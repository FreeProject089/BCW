// The optional AI provider layer's HTTP doors (agent-laya-bcweb). The layer itself, and every
// guard it runs (kill switch, queue, timeout, breaker, rate limits, cache), is
// lib/moderation/ai.mjs. What is here:
//
//   GET  /admin/ai            status + the stored config (manage_moderation; never a URL or a key)
//   PUT  /admin/ai/config     provider, global switch, per-surface toggles, knobs (manage_moderation)
//   POST /admin/ai/kill       { killed: true|false } — the KILL SWITCH. Cuts AI at once in this
//                             process, every other replica within 3 s; the rules engine is
//                             untouched. AI_KILL_SWITCH=1 in the env wins over it. Pulling it
//                             is manage_moderation; switching the AI back ON is an ADMIN's call
//                             (the same rule as PUT /admin/moderation/ai/kill).
//   POST /admin/ai/test       { surface, text } — one real call, ignoring the global switch
//                             and the surface toggles (never the kill switch) (manage_moderation)
//
// The AI layer is part of the moderation engine, so it is delegated with it: one capability,
// manage_moderation, rather than four more whole-site ADMIN routes.
//   POST /ai/bmm/suggest      BMM's helper (contract: contracts-laya-notify.md). A signed-in
//                             user, by session or by API key with the `ai:suggest` scope; off
//                             unless the admin enables `bmmSuggest`.
//   POST /bot/ai/automod      the Discord bot's AI-assisted anti-phishing / anti-troll check,
//                             a PAID feature (entitlement `aiAutomod`, lib/bot-entitlements.mjs)
//                             checked HERE, whatever the bot believes.
import { z } from 'zod';
import { db, requireRole, requireCap, apiAuth, logAudit, clientIp, botAuth } from '../lib/lib.mjs';
import { boundedSet } from '../lib/boundedmap.mjs';
import {
  AI_CONFIG_KEY, AI_KILLED_KEY, AI_SURFACES, normalizeAiConfig, aiInvalidateConfig, aiLoadConfig, aiStatus,
  aiAnalyzeWithReason, aiClassifyWithReason, publicConfig,
} from '../lib/moderation/ai.mjs';
import { loadEntitlementContext } from '../lib/bot-entitlements.mjs';

// ── BMM suggest: task → question ────────────────────────────────────────────────────────────
const LANGUAGES = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'uk', 'tr', 'zh', 'ja', 'ko', 'ar', 'other'];
const CRASH = ['gpu_driver', 'out_of_memory', 'missing_dependency', 'mod_conflict', 'corrupted_file', 'permission', 'game_update', 'other'];
export const SUGGEST_TASKS = ['tags', 'category', 'language', 'nsfw', 'crash_triage'];

/** The task's question, or { error } when the options it needs are missing. Pure. */
export function suggestQuestion(task, options) {
  const opts = [...new Set((options || []).map((o) => String(o).trim()).filter(Boolean))];
  switch (task) {
    case 'tags':
      if (opts.length < 2) return { error: 'options_required' };
      return { type: 'choice', instructions: 'Which of these tags fits this mod or content best?', options: opts };
    case 'category':
      if (opts.length < 2) return { error: 'options_required' };
      return { type: 'choice', instructions: 'Which category does this mod or content belong to?', options: opts };
    case 'language':
      return { type: 'choice', instructions: 'Which language is this text written in?', options: opts.length >= 2 ? opts : LANGUAGES };
    case 'nsfw':
      return { type: 'noul', instructions: 'Does this text describe sexual, pornographic or otherwise adult-only (NSFW) content?' };
    case 'crash_triage':
      return { type: 'choice', instructions: 'What is the most likely cause of this crash report or log?', options: opts.length >= 2 ? opts : CRASH };
    default:
      return { error: 'bad_task' };
  }
}

const SuggestBody = z.object({
  task: z.enum(SUGGEST_TASKS),
  text: z.string().min(1).max(4000),
  options: z.array(z.string().min(1).max(64)).max(50).optional(),
});

