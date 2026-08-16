// Server performance monitoring: metric sampling, dependency/SSL checks, and
// threshold alerting. Everything here reads from what's actually visible from
// INSIDE this container (os.*, this process's own cgroup, the mounted rootfs) —
// no Docker-socket or host access is assumed. Per-container/per-service
// breakdowns (a separate, larger ask) would need that socket; see server-perf.mjs.
import os from 'node:os';
import fs from 'node:fs';
import tls from 'node:tls';
import { Transform } from 'node:stream';
import { realDiskStats } from '../routes/hosting.mjs';
import { checkStorageHealth } from './storage.mjs';
import { notify } from './lib.mjs';

// ── CPU% — classic two-snapshot os.cpus() diff (reflects what this container's
// scheduler sees; under an unrestricted cgroup that's effectively the host's). ──
function cpuSnapshot() {
  return os.cpus().reduce((a, c) => { for (const k in c.times) a[k] = (a[k] || 0) + c.times[k]; return a; }, {});
}
/**
 * Fold one day's raw samples into the row that outlives them.
 *
 * Idempotent on the day: an upsert, so a restart, a double tick or a manual re-run recomputes
 * rather than double-counting. A day with no samples writes nothing — a row of zeroes would
 * read as "the server was idle" when it means "we were not watching".
 */
export async function rollUpDay(p, when) {
  const day = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()));
  const next = new Date(day.getTime() + 864e5);
  const rows = await p.serverMetricSample.findMany({
    where: { createdAt: { gte: day, lt: next } },
    orderBy: { createdAt: 'asc' },
  });
  if (!rows.length) return null;

  const avg = (f) => rows.reduce((a, r) => a + (f(r) ?? 0), 0) / rows.length;
  const max = (f) => rows.reduce((a, r) => Math.max(a, f(r) ?? 0), 0);
  // Only average the samples that HAVE the value: latency and throughput are nullable, and
  // treating a missing reading as zero would quietly report a fast day.
  const avgOf = (f) => { const v = rows.map(f).filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  // Same rule the metrics endpoint uses: a gap of more than 25 minutes between two ~10-minute
  // ticks means nothing was running in between.
  let downMinutes = 0;
  for (let i = 1; i < rows.length; i++) {
    const gap = (rows[i].createdAt - rows[i - 1].createdAt) / 60000;
    if (gap > 25) downMinutes += Math.round(gap);
  }

  const data = {
    cpuAvg: avg((r) => r.cpuPct), cpuMax: max((r) => r.cpuPct),
    memAvg: avg((r) => r.memPct), memMax: max((r) => r.memPct),
    diskAvg: avg((r) => r.diskPct), diskMax: max((r) => r.diskPct),
    loadAvg: avg((r) => r.loadAvg1),
    latencyAvg: avgOf((r) => r.latencyMs),
    netRxAvg: avgOf((r) => r.netRxKbps),
    netTxAvg: avgOf((r) => r.netTxKbps),
    samples: rows.length,
    downMinutes,
  };
  return p.serverMetricDaily.upsert({ where: { day }, create: { day, ...data }, update: data });
}

export async function sampleCpuPct(windowMs = 200) {
  const a = cpuSnapshot();
  await new Promise((r) => setTimeout(r, windowMs));
  const b = cpuSnapshot();
  const totalA = Object.values(a).reduce((x, y) => x + y, 0);
  const totalB = Object.values(b).reduce((x, y) => x + y, 0);
  const idleA = a.idle; const idleB = b.idle;
  const totalDiff = totalB - totalA; const idleDiff = idleB - idleA;
  return totalDiff > 0 ? Math.max(0, Math.min(100, 100 * (1 - idleDiff / totalDiff))) : 0;
}

// This process's own cgroup v2 memory usage (bytes) — more accurate than the host
// figure for "how much is THIS app using", when the cgroup file is readable.
function cgroupMemoryBytes() {
  try { return Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim()); } catch { return null; }
}
function cgroupMemoryLimitBytes() {
  try {
    const raw = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    return raw === 'max' ? null : Number(raw);
  } catch { return null; }
}

export async function checkSslExpiry(hostname, port = 443) {
  if (!hostname) return null;
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port, servername: hostname, timeout: 6000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert?.valid_to) return resolve(null);
      const expiresAt = new Date(cert.valid_to);
      resolve({ expiresAt: expiresAt.toISOString(), daysLeft: Math.round((expiresAt - Date.now()) / 864e5) });
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

