// Flood and duplicate counters: how many messages this author (or this address) sent in the
// window, and how many times this exact text was already seen.
//
// Redis when REDIS_URL is set, so every API replica counts the same thing; a bounded in-memory
// map otherwise, or whenever Redis refuses a command (enableOfflineQueue is off, so a down
// Redis fails fast instead of stalling the request). Fixed windows, not sliding ones: a spammer
// gains at most one window's worth by straddling a boundary, and the price of precision would
// be a sorted set per author.
//
// Nothing here stores text. Keys carry a hash of the text and a hash of the IP.
import crypto from 'node:crypto';
import { getRedis } from '../redis.mjs';
import { boundedSet } from '../boundedmap.mjs';

const MAX_KEYS = 20000;
const counters = new Map(); // key -> { n, at, ttl }
const sets = new Map();     // key -> { members: Set, at, ttl }

/** Test hook: forget every in-memory counter. */
export function _resetFlood() { counters.clear(); sets.clear(); }

/** A stable, non-reversible key for an IP address. */
export function ipKey(ip) {
  const s = String(ip || '').trim();
  return s ? crypto.createHash('sha256').update(`bcw-mod:${s}`).digest('hex').slice(0, 20) : '';
}

function memIncr(key, ttlMs) {
  const now = Date.now();
  const cur = counters.get(key);
  if (cur && now - cur.at < cur.ttl) { cur.n += 1; return cur.n; }
  boundedSet(counters, key, { n: 1, at: now, ttl: ttlMs }, MAX_KEYS);
  return 1;
}

function memAdd(key, member, ttlMs) {
  const now = Date.now();
  let cur = sets.get(key);
  if (!cur || now - cur.at >= cur.ttl) { cur = { members: new Set(), at: now, ttl: ttlMs }; boundedSet(sets, key, cur, MAX_KEYS); }
  if (cur.members.size < 100) cur.members.add(member);
  return cur.members.size;
}

/** Increment a windowed counter; returns the count INCLUDING this hit. */
export async function incr(key, windowSec) {
  const ttlMs = Math.max(1, windowSec) * 1000;
  const r = getRedis();
  if (r) {
    try {
      const k = `mod:c:${key}`;
      const n = await r.incr(k);
      if (n === 1) await r.pexpire(k, ttlMs);
      return n;
    } catch { /* fall through to memory */ }
  }
  return memIncr(key, ttlMs);
}

/** Add `member` to a windowed set; returns the set's size INCLUDING it. */
export async function addToSet(key, member, windowSec) {
  const ttlMs = Math.max(1, windowSec) * 1000;
  const r = getRedis();
  if (r) {
    try {
      const k = `mod:s:${key}`;
      await r.sadd(k, member);
      await r.pexpire(k, ttlMs, 'NX').catch(() => r.pexpire(k, ttlMs));
      return await r.scard(k);
    } catch { /* fall through to memory */ }
  }
  return memAdd(key, member, ttlMs);
}

/**
 * The flood + duplicate reasons for one message.
 *
 * @param surface  moderation surface id
 * @param who      { authorId, ip } — either may be missing
 * @param hashes   { exact, loose } from text.mjs textHashes
 * @param policy   the surface policy (flood: { max, windowSec }, dup: { windowSec, crossAuthors })
 * @param count    false for a dry run ("test this text"): read nothing, count nothing
 */
export async function floodReasons(surface, who, hashes, policy, { count = true } = {}) {
  if (!count) return [];
  const out = [];
  const fl = policy.flood || {};
  const author = who.authorId ? `u:${who.authorId}` : '';
  const ip = who.ip ? `ip:${ipKey(who.ip)}` : '';
  // A signed-in author is counted as themself; an anonymous sender by address. Counting an
  // account by IP too would make an office, a school or a mobile carrier (hundreds of people
  // behind one address) one flooding "author", and the routes already cap per IP themselves.
  const keys = [author || ip].filter(Boolean);
  if (fl.max > 0 && keys.length) {
    let n = 0;
    for (const k of keys) n = Math.max(n, await incr(`r:${surface}:${k}`, fl.windowSec));
    if (n > fl.max * 2) out.push({ rule: 'flood.burst', weight: 70, detail: `${n} in ${fl.windowSec}s (limit ${fl.max})` });
    else if (n > fl.max) out.push({ rule: 'flood.rate', weight: 40, detail: `${n} in ${fl.windowSec}s (limit ${fl.max})` });
  }
  const dup = policy.dup || {};
  const who1 = author || ip;
  if (dup.windowSec > 0 && who1) {
    for (const [kind, h] of [['exact', hashes.exact], ['loose', hashes.loose]]) {
      if (!h) continue;
      const mine = await incr(`d:${surface}:${who1}:${h}`, dup.windowSec);
      const authors = await addToSet(`x:${h}`, who1, dup.windowSec);
      if (authors >= (dup.crossAuthors || 3)) { out.push({ rule: 'dup.cross_author', weight: 45, detail: `same text from ${authors} senders` }); break; }
      if (mine >= 2) { out.push({ rule: kind === 'exact' ? 'dup.same_author' : 'dup.near', weight: kind === 'exact' ? 20 : 15, detail: `${mine}× in ${Math.round(dup.windowSec / 60)} min` }); break; }
    }
  }
  return out;
}
