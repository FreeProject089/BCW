// Admin-configured services on the status page (D7), and why they cannot become an SSRF.
//
// The built-in checks (database, storage, bot, telemetry, website, Stripe) are code: their
// targets are fixed internal names nobody can edit. This module adds the other kind, a URL an
// admin types in ("our docs host", "the CDN", "the BMM update feed") that the server then
// fetches on every monitor tick. A server that fetches an admin-typed URL on a schedule is an
// SSRF primitive (pentest R11): point it at 169.254.169.254, at the database container, at
// 127.0.0.1:6379, and the status page reports, tick after tick, whether each internal port
// answers. So every fetch here goes through lib/net.mjs `safeFetch`, and the rules are:
//
//   - http and https only; no credentials in the URL; no port outside 1-65535 (URL does it);
//   - the host must resolve ONLY to public addresses: loopback, RFC 1918, link-local
//     (169.254/16, the cloud metadata address), CGNAT, ULA, multicast and "localhost/.local/
//     .internal" names are refused, checked after DNS, with the checked address pinned for
//     the connection (no second lookup to rebind);
//   - every redirect hop is a new URL and is checked again, at most MAX_REDIRECTS of them;
//   - a hard timeout per probe, and at most BODY_CAP bytes of body are ever read;
//   - nothing the target returns is sent back to anybody: the admin "Test" button and the
//     public page both get up/down, a status code, a duration and a refusal code. Never the
//     body, never a header. A probe that could echo the response would be a proxy.
//
// The URL is checked twice: at SAVE (so an internal target is refused with a reason the admin
// can read) and at every PROBE (DNS can change after the save). A probe refused by policy
// answers `null` ("cannot tell"), not `false`: a misconfigured monitor must not open outages
// and page subscribers.
//
// Results are cached for CACHE_MS and concurrent callers share one in-flight run. The public
// GET /status runs the checks on every request; without the cache, anybody reloading that page
// would make this server fetch every configured URL, which turns the status page into a way
// to send traffic at a third party through us.
import { z } from 'zod';
import { safeFetch, checkPublicUrl } from './net.mjs';

export const MAX_MONITORS = 20;
export const MAX_REDIRECTS = 3;
export const BODY_CAP = 64 * 1024;
export const TIMEOUT_MIN = 1000;
export const TIMEOUT_MAX = 10000;
export const CACHE_MS = 60_000;
const SETTING = 'status.monitors';
/** Custom keys are namespaced so they can never collide with a built-in check. */
export const CUSTOM_PREFIX = 'c_';

const idRe = /^c_[a-z0-9-]{1,40}$/;

export const monitorSchema = z.object({
  id: z.string().regex(idRe),
  label: z.string().trim().min(1).max(60),
  labelFr: z.string().trim().max(60).optional().default(''),
  url: z.string().trim().min(1).max(500),
  method: z.enum(['GET', 'HEAD']).optional().default('GET'),
  // The status codes that count as up. Default 200-399: a redirect answered at all is alive.
  okMin: z.number().int().min(100).max(599).optional().default(200),
  okMax: z.number().int().min(100).max(599).optional().default(399),
  // Optional text the body must contain (a health endpoint that says "ok"). Case-sensitive,
  // searched in the first BODY_CAP bytes only.
  keyword: z.string().max(100).optional().default(''),
  timeoutMs: z.number().int().min(TIMEOUT_MIN).max(TIMEOUT_MAX).optional().default(5000),
  enabled: z.boolean().optional().default(true),
});

export const monitorsSchema = z.array(monitorSchema).max(MAX_MONITORS);

/**
 * The static half of the URL rule (no DNS): scheme, credentials, shape. Throws Error(code).
 */
