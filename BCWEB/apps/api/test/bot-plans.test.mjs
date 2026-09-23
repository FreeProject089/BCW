// Discord bot plans (M21), end to end through the real routes.
//
//   webhook      a paid bot-plan checkout writes ONE subscription, however many times Stripe
//                (or the reconciler) delivers it; an unpaid session grants nothing; the
//                subscription ending is the revoke, and replaying the end changes nothing.
//                (In-memory Prisma stand-in: no Stripe, no database.)
//
//   enforcement  with a strict free tier, a server WITHOUT the plan cannot turn a gated
//                feature on or go past a limit through the owner's API (402, the feature
//                named) nor through Discord's /logs route, and the bot is SERVED the feature
//                switched off even when the config row says on. With the plan, the same save
//                passes. A plan cannot be pointed at a server the buyer does not manage.
//                (Real Postgres; skipped without DATABASE_URL. Fixtures are tagged and
//                removed; bot.config and bot.entitlements are snapshotted and put back.)
process.env.STRIPE_SECRET_KEY ||= 'sk_test_dummy';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { dispatchStripeEvent } from '../src/routes/stripe-webhook.mjs';
import { lockRow, unlockRow } from './row-lock.mjs';

// lib.mjs reads JWT_SECRET once, at load, and the static import above has already loaded it:
// setting the env var here would be too late. Sign with what lib.mjs actually holds.
const JWT = process.env.JWT_SECRET || 'dev-only-insecure-secret';

// ── webhook, faked database ─────────────────────────────────────────────────────────────────
const PLAN = { id: 'plan_bot', name: 'Bot Pro', kind: 'bot', active: true, priceMonthlyCents: 500, bot: { guilds: 1, features: ['rolePanels'], limits: { rolePanels: 5 } } };
function fakeDb() {
  const subs = []; const payments = []; const notes = [];
  return {
    subs, payments, notes,
    hostingPlan: { findUnique: async ({ where }) => (where.id === PLAN.id ? { ...PLAN } : null) },
    subscription: {
      findUnique: async ({ where }) => subs.find((x) => x.stripeSubId === where.stripeSubId) || null,
      create: async ({ data }) => {
        if (subs.some((x) => x.stripeSubId === data.stripeSubId)) { const e = new Error('unique'); e.code = 'P2002'; throw e; }
        const r = { id: `sub_${subs.length + 1}`, hostingGroupId: null, serverRepoId: null, ...data }; subs.push(r); return r;
      },
      update: async ({ where, data }) => { const r = subs.find((x) => x.id === where.id); Object.assign(r, data); return r; },
    },
    payment: { create: async ({ data }) => { payments.push(data); return data; } },
    projectProductPurchase: { updateMany: async () => ({ count: 0 }) },
    featureSubscription: { findUnique: async () => null },
    user: { findUnique: async () => ({ notifPrefs: null }) },
    notification: { create: async ({ data }) => { notes.push(data); return data; } },
    adminSetting: { findUnique: async () => null },
    pendingCheckout: { updateMany: async () => ({ count: 0 }) },
  };
}
const GUILD = '123456789012345678';
const session = (over = {}) => ({ id: 'cs_bot_1', mode: 'subscription', payment_status: 'paid', subscription: 'sub_stripe_1', amount_total: 500, currency: 'usd', metadata: { type: 'bot_plan', planId: PLAN.id, userId: 'u1', guildId: GUILD }, ...over });
const completed = (s) => ({ id: `evt_${Math.random()}`, type: 'checkout.session.completed', data: { object: s } });
const deleted = (id) => ({ id: `evt_${Math.random()}`, type: 'customer.subscription.deleted', data: { object: { id } } });
const quiet = { warn() {}, info() {} };

describe('bot plan webhook (grant and revoke, idempotent)', () => {
  test('a paid checkout grants once, on the server it was bought for, whatever the replays', async () => {
    const p = fakeDb();
    for (let i = 0; i < 3; i++) await dispatchStripeEvent({ p, stripe: {}, event: completed(session()), log: quiet });
    assert.equal(p.subs.length, 1);
    assert.equal(p.subs[0].status, 'active');
    assert.equal(p.subs[0].planId, PLAN.id);
    assert.deepEqual(p.subs[0].botGuildIds, [GUILD]);
    assert.equal(p.payments.length, 1, 'one receipt');
    assert.equal(p.payments[0].kind, 'BOT_PLAN');
    assert.equal(p.notes.length, 1, 'told once');
  });

  test('it never provisions a storage pool (the generic hosting tail is not reached)', async () => {
    const p = fakeDb();
    p.hostingGroup = { create: async () => { throw new Error('a bot plan must not create a pool'); } };
    await dispatchStripeEvent({ p, stripe: {}, event: completed(session()), log: quiet });
    assert.equal(p.subs.length, 1);
  });

  test('an unpaid (delayed) session grants nothing until it clears', async () => {
    const p = fakeDb();
    await dispatchStripeEvent({ p, stripe: {}, event: completed(session({ payment_status: 'unpaid' })), log: quiet });
    assert.equal(p.subs.length, 0);
  });

  test('the subscription ending is the revoke; replaying the end changes nothing more', async () => {
    const p = fakeDb();
    await dispatchStripeEvent({ p, stripe: {}, event: completed(session()), log: quiet });
    await dispatchStripeEvent({ p, stripe: {}, event: deleted('sub_stripe_1'), log: quiet });
    assert.equal(p.subs[0].status, 'canceled');
    const told = p.notes.length;
    await dispatchStripeEvent({ p, stripe: {}, event: deleted('sub_stripe_1'), log: quiet });
    assert.equal(p.subs[0].status, 'canceled');
    assert.equal(p.notes.length, told, 'the end is announced once');
  });
});