/** Session OR API key. A Bearer header means "I am a key": it is judged as one and only as one. */
const hasBearer = (req) => /^Bearer\s+\S/i.test(String(req.headers.authorization || '')) || !!req.headers['x-api-key'];
const suggestAuth = (req, reply) => (hasBearer(req) ? apiAuth('ai:suggest') : requireRole())(req, reply);

const ADMIN_TIER = ['ADMIN', 'SUPERADMIN'];

// ── Admin config ────────────────────────────────────────────────────────────────────────────
const bool = z.boolean().optional();
const int = z.number().int().optional();
const ConfigBody = z.object({
  provider: z.enum(['off', 'laya', 'external']).optional(),
  enabled: bool,
  bmmSuggest: bool,
  surfaces: z.object(Object.fromEntries(AI_SURFACES.map((s) => [s, bool]))).optional(),
  thresholds: z.object({ flag: z.number().min(0.5).max(0.99).optional(), review: z.number().min(0.5).max(0.999).optional() }).optional(),
  timeoutMs: int, queueWaitMs: int, concurrency: int, maxQueue: int, maxChars: int, maxLen: int,
  breakerFailures: int, breakerOpenSec: int, perUserPerMin: int, globalPerMin: int, cacheTtlSec: int,
  externalMode: z.enum(['moderations', 'chat']).optional(),
  externalModel: z.string().max(80).regex(/^[\w.:/-]*$/).optional(),
}).strict();

// ── Bot: entitlement lookup, cached (one per message would be two queries per message) ─────
let _ent = { at: 0, entOf: null };
async function guildHasAi(guildId) {
  if (!_ent.entOf || Date.now() - _ent.at > 30_000) {
    const p = await db();
    const { entOf } = await loadEntitlementContext(p);
    _ent = { at: Date.now(), entOf };
  }
  const e = _ent.entOf(String(guildId));
  return !!e && (e.unlimited || e.features.includes('aiAutomod'));
}
/** Per-guild budget on top of the layer's own per-user and global ones: one huge server must
 *  not spend the whole platform's allowance. */
const _guildRl = new Map();
function guildAllows(guildId, max = 60) {
  const k = `${guildId}:${Math.floor(Date.now() / 60000)}`;
  const e = _guildRl.get(k) || { at: Date.now(), n: 0 };
  e.n += 1;
  boundedSet(_guildRl, k, e, 5000, 120_000);
  return e.n <= max;
}
const CHECK_LABELS = { phishing: ['phishing', 'spam'], troll: ['troll', 'toxic'] };
const AutomodBody = z.object({
  guildId: z.string().regex(/^\d{5,32}$/),
  userId: z.string().regex(/^\d{5,32}$/).optional(),
  text: z.string().min(1).max(4000),
  checks: z.array(z.enum(['phishing', 'troll'])).min(1).max(2),
});

