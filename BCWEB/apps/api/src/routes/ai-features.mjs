// The AI features' doors (aios, agent-bcw-ai-os). The rules are in lib/ai-features.mjs, the
// counting in lib/ai-usage.mjs, the provider pipeline in lib/moderation/ai.mjs.
//
// MEMBERS (signed in)
//   GET    /ai/me              what I may use, why not, how much is left today, where my text
//                              would go (the disclosure), and my key (host + last 4, never the key)
//   PUT    /ai/key             store my own key (BYOK), sealed. Never returned.
//   DELETE /ai/key             forget it
//   POST   /ai/key/test        one tiny call with my key, to prove it works
//   POST   /ai/suggest         tags / category / language for what I am about to submit
//   POST   /ai/describe        draft a description (generative: my key, or the site key if my plan has it)
//   POST   /ai/check           "is this likely to be held?" before I post: coarse, never the rule
//   POST   /ai/feedback        "that warning was wrong / right", or a suggestion applied / dismissed — a count, nothing else
//
// PUBLIC
//   GET    /site/features      site-wide switches the web needs before it draws: OS mode on/off
//
// STAFF (under /admin/ai, the AI layer's section: manage_moderation; the doors that read
// reports or feedback also ask manage_reports, the capability those queues have)
//   GET    /admin/ai/usage             the analytics dashboard (aggregates only)
//   GET    /admin/ai/features          feature settings + site key state
//   PUT    /admin/ai/features          save them
//   PUT    /admin/ai/site-key          set the site key (ADMIN tier only), sealed
//   DELETE /admin/ai/site-key          remove it (ADMIN tier only)
//   GET    /admin/ai/triage            the moderation queue, ranked
//   POST   /admin/ai/summarize         summarise a report or a feedback thread (generative)
//   GET    /admin/ai/duplicates        near-duplicate reports / feedback
//   GET    /admin/ai/crash-clusters    crashes grouped by stack, with a likely cause
import { z } from 'zod';
import { db, requireRole, requireCap, logAudit, clientIp, hasCap } from '../lib/lib.mjs';
import { aiLoadConfig, layaCheck } from '../lib/moderation/ai.mjs';
import { aiUsageReport, recordAi, recordAiEvent, RANGES, userCallsToday } from '../lib/ai-usage.mjs';
import {
  FEATURES, FEATURE_IDS, FEATURE_BOUNDS, AI_FEATURES_KEY, AI_SITE_KEY, normalizeFeatures, loadFeatures, invalidateFeatures,
  publicSiteKey, buildSiteKey, featureGate, dailyAllowance, checkLimits, resolveGenKey, generate, classify,
  detectLanguageLocal, suggestTagsLocal, clusterDuplicates, triageScore, crashCauseLocal, coarseWarnings,
  sealKey, last4, keyShapeOk, checkBaseUrl, hostOf, isStaff,
} from '../lib/ai-features.mjs';
import { stackSignature, stackTextOf } from './feedback.mjs';
import { SEARCH_BOUNDS } from '../lib/search-ai.mjs'; // agent-bcw-nav

export const OS_ENABLED_KEY = 'os.enabled';
const ADMIN_TIER = ['ADMIN', 'SUPERADMIN'];

/** Where a classifier call would go, for the disclosure. Never a URL. */
function classifierWhere(layer) {
  if (!layer || layer.killed || !layer.enabled) return { kind: 'off' };
  if (layer.provider === 'laya') return layaCheck().ok ? { kind: 'laya' } : { kind: 'off' };
  if (layer.provider === 'external') return { kind: 'external' };
  return { kind: 'off' };
}

/** Is the classifier usable right now (global switch on, provider set, not killed)? */
const classifierOn = (layer) => classifierWhere(layer).kind !== 'off';

/** The standard refusal for a limit, with Retry-After. */
function limited(reply, r) {
  if (r.retryAfterSec) reply.header('Retry-After', String(r.retryAfterSec));
  return reply.code(429).send({ ok: false, error: r.reason, scope: r.scope, retryAfterSec: r.retryAfterSec, ...(r.allowance != null ? { allowance: r.allowance, used: r.used } : {}) });
}