// ── enforcement, real database ──────────────────────────────────────────────────────────────
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the bot plan enforcement tests';
const TAG = `botplan-${Date.now()}-`;
const G1 = `9${String(Date.now()).slice(-12)}01`; // the owner's server, no plan at first
const G2 = `9${String(Date.now()).slice(-12)}02`; // a server the owner does NOT manage
const OWNER_DISCORD = `8${String(Date.now()).slice(-12)}77`;
let p, app, user, cookie, savedConfig, savedEnt, plan;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  // bot.config is the singleton economy-history-admin also snapshots and restores; take
  // the same lock so the two files do not put back each other's fixture.
  await lockRow(p, 'economy.global');
  savedConfig = await p.adminSetting.findUnique({ where: { key: 'bot.config' } });
  savedEnt = await p.adminSetting.findUnique({ where: { key: 'bot.entitlements' } });
  // A strict free tier: rolePanels and joinToCreate are what the plan sells.
  await p.adminSetting.upsert({
    where: { key: 'bot.entitlements' },
    create: { key: 'bot.entitlements', value: { free: { features: ['welcome', 'gating'], limits: { gatingRules: 2 } } } },
    update: { value: { free: { features: ['welcome', 'gating'], limits: { gatingRules: 2 } } } },
  });
  user = await p.user.create({ data: { email: `${TAG}owner@bettercommunity.invalid`, displayName: 'Bot Owner', emailVerified: true } });
  const sess = await p.session.create({ data: { userId: user.id }, select: { id: true } });
  cookie = `bcw_session=${jwt.sign({ uid: user.id, role: user.role, sid: sess.id }, JWT)}`;
  await p.discordLink.create({ data: { userId: user.id, discordId: OWNER_DISCORD, username: `${TAG}d` } });
  await p.botGuild.create({ data: { guildId: G1, name: `${TAG}mine`, ownerDiscordId: OWNER_DISCORD } });
  await p.botGuild.create({ data: { guildId: G2, name: `${TAG}theirs`, ownerDiscordId: '1' } });
  plan = await p.hostingPlan.create({ data: { name: `${TAG}Bot Pro`, kind: 'bot', storageGB: 0, uploadLimitKbps: 0, priceMonthlyCents: 500, active: false, bot: { guilds: 1, features: ['rolePanels', 'joinToCreate'], limits: { rolePanels: 2, joinToCreateLobbies: 3 } } } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/bot.mjs')).default);
  await app.register((await import('../src/routes/bot-plans.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  await p.subscription.deleteMany({ where: { userId: user?.id || '-' } });
  await p.hostingPlan.deleteMany({ where: { name: { startsWith: TAG } } });
  await p.botGuild.deleteMany({ where: { guildId: { in: [G1, G2] } } });
  await p.discordLink.deleteMany({ where: { discordId: OWNER_DISCORD } });
  await p.auditLogEntry.deleteMany({ where: { actorId: user?.id || '-' } }).catch(() => {});
  await p.session.deleteMany({ where: { userId: user?.id || '-' } });
  await p.user.deleteMany({ where: { email: { startsWith: TAG } } });
  const put = async (key, saved) => {
    if (saved) await p.adminSetting.upsert({ where: { key }, create: saved, update: { value: saved.value } });
    else await p.adminSetting.deleteMany({ where: { key } });
  };
  await put('bot.config', savedConfig);
  await put('bot.entitlements', savedEnt);
  await unlockRow(p, 'economy.global');
  await app?.close();
  await p?.$disconnect?.();
});

const put = (url, payload) => app.inject({ method: 'PUT', url, headers: { cookie }, payload });
const botGet = (url) => app.inject({ method: 'GET', url, headers: { 'x-bot-secret': process.env.BOT_SHARED_SECRET || process.env.LINK_LOOKUP_SECRET || 'dev-bot-secret' } });
const botPut = (url, payload) => app.inject({ method: 'PUT', url, headers: { 'x-bot-secret': process.env.BOT_SHARED_SECRET || process.env.LINK_LOOKUP_SECRET || 'dev-bot-secret' }, payload });

describe('bot plan enforcement through the API', { skip }, () => {
  test('without the plan: a gated feature cannot be turned on, a limit cannot be passed', async () => {
    let r = await put(`/me/discord/guilds/${G1}`, { joinToCreate: { enabled: true, lobbies: [{ lobbyChannelId: '1' }] } });
    assert.equal(r.statusCode, 402, r.body);
    assert.deepEqual(r.json(), { error: 'plan_required', feature: 'joinToCreate' });
    r = await put(`/me/discord/guilds/${G1}`, { rolePanels: [{ channelId: '5', title: 'x' }] });
    assert.equal(r.statusCode, 402);
    assert.equal(r.json().feature, 'rolePanels');
    r = await put(`/me/discord/guilds/${G1}`, { gating: { enabled: true, rules: [{ roleId: '1' }, { roleId: '2' }, { roleId: '3' }] } });
    assert.equal(r.statusCode, 402);
    assert.deepEqual(r.json(), { error: 'plan_limit', limit: 'gatingRules', max: 2 });
    // Nothing was written by the refused saves.
    const cfg = (await p.adminSetting.findUnique({ where: { key: 'bot.config' } }))?.value || {};
    assert.equal(cfg.guilds?.[G1]?.joinToCreate, undefined);
    // A free feature still saves, and turning a paid one OFF always does.
    r = await put(`/me/discord/guilds/${G1}`, { gating: { enabled: true, rules: [{ roleId: '1' }] }, joinToCreate: { enabled: false } });
    assert.equal(r.statusCode, 200, r.body);
  });

  test('Discord is not a way around it (the /logs route)', async () => {
    const r = await botPut(`/bot/guilds/${G1}/features`, { actorDiscordId: OWNER_DISCORD, patch: { logs: { forumId: '42' } } });
    assert.equal(r.statusCode, 402, r.body);
    assert.equal(r.json().feature, 'logRouting');
  });

  test('the bot is served the feature OFF even when the stored config says on', async () => {
    const row = await p.adminSetting.findUnique({ where: { key: 'bot.config' } });
    const raw = row?.value || {};
    const guilds = { ...(raw.guilds || {}), [G1]: { ...(raw.guilds?.[G1] || {}), joinToCreate: { enabled: true, lobbies: [{ lobbyChannelId: '1' }] } } };
    await p.adminSetting.upsert({ where: { key: 'bot.config' }, create: { key: 'bot.config', value: { ...raw, guilds } }, update: { value: { ...raw, guilds } } });
    const r = await botGet('/bot/config');
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().config.guilds[G1].joinToCreate.enabled, false);
  });

  test('a plan cannot be pointed at a server the buyer does not manage', async () => {
    const sub = await p.subscription.create({ data: { userId: user.id, planId: plan.id, status: 'active', currentPeriodEnd: new Date(Date.now() + 864e5) } });
    let r = await put(`/me/bot-plans/${sub.id}/guilds`, { guildIds: [G2] });
    assert.equal(r.statusCode, 403);
    r = await put(`/me/bot-plans/${sub.id}/guilds`, { guildIds: [G1, G2] });
    assert.equal(r.statusCode, 400, 'the plan covers one server');
    r = await put(`/me/bot-plans/${sub.id}/guilds`, { guildIds: [G1] });
    assert.equal(r.statusCode, 200, r.body);
  });

  test('with the plan: the same saves pass, up to the plan\'s own limit, and the bot is served them', async () => {
    let r = await put(`/me/discord/guilds/${G1}`, { joinToCreate: { enabled: true, lobbies: [{ lobbyChannelId: '1' }, { lobbyChannelId: '2' }] } });
    assert.equal(r.statusCode, 200, r.body);
    r = await put(`/me/discord/guilds/${G1}`, { rolePanels: [{ channelId: '5' }, { channelId: '6' }, { channelId: '7' }] });
    assert.equal(r.statusCode, 402);
    assert.deepEqual(r.json(), { error: 'plan_limit', limit: 'rolePanels', max: 2 });
    const c = await botGet('/bot/config');
    assert.equal(c.json().config.guilds[G1].joinToCreate.enabled, true);
  });

  test('the plan lapsing takes it away again, with no write to the guild', async () => {
    await p.subscription.updateMany({ where: { userId: user.id }, data: { status: 'canceled' } });
    const c = await botGet('/bot/config');
    assert.equal(c.json().config.guilds[G1].joinToCreate.enabled, false);
    const stored = (await p.adminSetting.findUnique({ where: { key: 'bot.config' } })).value.guilds[G1].joinToCreate.enabled;
    assert.equal(stored, true, 'the saved setting is kept for when they renew');
  });
});