// ── Dependency checks — each is individually enable-able from the admin UI
// (AdminSetting "serverperf.deps"). `null` means "not applicable / not
// configured" (e.g. Stripe with no key set), distinct from `false` (checked and
// found down) so the UI doesn't cry wolf over an intentionally-unused integration. ──
const DEP_CHECKS = {
  db: async (p) => p.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
  storage: async () => checkStorageHealth(),
  bot: async (p) => {
    const botStatus = await p.adminSetting.findUnique({ where: { key: 'bot.status' } }).catch(() => null);
    const botFresh = botStatus?.value?.at ? (Date.now() - new Date(botStatus.value.at).getTime() < 120_000) : null;
    return botFresh === null ? null : (botFresh && botStatus.value.online !== false);
  },
  telemetry: async () => {
    try { const r = await fetch('http://telemetry:8900/', { signal: AbortSignal.timeout(4000) }); return r.ok; } catch { return false; }
  },
  // The site itself. A status page that lists the database, the bot and Stripe but not the
  // website cannot answer the question people open it to ask. Probed as a real request to the
  // web container, not self-reported: the API and the site fail separately — an API outage is
  // exactly what people would be reading this page during.
  //
  // There is deliberately no "API" row. This answer comes FROM the API, so it could only ever
  // say "up", and a row that cannot report a failure is worse than no row.
  web: async () => {
    try { const r = await fetch('http://web/', { signal: AbortSignal.timeout(4000) }); return r.ok; } catch { return false; }
  },
  stripe: async () => {
    if (!process.env.STRIPE_SECRET_KEY) return null;
    try { const r = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }, signal: AbortSignal.timeout(5000) }); return r.ok; }
    catch { return false; }
  },
};
export const DEP_LABELS = { db: 'Database', storage: 'Object storage', bot: 'Discord bot', telemetry: 'Telemetry dashboard', web: 'Website', stripe: 'Stripe' };
export const DEP_KEYS = Object.keys(DEP_CHECKS);

export async function getDepsConfig(p) {
  const row = await p.adminSetting.findUnique({ where: { key: 'serverperf.deps' } });
  return { db: true, storage: true, bot: true, telemetry: true, web: true, stripe: true, ...(row?.value || {}) };
}

export async function checkDependencies(p) {
  const enabled = await getDepsConfig(p);
  const keys = DEP_KEYS.filter((k) => enabled[k] !== false);
  const results = await Promise.all(keys.map(async (k) => [k, await DEP_CHECKS[k](p).catch(() => false)]));
  return Object.fromEntries(results);
}

