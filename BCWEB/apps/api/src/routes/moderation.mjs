// The moderation engine's admin surface, and the one bot endpoint (lib/moderation).
//
//   GET  /admin/moderation/cases?status=&surface=&decision=&held=&q=&page=   the queue
//   GET  /admin/moderation/cases/:id                                         one case, where its content lives, what can be done
//   POST /admin/moderation/cases/:id/action   { action, note?, reason?, remove?, allowDomains? }
//   GET  /admin/moderation/stats?days=
//   GET  /admin/moderation/policies · PUT     per-surface mode, thresholds, AI toggles
//   GET  /admin/moderation/rules    · PUT     keyword / pattern / domain lists, weights
//   POST /admin/moderation/test               { surface, text } → which rules fired (stores and counts nothing)
//   GET  /admin/moderation/settings · PUT     { enabled, retentionDays }
//   GET  /admin/moderation/ai                 AI layer status (read from aiStatus()) + the kill switch
//   PUT  /admin/moderation/ai/kill            { killed, reason? }  the GLOBAL AI kill switch
//   POST /bot/moderation/check                the Discord bot asks about a message (shared secret)
//
// Guards: the queue (reading cases, acting on them, the test box, the stats) is
// manage_moderation OR the MOD role, like the report queue next door. The configuration
// (policies, rules, settings, the kill switch) is manage_moderation only: changing what gets
// held for the whole site is a bigger decision than working a queue. Sanctioning an author
// from a case additionally needs manage_users (checked in lib/moderation/cases.mjs).
import { z } from 'zod';
import { db, requireCap, botAuth, logAudit, clientIp } from '../lib/lib.mjs';
import { moderate, aiModule } from '../lib/moderation/engine.mjs';
import { SURFACES, DEFAULT_POLICIES, MODES } from '../lib/moderation/policy.mjs';
import { KEYS, loadConfig, normalizeRules, normalizeSettings, saveSetting } from '../lib/moderation/config.mjs';
import { normalizePolicies } from '../lib/moderation/policy.mjs';
import { actOnCase, actionsFor, listCases, caseStats, ACTIONS } from '../lib/moderation/cases.mjs';
import { DEFAULT_BRANDS, SHORTENERS } from '../lib/moderation/links.mjs';
import { LIMITS } from '../lib/moderation/patterns.mjs';

/** Every built-in rule id with its default weight: what the rules editor lets an admin
 *  re-weigh (weights.<id>), and what the "test this text" box names. */
export const BUILTIN_RULES = Object.freeze({
  'link.scheme_script': 100, 'link.blocklisted': 100, 'link.lookalike': 70, 'link.gift_scam': 45, 'link.brand_in_subdomain': 50,
  'link.brand_in_domain': 40, 'link.mixed_script': 40, 'link.ip_host': 35, 'link.credential_path': 30, 'link.punycode': 20,
  'link.shortener': 20, 'link.many': 15, 'link.risky_tld': 8,
  'heur.mass_mentions': 30, 'heur.zalgo': 25, 'heur.invisible': 20, 'heur.repetition': 15, 'heur.caps': 10,
  'flood.burst': 70, 'flood.rate': 40, 'dup.cross_author': 45, 'dup.same_author': 20, 'dup.near': 15,
  'trust.new_account': 15, 'trust.unverified': 10, 'trust.prior_sanctions': 30, 'trust.restricted': 20, 'trust.anonymous': 5,
  'trust.established': -10, 'trust.staff': -50,
});

const QUEUE = { preHandler: requireCap('manage_moderation', 'MOD') };
const CONFIG = { preHandler: requireCap('manage_moderation') };

