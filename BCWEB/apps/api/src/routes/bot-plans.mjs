// Discord bot plans (M21): listing, buying, and pointing a plan at your servers.
//
// The rules (what a plan grants, how a guild's entitlements are computed, where they are
// enforced) live in lib/bot-entitlements.mjs with the design decisions at its top. This file
// is only the doors:
//
//   GET  /hosting/bot-plans                  public: the bot-only plans, the bundles (hosting
//                                            plans that include bot entitlements), the free
//                                            tier, and the feature/limit vocabulary
//   POST /hosting/bot-plans/checkout         a recurring Stripe subscription (test mode in
//                                            dev; never a real charge from here). The grant is
//                                            written by the webhook, never at checkout.
//   GET  /me/bot-plans                       my subscriptions that grant bot entitlements, and
//                                            the servers I may point them at
//   PUT  /me/bot-plans/:id/guilds            choose those servers (at most plan.bot.guilds,
//                                            each one a server I manage)
//   GET  /admin/hosting/bot-entitlements     the free tier + the platform's own servers
//   PUT  /admin/hosting/bot-entitlements
import { z } from 'zod';
import { db, requireRole, requireCap, logAudit, clientIp } from '../lib/lib.mjs';
import { recordPendingCheckout } from '../lib/pending-checkout.mjs';
import {
  BOT_FEATURES, BOT_LIMITS, MAX_PLAN_GUILDS, BOT_ENTITLEMENTS_KEY,
  normalizePlanBot, normalizeSetting, normalizeTier, subCounts,
} from '../lib/bot-entitlements.mjs';

/** The Discord ids linked to this account, and the guilds they manage (owner or Manage-Server,
 *  as the bot reports on its heartbeat). The same predicate bot.mjs uses for the dashboard. */
async function manageableGuilds(p, uid) {
  const ids = (await p.discordLink.findMany({ where: { userId: uid }, select: { discordId: true } })).map((l) => l.discordId);
  if (!ids.length) return [];
  return p.botGuild.findMany({
    where: { OR: [{ ownerDiscordId: { in: ids } }, { managerDiscordIds: { hasSome: ids } }] },
    select: { guildId: true, name: true, memberCount: true },
    orderBy: { memberCount: 'desc' },
  });
}

const serPlan = (pl) => ({
  id: pl.id, name: pl.name, kind: pl.kind, priceMonthlyCents: pl.priceMonthlyCents,
  storageGB: pl.storageGB, bot: normalizePlanBot(pl.bot),
});

