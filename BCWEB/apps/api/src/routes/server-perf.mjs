import os from 'node:os';
import { z } from 'zod';
import { db, requireRole } from '../lib.mjs';
import { checkSslExpiry, checkDependencies, cgroupMemory, sampleAndAlert, getDepsConfig, DEP_KEYS, DEP_LABELS, readNetBytes, getBandwidthByCat } from '../monitor.mjs';
import { realDiskStats } from './hosting.mjs';

const BOT_SECRET = () => process.env.BOT_SHARED_SECRET || process.env.LINK_LOOKUP_SECRET || 'dev-bot-secret';
function botAuth(req, reply) {
  if ((req.headers['x-bot-secret'] || '') !== BOT_SECRET()) { reply.code(401).send({ error: 'unauthorized' }); return false; }
  return true;
}

// The dependency checks + SSL probe do live network I/O (a TLS handshake to the site,
// Redis/DB/MinIO pings) that took seconds. Running them inline made the /metrics endpoint
// slow — even the first page load blocked on them. Serve them stale-while-revalidate:
// return whatever we have IMMEDIATELY (null on the very first hit) and refresh in the
// background, so the endpoint is always fast. The CPU/RAM/disk history is a cheap DB read.
let _probeCache = { deps: null, ssl: null, at: 0, refreshing: false };
const PROBE_TTL = 2 * 60e3;
function refreshProbes(p) {
  if (_probeCache.refreshing) return;
  _probeCache.refreshing = true;
  Promise.all([
    checkDependencies(p),
    checkSslExpiry((process.env.SITE_URL || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null),
  ]).then(([deps, ssl]) => { _probeCache = { ..._probeCache, deps, ssl, at: Date.now() }; })
    .catch(() => {})
    .finally(() => { _probeCache.refreshing = false; });
}
function cachedProbes(p) {
  // Kick off a background refresh when stale/empty; never await it.
  if (!_probeCache.deps || Date.now() - _probeCache.at > PROBE_TTL) refreshProbes(p);
  return { deps: _probeCache.deps, ssl: _probeCache.ssl };
}

// Read-only monitoring — no dangerous action lives here, so plain ADMIN is enough
// (no step-up 2FA / canControlServer required, unlike server-control.mjs).
export default async function serverPerfRoutes(app) {
  // Warm the probe cache at boot so the first admin visit already has deps/SSL populated.
  db().then((p) => refreshProbes(p)).catch(() => {});
  app.get('/admin/server/metrics', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const hoursBack = Math.min(Number(req.query?.hours) || (24 * 7), 24 * 30);
    const since = new Date(Date.now() - hoursBack * 3600e3);
    const [history, probes] = await Promise.all([
      p.serverMetricSample.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'asc' } }),
      cachedProbes(p),
    ]);
    const { deps, ssl } = probes;
    const latest = history[history.length - 1] || null;
    // Downtime gaps: consecutive samples more than 2x the ~10-min tick apart imply
    // the sweeper (and so the API process) wasn't running in between.
    const downtime = [];
    for (let i = 1; i < history.length; i++) {
      const gapMin = (history[i].createdAt - history[i - 1].createdAt) / 60000;
      if (gapMin > 25) downtime.push({ from: history[i - 1].createdAt, to: history[i].createdAt, minutes: Math.round(gapMin) });
    }
    // Availability % over the queried window: window length minus total downtime,
    // measured from the first sample actually seen (not the full requested window,
    // if history doesn't go back that far yet) through now.
    const totalDowntimeMs = downtime.reduce((a, d) => a + d.minutes * 60000, 0);
    const windowStart = history[0]?.createdAt ? new Date(history[0].createdAt).getTime() : Date.now();
    const windowMs = Math.max(1, Date.now() - windowStart);
    const uptimePct = history.length > 1 ? Math.max(0, Math.min(100, 100 * (1 - totalDowntimeMs / windowMs))) : null;
    const disk = realDiskStats();
    const totals = {
      cpuCores: os.cpus().length,
      memTotalBytes: os.totalmem(),
      memFreeBytes: os.freemem(),
      diskTotalBytes: disk.totalBytes,
      diskFreeBytes: disk.freeBytes,
      uptimePct,
    };
    // Per-repo ALLOCATED resources (not live "used": hosted repos aren't isolated
    // processes yet — the provisioner is a scaffold, cpuShare/uploadLimitKbps are plan
    // allotments a future container deploy would enforce). This shows what each repo is
    // allocated + the total vCPU committed vs the host's core count.
    const hostedRepos = await p.serverRepo.findMany({
      where: { hosted: true }, orderBy: { cpuShare: 'desc' }, take: 300,
      select: { id: true, name: true, status: true, cpuShare: true, uploadLimitKbps: true, storageQuotaBytes: true, storageUsedBytes: true, owner: { select: { displayName: true } } },
    });
    const repoAllocations = {
      repos: hostedRepos.map((r) => ({
        id: r.id, name: r.name, owner: r.owner?.displayName, status: r.status,
        cpuShare: r.cpuShare, uploadMbps: +(r.uploadLimitKbps / 1024).toFixed(1),
        storageUsedBytes: Number(r.storageUsedBytes), storageQuotaBytes: Number(r.storageQuotaBytes),
      })),
      totalCpuShare: +hostedRepos.reduce((a, r) => a + (r.cpuShare || 0), 0).toFixed(2),
      totalUploadMbps: +hostedRepos.reduce((a, r) => a + (r.uploadLimitKbps || 0) / 1024, 0).toFixed(1),
      hostCpuCores: os.cpus().length,
    };
    // Current cumulative network counters — the client diffs these between its 30s
    // refreshes to show a LIVE download/upload rate (the sampled history is tick-average).
    const nb = readNetBytes();
    const net = nb ? { rx: nb.rx, tx: nb.tx, at: Date.now() } : null;
    return { history, latest, deps, ssl, cgroupMemory: cgroupMemory(), downtime: downtime.slice(-20), totals, repoAllocations, net, bandwidthByCat: getBandwidthByCat() };
  });

  // Which dependencies to check at all — an admin can turn off ones that aren't
  // relevant to their deployment (e.g. Stripe on a non-commercial instance).
  app.get('/admin/server/deps-config', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    return { enabled: await getDepsConfig(p), labels: DEP_LABELS, keys: DEP_KEYS };
  });
  app.put('/admin/server/deps-config', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const shape = Object.fromEntries(DEP_KEYS.map((k) => [k, z.boolean().optional()]));
    const b = z.object(shape).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cur = await getDepsConfig(p);
    const next = { ...cur, ...b.data };
    await p.adminSetting.upsert({ where: { key: 'serverperf.deps' }, create: { key: 'serverperf.deps', value: next }, update: { value: next } });
    _probeCache.at = 0; // force a fresh dependency check on the next metrics fetch
    return { enabled: next };
  });

  app.get('/admin/server/alerts', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const take = Math.min(Number(req.query?.take) || 100, 300);
    const alerts = await p.serverAlertLog.findMany({ orderBy: { createdAt: 'desc' }, take });
    return { alerts };
  });

  // Manual "sample now" — handy right after changing alert thresholds/config, and
  // used by the dashboard's refresh button instead of waiting for the next tick.
  app.post('/admin/server/sample-now', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    return await sampleAndAlert(p, app.log);
  });

  // ── Bot polling (same shape as /bot/blog/unannounced) ──
  app.get('/bot/alerts/unannounced', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const p = await db();
    const alerts = await p.serverAlertLog.findMany({ where: { announced: false }, orderBy: { createdAt: 'asc' }, take: 20 });
    return { alerts };
  });
  app.post('/bot/alerts/announced', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ ids: z.array(z.string()).max(50) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.serverAlertLog.updateMany({ where: { id: { in: b.data.ids } }, data: { announced: true } });
    return { ok: true };
  });
}
