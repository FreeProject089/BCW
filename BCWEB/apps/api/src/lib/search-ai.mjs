// agent-bcw-nav: Laya in the site's search bars — optional, on top of a search that always works.
//
// ── THE PROMISE ──────────────────────────────────────────────────────────────────────────────
//
// Every search box on the site (the ⌘K palette, the catalog, the repos, the blog, the docs)
// finds things WITHOUT this file: the web matches words itself, or asks the ordinary list
// endpoints. This adds two optional things when the admin switched the `search` feature on and
// the AI layer is up:
//
//   intent   what the query is probably looking for (mods in the catalog, a server repo, an
//            article, help in the docs, a project, the account), so a box can say "looking for
//            mods? search the catalog" instead of answering "no results".
//   rerank   the first few results the page ALREADY found, reordered by how well each answers
//            the query. Never a result the page did not have: the AI only reorders.
//
// Laya is a classifier, so both are CHOICE questions, one call each, through the moderation
// layer's pipeline (kill switch, queue, breaker, its own cache). Anything that goes wrong —
// feature off, AI off or killed, over a limit, a timeout, a garbage answer — answers
// `{ ai: false, reason }` with a 200, and the page keeps the order it had. Search never breaks
// because of the AI.
//
// ── LIMITS (admin, ai.features → search) ─────────────────────────────────────────────────────
//
//   anon            may a signed-out visitor use it at all (a visitor is their IP)
//   perUserPerMin   a signed-in account, per minute
//   perAnonPerMin   a signed-out visitor, per minute
//   perIpPerMin     every call from one address, signed in or not, per minute
//   anonPerIpPerDay a signed-out visitor's daily budget (the account's is the feature's daily
//                   allowance, counted in the usage table like every other feature)
//   cacheTtlSec     how long one answer (scope + query + candidates) is reused, for everyone
//
// Only the query and the candidates' titles go to the classifier: never who asked, never a
// URL. What is counted is the ai-usage analytics' numbers, never the query.
import crypto from 'node:crypto';
import { boundedSet } from './boundedmap.mjs';

export const SEARCH_SCOPES = Object.freeze(['global', 'catalog', 'repos', 'blog', 'docs']);

/** What a query can be looking for. The key is what the web links to; the text is the option
 *  the classifier reads. */
export const SEARCH_INTENTS = Object.freeze({
  catalog: 'mods, plugins, themes or presets to download',
  repos: 'a server repository of mods',
  blog: 'news, an announcement or an article',
  docs: 'documentation, a how-to, help with a problem',
  projects: 'one of the Better projects or apps (BMM, BSM, the installer)',
  account: 'their own account, settings, billing or subscription',
  people: 'a person, a creator or a team',
});
export const INTENT_IDS = Object.freeze(Object.keys(SEARCH_INTENTS));

export const SEARCH_BOUNDS = Object.freeze({
  perUserPerMin: [1, 120], perAnonPerMin: [1, 120], perIpPerMin: [1, 600], anonPerIpPerDay: [1, 20000], cacheTtlSec: [0, 3600],
});
export const SEARCH_DEFAULTS = Object.freeze({ anon: true, perUserPerMin: 20, perAnonPerMin: 6, perIpPerMin: 30, anonPerIpPerDay: 200, cacheTtlSec: 300 });

const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

/** Whatever was stored → the search limits, every value bounded. */
export function normalizeSearch(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { anon: typeof r.anon === 'boolean' ? r.anon : SEARCH_DEFAULTS.anon };
  for (const k of Object.keys(SEARCH_BOUNDS)) out[k] = clampInt(r[k], ...SEARCH_BOUNDS[k], SEARCH_DEFAULTS[k]);
  return out;
}

/** The query as the classifier and the cache see it: folded, one space, bounded. */
export function normalizeQuery(q) {
  return String(q ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 200);
}

/** Candidates from the page → at most `max` of { id, title }, ids and titles bounded, no dupes. */
export function cleanCandidates(list, max = 8) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const id = String(c?.id ?? '').trim().slice(0, 64);
    const title = String(c?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title });
    if (out.length >= max) break;
  }
  return out;
}