export default async function aiRoutes(app) {
  // Warm the config, so aiEnabledFor() (sync by contract) has an answer from the first request.
  app.addHook('onReady', async () => { aiLoadConfig().catch(() => {}); });

  app.get('/admin/ai', { preHandler: requireCap('manage_moderation') }, async () => {
    const status = await aiStatus();
    return { status, surfaces: AI_SURFACES };
  });

  app.put('/admin/ai/config', { preHandler: requireCap('manage_moderation') }, async (req, reply) => {
    const parsed = ConfigBody.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', detail: parsed.error.issues?.[0]?.message });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: AI_CONFIG_KEY } }).catch(() => null);
    const cur = normalizeAiConfig(row?.value);
    const next = normalizeAiConfig({ ...cur, ...parsed.data, surfaces: { ...cur.surfaces, ...(parsed.data.surfaces || {}) }, thresholds: { ...cur.thresholds, ...(parsed.data.thresholds || {}) } });
    await p.adminSetting.upsert({ where: { key: AI_CONFIG_KEY }, create: { key: AI_CONFIG_KEY, value: next }, update: { value: next } });
    aiInvalidateConfig();
    const on = Object.entries(next.surfaces).filter(([, v]) => v).map(([k]) => k);
    await logAudit(p, req.user.uid, 'ai.config', `provider=${next.provider} enabled=${next.enabled} bmmSuggest=${next.bmmSuggest} surfaces=${on.join(',') || '-'}`, clientIp(req));
    return { ok: true, config: publicConfig(next) };
  });

  app.post('/admin/ai/kill', { preHandler: requireCap('manage_moderation') }, async (req, reply) => {
    const killed = req.body?.killed;
    if (typeof killed !== 'boolean') return reply.code(400).send({ error: 'invalid_input' });
    // Killing is the safe direction: anybody who configures moderation may pull it. Turning
    // the AI back on stays with the admins.
    if (!killed && !ADMIN_TIER.includes(req.user.role)) return reply.code(403).send({ error: 'forbidden', detail: 'admin_only_to_unkill' });
    const p = await db();
    await p.adminSetting.upsert({ where: { key: AI_KILLED_KEY }, create: { key: AI_KILLED_KEY, value: killed }, update: { value: killed } });
    aiInvalidateConfig();
    await logAudit(p, req.user.uid, 'ai.killed', killed ? 'AI kill switch ON' : 'AI kill switch OFF', clientIp(req));
    const cfg = await aiLoadConfig({ force: true });
    return { ok: true, killed: cfg.killed, killedBy: cfg.killedBy };
  });

  app.post('/admin/ai/test', { preHandler: requireCap('manage_moderation'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const surface = String(req.body?.surface || 'community');
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!AI_SURFACES.includes(surface) || !text.trim() || text.length > 4000) return reply.code(400).send({ error: 'invalid_input' });
    const r = await aiAnalyzeWithReason(surface, { text, meta: { userId: `admin:${req.user.uid}` } }, { adminTest: true });
    return r.value ? { ok: true, result: r.value } : { ok: false, reason: r.reason };
  });

  // ── BMM ──
  app.post('/ai/bmm/suggest', { preHandler: suggestAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = SuggestBody.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_input', detail: parsed.error.issues?.[0]?.message });
    const q = suggestQuestion(parsed.data.task, parsed.data.options);
    if (q.error) return reply.code(400).send({ ok: false, error: q.error });
    const r = await aiClassifyWithReason(q, { text: parsed.data.text }, { userId: req.user?.uid });
    if (!r.value) {
      const reason = ['disabled', 'rate_limited', 'busy'].includes(r.reason) ? r.reason : 'unavailable';
      return { ok: false, reason };
    }
    const v = r.value;
    return { ok: true, provider: v.provider, result: { choice: v.choice, probs: v.probs, p: v.p } };
  });

  // ── Discord bot ──
  app.post('/bot/ai/automod', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const parsed = AutomodBody.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
    const { guildId, userId, text, checks } = parsed.data;
    let entitled = false;
    try { entitled = await guildHasAi(guildId); } catch { entitled = false; }
    if (!entitled) return reply.code(402).send({ ok: false, error: 'plan_required', feature: 'aiAutomod' });
    if (!guildAllows(guildId)) return { ok: false, reason: 'rate_limited' };
    const labels = [...new Set(checks.flatMap((c) => CHECK_LABELS[c]))];
    const r = await aiAnalyzeWithReason('discord_automod', { text, meta: { labels, userId: userId ? `discord:${userId}` : null } }, {});
    if (!r.value) return { ok: false, reason: r.reason === 'empty' ? 'unavailable' : r.reason };
    return { ok: true, provider: r.value.provider, latencyMs: r.value.latencyMs, labels: r.value.labels };
  });
}

// For the tests.
export function _resetBotCacheForTests() { _ent = { at: 0, entOf: null }; _guildRl.clear(); }