/** Gate + limits for one member request. Returns { ctx } or { res } (already sent). */
async function admit(p, req, reply, feature) {
  const { cfg, site } = await loadFeatures();
  const g = await featureGate(p, req.user, feature, cfg);
  if (!g.ok) return { res: reply.code(403).send({ ok: false, error: g.reason, feature }) };
  const allowance = dailyAllowance(cfg, feature, g);
  const lim = await checkLimits(p, { cfg, user: req.user, ip: clientIp(req), feature, allowance });
  if (!lim.ok) {
    recordAi({ feature, provider: 'off', outcome: 'rateLimited', userId: req.user?.uid });
    return { res: limited(reply, lim) };
  }
  return { ctx: { cfg, site, paid: g.paid, staff: g.staff, allowance } };
}

const SuggestBody = z.object({
  task: z.enum(['tags', 'category', 'language']),
  text: z.string().min(1).max(6000),
  options: z.array(z.string().min(1).max(64)).max(60).optional(),
}).strict();
const DescribeBody = z.object({
  kind: z.enum(['plugin', 'theme', 'app', 'preset', 'catalog', 'repo', 'project']).default('plugin'),
  name: z.string().trim().min(1).max(120),
  notes: z.string().max(4000).default(''),
  lang: z.enum(['en', 'fr']).default('en'),
}).strict();
const CheckBody = z.object({
  surface: z.enum(['community', 'member_message', 'team_message']).default('community'),
  text: z.string().min(1).max(8000),
}).strict();
// Two shapes: a verdict on a warning ("this warning is wrong"), or what a member did with a
// suggestion (applied it, or dismissed it). Only enums and a small count: no text, no content id.
export const FeedbackBody = z.union([
  z.object({ feature: z.enum(FEATURE_IDS), verdict: z.enum(['wrong', 'right']) }).strict(),
  z.object({
    feature: z.enum(FEATURE_IDS),
    outcome: z.enum(['accepted', 'rejected']),
    provider: z.enum(['laya', 'external', 'byok', 'site', 'local', 'rules']).default('rules'),
    field: z.enum(['tags', 'category', 'description', 'language']).optional(),
    n: z.number().int().min(1).max(20).default(1),
  }).strict(),
]);
/** The analytics' provider for a suggestion's source: word matching counts as `rules`. */
export const feedbackProvider = (src) => (src === 'local' ? 'rules' : src);
const KeyBody = z.object({
  baseUrl: z.string().trim().min(8).max(300),
  key: z.string().min(8).max(400),
  model: z.string().trim().max(80).regex(/^[\w.:/-]*$/).default(''),
}).strict();