/** Where a case's content is read in the rest of the admin. */
function sourceOf(c, extra = {}) {
  switch (c.subjectType) {
    case 'contact_message': return { href: '/admin?s=messages', label: 'Contact inbox' };
    case 'contact_held': return { href: null, label: 'Held here until released' };
    case 'report': return { href: `/admin?s=reports&r=${c.subjectId}`, label: 'Report' };
    case 'report_message': return { href: extra.reportId ? `/admin?s=reports&r=${extra.reportId}` : '/admin?s=reports', label: 'Report message' };
    case 'rights_notice': return { href: '/admin?s=rights', label: 'Rights notice' };
    case 'thread_message': return { href: '/admin?s=messages', label: 'Contact thread' };
    case 'feedback': return { href: '/admin?s=feedback', label: 'Feedback centre' };
    case 'project_review': return { href: '/admin?s=projectreviews', label: 'Project reviews' };
    case 'discord_message': return { href: '/admin?s=bot', label: 'Discord' };
    default: return { href: null, label: c.subjectType };
  }
}

/** A case as the admin reads it. The held payload is never sent: it can carry an e-mail
 *  address, and the excerpt already shows what was written. */
const serCase = (c) => ({
  id: c.id, surface: c.surface, subjectType: c.subjectType, subjectId: c.subjectId,
  decision: c.decision, rawDecision: c.rawDecision, mode: c.mode, score: c.score,
  reasons: Array.isArray(c.reasons) ? c.reasons : [], ai: c.ai || null,
  status: c.status, held: c.held, authorId: c.authorId, authorKey: c.authorKey,
  excerpt: c.excerpt, purged: !!c.purgedAt,
  resolution: c.resolution, resolverId: c.resolverId, note: c.note, resolvedAt: c.resolvedAt,
  createdAt: c.createdAt, actions: actionsFor(c),
});

async function aiView(p) {
  const cfg = await loadConfig(p, { fresh: true });
  const mod = await aiModule();
  let status = null;
  if (mod?.aiStatus) {
    try {
      status = await Promise.race([Promise.resolve(mod.aiStatus()), new Promise((r) => setTimeout(() => r(null), 2000))]);
    } catch { status = null; }
  }
  return {
    available: !!mod,
    status,
    killSwitch: cfg.killSwitch,
    surfaces: Object.fromEntries(SURFACES.map((s) => [s, { ai: cfg.policies[s].ai, aiBlocking: cfg.policies[s].aiBlocking, enabledByLayer: (() => { try { return mod?.aiEnabledFor?.(s) === true; } catch { return false; } })() }])),
  };
}