// ── In-process request stats (response times + status codes) — reset every
// sample so each ServerMetricSample reflects "since the last tick". ──
let _reqStats = { count: 0, totalMs: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
// Bytes served per category since process start — answers "what's using the bandwidth"
// (repo hosting downloads vs catalog/submission payloads vs media vs the rest). Counted
// from Content-Length on each response (streams without one are under-counted). Telemetry
// is a separate service (not served by this API), so it can't be measured here.
const _bwByCat = { repo: 0, catalog: 0, media: 0, other: 0 };
function bwCategory(url = '') {
  if (url.startsWith('/hosting/') || /^\/(admin\/)?repos\/[^/]+\/files/.test(url)) return 'repo';
  if (url.startsWith('/catalog/') || url.startsWith('/admin/catalog/')) return 'catalog';
  if (url.startsWith('/media/') || url.startsWith('/api/media/')) return 'media';
  return 'other';
}
export function getBandwidthByCat() { return { ..._bwByCat }; }

// ── Live per-repo upload throughput ──
// Bytes actually SENT to clients for each hosted repo's files, timestamped, so we can
// report a real-time upload rate per repo (0 when idle, the live kbit/s when serving).
// Sliding window: only the last REPO_BW_WINDOW ms count, so it reflects current
// activity rather than a lifetime total. Called from the repo file streamer.
const _repoBw = new Map(); // repoId -> [{ t, bytes }…] within the window
const REPO_BW_WINDOW = 10_000;
export function recordRepoBytes(repoId, bytes) {
  const b = Number(bytes);
  if (!repoId || !(b > 0)) return;
  let arr = _repoBw.get(repoId);
  if (!arr) { arr = []; _repoBw.set(repoId, arr); }
  arr.push({ t: Date.now(), bytes: b });
}
// { repoId: kbps } over the sliding window. Idle repos report nothing (omitted).
export function getRepoUploadKbps() {
  const now = Date.now();
  const out = {};
  for (const [id, arr] of _repoBw) {
    let i = 0; while (i < arr.length && now - arr[i].t > REPO_BW_WINDOW) i++;
    if (i) arr.splice(0, i);
    if (!arr.length) { _repoBw.delete(id); continue; }
    const bytes = arr.reduce((a, s) => a + s.bytes, 0);
    // kbps = bits / ms. Divide by the fixed window so a sustained transfer reads its
    // true rate and a lone recent chunk doesn't inflate to an unrealistic spike.
    out[id] = Math.max(0, Math.round((bytes * 8) / REPO_BW_WINDOW));
  }
  return out;
}
// A passthrough stream that meters bytes for a repo as they flow to the client.
export function repoMeter(repoId) {
  return new Transform({
    transform(chunk, _enc, cb) { recordRepoBytes(repoId, chunk.length); cb(null, chunk); },
  });
}

export function recordRequest(ms, statusCode, url, bytes) {
  _reqStats.count++; _reqStats.totalMs += ms;
  if (statusCode < 300) _reqStats.s2xx++; else if (statusCode < 400) _reqStats.s3xx++; else if (statusCode < 500) _reqStats.s4xx++; else _reqStats.s5xx++;
  const b = Number(bytes);
  if (b > 0) _bwByCat[bwCategory(url)] += b;
}
function flushRequestStats() {
  const snap = _reqStats;
  _reqStats = { count: 0, totalMs: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
  return snap;
}

const ALERT_DEBOUNCE_MS = 30 * 60 * 1000; // don't re-alert the SAME message more than every 30 min
async function maybeAlert(p, kind, message) {
  // Debounce on kind + message (not kind alone): a persistent "Object storage is
  // unreachable" no longer spams, but a DIFFERENT dependency failing the same tick
  // still alerts instead of being swallowed by the first one's cooldown.
  const recent = await p.serverAlertLog.findFirst({ where: { kind, message }, orderBy: { createdAt: 'desc' } });
  if (recent && Date.now() - recent.createdAt.getTime() < ALERT_DEBOUNCE_MS) return null;
  return p.serverAlertLog.create({ data: { kind, message } });
}

// Network throughput from /proc/net/dev (Linux container): sum rx/tx bytes across real
// interfaces (skip loopback), then derive kbit/s from the delta since the last sample.
// First call returns null (no baseline yet). Falls back to null off-Linux.
// Cumulative rx/tx byte counters across real interfaces (skip loopback). Off-Linux → null.
export function readNetBytes() {
  try {
    const txt = fs.readFileSync('/proc/net/dev', 'utf8');
    let rx = 0, tx = 0;
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([^:]+):\s*(.+)$/);
      if (!m) continue;
      const iface = m[1].trim();
      if (iface === 'lo' || iface.startsWith('lo')) continue;
      const cols = m[2].trim().split(/\s+/).map(Number);
      rx += cols[0] || 0; tx += cols[8] || 0; // rx bytes = col 0, tx bytes = col 8
    }
    return { rx, tx };
  } catch { return null; }
}
let _netPrev = null;
function netRate() {
  const cur = readNetBytes();
  if (!cur) return { rxKbps: null, txKbps: null };
  const now = Date.now();
  let rxKbps = null, txKbps = null;
  if (_netPrev && now > _netPrev.at) {
    const dt = (now - _netPrev.at) / 1000;
    rxKbps = Math.max(0, Math.round(((cur.rx - _netPrev.rx) * 8) / 1000 / dt));
    txKbps = Math.max(0, Math.round(((cur.tx - _netPrev.tx) * 8) / 1000 / dt));
  }
  _netPrev = { ...cur, at: now };
  return { rxKbps, txKbps };
}

// The sweeper's per-tick entry point: sample metrics, persist history, run
// threshold checks, and fire (debounced) alerts. Never throws.

