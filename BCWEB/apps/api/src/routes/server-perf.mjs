import os from 'node:os';
import { z } from 'zod';
import { db, requireRole } from '../lib.mjs';
import { checkSslExpiry, checkDependencies, cgroupMemory, sampleAndAlert, getDepsConfig, DEP_KEYS, DEP_LABELS } from '../monitor.mjs';
import { realDiskStats } from './hosting.mjs';

const BOT_SECRET = () => process.env.BOT_SHARED_SECRET || process.env.LINK_LOOKUP_SECRET || 'dev-bot-secret';
function botAuth(req, reply) {
  if ((req.headers['x-bot-secret'] || '') !== BOT_SECRET()) { reply.code(401).send({ error: 'unauthorized' }); return false; }
  return true;
}

// Read-only monitoring — no dangerous action lives here, so plain ADMIN is enough
// (no step-up 2FA / canControlServer required, unlike server-control.mjs).
export default async function serverPerfRoutes(app) {
  app.get('/admin/server/metrics', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const hoursBack = Math.min(Number(req.query?.hours) || (24 * 7), 24 * 30);
    const since = new Date(Date.now() - hoursBack * 3600e3);
    const [history, deps] = await Promise.all([
      p.serverMetricSample.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'asc' } }),
      checkDependencies(p),
    ]);
    const latest = history[history.length - 1] || null;
    const ssl = await checkSslExpiry((process.env.SITE_URL || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null);
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
    return { history, latest, deps, ssl, cgroupMemory: cgroupMemory(), downtime: downtime.slice(-20), totals };
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