const int = (lo, hi) => z.number().int().min(lo).max(hi).optional();
const FeaturesBody = z.object({
  features: z.object(Object.fromEntries(FEATURE_IDS.map((id) => [id, z.object({
    enabled: z.boolean().optional(),
    audience: z.enum(['all', 'paid', 'staff']).optional(),
    perUserPerDay: int(...FEATURE_BOUNDS.perUserPerDay),
    paidPerUserPerDay: int(...FEATURE_BOUNDS.perUserPerDay),
  }).strict().optional()]))).strict().optional(),
  limits: z.object({ perUserPerMin: int(...FEATURE_BOUNDS.perUserPerMin), perIpPerMin: int(...FEATURE_BOUNDS.perIpPerMin), globalPerDay: int(...FEATURE_BOUNDS.globalPerDay) }).strict().optional(),
  byok: z.object({ enabled: z.boolean().optional(), perUserPerDay: int(...FEATURE_BOUNDS.byokPerUserPerDay) }).strict().optional(),
  site: z.object({ forStaff: z.boolean().optional(), forPaid: z.boolean().optional(), perUserPerDay: int(...FEATURE_BOUNDS.sitePerUserPerDay), globalPerDay: int(...FEATURE_BOUNDS.siteGlobalPerDay) }).strict().optional(),
  gen: z.object({ maxTokens: int(...FEATURE_BOUNDS.maxTokens), timeoutMs: int(...FEATURE_BOUNDS.timeoutMs), concurrency: int(...FEATURE_BOUNDS.concurrency) }).strict().optional(),
  pricing: z.object({
    external: z.object({ inPerMTok: z.number().min(0).max(1000).optional(), outPerMTok: z.number().min(0).max(1000).optional() }).strict().optional(),
    site: z.object({ inPerMTok: z.number().min(0).max(1000).optional(), outPerMTok: z.number().min(0).max(1000).optional() }).strict().optional(),
  }).strict().optional(),
  retentionDays: int(...FEATURE_BOUNDS.retentionDays),
  // agent-bcw-nav: the search bars' limits (lib/search-ai.mjs).
  search: z.object({
    anon: z.boolean().optional(),
    perUserPerMin: int(...SEARCH_BOUNDS.perUserPerMin), perAnonPerMin: int(...SEARCH_BOUNDS.perAnonPerMin),
    perIpPerMin: int(...SEARCH_BOUNDS.perIpPerMin), anonPerIpPerDay: int(...SEARCH_BOUNDS.anonPerIpPerDay), cacheTtlSec: int(...SEARCH_BOUNDS.cacheTtlSec),
  }).strict().optional(),
}).strict();

/** A member's key, as it may be shown: never the key, never the full URL's path. */
const serKey = (row) => (row ? { set: true, host: hostOf(row.baseUrl), model: row.model || '', last4: row.keyLast4 || '', lastUsedAt: row.lastUsedAt, createdAt: row.createdAt } : { set: false });

/** Merge two settings objects one level down (features.<id>, limits, byok…). */
function mergeFeatures(cur, patch) {
  const out = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'features') {
      out.features = { ...cur.features };
      for (const [id, f] of Object.entries(v || {})) out.features[id] = { ...cur.features[id], ...f };
    } else if (k === 'pricing') {
      out.pricing = { external: { ...cur.pricing.external, ...(v?.external || {}) }, site: { ...cur.pricing.site, ...(v?.site || {}) } };
    } else if (v && typeof v === 'object') out[k] = { ...cur[k], ...v };
    else out[k] = v;
  }
  return normalizeFeatures(out);
}

