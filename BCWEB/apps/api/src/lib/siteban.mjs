// Site-wide bans and the automatic shield — the front door of every service.
//
// Three lists an admin keeps (IPs and CIDR ranges, User-Agent fragments, BMM creator ids)
// and one rule that needs nobody: an address rate-limited too often in ten minutes is
// blocked outright for a while. Everything is read from one AdminSetting, cached for
// fifteen seconds, and checked in an `onRequest` hook before any route — no DB on the
// hot path, so a blocked address costs a map lookup and a 403.
//
// The repo access policy (GlobalAccessPolicy) is a different thing: it decides who may
// read HOSTED CONTENT. This decides who is answered at all.
import { db } from './lib.mjs';

export const BANS_KEY = 'security.bans';
const DEFAULTS = Object.freeze({ ips: [], uas: [], creators: [], shield: { enabled: true, after429: 30, minutes: 30, blockNoUA: false } });
const REFRESH_MS = 15_000;
const WINDOW_MS = 10 * 60 * 1000;

let cache = { at: 0, v: DEFAULTS, c: compile(DEFAULTS) };
const live = new Map(); // ip -> { until, reason }
const hits429 = new Map(); // ip -> { at, n }
const MAX_TRACKED = 50_000;

const entry = (e) => {
  if (!e) return null;
  const v = String(typeof e === 'string' ? e : e.v || '').trim();
  if (!v || v.length > 200) return null;
  const note = String((typeof e === 'object' && e.note) || '').slice(0, 200);
  const until = typeof e === 'object' && e.until ? String(e.until).slice(0, 40) : null;
  return { v, note, until };
};
export function normalise(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const list = (k, cap) => (Array.isArray(r[k]) ? r[k].map(entry).filter(Boolean).slice(0, cap) : []);
  const sh = r.shield && typeof r.shield === 'object' ? r.shield : {};
  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
  return {
    ips: list('ips', 20000), uas: list('uas', 500), creators: list('creators', 20000),
    shield: { enabled: sh.enabled !== false, after429: num(sh.after429, 30, 0, 100000), minutes: num(sh.minutes, 30, 1, 10080), blockNoUA: !!sh.blockNoUA },
  };
}

// ── matching ──
const ip4 = (s) => { const m = String(s).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/); if (!m) return null; let n = 0; for (let i = 1; i <= 4; i++) { const o = Number(m[i]); if (o > 255) return null; n = (n * 256) + o; } return n; };
function compile(pol) {
  const now = Date.now();
  const alive = (e) => !e.until || Number.isNaN(Date.parse(e.until)) || Date.parse(e.until) > now;
  const exact = new Set(); const ranges = []; const prefixes = [];
  for (const e of pol.ips.filter(alive)) {
    const v = e.v.replace(/^::ffff:/, '');
    const cidr = v.match(/^(.+)\/(\d{1,3})$/);
    if (cidr) {
      const base = ip4(cidr[1]); const bits = Number(cidr[2]);
      if (base != null && bits >= 0 && bits <= 32) { const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0; ranges.push({ base: (base & mask) >>> 0, mask }); continue; }
      // IPv6 ranges: matched on the written prefix (the part before `::`), which covers the
      // /32 … /64 an operator actually types. Good enough for a ban list; not a router.
      const pre = cidr[1].toLowerCase().replace(/::.*$/, ''); if (pre) prefixes.push(pre);
      continue;
    }
    if (v.endsWith('*')) { prefixes.push(v.slice(0, -1).toLowerCase()); continue; }
    exact.add(v.toLowerCase());
  }
  return {
    exact, ranges, prefixes,
    uas: pol.uas.filter(alive).map((e) => e.v.toLowerCase()),
    creators: new Set(pol.creators.filter(alive).map((e) => e.v)),
  };
}
export function isBannedIp(ip, c = cache.c) {
  const v = String(ip || '').replace(/^::ffff:/, '').toLowerCase();
  if (!v) return false;
  if (c.exact.has(v)) return true;
  const n = ip4(v);
  if (n != null && c.ranges.some((r) => ((n & r.mask) >>> 0) === r.base)) return true;
  return c.prefixes.some((p) => v.startsWith(p));
}

