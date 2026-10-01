// agent-bcw-nav: POST /search/smart — Laya's optional help for the site's search bars.
// The rules and the pure helpers are in lib/search-ai.mjs; read its header for the promise.
//
//   body   { q, scope: global|catalog|repos|blog|docs, want?: ['intent','rerank'],
//            candidates?: [{ id, title }] (the page's first results, at most 8 used) }
//   200    { ai: true, intent: { id, p } | null, order: [ids] | null, provider, cached }
//   200    { ai: false, reason }        feature off, AI off, sign-in required, too short…
//   429    { ai: false, reason: 'rate_limited' | 'quota_reached', scope, retryAfterSec }
//
// Signed in or not: the session is read when there is one, never required. A signed-out
// visitor is allowed only when the admin said so (ai.features → search.anon) and only for a
// feature whose audience is everyone.
import { z } from 'zod';
import { db, clientIp, sessionUser } from '../lib/lib.mjs';
import { aiLoadConfig, layaCheck } from '../lib/moderation/ai.mjs';
import { recordAi, userCallsToday } from '../lib/ai-usage.mjs';
import { loadFeatures, featureGate, dailyAllowance, classify, rateHit } from '../lib/ai-features.mjs';
import {
  SEARCH_SCOPES, normalizeQuery, cleanCandidates, searchCacheKey, intentQuestion, rerankQuestion,
  blendOrder, pickIntent, cacheGet, cachePut, searchLimitKeys,
} from '../lib/search-ai.mjs';

const Body = z.object({
  q: z.string().max(400),
  scope: z.enum(SEARCH_SCOPES).default('global'),
  want: z.array(z.enum(['intent', 'rerank'])).max(2).optional(),
  candidates: z.array(z.object({ id: z.union([z.string().max(200), z.number()]), title: z.string().max(400) }).passthrough()).max(40).optional(),
}).strict();

/** The classifier is usable right now (switch on, provider set, not killed). */
function classifierReady(layer) {
  if (!layer || layer.killed || !layer.enabled) return false;
  if (layer.provider === 'laya') return layaCheck().ok;
  return layer.provider === 'external';
}

const secondsToMidnight = () => { const n = new Date(); const m = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1); return Math.max(1, Math.round((m - n.getTime()) / 1000)); };

export default async function searchAiRoutes(app) {
  app.post('/search/smart', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = Body.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ ai: false, reason: 'invalid_input' });
    const { scope } = parsed.data;
    const q = normalizeQuery(parsed.data.q);
    if (q.length < 2) return { ai: false, reason: 'too_short' };
    const want = new Set(parsed.data.want?.length ? parsed.data.want : ['intent', 'rerank']);
    const candidates = cleanCandidates((parsed.data.candidates || []).map((c) => ({ id: String(c.id), title: c.title })), 8);

    const p = await db();
    const { cfg } = await loadFeatures();
    if (!cfg.features.search?.enabled) return { ai: false, reason: 'feature_off' };
    const user = await sessionUser(req).catch(() => null);
    if (!user && !cfg.search.anon) return { ai: false, reason: 'sign_in' };
    const g = await featureGate(p, user, 'search', cfg);
    if (!g.ok) return { ai: false, reason: user ? g.reason : 'sign_in' };
    const layer = await aiLoadConfig();
    if (!classifierReady(layer)) return { ai: false, reason: 'ai_off' };

    // The same question from anybody gets the same answer: served from the cache before any
    // limit is spent on it.
    const key = searchCacheKey(`${scope}|${[...want].sort().join(',')}`, q, candidates);
    const hit = cacheGet(key, cfg.search.cacheTtlSec);
    if (hit) {
      recordAi({ feature: 'search', provider: hit.provider || 'laya', outcome: 'cacheHit', userId: user?.uid || null });
      return { ...hit, cached: true };
    }

    const ip = clientIp(req);
    const day = new Date().toISOString().slice(0, 10);
    const keys = [...searchLimitKeys(cfg.search, { uid: user?.uid || null, ip }), { k: `g:${day}`, max: cfg.limits.globalPerDay, ttl: 90000, scope: 'global' }];
    const lim = await rateHit(keys);
    if (!lim.ok) {
      const sc = keys.find((k) => k.k === lim.key)?.scope || 'ip';
      const retry = sc === 'global' || sc === 'anon_day' ? secondsToMidnight() : 60;
      recordAi({ feature: 'search', provider: 'off', outcome: 'rateLimited', userId: user?.uid || null });
      reply.header('Retry-After', String(retry));
      return reply.code(429).send({ ai: false, reason: 'rate_limited', scope: sc, retryAfterSec: retry });
    }
    if (user?.uid) {
      const allowance = dailyAllowance(cfg, 'search', g);
      const used = await userCallsToday(p, user.uid, 'search').catch(() => 0);
      if (used >= allowance) {
        reply.header('Retry-After', String(secondsToMidnight()));
        return reply.code(429).send({ ai: false, reason: 'quota_reached', scope: 'feature', retryAfterSec: secondsToMidnight() });
      }
    }

    const uid = user?.uid || null;
    const [intentR, rerankR] = await Promise.all([
      want.has('intent') ? classify('search', intentQuestion(), q, uid) : null,
      want.has('rerank') && candidates.length >= 2 ? classify('search', rerankQuestion(candidates), q, uid) : null,
    ]);
    const intent = intentR?.value ? pickIntent(intentR.value) : null;
    const order = rerankR?.value ? blendOrder(candidates, rerankR.value.probs || { [rerankR.value.choice]: rerankR.value.p ?? 1 }) : null;
    if (!intent && !order) {
      const reason = intentR?.reason || rerankR?.reason || 'unavailable';
      return { ai: false, reason };
    }
    const out = { ai: true, intent, order, provider: intentR?.value?.provider || rerankR?.value?.provider || layer.provider };
    cachePut(key, out, cfg.search.cacheTtlSec);
    return { ...out, cached: false };
  });
}