export default async function botPlanRoutes(app) {
  app.get('/hosting/bot-plans', async () => {
    const p = await db();
    const [rows, setting] = await Promise.all([
      p.hostingPlan.findMany({ where: { active: true }, orderBy: [{ priceMonthlyCents: 'asc' }] }),
      p.adminSetting.findUnique({ where: { key: BOT_ENTITLEMENTS_KEY } }).catch(() => null),
    ]);
    const withBot = rows.map(serPlan).filter((pl) => pl.bot);
    return {
      plans: withBot.filter((pl) => pl.kind === 'bot'),
      bundles: withBot.filter((pl) => pl.kind !== 'bot'),
      free: normalizeSetting(setting?.value).free,
      catalog: { features: BOT_FEATURES, limits: BOT_LIMITS },
    };
  });

  app.post('/hosting/bot-plans/checkout', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const b = z.object({
      planId: z.string().min(1).max(40),
      // The server this plan is for, when bought from its dashboard. Optional: it can be
      // chosen (or changed) afterwards from the plan's own card.
      guildId: z.string().regex(/^\d{1,32}$/).optional(),
      // Same rule as the hosting cart: no payment without the Terms and the Payments policy.
      acceptedTerms: z.literal(true),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: req.body?.acceptedTerms !== true ? 'terms_not_accepted' : 'invalid_input' });
    const p = await db();
    const plan = await p.hostingPlan.findUnique({ where: { id: b.data.planId } });
    const pb = plan ? normalizePlanBot(plan.bot) : null;
    if (!plan || !plan.active || plan.kind !== 'bot' || !pb) return reply.code(404).send({ error: 'unknown_plan' });
    if (!(plan.priceMonthlyCents > 0)) return reply.code(400).send({ error: 'no_price' });
    if (b.data.guildId) {
      const mine = await manageableGuilds(p, req.user.uid);
      if (!mine.some((g) => g.guildId === b.data.guildId)) return reply.code(403).send({ error: 'not_your_server' });
    }
    const { stripe, ensureCustomer } = await import('./hosting.mjs');
    const sk = await stripe({ forPurchase: true });
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const siteUrl = process.env.SITE_URL || 'http://localhost:5176';
    const customer = await ensureCustomer(p, sk, req.user.uid);
    const md = { type: 'bot_plan', planId: plan.id, userId: String(req.user.uid), guildId: b.data.guildId || '' };
    const session = await sk.checkout.sessions.create({
      mode: 'subscription', customer,
      line_items: [{ quantity: 1, price_data: {
        currency: 'usd', unit_amount: plan.priceMonthlyCents,
        recurring: { interval: 'month', interval_count: 1 },
        product_data: { name: `${plan.name} (Discord bot plan, monthly)` },
      } }],
      // On the subscription too, so a renewal or a cancellation can be traced to the plan.
      subscription_data: { metadata: md },
      metadata: md,
      // Back to the section where the plan is pointed at a server (MyBotPlans, hosting-bot.jsx).
      success_url: `${siteUrl}/hosting?botplan=ok#bot`,
      cancel_url: `${siteUrl}/hosting?botplan=cancel#bot`,
    });
    await recordPendingCheckout(p, { kind: 'bot_plan', sessionId: session.id, userId: req.user.uid, payload: md }).catch(() => {});
    return { url: session.url };
  });

  app.get('/me/bot-plans', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const [subs, guilds] = await Promise.all([
      p.subscription.findMany({
        where: { userId: req.user.uid, status: { in: ['active', 'canceling'] } },
        select: { id: true, status: true, currentPeriodEnd: true, botGuildIds: true, stripeSubId: true, hostingGroupId: true, plan: { select: { id: true, name: true, kind: true, bot: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      manageableGuilds(p, req.user.uid),
    ]);
    return {
      subs: subs.map((s) => ({ ...s, bot: normalizePlanBot(s.plan?.bot), counts: subCounts(s) }))
        .filter((s) => s.bot)
        .map(({ plan, stripeSubId, ...s }) => ({ ...s, planId: plan.id, planName: plan.name, kind: plan.kind, recurring: !!stripeSubId })),
      guilds,
    };
  });

  app.put('/me/bot-plans/:id/guilds', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ guildIds: z.array(z.string().regex(/^\d{1,32}$/)).max(MAX_PLAN_GUILDS) }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // The subscription is looked up WITH the caller's id: somebody else's is a 404, not a 403,
    // so the route does not confirm that an id exists.
    const sub = await p.subscription.findFirst({ where: { id: req.params.id, userId: req.user.uid }, include: { plan: { select: { name: true, bot: true } } } });
    const pb = sub ? normalizePlanBot(sub.plan?.bot) : null;
    if (!sub || !pb) return reply.code(404).send({ error: 'not_found' });
    const want = [...new Set(b.data.guildIds)];
    if (want.length > pb.guilds) return reply.code(400).send({ error: 'too_many_servers', max: pb.guilds });
    const mine = new Set((await manageableGuilds(p, req.user.uid)).map((g) => g.guildId));
    const foreign = want.filter((id) => !mine.has(id));
    if (foreign.length) return reply.code(403).send({ error: 'not_your_server', guildIds: foreign });
    const next = await p.subscription.update({ where: { id: sub.id }, data: { botGuildIds: want } });
    await logAudit(p, req.user.uid, 'bot.plan.guilds', `${sub.plan.name}: ${want.join(',') || 'none'}`, clientIp(req)).catch(() => {});
    return { ok: true, botGuildIds: next.botGuildIds };
  });

  app.get('/admin/hosting/bot-entitlements', { preHandler: requireCap('manage_hosting') }, async () => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: BOT_ENTITLEMENTS_KEY } });
    return { ...normalizeSetting(row?.value), saved: !!row, catalog: { features: BOT_FEATURES, limits: BOT_LIMITS, maxGuilds: MAX_PLAN_GUILDS } };
  });

  app.put('/admin/hosting/bot-entitlements', { preHandler: requireCap('manage_hosting') }, async (req, reply) => {
    const b = z.object({
      free: z.object({
        features: z.array(z.string().max(40)).max(40),
        limits: z.record(z.string().max(40), z.number().int().min(0).max(1_000_000)),
      }),
      unlimitedGuildIds: z.array(z.string().max(32)).max(50).default([]),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const value = normalizeSetting({ free: normalizeTier(b.data.free), unlimitedGuildIds: b.data.unlimitedGuildIds });
    await p.adminSetting.upsert({ where: { key: BOT_ENTITLEMENTS_KEY }, create: { key: BOT_ENTITLEMENTS_KEY, value }, update: { value } });
    await logAudit(p, req.user.uid, 'bot.plan.free_tier', `features=${value.free.features.join(',') || 'none'} unlimited=${value.unlimitedGuildIds.length}`, clientIp(req)).catch(() => {});
    return { ok: true, ...value };
  });
}