/** One cache key per (scope, query, candidate set). The query is hashed: the key is data too. */
export function searchCacheKey(scope, q, candidates = []) {
  const h = crypto.createHash('sha256');
  h.update(`${scope}\n${normalizeQuery(q)}\n${candidates.map((c) => `${c.id}\t${c.title}`).join('\n')}`);
  return h.digest('base64url').slice(0, 32);
}

/** The intent question: a choice over SEARCH_INTENTS. */
export function intentQuestion() {
  return {
    type: 'choice',
    instructions: 'This is a search query typed on a website for game mods and apps. What is the person looking for?',
    criteria: { ...SEARCH_INTENTS },
  };
}

/** The rerank question: a choice over the candidates, keyed by their ids. */
export function rerankQuestion(candidates) {
  return {
    type: 'choice',
    instructions: 'This is a search query. Which of these results answers it best?',
    criteria: Object.fromEntries(candidates.map((c) => [c.id, c.title])),
  };
}

/**
 * The page's order blended with the classifier's probabilities. Pure.
 * The deterministic rank keeps most of the weight (a result the words matched strongly stays
 * near the top); the AI moves a result up when it is clearly the better answer. Ties keep the
 * page's order. Returns the ids, best first. Ids the classifier did not score keep p = 0.
 */
export function blendOrder(candidates, probs, weight = 0.6) {
  const n = candidates.length;
  if (!n) return [];
  const w = Math.max(0, Math.min(1, Number(weight)));
  const scored = candidates.map((c, i) => {
    const det = n === 1 ? 1 : 1 - i / (n - 1);          // 1 for the first, 0 for the last
    const p = Math.max(0, Math.min(1, Number(probs?.[c.id]) || 0));
    return { id: c.id, i, s: (1 - w) * det + w * p };
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.map((x) => x.id);
}

/** The intent answer → { id, p } or null when it is not clear enough to show. */
export function pickIntent(value, min = 0.45) {
  if (!value || !INTENT_IDS.includes(value.choice)) return null;
  const p = Number(value.p ?? value.probs?.[value.choice]);
  if (!Number.isFinite(p) || p < min) return null;
  return { id: value.choice, p: Math.round(p * 100) / 100 };
}

// ── The answer cache ────────────────────────────────────────────────────────────────────────
const _cache = new Map();
export function cacheGet(key, ttlSec) {
  if (!ttlSec) return null;
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at >= ttlSec * 1000) { _cache.delete(key); return null; }
  return e.value;
}
export function cachePut(key, value, ttlSec) {
  if (!ttlSec) return;
  boundedSet(_cache, key, { at: Date.now(), value }, 2000, ttlSec * 1000);
}
export function _clearSearchCacheForTests() { _cache.clear(); }

/**
 * The limit keys for one request, in the order they are checked. Pure (the route runs them).
 * Signed in: per account per minute + per IP per minute. Signed out: per visitor per minute,
 * per IP per minute (the same address, so both apply) and the visitor's daily budget.
 */
export function searchLimitKeys(cfg, { uid = null, ip = null, now = Date.now() } = {}) {
  const minute = Math.floor(now / 60000);
  const day = new Date(now).toISOString().slice(0, 10);
  const addr = String(ip || 'noip').slice(0, 64);
  const keys = [{ k: `s:ip:${addr}:${minute}`, max: cfg.perIpPerMin, ttl: 120, scope: 'ip' }];
  if (uid) keys.push({ k: `s:u:${uid}:${minute}`, max: cfg.perUserPerMin, ttl: 120, scope: 'user' });
  else {
    keys.push({ k: `s:a:${addr}:${minute}`, max: cfg.perAnonPerMin, ttl: 120, scope: 'anon' });
    keys.push({ k: `s:ad:${addr}:${day}`, max: cfg.anonPerIpPerDay, ttl: 90000, scope: 'anon_day' });
  }
  return keys;
}