// ── Thresholds ───────────────────────────────────────────────────────────────
// Admin-settable, with the previous hardcoded values as defaults so nothing changes for an
// installation that never touches them. Read per tick rather than cached: the tick is every
// ten minutes, one settings read is free next to the sampling it accompanies, and a cached
// copy would mean a threshold change quietly not taking effect until a restart.
const T_DEFAULTS = {
  cpuPct: 90,
  memPct: 90,
  diskPct: 90,
  storagePct: 85,      // a hosting pool this full needs action BEFORE it refuses an upload
  vitalsPoorPct: 25,   // share of "poor" samples on a metric that counts as degraded
  vitalsMinSamples: 20, // below this, a couple of bad loads would fire on noise
  errorBurst: 10,      // new errors within the window
};
async function thresholds(p) {
  const row = await p.adminSetting.findUnique({ where: { key: 'alerts.thresholds' } }).catch(() => null);
  const v = (row?.value && typeof row.value === 'object') ? row.value : {};
  const out = { ...T_DEFAULTS };
  for (const k of Object.keys(T_DEFAULTS)) {
    const n = Number(v[k]);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

// ── Web Vitals ───────────────────────────────────────────────────────────────
// Alerts on the SHARE of poor samples, not on any single bad one: a slow load happens, a
// quarter of them being slow is a regression. `rating` is what the web-vitals library
// itself decided, so this reports the browser's verdict rather than re-deriving thresholds
// that would drift from it.
async function vitalsAlerts(p, t) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const rows = await p.webVital.groupBy({
    by: ['metric', 'rating'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  }).catch(() => []);
  const totals = new Map(); // metric -> { all, poor }
  for (const r of rows) {
    const e = totals.get(r.metric) || { all: 0, poor: 0 };
    e.all += r._count._all;
    if (r.rating === 'poor') e.poor += r._count._all;
    totals.set(r.metric, e);
  }
  const out = [];
  for (const [metric, e] of totals) {
    if (e.all < t.vitalsMinSamples) continue;
    const pct = (100 * e.poor) / e.all;
    if (pct >= t.vitalsPoorPct) {
      out.push({ kind: 'web_vitals', message: `${metric}: ${pct.toFixed(0)}% of the last ${e.all} samples rated "poor" (threshold ${t.vitalsPoorPct}%).` });
    }
  }
  return out;
}

// ── Hosting storage ──────────────────────────────────────────────────────────
// A pool that fills up stops accepting uploads, and the owner finds out by failing. This
// warns while there is still room to act. Reported per pool, so the message names the one
// that needs attention rather than an aggregate nobody can act on.
async function storageAlerts(p, t) {
  const groups = await p.hostingGroup.findMany({ select: { id: true, name: true, poolBytes: true } }).catch(() => []);
  const out = [];
  for (const g of groups) {
    const cap = Number(g.poolBytes || 0);
    if (cap <= 0) continue;
    // ServerRepo joins a pool through `groupId`, NOT `hostingGroupId` — that name belongs
    // to Subscription. The first version used it and Prisma rejected the query, which the
    // wrapper above would have swallowed: no storage alert would ever have fired, and
    // nothing anywhere would have said why.
    const agg = await p.serverRepo.aggregate({ where: { groupId: g.id }, _sum: { storageUsedBytes: true } });
    const used = Number(agg?._sum?.storageUsedBytes || 0);
    const pct = (100 * used) / cap;
    if (pct >= t.storagePct) {
      out.push({ kind: 'storage', message: `Storage pool "${g.name}" is ${pct.toFixed(0)}% full (${(used / 1e9).toFixed(1)} of ${(cap / 1e9).toFixed(1)} GB).` });
    }
  }
  return out;
}

// ── Errors ───────────────────────────────────────────────────────────────────
// A burst, not every error: one exception is a bug report, ten in ten minutes is an
// incident. Server errors are counted separately from client ones because a 5xx storm and
// a broken third-party script are different problems with different responses.
async function errorAlerts(p, t) {
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const out = [];
  for (const source of ['server', 'client']) {
    const n = await p.errorEvent.count({ where: { source, createdAt: { gte: since } } }).catch(() => 0);
    if (n >= t.errorBurst) {
      out.push({ kind: 'errors', message: `${n} new ${source} error(s) in the last 10 minutes (threshold ${t.errorBurst}).` });
    }
  }
  return out;
}

/** Open an outage the first tick a dependency fails, close it the first tick it answers.
 *
 *  Idempotent by construction: "the open outage for this dep" is a unique-enough query that
 *  a repeated failing tick extends the existing row rather than creating a second one.
 */
export async function recordOutages(p, deps, inGrace) {
  for (const [dep, ok] of Object.entries(deps)) {
    if (ok === null || ok === undefined) continue; // not configured — not an outage
    const open = await p.serviceOutage.findFirst({ where: { dep, endedAt: null }, orderBy: { startedAt: 'desc' } });
    if (ok === false) {
      if (!open && !inGrace) {
        await p.serviceOutage.create({ data: { dep, cause: `${DEP_LABELS[dep] || dep} is unreachable.` } });
        // Only on the TRANSITION — inside `!open`, so a service that stays down for an hour
        // sends one message, not one every tick. Imported lazily to keep the notifier (and its
        // mail dependencies) out of the hot sampling path when nobody subscribes.
        const { notifyStatusChange } = await import('./status-notify.mjs');
        await notifyStatusChange(p, dep, 'down').catch(() => {});
      }
    } else if (open) {
      await p.serviceOutage.update({ where: { id: open.id }, data: { endedAt: new Date() } });
      const { notifyStatusChange } = await import('./status-notify.mjs');
      await notifyStatusChange(p, dep, 'up', open.startedAt).catch(() => {});
    }
  }
}

export async function sampleAndAlert(p, log) {
  try {
    const [cpuPct, deps] = await Promise.all([sampleCpuPct(), checkDependencies(p)]);
    const disk = realDiskStats();
    const diskPct = disk.totalBytes ? 100 * (1 - disk.freeBytes / disk.totalBytes) : 0;
    const memPct = 100 * (1 - os.freemem() / os.totalmem());
    const reqStats = flushRequestStats();
    const latencyMs = reqStats.count ? Math.round(reqStats.totalMs / reqStats.count) : null;
    const { rxKbps, txKbps } = netRate();

    await p.serverMetricSample.create({ data: {
      cpuPct, memPct, diskPct, loadAvg1: os.loadavg()[0], uptimeSec: Math.round(process.uptime()), latencyMs,
      netRxKbps: rxKbps, netTxKbps: txKbps,
    } });
    // Summarise BEFORE pruning, or the summary would be missing exactly the days the prune
    // takes. Yesterday and today: yesterday because it is now complete, today so the dashboard
    // has a current row to compare against rather than a gap.
    await rollUpDay(p, new Date(Date.now() - 864e5)).catch(() => {});
    await rollUpDay(p, new Date()).catch(() => {});

    // Keep 30 days of raw history — enough for the dashboard's trend graph without the table
    // growing unbounded (one row per ~10 min tick). Anything older lives on as a daily row.
    await p.serverMetricSample.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 864e5) } } });

    const t = await thresholds(p);
    const alerts = [];
    if (cpuPct > t.cpuPct) alerts.push(await maybeAlert(p, 'cpu', `CPU usage at ${cpuPct.toFixed(0)}% (>${t.cpuPct}%).`));
    if (memPct > t.memPct) alerts.push(await maybeAlert(p, 'mem', `Memory usage at ${memPct.toFixed(0)}% (>${t.memPct}%).`));
    if (diskPct > t.diskPct) alerts.push(await maybeAlert(p, 'disk', `Disk usage at ${diskPct.toFixed(0)}% (>${t.diskPct}%).`));
    // The non-machine signals. Each returns a list, and each is wrapped: a failure to
    // COUNT errors must never stop the CPU alert from firing, which is the one that says
    // the box is about to fall over.
    for (const fn of [vitalsAlerts, storageAlerts, errorAlerts]) {
      try {
        for (const a of await fn(p, t)) alerts.push(await maybeAlert(p, a.kind, a.message));
      } catch (e) { log?.warn?.({ e: String(e?.message || e) }, `monitor: ${fn.name} failed`); }
    }
    // Startup grace: right after the stack boots, dependencies (esp. the Discord
    // bot, whose heartbeat is only "fresh" ~2 min after IT starts) haven't had
    // time to report in — alerting immediately was a guaranteed false positive.
    const inGrace = process.uptime() < 240; // 4 min
    for (const [key, ok] of Object.entries(deps)) {
      if (ok === false && !inGrace) alerts.push(await maybeAlert(p, 'service_down', `${DEP_LABELS[key] || key} is unreachable.`));
    }
    // Outage history is kept separately from the alert log, because they answer different
    // questions: the log says "it broke" (once per debounce window), this says "it was down
    // from X to Y". Only recorded outside the grace window on the way DOWN — a dependency
    // that comes back is always closed, even if the outage was opened before a restart.
    try { await recordOutages(p, deps, inGrace); }
    catch (e) { log?.warn?.({ e: String(e?.message || e) }, 'monitor: outage bookkeeping failed'); }
    const fired = alerts.filter(Boolean);

    // Also notify every SUPERADMIN in-app so an alert isn't only visible to
    // whoever happens to open the Security/perf tab.
    if (fired.length) {
      const admins = await p.user.findMany({ where: { role: 'SUPERADMIN' }, select: { id: true } });
      for (const a of admins) for (const f of fired) await notify(p, a.id, 'server_alert', f.message);
    }
    return { sampled: true, cpuPct, memPct, diskPct, alertsFired: fired.length };
  } catch (e) { log?.warn?.({ e: String(e?.message || e) }, 'monitor: sample failed'); return { sampled: false }; }
}

export function cgroupMemory() { return { usedBytes: cgroupMemoryBytes(), limitBytes: cgroupMemoryLimitBytes() }; }
