// Server performance monitoring: metric sampling, dependency/SSL checks, and
// threshold alerting. Everything here reads from what's actually visible from
// INSIDE this container (os.*, this process's own cgroup, the mounted rootfs) —
// no Docker-socket or host access is assumed. Per-container/per-service
// breakdowns (a separate, larger ask) would need that socket; see server-perf.mjs.
import os from 'node:os';
import fs from 'node:fs';
import tls from 'node:tls';
import { realDiskStats } from './routes/hosting.mjs';
import { checkStorageHealth } from './storage.mjs';
import { notify } from './lib.mjs';

// ── CPU% — classic two-snapshot os.cpus() diff (reflects what this container's
// scheduler sees; under an unrestricted cgroup that's effectively the host's). ──
function cpuSnapshot() {
  return os.cpus().reduce((a, c) => { for (const k in c.times) a[k] = (a[k] || 0) + c.times[k]; return a; }, {});
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
  stripe: async () => {
    if (!process.env.STRIPE_SECRET_KEY) return null;
    try { const r = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }, signal: AbortSignal.timeout(5000) }); return r.ok; }
    catch { return false; }
  },
};
export const DEP_LABELS = { db: 'Database', storage: 'Object storage', bot: 'Discord bot', telemetry: 'Telemetry dashboard', stripe: 'Stripe' };
export const DEP_KEYS = Object.keys(DEP_CHECKS);

export async function getDepsConfig(p) {
  const row = await p.adminSetting.findUnique({ where: { key: 'serverperf.deps' } });
  return { db: true, storage: true, bot: true, telemetry: true, stripe: true, ...(row?.value || {}) };
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
export function recordRequest(ms, statusCode) {
  _reqStats.count++; _reqStats.totalMs += ms;
  if (statusCode < 300) _reqStats.s2xx++; else if (statusCode < 400) _reqStats.s3xx++; else if (statusCode < 500) _reqStats.s4xx++; else _reqStats.s5xx++;
}
function flushRequestStats() {
  const snap = _reqStats;
  _reqStats = { count: 0, totalMs: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
  return snap;
}

const ALERT_DEBOUNCE_MS = 30 * 60 * 1000; // don't re-alert the same kind more than every 30 min
async function maybeAlert(p, kind, message) {
  const recent = await p.serverAlertLog.findFirst({ where: { kind }, orderBy: { createdAt: 'desc' } });
  if (recent && Date.now() - recent.createdAt.getTime() < ALERT_DEBOUNCE_MS) return null;
  return p.serverAlertLog.create({ data: { kind, message } });
}

// The sweeper's per-tick entry point: sample metrics, persist history, run
// threshold checks, and fire (debounced) alerts. Never throws.
export async function sampleAndAlert(p, log) {
  try {
    const [cpuPct, deps] = await Promise.all([sampleCpuPct(), checkDependencies(p)]);
    const disk = realDiskStats();
    const diskPct = disk.totalBytes ? 100 * (1 - disk.freeBytes / disk.totalBytes) : 0;
    const memPct = 100 * (1 - os.freemem() / os.totalmem());
    const reqStats = flushRequestStats();
    const latencyMs = reqStats.count ? Math.round(reqStats.totalMs / reqStats.count) : null;

    await p.serverMetricSample.create({ data: {
      cpuPct, memPct, diskPct, loadAvg1: os.loadavg()[0], uptimeSec: Math.round(process.uptime()), latencyMs,
    } });
    // Keep 30 days of history — enough for the dashboard's trend graph without
    // the table growing unbounded (one row per ~10 min tick).
    await p.serverMetricSample.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 864e5) } } });

    const alerts = [];
    if (cpuPct > 90) alerts.push(await maybeAlert(p, 'cpu', `CPU usage at ${cpuPct.toFixed(0)}% (>90%).`));
    if (memPct > 90) alerts.push(await maybeAlert(p, 'mem', `Memory usage at ${memPct.toFixed(0)}% (>90%).`));
    if (diskPct > 90) alerts.push(await maybeAlert(p, 'disk', `Disk usage at ${diskPct.toFixed(0)}% (>90%).`));
    for (const [key, ok] of Object.entries(deps)) {
      if (ok === false) alerts.push(await maybeAlert(p, 'service_down', `${DEP_LABELS[key] || key} is unreachable.`));
    }
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
