// Discord bot billing doors (agent-bcw-bot). The rules are lib/bot-billing.mjs; this file is
// only who may call what.
//
//   GET  /me/discord/guilds/:id/billing          the server's tier, AI budget, wallet, packs
//   PUT  /me/discord/guilds/:id/ai               AI source (platform | byok), key, own cap
//   POST /me/discord/guilds/:id/credits/checkout a credit pack (Stripe Checkout, one payment;
//                                                the credits are written by the webhook)
//   GET  /bot/guilds/:id/plan                    (bot) tier + features + AI budget, for the
//                                                paywall cards and /plan
//   POST /bot/ai/ask                             (bot) one /ask answer, metered
//   GET/PUT /admin/bot/billing                   packs and per-call costs (manage_bot)
//   GET/POST /admin/bot/credits/:guildId         a server's wallet; give or take (manage_bot)
//
// Ownership is re-checked on every owner route (owner or Manage-Server, as the bot reports it,
// matched on the caller's linked Discord ids), the same predicate bot.mjs uses: the :id is
// never trusted alone, and somebody else's server is a 404.
import { z } from 'zod';
import { db, requireRole, requireCap, logAudit, clientIp, botAuth } from '../lib/lib.mjs';
import { boundedSet } from '../lib/boundedmap.mjs';
import { recordPendingCheckout } from '../lib/pending-checkout.mjs';
import { loadEntitlementContext, normalizePlanBot, subCounts } from '../lib/bot-entitlements.mjs';
import {
  BILLING_KEY, TIER_PRESETS, normalizeBilling, loadBilling, balanceOf, grantCredits, aiState, aiDecision, aiSummary,
  checkAi, commitAi, buildGuildKey, publicAiSettings, guildGenerate, nextExpiry, packMonths, askInflight, billingHealth,
} from '../lib/bot-billing.mjs';
import { normalizeRoleEndPolicy, ROLE_END_POLICIES } from '../lib/purchased-roles.mjs';

/** The packs as sold: each with the months it stays valid (0 = never). */
const packsOut = (billing) => billing.packs.map((x) => ({ ...x, months: packMonths(x, billing) }));

const SNOW = /^\d{5,32}$/;

async function myGuild(p, uid, guildId) {
  if (!SNOW.test(String(guildId || ''))) return null;
  const ids = (await p.discordLink.findMany({ where: { userId: uid }, select: { discordId: true } })).map((l) => l.discordId);
  if (!ids.length) return null;
  return p.botGuild.findFirst({ where: { guildId: String(guildId), OR: [{ ownerDiscordId: { in: ids } }, { managerDiscordIds: { hasSome: ids } }] } });
}

const RANK = { free: 0, pro: 1, ultra: 2, unlimited: 3 };
/** The highest public tier a server is on: from its counting subscriptions' plans. Pure. */
export function tierOf(guildId, ctx, ent, now = new Date()) {
  if (ent?.unlimited) return 'unlimited';
  let best = 'free';
  for (const sub of ctx?.subs || []) {
    if (!subCounts(sub, now)) continue;
    const pb = normalizePlanBot(sub.plan?.bot);
    if (!pb || !(sub.botGuildIds || []).map(String).slice(0, pb.guilds).includes(String(guildId))) continue;
    const t = pb.tier || 'pro'; // a plan that names no tier is still a paid one
    if (RANK[t] > RANK[best]) best = t;
  }
  return best;
}

/** Links the bot and the dashboard send an owner to. */
export function paywallLinks(siteUrl, { feature = '', guildId = '' } = {}) {
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const q = new URLSearchParams();
  if (feature) q.set('feature', feature);
  if (guildId) q.set('guild', guildId);
  const qs = q.toString();
  return {
    pricing: `${base}/bot/pricing${qs ? `?${qs}` : ''}`,
    features: `${base}/bot/features${feature ? `#${encodeURIComponent(feature)}` : ''}`,
    dashboard: `${base}/dashboard?s=discord${guildId ? `&guild=${guildId}&view=billing` : ''}`,
  };
}

