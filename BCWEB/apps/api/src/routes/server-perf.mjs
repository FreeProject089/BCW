import os from 'node:os';
import { ALERT_THRESHOLDS, ALERT_THRESHOLD_KEYS, readThresholds, serverVerdict } from '../lib/thresholds.mjs';
import { z } from 'zod';
import { db, requireRole, requireCap, botAuth } from '../lib/lib.mjs';
import { windowBounds, summariseDaily, compareDaily, dailyPoint } from '../lib/metrics-compare.mjs';
import { checkSslExpiry, checkDependenciesTimed, cgroupMemory, sampleAndAlert, getDepsConfig, DEP_KEYS, DEP_LABELS, readNetBytes, getBandwidthByCat, getRepoUploadKbps, getRepoRateStats, sampleRepoRates } from '../lib/monitor.mjs';
import { realDiskStats } from './hosting.mjs';


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
  const siteUrl = process.env.SITE_URL || '';
  const isHttps = /^https:\/\//i.test(siteUrl);
  const host = siteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null;
  Promise.all([
    checkDependenciesTimed(p),
    // Only probe a cert when SITE_URL is actually https — in dev it's http://localhost
    // and Caddy provisions TLS in prod, so there's simply nothing to probe.
    isHttps ? checkSslExpiry(host) : Promise.resolve({ notHttps: true, url: siteUrl || null }),
  ]).then(([deps, ssl]) => { _probeCache = { ..._probeCache, deps, ssl, at: Date.now() }; })
    .catch(() => {})
    .finally(() => { _probeCache.refreshing = false; });
}
function cachedProbes(p) {
  // Kick off a background refresh when stale/empty; never await it.
  if (!_probeCache.deps || Date.now() - _probeCache.at > PROBE_TTL) refreshProbes(p);
  // `deps` stays booleans, because that is what the panel branched on and what every other
  // reader of this endpoint expects. `depsDetail` carries the timings beside it, and `depsAt`
  // is WHEN — the first question about a health panel, and the one it could not answer. It is
  // served stale-while-revalidate, so "green" on screen could be two minutes old or, right
  // after a boot, from a probe that has not finished; without a timestamp there is no way to
  // tell those apart from a live reading.
  const detail = _probeCache.deps || null;
  return {
    deps: detail ? Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, v.ok])) : null,
    depsDetail: detail,
    depsAt: _probeCache.at ? new Date(_probeCache.at).toISOString() : null,
    ssl: _probeCache.ssl,
  };
}