export default async function moderationRoutes(app) {
  // ── the queue ─────────────────────────────────────────────────────────────────────────
  app.get('/admin/moderation/cases', QUEUE, async (req) => {
    const p = await db();
    const r = await listCases(p, req.query || {});
    const ids = [...new Set(r.cases.map((c) => c.authorId).filter(Boolean))];
    const users = ids.length ? await p.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, status: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return { ...r, cases: r.cases.map((c) => ({ ...serCase(c), excerpt: c.excerpt ? c.excerpt.slice(0, 280) : null, author: c.authorId ? byId.get(c.authorId) || null : null })) };
  });

  app.get('/admin/moderation/cases/:id', QUEUE, async (req, reply) => {
    const p = await db();
    const c = await p.moderationCase.findUnique({ where: { id: String(req.params.id) } });
    if (!c) return reply.code(404).send({ error: 'not_found' });
    const [author, resolver, prior, reportMsg] = await Promise.all([
      c.authorId ? p.user.findUnique({ where: { id: c.authorId }, select: { id: true, displayName: true, status: true, createdAt: true, emailVerified: true } }) : null,
      c.resolverId ? p.user.findUnique({ where: { id: c.resolverId }, select: { id: true, displayName: true } }) : null,
      c.authorId ? p.moderationCase.count({ where: { authorId: c.authorId, id: { not: c.id }, status: { in: ['open', 'resolved'] } } }) : c.authorKey ? p.moderationCase.count({ where: { authorKey: c.authorKey, id: { not: c.id }, status: { in: ['open', 'resolved'] } } }) : 0,
      c.subjectType === 'report_message' && c.subjectId ? p.reportMessage.findUnique({ where: { id: c.subjectId }, select: { reportId: true } }).catch(() => null) : null,
    ]);
    return { case: { ...serCase(c), author, resolver, priorCases: prior, source: sourceOf(c, { reportId: reportMsg?.reportId }) } };
  });

  app.post('/admin/moderation/cases/:id/action', QUEUE, async (req, reply) => {
    const b = z.object({
      action: z.enum(ACTIONS),
      note: z.string().max(1000).optional(),
      reason: z.string().max(1000).optional(),
      remove: z.boolean().optional(),
      allowDomains: z.array(z.string().max(253)).max(10).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await actOnCase(p, String(req.params.id), b.data.action, req.user, b.data, clientIp(req));
    if (r.error) return reply.code(r.status || 400).send({ error: r.error, ...(r.capability ? { capability: r.capability } : {}) });
    return { ok: true, case: serCase(r.case), sanctionCode: r.sanctionCode || null };
  });

  app.get('/admin/moderation/stats', QUEUE, async (req) => {
    const p = await db();
    const days = Math.max(1, Math.min(365, parseInt(req.query?.days, 10) || 30));
    return caseStats(p, days);
  });

  // ── "test this text": the full rule run, nothing stored, nothing counted ──
  app.post('/admin/moderation/test', { preHandler: requireCap('manage_moderation', 'MOD'), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = z.object({ surface: z.enum(SURFACES), text: z.string().max(20000), authorId: z.string().max(40).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await moderate(b.data.surface, { text: b.data.text, authorId: b.data.authorId || null }, { p, dryRun: true, canHold: true, canRefuse: true, log: req.log });
    return { result: r };
  });

  // ── configuration ─────────────────────────────────────────────────────────────────────
  app.get('/admin/moderation/policies', QUEUE, async () => {
    const p = await db();
    const cfg = await loadConfig(p, { fresh: true });
    return { policies: cfg.policies, defaults: DEFAULT_POLICIES, surfaces: SURFACES, modes: MODES, sensitive: SURFACES.filter((s) => cfg.policies[s].sensitive) };
  });

  app.put('/admin/moderation/policies', CONFIG, async (req, reply) => {
    const b = z.object({ policies: z.record(z.any()) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // Stored normalised, so a policy on disk is always one the engine would produce itself
    // (report/legal cannot be saved as auto, thresholds always climb).
    const policies = normalizePolicies(b.data.policies);
    const stored = Object.fromEntries(Object.entries(policies).map(([k, v]) => { const { sensitive: _s, ...rest } = v; return [k, rest]; }));
    await saveSetting(p, KEYS.policies, stored);
    await logAudit(p, req.user.uid, 'moderation.policies', Object.entries(policies).map(([s, v]) => `${s}=${v.mode}${v.ai ? '+ai' : ''}`).join(' ').slice(0, 300), clientIp(req));
    return { ok: true, policies };
  });

  app.get('/admin/moderation/rules', QUEUE, async () => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: KEYS.rules } }).catch(() => null);
    const { rules } = normalizeRules(row?.value, { probe: false });
    return { rules, builtin: BUILTIN_RULES, brands: DEFAULT_BRANDS, shorteners: SHORTENERS, limits: LIMITS };
  });

  app.put('/admin/moderation/rules', CONFIG, async (req, reply) => {
    const b = z.object({ rules: z.record(z.any()) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // The false-positive list is written by the queue, not by this editor: keep the stored
    // one unless the editor explicitly sends a (shorter) list, which is how an entry is removed.
    const row = await p.adminSetting.findUnique({ where: { key: KEYS.rules } }).catch(() => null);
    const incoming = { ...b.data.rules };
    if (!Array.isArray(incoming.falsePositives)) incoming.falsePositives = row?.value?.falsePositives || [];
    // Each pattern is compiled and probed here, once; a refused one refuses the save, with
    // the reason next to it, rather than being silently dropped.
    const { rules, errors } = normalizeRules(incoming);
    if (errors.length) return reply.code(400).send({ error: 'invalid_rules', errors });
    await saveSetting(p, KEYS.rules, rules);
    await logAudit(p, req.user.uid, 'moderation.rules', `keywords=${rules.keywords.length} patterns=${rules.patterns.length} block=${rules.blockDomains.length} allow=${rules.allowDomains.length}`, clientIp(req));
    return { ok: true, rules };
  });

  app.get('/admin/moderation/settings', QUEUE, async () => {
    const p = await db();
    const cfg = await loadConfig(p, { fresh: true });
    return { settings: cfg.settings };
  });

  app.put('/admin/moderation/settings', CONFIG, async (req, reply) => {
    const b = z.object({ enabled: z.boolean().optional(), retentionDays: z.number().int().min(1).max(3650).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cur = (await loadConfig(p, { fresh: true })).settings;
    const settings = normalizeSettings({ ...cur, ...b.data });
    await saveSetting(p, KEYS.settings, settings);
    await logAudit(p, req.user.uid, 'moderation.settings', `enabled=${settings.enabled} retentionDays=${settings.retentionDays}`, clientIp(req));
    return { ok: true, settings };
  });

  // ── the AI layer: status and the global kill switch ──
  app.get('/admin/moderation/ai', QUEUE, async () => aiView(await db()));

  app.put('/admin/moderation/ai/kill', CONFIG, async (req, reply) => {
    const b = z.object({ killed: z.boolean(), reason: z.string().max(300).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    // Killing is the safe direction and anybody who configures moderation may pull it.
    // Switching the AI back ON is an admin's call, as on the AI layer's own door (/admin/ai/kill).
    if (!b.data.killed && !['ADMIN', 'SUPERADMIN'].includes(req.user.role)) return reply.code(403).send({ error: 'forbidden', detail: 'admin_only_to_unkill' });
    const p = await db();
    // The same row the AI layer reads (ai.mjs AI_KILLED_KEY): one switch.
    await saveSetting(p, KEYS.kill, b.data.killed);
    const mod = await aiModule();
    try { mod?.aiInvalidateConfig?.(); } catch { /* it re-reads the row within seconds anyway */ }
    await logAudit(p, req.user.uid, b.data.killed ? 'ai.killed' : 'ai.unkilled', `via moderation${b.data.reason ? `: ${String(b.data.reason).trim().slice(0, 200)}` : ''}`, clientIp(req));
    return { ok: true, ...(await aiView(p)) };
  });

  // ── the Discord bot asks; the bot acts ──
  // The bot's own automod keeps its rules and actions (apps/bot features/automod.mjs). This is
  // a second opinion it can ask for: phishing links, cross-server spam campaigns, the site's
  // keyword lists. The answer is advice (`action`), recorded as a case when it is not ALLOW.
  app.post('/bot/moderation/check', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({
      surface: z.enum(['discord_automod', 'phishing']).optional().default('discord_automod'),
      text: z.string().max(4000).optional().default(''),
      links: z.array(z.string().max(2000)).max(30).optional().default([]),
      discordId: z.string().regex(/^\d{5,25}$/),
      guildId: z.string().regex(/^\d{5,25}$/).optional(),
      channelId: z.string().regex(/^\d{5,25}$/).optional(),
      messageId: z.string().regex(/^\d{5,25}$/).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const d = b.data;
    const p = await db();
    const r = await moderate(d.surface, { text: d.text, links: d.links, authorKey: `discord:${d.discordId}`, meta: { guildId: d.guildId, channelId: d.channelId } }, {
      p, log: req.log, canRefuse: true,
      subject: { type: 'discord_message', id: [d.guildId, d.channelId, d.messageId].filter(Boolean).join('/') },
    });
    return { decision: r.decision, action: r.action, score: r.score, caseId: r.caseId, reasons: (r.reasons || []).filter((x) => x.weight > 0).slice(0, 6).map((x) => ({ rule: x.rule, weight: x.weight, detail: x.detail })) };
  });
}