export default async function aiFeatureRoutes(app) {
  app.addHook('onReady', async () => { loadFeatures().catch(() => {}); });

  // ── Public ──────────────────────────────────────────────────────────────────────────────
  app.get('/site/features', async (req, reply) => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: OS_ENABLED_KEY } }).catch(() => null);
    reply.header('Cache-Control', 'public, max-age=30');
    // agent-bcw-nav: whether the search bars may ask Laya at all, so a page never sends a
    // request that can only answer "off". Who may is still checked on every call.
    let search = { ai: false, anon: false };
    try {
      const { cfg } = await loadFeatures();
      const f = cfg.features.search;
      search = { ai: !!f?.enabled && classifierOn(await aiLoadConfig()), anon: !!cfg.search?.anon && f?.audience === 'all' };
    } catch { /* unreadable: off */ }
    // OS mode is ON unless an admin switched it off: it was shipped on, and a missing row must
    // not take away what people already use.
    return { os: { enabled: row?.value !== false, beta: true }, search };
  });

  // ── Members ─────────────────────────────────────────────────────────────────────────────
  app.get('/ai/me', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const { cfg, site } = await loadFeatures();
    const layer = await aiLoadConfig();
    const where = classifierWhere(layer);
    const row = cfg.byok.enabled ? await p.aiUserKey.findUnique({ where: { userId: req.user.uid } }).catch(() => null) : null;
    const staff = isStaff(req.user);
    const features = {};
    for (const id of FEATURE_IDS) {
      if (FEATURES[id].staffOnly) continue;
      const g = await featureGate(p, req.user, id, cfg);
      const entry = { kind: FEATURES[id].kind, audience: cfg.features[id].audience, available: g.ok, reason: g.ok ? null : g.reason };
      if (g.ok) {
        entry.allowance = dailyAllowance(cfg, id, g);
        entry.used = await userCallsToday(p, req.user.uid, id).catch(() => 0);
        if (FEATURES[id].kind === 'generative') {
          const k = await resolveGenKey(p, req.user, { cfg, site, paid: g.paid, staff: g.staff, withKey: false });
          entry.source = k.source;                    // byok | site | null
          entry.host = k.source ? k.host : null;      // where the text goes
          if (!k.source) { entry.available = false; entry.reason = k.reason; }
        } else {
          entry.source = where.kind === 'off' ? (FEATURES[id].fallback || null) : where.kind; // laya | external | local | rules
        }
      }
      features[id] = entry;
    }
    return {
      killed: !!layer.killed,
      classifier: where.kind,
      byok: { enabled: cfg.byok.enabled, perUserPerDay: cfg.byok.perUserPerDay, key: cfg.byok.enabled ? serKey(row) : { set: false } },
      siteKey: { forPaid: cfg.site.forPaid && !!site?.keySecret, forStaff: staff && cfg.site.forStaff && !!site?.keySecret },
      limits: { perUserPerMin: cfg.limits.perUserPerMin },
      features,
    };
  });

  app.put('/ai/key', { preHandler: requireRole(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { cfg } = await loadFeatures();
    if (!cfg.byok.enabled) return reply.code(403).send({ ok: false, error: 'byok_off' });
    const parsed = KeyBody.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
    const u = checkBaseUrl(parsed.data.baseUrl);
    if (!u.ok) return reply.code(400).send({ ok: false, error: u.error });
    if (!keyShapeOk(parsed.data.key)) return reply.code(400).send({ ok: false, error: 'bad_key' });
    const p = await db();
    const data = { baseUrl: u.url, model: parsed.data.model, keySecret: sealKey(parsed.data.key.trim(), req.user.uid), keyLast4: last4(parsed.data.key) };
    const row = await p.aiUserKey.upsert({ where: { userId: req.user.uid }, create: { userId: req.user.uid, ...data }, update: { ...data, lastUsedAt: null } });
    return { ok: true, key: serKey(row) };
  });

  app.delete('/ai/key', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const r = await p.aiUserKey.deleteMany({ where: { userId: req.user.uid } });
    return { ok: true, removed: r.count };
  });

  app.post('/ai/key/test', { preHandler: requireRole(), config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = await db();
    const { cfg } = await loadFeatures();
    if (!cfg.byok.enabled) return reply.code(403).send({ ok: false, error: 'byok_off' });
    const row = await p.aiUserKey.findUnique({ where: { userId: req.user.uid } });
    if (!row) return reply.code(404).send({ ok: false, error: 'no_key' });
    // BYOK only: the site key is never tested on a member's behalf.
    const r = await generate(p, req.user, 'key_test', { system: 'Answer with the single word OK.', prompt: 'ping', maxTokens: 32 }, { cfg: { ...cfg, site: { ...cfg.site, forStaff: false, forPaid: false } }, site: null, paid: false, staff: false });
    return r.value ? { ok: true, model: r.value.model, host: r.value.host } : { ok: false, reason: r.reason };
  });

  app.post('/ai/suggest', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = SuggestBody.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
    const { task, text } = parsed.data;
    const options = [...new Set((parsed.data.options || []).map((o) => o.trim()).filter(Boolean))];
    const feature = task === 'language' ? 'detect_language' : 'suggest_tags';
    if (task !== 'language' && options.length < 2) return reply.code(400).send({ ok: false, error: 'options_required' });
    const p = await db();
    const a = await admit(p, req, reply, feature);
    if (a.res) return a.res;
    const layer = await aiLoadConfig();
    if (task === 'language') {
      const local = detectLanguageLocal(text);
      if (classifierOn(layer)) {
        const langs = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'tr', 'zh', 'ja', 'other'];
        const r = await classify(feature, { type: 'choice', instructions: 'Which language is this text written in?', options: langs }, text, req.user.uid);
        if (r.value) return { ok: true, source: 'ai', provider: r.value.provider, result: { lang: r.value.choice, p: r.value.p ?? null } };
      }
      return { ok: true, source: 'local', result: local };
    }
    const local = suggestTagsLocal(text, options, 5);
    if (classifierOn(layer)) {
      const r = await classify(feature, { type: 'choice', instructions: task === 'category' ? 'Which category does this content belong to?' : 'Which of these tags fits this content best?', options }, text, req.user.uid);
      if (r.value) {
        const probs = Object.entries(r.value.probs || {}).sort((x, y) => y[1] - x[1]);
        const picked = probs.length ? probs.filter(([, v]) => v >= 0.15).slice(0, task === 'category' ? 1 : 3).map(([k, v]) => ({ tag: k, score: Math.round(v * 100) / 100 })) : [{ tag: r.value.choice, score: r.value.p ?? null }];
        const seen = new Set(picked.map((x) => x.tag));
        const merged = task === 'category' ? picked : [...picked, ...local.filter((x) => !seen.has(x.tag))].slice(0, 5);
        return { ok: true, source: 'ai', provider: r.value.provider, result: { tags: merged } };
      }
    }
    return { ok: true, source: 'local', result: { tags: task === 'category' ? local.slice(0, 1) : local } };
  });

  app.post('/ai/describe', { preHandler: requireRole(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = DescribeBody.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
    const p = await db();
    const a = await admit(p, req, reply, 'describe');
    if (a.res) return a.res;
    const { kind, name, notes, lang } = parsed.data;
    const system = `You write short, factual descriptions for a community catalogue of game mods and tools. Write ${lang === 'fr' ? 'in French' : 'in English'}, 2 to 4 sentences, at most 80 words, plain text. Describe only what the notes say; do not invent features, compatibility or claims. No marketing superlatives.`;
    const r = await generate(p, req.user, 'describe', { system, prompt: `Type: ${kind}\nName: ${name}\nNotes from the author:\n${notes || '(none)'}`, maxTokens: 220 }, a.ctx);
    if (!r.value) return { ok: false, reason: r.reason };
    return { ok: true, text: r.value.text, provider: r.value.provider, host: r.value.host };
  });

  app.post('/ai/check', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = CheckBody.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
    const p = await db();
    const a = await admit(p, req, reply, 'content_check');
    if (a.res) return a.res;
    const { moderate } = await import('../lib/moderation/index.mjs');
    const { loadConfig } = await import('../lib/moderation/config.mjs');
    // A DRY RUN: nothing counted, nothing stored, no case — and no author, so the answer is
    // about the text and not about how new the account is.
    const res = await moderate(parsed.data.surface, { text: parsed.data.text }, { p, dryRun: true, log: req.log });
    const mc = await loadConfig(p).catch(() => null);
    const w = coarseWarnings(res, mc?.policies?.[parsed.data.surface]?.thresholds);
    recordAi({ feature: 'content_check', provider: res.ai ? (res.ai.provider === 'external' ? 'external' : 'laya') : 'rules', outcome: 'ok', latencyMs: res.ms || 0, userId: req.user.uid });
    return { ok: true, engine: res.engine === 'off' ? 'off' : 'on', ai: !!res.ai, ...w };
  });

  app.post('/ai/feedback', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = FeedbackBody.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
    const d = parsed.data;
    // A staff-only helper cannot be "rated" by a member who never saw it.
    if (FEATURES[d.feature].staffOnly && !isStaff(req.user)) return reply.code(403).send({ ok: false, error: 'staff_only' });
    if (d.verdict) recordAiEvent(d.feature, d.verdict === 'wrong' ? 'falsePositive' : 'confirmed', 'rules');
    else recordAiEvent(d.feature, d.outcome, feedbackProvider(d.provider), d.n);
    return { ok: true };
  });

  // ── Staff ───────────────────────────────────────────────────────────────────────────────
  app.get('/admin/ai/usage', { preHandler: requireCap('manage_moderation') }, async (req) => {
    const p = await db();
    const range = Object.hasOwn(RANGES, String(req.query?.range)) ? String(req.query.range) : '7d';
    const report = await aiUsageReport(p, { days: RANGES[range] });
    return { range, ...report };
  });

  app.get('/admin/ai/features', { preHandler: requireCap('manage_moderation') }, async () => {
    const { cfg, site } = await loadFeatures({ force: true });
    return { config: cfg, siteKey: publicSiteKey(site), catalogue: FEATURES, bounds: FEATURE_BOUNDS };
  });

  app.put('/admin/ai/features', { preHandler: requireCap('manage_moderation') }, async (req, reply) => {
    const parsed = FeaturesBody.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', detail: parsed.error.issues?.[0]?.message });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: AI_FEATURES_KEY } }).catch(() => null);
    const next = mergeFeatures(normalizeFeatures(row?.value), parsed.data);
    await p.adminSetting.upsert({ where: { key: AI_FEATURES_KEY }, create: { key: AI_FEATURES_KEY, value: next }, update: { value: next } });
    invalidateFeatures();
    const on = FEATURE_IDS.filter((id) => next.features[id].enabled);
    await logAudit(p, req.user.uid, 'ai.features', `on=${on.join(',') || '-'} byok=${next.byok.enabled} site.staff=${next.site.forStaff} site.paid=${next.site.forPaid}`, clientIp(req));
    return { ok: true, config: next };
  });

  // The site key is a credential and billing: an ADMIN's call, like un-killing the AI.
  app.put('/admin/ai/site-key', { preHandler: requireCap('manage_moderation') }, async (req, reply) => {
    if (!ADMIN_TIER.includes(req.user.role)) return reply.code(403).send({ error: 'forbidden', detail: 'admin_only' });
    const parsed = KeyBody.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const built = buildSiteKey(parsed.data);
    if (built.error) return reply.code(400).send({ error: built.error });
    const p = await db();
    await p.adminSetting.upsert({ where: { key: AI_SITE_KEY }, create: { key: AI_SITE_KEY, value: built.value }, update: { value: built.value } });
    invalidateFeatures();
    await logAudit(p, req.user.uid, 'ai.siteKey', `set host=${hostOf(built.value.baseUrl)} model=${built.value.model || '-'}`, clientIp(req));
    return { ok: true, siteKey: publicSiteKey(built.value) };
  });

  app.delete('/admin/ai/site-key', { preHandler: requireCap('manage_moderation') }, async (req, reply) => {
    if (!ADMIN_TIER.includes(req.user.role)) return reply.code(403).send({ error: 'forbidden', detail: 'admin_only' });
    const p = await db();
    await p.adminSetting.deleteMany({ where: { key: AI_SITE_KEY } });
    invalidateFeatures();
    await logAudit(p, req.user.uid, 'ai.siteKey', 'removed', clientIp(req));
    return { ok: true, siteKey: { set: false } };
  });

  /** The staff features' own switch (their audience is staff by construction). */
  const staffFeatureOn = async (id) => (await loadFeatures()).cfg.features[id].enabled;

  app.get('/admin/ai/triage', { preHandler: requireCap('manage_moderation') }, async (req, reply) => {
    if (!(await staffFeatureOn('triage'))) return reply.code(403).send({ error: 'feature_off' });
    const p = await db();
    const rows = await p.moderationCase.findMany({
      where: { status: 'open' }, orderBy: { createdAt: 'asc' }, take: 300,
      select: { id: true, surface: true, decision: true, score: true, held: true, ai: true, createdAt: true, subjectType: true, excerpt: true },
    });
    const now = Date.now();
    const ranked = rows.map((c) => ({ id: c.id, surface: c.surface, decision: c.decision, score: c.score, held: c.held, subjectType: c.subjectType, createdAt: c.createdAt, excerpt: c.excerpt ? String(c.excerpt).slice(0, 160) : null, triage: triageScore(c, now) }))
      .sort((a, b) => b.triage.score - a.triage.score).slice(0, 100);
    recordAi({ feature: 'triage', provider: 'rules', outcome: 'ok', latencyMs: Date.now() - now, userId: req.user.uid });
    return { cases: ranked, total: rows.length };
  });

  const SummarizeBody = z.object({ kind: z.enum(['report', 'feedback']), id: z.string().min(1).max(64) }).strict();
  app.post('/admin/ai/summarize', { preHandler: requireCap('manage_moderation'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!hasCap(req.user, 'manage_reports')) return reply.code(403).send({ error: 'missing_permission', capability: 'manage_reports' });
    const parsed = SummarizeBody.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const { cfg, site } = await loadFeatures();
    if (!cfg.features.summarize.enabled) return reply.code(403).send({ error: 'feature_off' });
    const lim = await checkLimits(p, { cfg, user: req.user, ip: clientIp(req), feature: 'summarize', allowance: cfg.features.summarize.paidPerUserPerDay });
    if (!lim.ok) return limited(reply, lim);
    let material = '';
    if (parsed.data.kind === 'report') {
      const r = await p.report.findUnique({ where: { id: parsed.data.id }, select: { reason: true, targetType: true, messages: { orderBy: { createdAt: 'asc' }, take: 40, select: { staff: true, authorId: true, body: true } } } });
      if (!r) return reply.code(404).send({ error: 'not_found' });
      // Roles, never names: the provider needs who-said-what, not who they are.
      material = `Report about a ${r.targetType}, reason: ${r.reason || 'unspecified'}\n\n${r.messages.map((m) => `${m.staff ? 'Staff' : m.authorId ? 'Reporter' : 'System'}: ${m.body}`).join('\n\n')}`;
    } else {
      const f = await p.feedback.findUnique({ where: { id: parsed.data.id }, select: { kind: true, title: true, body: true, appVersion: true, os: true } });
      if (!f) return reply.code(404).send({ error: 'not_found' });
      material = `A ${f.kind} report (app ${f.appVersion || '?'}, ${f.os || '?'})\nTitle: ${f.title}\n\n${f.body}`;
    }
    const r = await generate(p, req.user, 'summarize', {
      system: 'You summarise a moderation or support thread for a moderator. Write 3 to 5 short bullet points in English: what is claimed, what evidence is given, what was already answered, what remains open. Neutral, no judgement, no names.',
      prompt: material, maxTokens: 300,
    }, { cfg, site, paid: false, staff: true, siteOnly: true });
    // The site key or nothing: a report is the platform's data, not the moderator's to send to
    // a provider of their own choosing (finding 8). No site key → { ok:false, reason:'no_site_key' }.
    if (!r.value) return { ok: false, reason: r.reason };
    return { ok: true, text: r.value.text, provider: r.value.provider, host: r.value.host };
  });

  app.get('/admin/ai/duplicates', { preHandler: requireCap('manage_moderation') }, async (req, reply) => {
    if (!hasCap(req.user, 'manage_reports')) return reply.code(403).send({ error: 'missing_permission', capability: 'manage_reports' });
    if (!(await staffFeatureOn('duplicates'))) return reply.code(403).send({ error: 'feature_off' });
    const kind = req.query?.kind === 'reports' ? 'reports' : 'feedback';
    const threshold = Math.max(0.2, Math.min(0.95, Number(req.query?.threshold) || 0.5));
    const p = await db();
    const t0 = Date.now();
    let items;
    if (kind === 'reports') {
      const rows = await p.report.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'desc' }, take: 300, select: { id: true, targetLabel: true, reason: true, createdAt: true, messages: { orderBy: { createdAt: 'asc' }, take: 1, select: { body: true } } } });
      items = rows.map((r) => ({ id: r.id, label: r.targetLabel || r.reason, at: r.createdAt, text: `${r.reason} ${r.targetLabel} ${r.messages[0]?.body || ''}` }));
    } else {
      const rows = await p.feedback.findMany({ where: { status: { in: ['new', 'triaged'] }, kind: { not: 'crash' } }, orderBy: { createdAt: 'desc' }, take: 300, select: { id: true, title: true, body: true, projectKey: true, createdAt: true } });
      items = rows.map((r) => ({ id: r.id, label: r.title || r.projectKey, at: r.createdAt, text: `${r.title} ${r.body}` }));
    }
    const byId = new Map(items.map((x) => [x.id, x]));
    const clusters = clusterDuplicates(items, threshold).slice(0, 50)
      .map((c) => ({ similarity: c.similarity, items: c.ids.map((id) => ({ id, label: String(byId.get(id)?.label || '').slice(0, 120), at: byId.get(id)?.at })) }));
    recordAi({ feature: 'duplicates', provider: 'rules', outcome: 'ok', latencyMs: Date.now() - t0, userId: req.user.uid });
    return { kind, threshold, scanned: items.length, clusters };
  });

  app.get('/admin/ai/crash-clusters', { preHandler: requireCap('manage_moderation') }, async (req, reply) => {
    if (!hasCap(req.user, 'manage_reports')) return reply.code(403).send({ error: 'missing_permission', capability: 'manage_reports' });
    if (!(await staffFeatureOn('crash_clusters'))) return reply.code(403).send({ error: 'feature_off' });
    const p = await db();
    const t0 = Date.now();
    const rows = await p.feedback.findMany({ where: { kind: 'crash' }, orderBy: { createdAt: 'desc' }, take: 500, select: { id: true, title: true, body: true, meta: true, appVersion: true, projectKey: true, createdAt: true, count: true } });
    const groups = new Map();
    for (const r of rows) {
      const s = stackSignature(r);
      const g = groups.get(s.sig) || { sig: s.sig, weak: s.weak, frames: (s.frames || []).slice(0, 3), count: 0, ids: [], title: r.title, sample: r, versions: new Set(), last: r.createdAt };
      g.count += Math.max(1, r.count || 1);
      if (g.ids.length < 10) g.ids.push(r.id);
      if (r.appVersion) g.versions.add(r.appVersion);
      groups.set(s.sig, g);
    }
    const top = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 20);
    const layer = await aiLoadConfig();
    const useAi = classifierOn(layer);
    const CAUSES = ['gpu_driver', 'out_of_memory', 'missing_dependency', 'mod_conflict', 'corrupted_file', 'permission', 'game_update', 'other'];
    let aiCalls = 0;
    const out = [];
    for (const g of top) {
      const text = `${g.sample.title}\n${stackTextOf(g.sample)}`.slice(0, 3000);
      let cause = crashCauseLocal(text);
      let causeSource = 'local';
      // At most 8 classifier calls per view (the largest groups): a dashboard must not queue
      // the moderation pipeline behind it. The pipeline caches the answer for the same text.
      if (useAi && aiCalls < 8) {
        aiCalls += 1;
        const r = await classify('crash_clusters', { type: 'choice', instructions: 'What is the most likely cause of this crash report or log?', options: CAUSES }, text, req.user.uid);
        if (r.value?.choice) { cause = r.value.choice; causeSource = 'ai'; }
      }
      out.push({ sig: g.sig, weak: g.weak, frames: g.frames, count: g.count, ids: g.ids, title: String(g.title || '').slice(0, 140), versions: [...g.versions].slice(0, 6), last: g.last, cause, causeSource });
    }
    recordAi({ feature: 'crash_clusters', provider: 'rules', outcome: 'ok', latencyMs: Date.now() - t0, userId: req.user.uid });
    return { scanned: rows.length, groups: out, ai: useAi };
  });
}