export function staticUrlCheck(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('ssrf_bad_url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('ssrf_bad_scheme');
  // user:pass@ in a monitor URL is a credential stored in plain sight and shipped on every
  // probe; it is also a classic parser-confusion trick (http://public@internal/). Refused.
  if (u.username || u.password) throw new Error('ssrf_credentials');
  return u;
}

/**
 * The full rule, DNS included. `resolve` is injectable for tests only.
 * Resolves on success; rejects with Error('ssrf_…') on a refused target.
 */
export async function assertMonitorUrl(raw, resolve) {
  staticUrlCheck(raw);
  await (resolve ? checkPublicUrl(raw, resolve) : checkPublicUrl(raw));
}

/** Read at most `cap` bytes of a response body, then stop reading. */
async function readCapped(res, cap) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.byteLength > cap - total ? value.subarray(0, cap - total) : value;
      chunks.push(take);
      total += take.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Probe one monitor.
 * @returns {{ ok: boolean|null, ms: number|null, status: number|null, error: string|null }}
 *   ok === null: refused by policy or malformed (never an outage); false: down; true: up.
 */
export async function probeMonitor(m, { resolve } = {}) {
  const t0 = Date.now();
  try { staticUrlCheck(m.url); } catch (e) { return { ok: null, ms: null, status: null, error: e.message }; }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, Number(m.timeoutMs) || 5000)));
  try {
    const res = await safeFetch(m.url, {
      method: m.method === 'HEAD' ? 'HEAD' : 'GET',
      signal: ac.signal,
      headers: { 'user-agent': 'BetterCommunity-Status/1 (+status page probe)', accept: '*/*' },
    }, MAX_REDIRECTS, ...(resolve ? [resolve] : []));
    const status = res.status;
    const statusOk = status >= (m.okMin ?? 200) && status <= (m.okMax ?? 399);
    let ok = statusOk;
    if (statusOk && m.keyword && m.method !== 'HEAD') {
      ok = (await readCapped(res, BODY_CAP)).includes(m.keyword);
    } else {
      await res.body?.cancel().catch(() => {});
    }
    return { ok, ms: Date.now() - t0, status, error: ok ? null : statusOk ? 'keyword_missing' : 'bad_status' };
  } catch (e) {
    const code = String(e?.message || '');
    if (code.startsWith('ssrf_')) return { ok: null, ms: null, status: null, error: code };
    return { ok: false, ms: Date.now() - t0, status: null, error: ac.signal.aborted ? 'timeout' : 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/** The configured monitors, validated. A row that no longer validates is dropped, not thrown. */
export async function readMonitors(p) {
  const row = await p.adminSetting.findUnique({ where: { key: SETTING } }).catch(() => null);
  const list = Array.isArray(row?.value) ? row.value : [];
  const out = [];
  for (const x of list.slice(0, MAX_MONITORS)) {
    const r = monitorSchema.safeParse(x);
    if (r.success) out.push(r.data);
  }
  return out;
}

export async function writeMonitors(p, list) {
  await p.adminSetting.upsert({ where: { key: SETTING }, create: { key: SETTING, value: list }, update: { value: list } });
  invalidateMonitorCache();
}

let cache = { at: 0, results: null, labels: {}, inflight: null };
export function invalidateMonitorCache() { cache = { at: 0, results: null, labels: cache.labels, inflight: null }; }

/** Labels of the configured monitors, from the last read ({ key: { en, fr } }). */
export function monitorLabels() { return cache.labels; }

/**
 * Every ENABLED monitor's result, keyed by monitor id, cached CACHE_MS.
 * @returns {Promise<Record<string, { ok, ms, status, error }>>}
 */
export async function runMonitors(p) {
  if (cache.results && Date.now() - cache.at < CACHE_MS) return cache.results;
  if (cache.inflight) return cache.inflight;
  const run = (async () => {
    const list = (await readMonitors(p)).filter((m) => m.enabled);
    cache.labels = Object.fromEntries(list.map((m) => [m.id, { en: m.label, fr: m.labelFr || '' }]));
    const pairs = await Promise.all(list.map(async (m) => [m.id, await probeMonitor(m)]));
    const results = Object.fromEntries(pairs);
    cache = { at: Date.now(), results, labels: cache.labels, inflight: null };
    return results;
  })();
  cache.inflight = run;
  try { return await run; } catch { cache.inflight = null; return {}; }
}