// Read-only monitoring — no dangerous action lives here, so plain ADMIN is enough
// (no step-up 2FA / canControlServer required, unlike server-control.mjs).
export default async function serverPerfRoutes(app) {
  // Warm the probe cache at boot so the first admin visit already has deps/SSL populated.
  db().then((p) => refreshProbes(p)).catch(() => {});
  // ── The daily figures, with the period before ──────────────────────────────
  //
  // This used to be the public status page's "System metrics" block: four charts of the
  // machine's daily CPU, memory, disk and latency. A visitor to a status page wants to know
  // whether the site is up, not how warm the CPU was on Tuesday — and the figures said more
  // about the machine than a public page should. They live here now, for the people who tune
  // it, with the one thing the public block never had: the same window immediately before,
  // and the change per metric. `manage_server` is the guard the status-page admin routes
  // already use — this is the same section, read the same way.
  app.get('/admin/server/metrics/daily', { preHandler: requireCap('manage_server', 'ADMIN') }, async (req) => {
    const p = await db();
    const { days, today, startCur, startPrev, previousTo } = windowBounds(req.query?.days);
    const [current, previous, oldest] = await Promise.all([
      p.serverMetricDaily.findMany({ where: { day: { gte: startCur } }, orderBy: { day: 'asc' } }),
      p.serverMetricDaily.findMany({ where: { day: { gte: startPrev, lt: startCur } }, orderBy: { day: 'asc' } }),
      p.serverMetricDaily.findFirst({ orderBy: { day: 'asc' }, select: { day: true } }),
    ]);
    const cur = summariseDaily(current);
    const prev = summariseDaily(previous);
    return {
      days, from: startCur, to: today, previousFrom: startPrev, previousTo,
      series: current.map(dailyPoint),
      current: cur, previous: prev,
      // Null when there is nothing before: a change against nothing is not a change of zero.
      change: cur && prev ? compareDaily(cur, prev) : null,
      coverage: {
        since: oldest?.day || null,
        daysHeld: oldest ? Math.round((today - new Date(oldest.day)) / 864e5) + 1 : 0,
        complete: !!oldest && new Date(oldest.day) <= startPrev,
      },
    };
  });

  // ── Long-range comparison ───────────────────────────────────────────────────
  //
  // Answers "how does this week compare with the one before", out to a year. It reads the DAILY
  // rollup, not the raw samples — those are pruned at 30 days, which is why this question had no
  // answer at all before. It reports what the history actually COVERS: a year requested against
  // three weeks of data is a real situation and must not be drawn as a flat line at zero.
  app.get('/admin/server/metrics/compare', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const days = Math.min(Math.max(Number(req.query?.days) || 7, 1), 366);
    const midnight = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const today = midnight(new Date());
    const startCur = new Date(today.getTime() - (days - 1) * 864e5);
    const startPrev = new Date(startCur.getTime() - days * 864e5);

    const [current, previous, oldest] = await Promise.all([
      p.serverMetricDaily.findMany({ where: { day: { gte: startCur } }, orderBy: { day: 'asc' } }),
      p.serverMetricDaily.findMany({ where: { day: { gte: startPrev, lt: startCur } }, orderBy: { day: 'asc' } }),
      p.serverMetricDaily.findFirst({ orderBy: { day: 'asc' }, select: { day: true } }),
    ]);

    // Weighted by the number of samples behind each day, so a day with four readings does not
    // count the same as a day with a hundred and forty.
    const summarise = (rows) => {
      if (!rows.length) return null;
      const n = rows.reduce((a, r) => a + (r.samples || 0), 0) || rows.length;
      const w = (f) => rows.reduce((a, r) => a + f(r) * (r.samples || 1), 0) / n;
      const down = rows.reduce((a, r) => a + (r.downMinutes || 0), 0);
      return {
        days: rows.length,
        samples: n,
        cpuAvg: w((r) => r.cpuAvg), cpuMax: Math.max(...rows.map((r) => r.cpuMax)),
        memAvg: w((r) => r.memAvg), memMax: Math.max(...rows.map((r) => r.memMax)),
        diskAvg: w((r) => r.diskAvg), diskMax: Math.max(...rows.map((r) => r.diskMax)),
        // Every one of these was already recorded per day and already exported to CSV. Only
        // the comparison ignored them — so the panel that exists to answer "is it getting
        // worse" could not answer it about the two things a visitor actually feels.
        loadAvg: w((r) => r.loadAvg || 0),
        latencyAvg: w((r) => r.latencyAvg || 0),
        netRxAvg: w((r) => r.netRxAvg || 0),
        netTxAvg: w((r) => r.netTxAvg || 0),
        downMinutes: down,
        // Uptime as a share, because "43 minutes" means nothing without knowing whether the
        // period was a day or a year. Clamped at 0: a day row can carry more down-minutes
        // than the window holds if the collector restarted, and a negative uptime is worse
        // than a rounded one.
        uptimePct: Math.max(0, 100 - (down / (rows.length * 1440)) * 100),
      };
    };

    const cur = summarise(current);
    const prev = summarise(previous);
    // A change against nothing is not a change. Returning 0 there would read as "no movement".
    const delta = (a, b) => (a == null || b == null ? null : a - b);
    return {
      days,
      from: startCur, to: today,
      series: current,
      current: cur,
      previous: prev,
      // Every field summarise() produces, compared. Listing them by hand is what left six of
      // them uncompared for months.
      change: cur && prev ? Object.fromEntries(
        ['cpuAvg', 'cpuMax', 'memAvg', 'memMax', 'diskAvg', 'diskMax',
          'loadAvg', 'latencyAvg', 'netRxAvg', 'netTxAvg', 'downMinutes', 'uptimePct']
          .map((k) => [k, delta(cur[k], prev[k])]),
      ) : null,
      // The window being compared against, named. "The one before" is not a date, and an
      // admin reading a regression needs to know which days it is being blamed on.
      previousFrom: startPrev,
      previousTo: new Date(startCur.getTime() - 864e5),
      // What the answer is actually built on, so a short history is visible rather than implied.
      coverage: {
        since: oldest?.day || null,
        daysHeld: oldest ? Math.round((today - new Date(oldest.day)) / 864e5) + 1 : 0,
        complete: !!oldest && new Date(oldest.day) <= startPrev,
      },
    };
  });

  app.get('/admin/server/metrics', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const hoursBack = Math.min(Number(req.query?.hours) || (24 * 7), 24 * 30);
    const since = new Date(Date.now() - hoursBack * 3600e3);
    // ONE machine's samples, not everyone's. Every metric in a sample is "the host as its
    // writer sees it": when a dev machine points at the prod database, or an old container
    // runs beside a new one, two machines interleave into one series and the chart draws a
    // sawtooth alternating between two real hosts — 24-core/1TB tiles over 4-vCPU history.
    //
    // WHICH one is now a choice, because "the host that answered" is only right while there
    // is one API container. The sampler runs from the sweeper, the sweeper is leader-elected
    // with a 9.5-minute lock on a 10-minute tick — so the lock lapses before each tick and
    // the WRITER rotates. Caddy round-robins, so the READER rotates too, independently. At
    // API_REPLICAS=3 that filter shows whichever third of the samples matched whoever
    // answered, a different third on every refresh, and reports your own replicas as
    // strangers writing into your database.
    //
    // `all` charts every host together. It is not the default and should not be: averaging a
    // 4-vCPU server with a 24-core dev box is the sawtooth again, wearing a different hat.
    // It is right when the hosts ARE comparable — replicas of one deployment — and the
    // person looking at the screen is the one who knows that.
    const me = os.hostname();
    const wantHost = typeof req.query?.host === 'string' ? req.query.host : '';
    const hostFilter = wantHost === 'all'
      ? {}
      : { host: { in: [wantHost || me, ''] } };
    const [history, probes, writers] = await Promise.all([
      p.serverMetricSample.findMany({
        where: { createdAt: { gte: since }, ...hostFilter },
        orderBy: { createdAt: 'asc' },
      }),
      cachedProbes(p),
      p.serverMetricSample.groupBy({
        // `_max: createdAt` rides along on the grouping that was already happening — no
        // extra query, and it is the one fact that separates a replica writing right now
        // from a container that died three deploys ago and left its samples behind.
        by: ['host'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        _max: { createdAt: true },
      }).catch(() => []),
    ]);
    const otherWriters = writers
      .filter((w) => w.host !== me && w.host !== '')
      .map((w) => ({ host: w.host, samples: w._count._all }));
    // Every host with samples in the window, for the selector. Sorted by volume so the one
    // doing most of the reporting is first — which on a rotating fleet is nobody in
    // particular, and that is itself worth seeing.
    // Live means "wrote within the last 25 minutes" — the same threshold the downtime gap
    // detector uses, because it is the same question: the tick is ~10 minutes, so one missed
    // tick is noise and two is an absence.
    const LIVE_MS = 25 * 60_000;
    const hosts = writers
      .filter((w) => w.host !== '')
      .map((w) => ({
        host: w.host,
        samples: w._count._all,
        lastAt: w._max?.createdAt || null,
        live: !!w._max?.createdAt && (Date.now() - new Date(w._max.createdAt).getTime()) < LIVE_MS,
      }))
      // Live ones first, then by volume. A list sorted by volume alone puts the busiest
      // GHOST above every container that is actually running.
      .sort((a, b) => (Number(b.live) - Number(a.live)) || (b.samples - a.samples));
    const { deps, depsDetail, depsAt, ssl } = probes;
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
    // The per-repo plan ceilings (admin-set) — used client-side to draw the CPU /
    // upload bars as "share of the maximum a single repo may request", which is
    // meaningful even when every repo is on the same plan (unlike a bar relative to
    // the current largest repo, which would then always read 100%).
    const ceilRows = await p.adminSetting.findMany({ where: { key: { in: ['hosting.maxCpuShare', 'hosting.maxUploadMbps'] } } });
    const ceil = Object.fromEntries(ceilRows.map((r) => [r.key, Number(r.value)]));
    const maxCpuShare = Number.isFinite(ceil['hosting.maxCpuShare']) && ceil['hosting.maxCpuShare'] > 0 ? ceil['hosting.maxCpuShare'] : 8;
    const maxUploadMbps = Number.isFinite(ceil['hosting.maxUploadMbps']) && ceil['hosting.maxUploadMbps'] > 0 ? ceil['hosting.maxUploadMbps'] : 1000;
    const liveUp = getRepoUploadKbps(); // { repoId: kbps } — live upload throughput now
    // Take a sample on the way past. The dashboard is polled every 30s while somebody has it
    // open, which is a perfectly good tick for this and costs one map read — and it means the
    // measurement exists even on a deployment whose sweeper interval is long.
    sampleRepoRates(Object.fromEntries(hostedRepos.map((r) => [r.id, r.uploadLimitKbps || 0])));
    const rateStats = getRepoRateStats(); // { repoId: { samples, avgKbps, maxKbps, underPct } }
    const repoAllocations = {
      repos: hostedRepos.map((r) => ({
        id: r.id, name: r.name, owner: r.owner?.displayName, status: r.status,
        cpuShare: r.cpuShare, uploadMbps: +(r.uploadLimitKbps / 1024).toFixed(1),
        // Live upload actually served right now (Mbps), 0 when idle.
        liveUploadMbps: +(((liveUp[r.id] || 0) / 1024)).toFixed(2),
        // What has actually been DELIVERED across every sample where this repo was serving,
        // against its own cap. Null when it has never been observed transferring — which is
        // "no data", and must not render as "0 Mbps delivered".
        delivered: rateStats[r.id]
          ? {
            samples: rateStats[r.id].samples,
            avgMbps: +((rateStats[r.id].avgKbps / 1024).toFixed(2)),
            maxMbps: +((rateStats[r.id].maxKbps / 1024).toFixed(2)),
            underPct: rateStats[r.id].underPct,
          }
          : null,
        storageUsedBytes: Number(r.storageUsedBytes), storageQuotaBytes: Number(r.storageQuotaBytes),
      })),
      totalCpuShare: +hostedRepos.reduce((a, r) => a + (r.cpuShare || 0), 0).toFixed(2),
      totalUploadMbps: +hostedRepos.reduce((a, r) => a + (r.uploadLimitKbps || 0) / 1024, 0).toFixed(1),
      hostCpuCores: os.cpus().length,
      maxCpuShare, maxUploadMbps,
    };
    // Current cumulative network counters — the client diffs these between its 30s
    // refreshes to show a LIVE download/upload rate (the sampled history is tick-average).
    const nb = readNetBytes();
    const net = nb ? { rx: nb.rx, tx: nb.tx, at: Date.now() } : null;
    // "Is the server all right" — the whole of Simple mode, answered here rather than by the
    // screen. It is the SAME comparison the monitor makes when it decides to raise an alert
    // (same thresholds, read by the same function), so what the dashboard says and what fires
    // an alert cannot disagree. Deriving it in the client would be the second opinion.
    const activeThresholds = await readThresholds(p);
    const verdict = serverVerdict(latest, activeThresholds);
    return { history, latest, verdict, thresholds: activeThresholds, deps, depsDetail, depsAt, ssl, cgroupMemory: cgroupMemory(), downtime: downtime.slice(-20), totals, repoAllocations, net, bandwidthByCat: await getBandwidthByCat(), otherWriters, hosts, host: me, charted: wantHost === 'all' ? 'all' : (wantHost || me) };
  });

  // Check them again, now.
  //
  // The cache is 2 minutes and refreshes in the background, which is right for a page load and
  // wrong for the moment somebody has just restarted a service and wants to know. Clearing
  // `at` makes the next read treat the cache as stale; the probe itself is not awaited, for
  // the same reason it never is — a slow dependency must not hold the request open.
  app.post('/admin/server/deps-recheck', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    _probeCache = { ..._probeCache, at: 0 };
    refreshProbes(p);
    return { ok: true };
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

  // ── Alert thresholds ──
  // Defaults live in monitor.mjs and are what an untouched install uses; this only stores
  // overrides. Returning the EFFECTIVE values (defaults merged with whatever is stored)
  // means the form shows what is actually in force rather than blank boxes that imply
  // "no threshold".
  const T_KEYS = ALERT_THRESHOLD_KEYS;
  const T_DEFAULTS = ALERT_THRESHOLDS;

  app.get('/admin/server/thresholds', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    return { thresholds: await readThresholds(p), defaults: T_DEFAULTS };
  });

  app.put('/admin/server/thresholds', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const shape = {};
    for (const k of T_KEYS) shape[k] = z.number().min(0).max(100000).optional();
    const b = z.object(shape).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // Store only what was sent; an absent key falls back to the default at read time, so
    // clearing a field returns it to the default rather than pinning it to zero — which
    // would silently mean "alert on everything".
    const value = {};
    for (const k of T_KEYS) if (b.data[k] !== undefined) value[k] = b.data[k];
    await p.adminSetting.upsert({ where: { key: 'alerts.thresholds' }, create: { key: 'alerts.thresholds', value }, update: { value } });
    return { ok: true, thresholds: { ...T_DEFAULTS, ...value } };
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

  // Acknowledge alerts. Without an id it acknowledges everything currently unacknowledged,
  // which is the honest meaning of the button ("I have seen these") — acknowledging is not
  // resolving, and nothing about the underlying condition changes.
  /**
   * Empty the performance history.
   *
   * The case this exists for is the one that produced the sawtooth: a second machine wrote
   * into this database and half the history describes a host that was never the server. Once
   * the second writer is gone, that history is not worth reading and cannot be repaired —
   * only dropped.
   *
   * Scoped, because "clear" means four different things here and an admin should say which:
   * the raw samples, the daily rollups derived from them, the alert log, or the outage
   * record. `all` is spelled out rather than being the default — this is not recoverable.
   */
  const PERF_TABLES = {
    samples: 'serverMetricSample',
    daily: 'serverMetricDaily',
    alerts: 'serverAlertLog',
    outages: 'serviceOutage',
  };
  app.post('/admin/server/clear', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      table: z.enum([...Object.keys(PERF_TABLES), 'all']),
      // Drop only what ANOTHER host wrote — the sawtooth case, where this server's own
      // history is the part worth keeping.
      otherHostsOnly: z.boolean().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const names = b.data.table === 'all' ? Object.keys(PERF_TABLES) : [b.data.table];
    const cleared = {};
    for (const name of names) {
      const model = p[PERF_TABLES[name]];
      if (!model) continue;
      // otherHostsOnly applies to samples alone: they are the only rows that record WHO
      // measured. A rollup is already a mix of every writer for that day, so "the other
      // host's daily row" is not a thing that exists.
      const where = (b.data.otherHostsOnly && name === 'samples')
        ? { host: { notIn: [os.hostname(), ''] } }
        : {};
      const { count } = await model.deleteMany({ where }).catch(() => ({ count: 0 }));
      cleared[name] = count;
    }
    return { ok: true, cleared, host: os.hostname() };
  });

  app.post('/admin/server/alerts/ack', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const id = typeof req.body?.id === 'string' ? req.body.id : null;
    const where = id ? { id, ackAt: null } : { ackAt: null };
    const r = await p.serverAlertLog.updateMany({ where, data: { ackAt: new Date(), ackById: req.user.uid } });
    return { ok: true, acknowledged: r.count };
  });

  // Outage history. Open outages come back with endedAt null rather than being hidden, so
  // "still down" and "was down for 4 minutes" are the same list.
  app.get('/admin/server/outages', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const take = Math.min(Number(req.query?.take) || 50, 200);
    const days = Math.min(Number(req.query?.days) || 30, 90);
    const rows = await p.serviceOutage.findMany({
      where: { startedAt: { gte: new Date(Date.now() - days * 864e5) } },
      orderBy: { startedAt: 'desc' }, take,
    });
    const outages = rows.map((o) => ({
      id: o.id, dep: o.dep, label: DEP_LABELS[o.dep] || o.dep, cause: o.cause,
      startedAt: o.startedAt, endedAt: o.endedAt,
      seconds: Math.max(0, Math.round(((o.endedAt || new Date()).getTime() - o.startedAt.getTime()) / 1000)),
      ongoing: !o.endedAt,
    }));
    // Availability over the window, per dependency — the number a status page would show.
    const windowSec = days * 86400;
    const byDep = {};
    for (const o of outages) byDep[o.dep] = (byDep[o.dep] || 0) + o.seconds;
    const uptime = Object.entries(byDep).map(([dep, sec]) => ({
      dep, label: DEP_LABELS[dep] || dep, downSeconds: sec,
      pct: Math.max(0, Math.round((1 - sec / windowSec) * 10000) / 100),
    })).sort((a, b) => b.downSeconds - a.downSeconds);
    return { outages, uptime, days };
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