// A burst limit on /ask per guild and per member, on top of the monthly budget: one server
// must not spend the provider's rate in a minute (OFD: 20 requests / minute / server).
const _burst = new Map();
function burstOk(key, max) {
  const k = `${key}:${Math.floor(Date.now() / 60000)}`;
  const e = _burst.get(k) || { n: 0 };
  e.n += 1;
  boundedSet(_burst, k, e, 10_000, 120_000);
  return e.n <= max;
}
export function _resetBurstForTests() { _burst.clear(); }

export default async function botBillingRoutes(app) {
  const siteUrl = () => process.env.SITE_URL || 'http://localhost:5176';

  app.get('/me/discord/guilds/:id/billing', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const g = await myGuild(p, req.user.uid, req.params.id);
    if (!g) return reply.code(404).send({ error: 'not_found' });
    const [{ ctx, entOf }, billing] = await Promise.all([loadEntitlementContext(p), loadBilling(p)]);
    const ent = entOf(g.guildId);
    const st = await aiState(p, g.guildId, ent, billing);
    const [history, soon, cfgRow] = await Promise.all([
      p.botCreditLedger.findMany({ where: { guildId: g.guildId }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, delta: true, reason: true, note: true, createdAt: true, expiresAt: true } }),
      nextExpiry(p, g.guildId),
      p.adminSetting.findUnique({ where: { key: 'bot.config' } }).catch(() => null),
    ]);
    return {
      tier: tierOf(g.guildId, ctx, ent), plans: ent.plans, entitlements: ent,
      ai: { ...publicAiSettings(st.settings), ...aiSummary(st), cost: billing.cost, byokFree: st.byokFree },
      credits: { balance: st.balance, history, nextExpiry: soon, expiryMonths: billing.expiryMonths },
      packs: packsOut(billing),
      purchasedRoles: normalizeRoleEndPolicy(cfgRow?.value?.guilds?.[g.guildId]?.purchasedRoles),
      links: paywallLinks(siteUrl(), { guildId: g.guildId }),
    };
  });

  app.put('/me/discord/guilds/:id/ai', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const b = z.object({
      source: z.enum(['platform', 'byok']).optional(),
      baseUrl: z.string().max(300).optional(),
      key: z.string().max(400).optional(),
      model: z.string().max(80).optional(),
      clearKey: z.boolean().optional(),
      monthlyCap: z.number().int().min(0).max(1_000_000).optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const g = await myGuild(p, req.user.uid, req.params.id);
    if (!g) return reply.code(404).send({ error: 'not_found' });
    const cur = await p.botAiSettings.findUnique({ where: { guildId: g.guildId } });
    const data = {};
    let keyChange = '';
    if (b.data.clearKey) { Object.assign(data, { keySecret: '', keyLast4: '', baseUrl: '', model: '' }); keyChange = 'cleared'; }
    else if (b.data.key) {
      const built = buildGuildKey(g.guildId, { baseUrl: b.data.baseUrl || cur?.baseUrl || '', key: b.data.key, model: b.data.model ?? cur?.model ?? '' });
      if (built.error) return reply.code(400).send({ error: built.error });
      Object.assign(data, built.value); keyChange = 'replaced';
    } else if (b.data.model != null && cur?.keySecret) {
      const m = b.data.model.trim();
      if (m && !/^[\w.:/-]+$/.test(m)) return reply.code(400).send({ error: 'bad_model' });
      data.model = m;
    }
    if (b.data.monthlyCap != null) data.monthlyCap = b.data.monthlyCap;
    if (b.data.source) data.source = b.data.source;
    const hasKey = data.keySecret !== undefined ? !!data.keySecret : !!cur?.keySecret;
    // BYOK without a key would refuse every call: say so now rather than at the first /ask.
    if ((data.source || cur?.source) === 'byok' && !hasKey) return reply.code(400).send({ error: 'no_key' });
    const row = await p.botAiSettings.upsert({ where: { guildId: g.guildId }, create: { guildId: g.guildId, ...data, updatedBy: req.user.uid }, update: { ...data, updatedBy: req.user.uid } });
    // The audit line never carries the key: only that it changed.
    await logAudit(p, req.user.uid, 'bot.ai.settings', `${g.guildId} source=${row.source}${keyChange ? ` key=${keyChange}` : ''} cap=${row.monthlyCap}`, clientIp(req)).catch(() => {});
    return { ok: true, ai: publicAiSettings(row) };
  });

  app.post('/me/discord/guilds/:id/credits/checkout', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const b = z.object({ packId: z.string().min(1).max(20), acceptedTerms: z.literal(true) }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: req.body?.acceptedTerms !== true ? 'terms_not_accepted' : 'invalid_input' });
    const p = await db();
    const g = await myGuild(p, req.user.uid, req.params.id);
    if (!g) return reply.code(404).send({ error: 'not_found' });
    const billingNow = await loadBilling(p);
    const pack = billingNow.packs.find((x) => x.id === b.data.packId);
    if (!pack) return reply.code(404).send({ error: 'unknown_pack' });
    const { stripe, ensureCustomer } = await import('./hosting.mjs');
    const sk = await stripe({ forPurchase: true });
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const customer = await ensureCustomer(p, sk, req.user.uid);
    // The credits and the server ride in the metadata the WEBHOOK reads (never the client's
    // word at completion): written here, server-side, from the pack on sale now.
    const md = { type: 'bot_credits', guildId: g.guildId, userId: String(req.user.uid), packId: pack.id, credits: String(pack.credits), months: String(packMonths(pack, billingNow)) };
    const session = await sk.checkout.sessions.create({
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: pack.priceCents, product_data: { name: `${pack.credits} bot credits (${g.name || g.guildId})` } } }],
      invoice_creation: { enabled: true },
      metadata: md,
      success_url: `${siteUrl()}/dashboard?s=discord&guild=${g.guildId}&view=billing&credits=ok`,
      cancel_url: `${siteUrl()}/dashboard?s=discord&guild=${g.guildId}&view=billing&credits=cancel`,
    });
    await recordPendingCheckout(p, { kind: 'bot_credits', sessionId: session.id, userId: req.user.uid, payload: md }).catch(() => {});
    return { url: session.url };
  });

  // ── the bot ──
  app.get('/bot/guilds/:id/plan', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    if (!SNOW.test(req.params.id)) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const [{ ctx, entOf }, billing] = await Promise.all([loadEntitlementContext(p), loadBilling(p)]);
    const ent = entOf(req.params.id);
    const st = await aiState(p, req.params.id, ent, billing);
    return {
      tier: tierOf(req.params.id, ctx, ent), features: ent.features, limits: ent.limits, unlimited: ent.unlimited,
      ai: { source: st.source, ...aiSummary(st) }, balance: st.balance,
      links: paywallLinks(siteUrl(), { guildId: req.params.id }),
    };
  });

  app.post('/bot/ai/ask', async (req, reply) => {
    if (!botAuth(req, reply)) return;
    const b = z.object({ guildId: z.string().regex(SNOW), userId: z.string().regex(SNOW), question: z.string().min(2).max(1500) }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ ok: false, error: 'invalid_input' });
    const { guildId, userId, question } = b.data;
    const p = await db();
    const [{ entOf }, billing] = await Promise.all([loadEntitlementContext(p), loadBilling(p)]);
    const ent = entOf(guildId);
    if (!ent.unlimited && !ent.features.includes('aiAsk')) return reply.code(402).send({ ok: false, error: 'plan_required', feature: 'aiAsk', links: paywallLinks(siteUrl(), { feature: 'aiAsk', guildId }) });
    if (!burstOk(`g:${guildId}`, 20) || !burstOk(`u:${guildId}:${userId}`, 5)) return reply.code(429).send({ ok: false, error: 'rate_limited' });
    const d = await checkAi(p, guildId, ent, billing);
    if (!d.ok) return reply.code(402).send({ ok: false, error: d.error, links: paywallLinks(siteUrl(), { feature: 'aiAsk', guildId }) });
    // How many calls are held open on a provider at once, per server and overall (a slow
    // endpoint must not pin the API's sockets): past it, "busy", which the bot shows as such.
    const release = askInflight.acquire(guildId);
    if (!release) return reply.code(429).send({ ok: false, error: 'busy' });
    try {
      let site = null;
      if (d.source === 'platform') {
        const { loadFeatures } = await import('../lib/ai-features.mjs');
        site = (await loadFeatures()).site;
      }
      const r = await guildGenerate({ guildId, source: d.source, settings: d.state.settings, site, question });
      if (!r.value) return { ok: false, reason: r.reason };
      const { charged } = await commitAi(p, guildId, d);
      return { ok: true, text: r.value.text, provider: r.value.provider, charged };
    } finally { release(); }
  });

  // ── admin ──
  app.get('/admin/bot/billing', { preHandler: requireCap('manage_bot') }, async () => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: BILLING_KEY } }).catch(() => null);
    return { ...normalizeBilling(row?.value), saved: !!row, tiers: TIER_PRESETS, health: billingHealth() };
  });

  app.put('/admin/bot/billing', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const b = z.object({
      packs: z.array(z.object({ id: z.string().max(20), credits: z.number().int().min(1).max(1_000_000), priceCents: z.number().int().min(50).max(100_000), months: z.number().int().min(0).max(120).nullish() })).min(1).max(6),
      cost: z.object({ platform: z.number().int().min(1).max(1000), byokFee: z.number().int().min(0).max(1000) }),
      expiryMonths: z.number().int().min(0).max(120).optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const value = normalizeBilling(b.data);
    await p.adminSetting.upsert({ where: { key: BILLING_KEY }, create: { key: BILLING_KEY, value }, update: { value } });
    await logAudit(p, req.user.uid, 'bot.billing', `packs=${value.packs.map((x) => `${x.id}:${x.credits}/${x.priceCents}`).join(',')} cost=${value.cost.platform}/${value.cost.byokFee} expiry=${value.expiryMonths}mo`, clientIp(req)).catch(() => {});
    return { ok: true, ...value };
  });

  // agent-bcw-bot: what happens to a marketplace-bought Discord role when its subscription
  // ends, per server (lib/purchased-roles.mjs). Stored with the server's other bot settings.
  app.put('/me/discord/guilds/:id/purchased-roles', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ onEnd: z.enum(ROLE_END_POLICIES), graceDays: z.number().int().min(1).max(90).optional() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const g = await myGuild(p, req.user.uid, req.params.id);
    if (!g) return reply.code(404).send({ error: 'not_found' });
    const raw = (await p.adminSetting.findUnique({ where: { key: 'bot.config' } }))?.value || {};
    const policy = normalizeRoleEndPolicy(b.data);
    const guilds = { ...(raw.guilds || {}), [g.guildId]: { ...(raw.guilds?.[g.guildId] || {}), purchasedRoles: policy } };
    const next = { ...raw, guilds };
    await p.adminSetting.upsert({ where: { key: 'bot.config' }, create: { key: 'bot.config', value: next }, update: { value: next } });
    await logAudit(p, req.user.uid, 'bot.purchased_roles', `${g.guildId} ${policy.onEnd}${policy.onEnd === 'grace' ? ` ${policy.graceDays}d` : ''}`, clientIp(req)).catch(() => {});
    return { ok: true, purchasedRoles: policy };
  });

  app.get('/admin/bot/credits/:guildId', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    if (!SNOW.test(req.params.guildId)) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const [balance, history] = await Promise.all([
      balanceOf(p, req.params.guildId),
      p.botCreditLedger.findMany({ where: { guildId: req.params.guildId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return { balance, history };
  });

  app.post('/admin/bot/credits/:guildId', { preHandler: requireCap('manage_bot') }, async (req, reply) => {
    const b = z.object({ delta: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0), note: z.string().min(3).max(200) }).safeParse(req.body || {});
    if (!b.success || !SNOW.test(req.params.guildId)) return reply.code(400).send({ error: req.body?.note ? 'invalid_input' : 'reason_required' });
    const p = await db();
    const r = await grantCredits(p, { guildId: req.params.guildId, delta: b.data.delta, reason: b.data.delta > 0 ? 'grant' : 'refund', userId: req.user.uid, note: b.data.note });
    await logAudit(p, req.user.uid, 'bot.credits.grant', `${req.params.guildId} ${r.delta ?? 0} (${b.data.note})`, clientIp(req)).catch(() => {});
    return { ...r, balance: await balanceOf(p, req.params.guildId) };
  });
}

// For the tests: the pure decision re-exported so a route test can compare against it.
export { aiDecision };