// ── the policy ──
export async function getBanPolicy(p, { fresh = false } = {}) {
  if (!fresh && Date.now() - cache.at < REFRESH_MS) return cache.v;
  try {
    const row = await p.adminSetting.findUnique({ where: { key: BANS_KEY } });
    const v = normalise(row?.value);
    cache = { at: Date.now(), v, c: compile(v) };
  } catch { cache = { ...cache, at: Date.now() }; }
  return cache.v;
}
export async function setBanPolicy(p, patch) {
  const cur = await getBanPolicy(p, { fresh: true });
  const next = normalise({ ...cur, ...patch, shield: { ...cur.shield, ...(patch?.shield || {}) } });
  await p.adminSetting.upsert({ where: { key: BANS_KEY }, create: { key: BANS_KEY, value: next }, update: { value: next } });
  cache = { at: Date.now(), v: next, c: compile(next) };
  return next;
}

// ── live blocks ──
export function liveBlocks() {
  const now = Date.now();
  for (const [ip, b] of live) if (b.until <= now) live.delete(ip);
  return [...live.entries()].map(([ip, b]) => ({ ip, until: b.until, reason: b.reason })).sort((a, b) => b.until - a.until);
}
export function banNow(ip, minutes = 30, reason = 'manual') {
  const v = String(ip || '').trim(); if (!v) return false;
  if (live.size > MAX_TRACKED) live.delete(live.keys().next().value);
  live.set(v, { until: Date.now() + Math.max(1, Number(minutes) || 30) * 60_000, reason });
  return true;
}
export function liftBlock(ip) { return live.delete(String(ip || '').trim()); }

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip || '0.0.0.0';
}

/** The hooks. Installed once, before the routes. */
export function installSiteBans(app) {
  let refreshing = false;
  const refresh = () => {
    if (refreshing || Date.now() - cache.at < REFRESH_MS) return;
    refreshing = true;
    db().then((p) => getBanPolicy(p, { fresh: true })).catch(() => {}).finally(() => { refreshing = false; });
  };
  refresh();
  app.addHook('onRequest', (req, reply, done) => {
    refresh();
    const ip = clientIp(req);
    const b = live.get(ip);
    if (b) { if (b.until > Date.now()) { reply.code(403).send({ error: 'temporarily_blocked', retryAfterSec: Math.ceil((b.until - Date.now()) / 1000) }); return; } live.delete(ip); }
    const c = cache.c;
    if (isBannedIp(ip, c)) { reply.code(403).send({ error: 'banned' }); return; }
    const ua = String(req.headers['user-agent'] || '').toLowerCase();
    if (ua && c.uas.length && c.uas.some((u) => ua.includes(u))) { reply.code(403).send({ error: 'banned' }); return; }
    if (!ua && cache.v.shield.blockNoUA && req.method === 'GET' && String(req.headers.accept || '').includes('text/html')) { reply.code(403).send({ error: 'forbidden' }); return; }
    const cid = req.headers['x-creator-id'];
    if (cid && c.creators.size && c.creators.has(String(cid))) { reply.code(403).send({ error: 'banned' }); return; }
    done();
  });
  // The shield: a 429 is counted; too many in the window and the address is blocked outright.
  app.addHook('onResponse', (req, reply, done) => {
    const sh = cache.v.shield;
    if (reply.statusCode === 429 && sh.enabled && sh.after429 > 0) {
      const ip = clientIp(req); const now = Date.now();
      const rec = hits429.get(ip);
      if (!rec || now - rec.at > WINDOW_MS) { if (hits429.size > MAX_TRACKED) hits429.clear(); hits429.set(ip, { at: now, n: 1 }); }
      else if (++rec.n >= sh.after429) { hits429.delete(ip); banNow(ip, sh.minutes, 'shield'); }
    }
    done();
  });
}
