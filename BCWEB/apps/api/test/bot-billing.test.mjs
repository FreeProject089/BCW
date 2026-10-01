// agent-bcw-bot: Discord bot tiers, AI allowance, credit wallet, BYOK, paywall links.
//
//   rules        the pure decision (allowance → credits → refusal; BYOK fee unless aiByok; the
//                owner's own cap), the billing setting cleaned, the tier of a server, the links
//                the paywall sends to, a saved free tier keeping the new limits' defaults
//   webhook      a paid credit pack adds its credits ONCE, whatever the replays; an unpaid
//                session adds nothing (in-memory Prisma stand-in, no Stripe)
//   routes       (real Postgres; skipped without DATABASE_URL) the owner reads the billing of
//                THEIR server only, sets BYOK (the key never comes back), /ask through a fake
//                OpenAI-compatible server: refused without credits (402 ai_credits), answered
//                and charged the fee with them, the wallet never below zero; the admin grant
//                needs a reason; the bot sees the plan and the paywall links
process.env.STRIPE_SECRET_KEY ||= 'sk_test_dummy';
process.env.AI_EXTERNAL_ALLOW_PRIVATE = '1'; // the fake provider below listens on 127.0.0.1
process.env.AI_TEST_ALLOW_PRIVATE_BYOK = '1'; // ai-secfix: a guild key on 127.0.0.1 needs the test-runner-only door
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import {
  aiDecision, aiSummary, normalizeBilling, DEFAULT_PACKS, AI_COST, TIER_PRESETS, monthKey, buildGuildKey, publicAiSettings, guildGenerate, guildKeyOwner,
  expiryFrom, planSpend, packMonths, grantCredits, balanceOf, expireCredits, nextExpiry, backfillLegacyLots, EXPIRY_ANNOUNCED_AT,
} from '../src/lib/bot-billing.mjs';
import { normalizeRoleEndPolicy, removalDate, guildOfRole, scheduleRoleRemovals, runDueRoleRemovals } from '../src/lib/purchased-roles.mjs';
import { normalizeSetting, normalizePlanBot, PAID_BY_DEFAULT, BOT_FEATURES, DEFAULT_FREE, NEW_LIMIT_DEFAULTS } from '../src/lib/bot-entitlements.mjs';
import { tierOf, paywallLinks } from '../src/routes/bot-billing.mjs';
import { openKey } from '../src/lib/ai-keys.mjs';
import { dispatchStripeEvent } from '../src/routes/stripe-webhook.mjs';
import { lockRow, unlockRow } from './row-lock.mjs';

const JWT = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const COST = { platform: 10, byokFee: 2 };

describe('the AI budget decision', () => {
  const base = { source: 'platform', included: 3, used: { platform: 0, byok: 0 }, balance: 0, cap: 0, byokFree: false, hasKey: false, cost: COST };
  test('the allowance first, free', () => {
    assert.deepEqual(aiDecision(base), { ok: true, charge: 0, over: false });
    assert.deepEqual(aiDecision({ ...base, used: { platform: 2, byok: 0 } }), { ok: true, charge: 0, over: false });
  });
  test('then credits, then a refusal that says how much one call needs', () => {
    const spent = { ...base, used: { platform: 3, byok: 0 } };
    assert.deepEqual(aiDecision({ ...spent, balance: 10 }), { ok: true, charge: 10, over: true });
    assert.deepEqual(aiDecision({ ...spent, balance: 9 }), { ok: false, error: 'ai_quota', need: 10 });
  });
  test('BYOK: needs a key, pays the fee unless the plan includes aiByok, ignores the allowance', () => {
    assert.deepEqual(aiDecision({ ...base, source: 'byok' }), { ok: false, error: 'no_key' });
    assert.deepEqual(aiDecision({ ...base, source: 'byok', hasKey: true }), { ok: false, error: 'ai_credits', need: 2 });
    assert.deepEqual(aiDecision({ ...base, source: 'byok', hasKey: true, balance: 2 }), { ok: true, charge: 2, over: false });
    assert.deepEqual(aiDecision({ ...base, source: 'byok', hasKey: true, byokFree: true }), { ok: true, charge: 0, over: false });
  });
  test('the owner’s own monthly cap wins over everything', () => {
    assert.deepEqual(aiDecision({ ...base, cap: 2, used: { platform: 1, byok: 1 }, balance: 1000 }), { ok: false, error: 'ai_cap' });
  });
  test('a negative or missing balance is zero', () => {
    assert.equal(aiDecision({ ...base, used: { platform: 3, byok: 0 }, balance: -50 }).error, 'ai_quota');
  });
  test('the summary: left, and how many calls the wallet still pays for', () => {
    const s = aiSummary({ included: 100, used: { platform: 40, byok: 0 }, balance: 55, cost: COST, source: 'platform' });
    assert.equal(s.left, 60);
    assert.equal(s.creditCalls, 5);
    assert.equal(aiSummary({ included: 0, used: { platform: 0, byok: 0 }, balance: 5, cost: COST, source: 'byok', byokFree: true }).creditCalls, null, 'free BYOK: unlimited by the wallet');
  });
});

describe('the rules around it', () => {
  test('billing setting: defaults, bounds, duplicates and junk dropped', () => {
    assert.deepEqual(normalizeBilling(null).packs, DEFAULT_PACKS.map((x) => ({ ...x })));
    assert.deepEqual(normalizeBilling(null).cost, AI_COST);
    const b = normalizeBilling({ packs: [{ id: 'A', credits: 100, priceCents: 99 }, { id: 'a', credits: 5, priceCents: 999 }, { id: 'x', credits: 0, priceCents: 500 }, { id: 'cheap', credits: 10, priceCents: 10 }], cost: { platform: 0, byokFee: 5000 } });
    assert.deepEqual(b.packs, [{ id: 'a', credits: 100, priceCents: 99 }]);
    assert.deepEqual(b.cost, { platform: 1, byokFee: 1000 });
  });
  test('the new paid-by-default features, and /ask free', () => {
    assert.deepEqual(PAID_BY_DEFAULT, ['aiAutomod', 'jtcPro', 'aiByok']);
    assert.ok(DEFAULT_FREE.features.includes('aiAsk'));
    assert.equal(DEFAULT_FREE.limits.aiMonthly, 100);
    for (const f of TIER_PRESETS.pro.features) assert.ok(BOT_FEATURES.includes(f));
  });
  test('a free tier saved before these limits existed keeps their defaults, not 0', () => {
    const s = normalizeSetting({ free: { features: ['welcome', 'aiAsk'], limits: { gatingRules: 2 } } });
    assert.equal(s.free.limits.aiMonthly, NEW_LIMIT_DEFAULTS.aiMonthly);
    assert.equal(s.free.limits.storageMB, NEW_LIMIT_DEFAULTS.storageMB);
    assert.equal(s.free.limits.rolePanels, 0, 'an old limit it left out stays 0, as before');
    assert.equal(normalizeSetting({ free: { features: [], limits: { aiMonthly: 0 } } }).free.limits.aiMonthly, 0, 'an explicit 0 is kept');
  });
  test('a plan names its tier; an unknown tier is dropped', () => {
    assert.equal(normalizePlanBot({ tier: 'Ultra', features: ['jtcPro'] }).tier, 'ultra');
    assert.equal(normalizePlanBot({ tier: 'gold', features: ['jtcPro'] }).tier, undefined);
  });
  test('the tier of a server: its best counting plan, free without one, unlimited for the platform’s', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const sub = (tier, guilds, extra = {}) => ({ status: 'active', currentPeriodEnd: new Date('2026-11-01'), botGuildIds: guilds, plan: { name: tier, bot: { tier, features: ['jtcPro'], guilds: 1 } }, ...extra });
    const ctx = { subs: [sub('pro', ['1']), sub('ultra', ['1'], { status: 'canceled' }), sub('ultra', ['2', '1'])] };
    assert.equal(tierOf('1', ctx, { unlimited: false }, now), 'pro', 'the ultra plan covers one server, the first it names');
    assert.equal(tierOf('2', ctx, { unlimited: false }, now), 'ultra');
    assert.equal(tierOf('3', ctx, { unlimited: false }, now), 'free');
    assert.equal(tierOf('3', ctx, { unlimited: true }, now), 'unlimited');
  });
  test('paywall links', () => {
    const L = paywallLinks('https://bc.example/', { feature: 'aiAsk', guildId: '99999' });
    assert.equal(L.pricing, 'https://bc.example/bot/pricing?feature=aiAsk&guild=99999');
    assert.equal(L.features, 'https://bc.example/bot/features#aiAsk');
    assert.equal(L.dashboard, 'https://bc.example/dashboard?s=discord&guild=99999&view=billing');
  });
  test('month key is UTC', () => {
    assert.equal(monthKey(new Date('2026-09-30T23:30:00-02:00')), '2026-10');
  });
  test('a guild key is sealed for that guild only, and never shown', () => {
    const b = buildGuildKey('12345', { baseUrl: 'https://api.example.com/v1', key: 'sk-test-abcdefghijklmnop', model: 'gpt-x' });
    assert.ok(b.value.keySecret && !b.value.keySecret.includes('abcdefghijklmnop'));
    assert.equal(openKey(b.value.keySecret, guildKeyOwner('12345')), 'sk-test-abcdefghijklmnop');
    assert.equal(openKey(b.value.keySecret, guildKeyOwner('99999')), null, 'another guild cannot open it');
    assert.equal(openKey(b.value.keySecret, 'site'), null);
    const pub = publicAiSettings({ source: 'byok', ...b.value });
    assert.equal(JSON.stringify(pub).includes('abcdefghijklmnop'), false);
    assert.equal(pub.keyLast4, 'mnop');
    assert.equal(buildGuildKey('1', { baseUrl: 'ftp://x', key: 'sk-test-abcdefghijklmnop' }).error != null, true);
    assert.equal(buildGuildKey('1', { baseUrl: 'https://api.example.com', key: 'short' }).error, 'bad_key');
  });
  test('guildGenerate: the answer, mentions defused; a rejected key says so', async () => {
    const b = buildGuildKey('12345', { baseUrl: 'https://api.example.com/v1', key: 'sk-test-abcdefghijklmnop' }).value;
    let sent = null;
    const ok = await guildGenerate({ guildId: '12345', source: 'byok', settings: b, question: 'hi', fetchImpl: async (url, init) => { sent = { url, init }; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Hello @everyone' } }] }) }; } });
    assert.equal(ok.value.text, 'Hello @​everyone');
    assert.equal(sent.url, 'https://api.example.com/v1/chat/completions');
    assert.equal(sent.init.headers.authorization, 'Bearer sk-test-abcdefghijklmnop');
    const bad = await guildGenerate({ guildId: '12345', source: 'byok', settings: b, question: 'hi', fetchImpl: async () => ({ ok: false, status: 401 }) });
    assert.equal(bad.reason, 'key_rejected');
    assert.equal((await guildGenerate({ guildId: '12345', source: 'platform', site: null, question: 'hi' })).reason, 'unavailable');
  });
});

describe('credits expire, spent oldest first (owner’s decision 2026-10-01)', () => {
  test('a pack is valid 12 months by default; admin- and pack-configurable; 0 = never', () => {
    assert.equal(normalizeBilling(null).expiryMonths, 12);
    assert.equal(normalizeBilling({ expiryMonths: 6 }).expiryMonths, 6);
    assert.equal(normalizeBilling({ expiryMonths: 999 }).expiryMonths, 120);
    const b = normalizeBilling({ expiryMonths: 6, packs: [{ id: 'a', credits: 100, priceCents: 99, months: 3 }, { id: 'b', credits: 100, priceCents: 99 }] });
    assert.equal(packMonths(b.packs[0], b), 3);
    assert.equal(packMonths(b.packs[1], b), 6);
  });
  test('expiry counts calendar months, and the end of a short month holds', () => {
    assert.equal(expiryFrom(new Date('2026-10-01T10:00:00Z'), 12).toISOString(), '2027-10-01T10:00:00.000Z');
    assert.equal(expiryFrom(new Date('2027-01-31T00:00:00Z'), 1).toISOString(), '2027-02-28T00:00:00.000Z');
    assert.equal(expiryFrom(new Date(), 0), null);
  });
  test('FIFO: the oldest lot pays first, an expired or empty lot never pays', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const lots = [
      { id: 'new', remaining: 50, createdAt: '2026-09-01', expiresAt: '2027-09-01' },
      { id: 'dead', remaining: 99, createdAt: '2025-01-01', expiresAt: '2026-01-01' },
      { id: 'old', remaining: 5, createdAt: '2026-01-01', expiresAt: '2027-01-01' },
      { id: 'forever', remaining: 10, createdAt: '2026-05-01', expiresAt: null },
      { id: 'empty', remaining: 0, createdAt: '2020-01-01', expiresAt: null },
    ];
    assert.deepEqual(planSpend(lots, 12, now), { take: [{ id: 'old', n: 5 }, { id: 'forever', n: 7 }], paid: 12 });
    assert.deepEqual(planSpend(lots, 1000, now).paid, 65, 'never more than the live lots hold');
    assert.deepEqual(planSpend([], 10, now), { take: [], paid: 0 });
  });
});

describe('purchased Discord roles at the end of a subscription', () => {
  test('the policy: grace (7 days) by default, bounded', () => {
    assert.deepEqual(normalizeRoleEndPolicy(null), { onEnd: 'grace', graceDays: 7 });
    assert.deepEqual(normalizeRoleEndPolicy({ onEnd: 'keep' }), { onEnd: 'keep', graceDays: 7 });
    assert.deepEqual(normalizeRoleEndPolicy({ onEnd: 'nope', graceDays: 500 }), { onEnd: 'grace', graceDays: 90 });
  });
  test('when the role goes', () => {
    const end = new Date('2026-10-01T00:00:00Z');
    assert.equal(removalDate({ onEnd: 'remove' }, end).toISOString(), end.toISOString());
    assert.equal(removalDate({ onEnd: 'keep' }, end), null);
    assert.equal(removalDate({ onEnd: 'grace', graceDays: 3 }, end).toISOString(), '2026-10-04T00:00:00.000Z');
  });
  test('the server of a role, from the heartbeat', () => {
    const list = [{ id: 'g1', roles: [{ id: 'r1' }] }, { id: 'g2', roles: [{ id: 'r2' }] }, { id: 'g3' }];
    assert.equal(guildOfRole(list, 'r2'), 'g2');
    assert.equal(guildOfRole(list, 'r9'), null);
    assert.equal(guildOfRole(list, ''), null);
  });

  // An in-memory stand-in: two servers, three policies, one buyer with two linked accounts.
  const fakeRolesDb = () => {
    const removals = []; const actions = [];
    const settings = {
      'bot.config': { guilds: { gKeep: { purchasedRoles: { onEnd: 'keep' } }, gNow: { purchasedRoles: { onEnd: 'remove' } } } }, // gGrace: default
      'bot.status': { guildList: [{ id: 'gKeep', roles: [{ id: 'rKeep' }] }, { id: 'gNow', roles: [{ id: 'rNow' }] }, { id: 'gGrace', roles: [{ id: 'rGrace' }] }] },
    };
    const active = new Set();
    return {
      removals, actions, active,
      adminSetting: { findUnique: async ({ where }) => (settings[where.key] ? { value: settings[where.key] } : null) },
      discordLink: { findMany: async () => [{ discordId: 'd1' }, { discordId: 'd2' }] },
      botRoleRemoval: {
        upsert: async ({ where, create }) => {
          const k = where.purchaseId_discordId;
          let r = removals.find((x) => x.purchaseId === k.purchaseId && x.discordId === k.discordId);
          if (!r) { r = { id: `rr${removals.length}`, doneAt: null, ...create }; removals.push(r); }
          return r;
        },
        findMany: async ({ where }) => removals.filter((x) => !x.doneAt && x.removeAt <= where.removeAt.lte),
        update: async ({ where, data }) => Object.assign(removals.find((x) => x.id === where.id), data),
      },
      projectProductPurchase: { findFirst: async ({ where }) => (active.has(`${where.productId}:${where.buyerId}`) ? { id: 'again' } : null) },
      botAction: { create: async ({ data }) => { actions.push(data); return data; } },
    };
  };
  const pu = (id, roleId) => ({ id, productId: `prod-${roleId}`, buyerId: 'buyer', product: { deliveryKind: 'role', roleId } });

  test('keep schedules nothing; remove is due at once; grace waits its days; a key product is ignored', async () => {
    const p = fakeRolesDb();
    const end = new Date('2026-10-01T00:00:00Z');
    const n = await scheduleRoleRemovals(p, [pu('p1', 'rKeep'), pu('p2', 'rNow'), pu('p3', 'rGrace'), { id: 'p4', productId: 'x', buyerId: 'buyer', product: { deliveryKind: 'key_static' } }, pu('p5', 'rUnknown')], end);
    assert.equal(n, 4, 'two accounts × (remove + grace)');
    await scheduleRoleRemovals(p, [pu('p2', 'rNow')], end);
    assert.equal(p.removals.length, 4, 'a replayed end schedules nothing more');
    let r = await runDueRoleRemovals(p, end);
    assert.deepEqual(r, { removed: 2, renewed: 0 });
    assert.deepEqual(p.actions.map((a) => [a.kind, a.guildId, a.roleId, a.discordId]), [['role_remove', 'gNow', 'rNow', 'd1'], ['role_remove', 'gNow', 'rNow', 'd2']]);
    r = await runDueRoleRemovals(p, new Date('2026-10-05T00:00:00Z'));
    assert.deepEqual(r, { removed: 0, renewed: 0 }, 'the grace period is not over');
    // The buyer paid again before the grace ran out: the role stays.
    p.active.add('prod-rGrace:buyer');
    r = await runDueRoleRemovals(p, new Date('2026-10-09T00:00:00Z'));
    assert.deepEqual(r, { removed: 0, renewed: 2 });
    assert.equal(p.actions.length, 2);
  });
});

// ── webhook, faked database ─────────────────────────────────────────────────────────────────
function fakeDb() {
  const ledger = []; const payments = []; const notes = [];
  const p = {
    ledger, payments, notes,
    botCreditLedger: {
      findUnique: async ({ where }) => ledger.find((x) => x.ref === where.ref) || null,
      create: async ({ data }) => { if (data.ref && ledger.some((x) => x.ref === data.ref)) { const e = new Error('unique'); e.code = 'P2002'; throw e; } ledger.push(data); return data; },
      aggregate: async ({ where }) => ({ _sum: { delta: ledger.filter((x) => x.guildId === where.guildId).reduce((a, x) => a + x.delta, 0) } }),
    },
    payment: { create: async ({ data }) => { payments.push(data); return data; } },
    user: { findUnique: async () => ({ notifPrefs: null }) },
    notification: { create: async ({ data }) => { notes.push(data); return data; } },
    adminSetting: { findUnique: async () => null },
    pendingCheckout: { updateMany: async () => ({ count: 0 }) },
  };
  p.$transaction = async (fn) => fn(p);
  return p;
}
const quiet = { warn() {}, info() {} };
const credSession = (over = {}) => ({ id: 'cs_cred_1', mode: 'payment', payment_status: 'paid', amount_total: 599, currency: 'usd', metadata: { type: 'bot_credits', guildId: '123456789012345678', userId: 'u1', packId: 'medium', credits: '2000' }, ...over });
const completed = (s) => ({ id: `evt_${Math.random()}`, type: 'checkout.session.completed', data: { object: s } });

describe('credit pack webhook', () => {
  test('a paid pack adds its credits once, whatever the replays', async () => {
    const p = fakeDb();
    for (let i = 0; i < 3; i++) await dispatchStripeEvent({ p, stripe: {}, event: completed(credSession()), log: quiet });
    assert.equal(p.ledger.length, 1);
    assert.deepEqual({ delta: p.ledger[0].delta, reason: p.ledger[0].reason, ref: p.ledger[0].ref }, { delta: 2000, reason: 'purchase', ref: 'stripe:cs_cred_1' });
    assert.equal(p.payments.length, 1, 'one receipt');
    assert.equal(p.notes.length, 1, 'told once');
    // The lot holds its credits for the validity sold at checkout (12 months when unsaid).
    assert.equal(p.ledger[0].remaining, 2000);
    const months = (p.ledger[0].expiresAt - Date.now()) / (30.44 * 864e5);
    assert.ok(months > 11.5 && months < 12.5, String(months));
  });
  test('the validity sold at checkout is the one written', async () => {
    const p = fakeDb();
    await dispatchStripeEvent({ p, stripe: {}, event: completed(credSession({ id: 'cs_cred_3', metadata: { ...credSession().metadata, months: '3' } })), log: quiet });
    const months = (p.ledger[0].expiresAt - Date.now()) / (30.44 * 864e5);
    assert.ok(months > 2.5 && months < 3.5, String(months));
    const q = fakeDb();
    await dispatchStripeEvent({ p: q, stripe: {}, event: completed(credSession({ id: 'cs_cred_4', metadata: { ...credSession().metadata, months: '0' } })), log: quiet });
    assert.equal(q.ledger[0].expiresAt, null, '0 = never');
  });
  test('an unpaid session adds nothing', async () => {
    const p = fakeDb();
    await dispatchStripeEvent({ p, stripe: {}, event: completed(credSession({ payment_status: 'unpaid' })), log: quiet });
    assert.equal(p.ledger.length, 0);
  });
});

// ── security (agent-bcw-bot, born red 2026-10-01) ────────────────────────────────────────────
// /ask read the provider's answer with res.json(): no size cap (a hostile BYOK endpoint could
// stream gigabytes into the API's memory) and no concurrency cap beyond the per-minute burst
// (twenty slow calls per guild, times every guild, all held open). The AI automod check
// swallowed a failed budget lookup and then counted nothing: fail-open, but free and invisible.
import * as billing from '../src/lib/bot-billing.mjs';

describe('security: /ask and the automod budget', () => {
  const key = () => buildGuildKey('12345', { baseUrl: 'https://api.example.com/v1', key: 'sk-test-abcdefghijklmnop' }).value;
  const endless = () => {
    let pulls = 0;
    const chunk = new TextEncoder().encode('x'.repeat(16 * 1024));
    const body = new ReadableStream({ pull(c) { pulls += 1; c.enqueue(chunk); } });
    return { res: { ok: true, status: 200, headers: new Headers(), body, json: async () => { throw new Error('res.json() must not be used'); } }, pulls: () => pulls };
  };

  test('a provider answer past the byte cap is refused, and the stream is not read to its end', async () => {
    assert.equal(typeof billing.readJsonCapped, 'function', 'readJsonCapped exported');
    assert.ok(billing.ASK_MAX_BYTES > 0 && billing.ASK_MAX_BYTES <= 256 * 1024, 'a small cap');
    const e = endless();
    const r = await guildGenerate({ guildId: '12345', source: 'byok', settings: key(), question: 'hi', fetchImpl: async () => e.res });
    assert.equal(r.value, null);
    assert.equal(r.reason, 'too_large');
    assert.ok(e.pulls() <= Math.ceil(billing.ASK_MAX_BYTES / (16 * 1024)) + 2, `stopped reading (${e.pulls()} chunks)`);
  });

  test('a declared content-length past the cap is refused before reading', async () => {
    let read = false;
    const res = { ok: true, status: 200, headers: new Headers({ 'content-length': String(50 * 1024 * 1024) }), body: new ReadableStream({ pull() { read = true; } }, { highWaterMark: 0 }), json: async () => ({}) };
    const r = await guildGenerate({ guildId: '12345', source: 'byok', settings: key(), question: 'hi', fetchImpl: async () => res });
    assert.equal(r.reason, 'too_large');
    assert.equal(read, false);
  });

  test('a normal streamed answer still comes back, mentions defused', async () => {
    const text = JSON.stringify({ choices: [{ message: { content: 'Hi <@&123> @here' } }] });
    const res = new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
    const r = await guildGenerate({ guildId: '12345', source: 'byok', settings: key(), question: 'hi', fetchImpl: async () => res });
    assert.equal(r.reason, null);
    assert.match(r.value.text, /@​here/);
  });

  test('in-flight /ask calls are capped per server and overall; a release frees exactly one slot', () => {
    assert.equal(typeof billing.makeInflight, 'function', 'makeInflight exported');
    const f = billing.makeInflight({ perGuild: 2, global: 3 });
    const a = f.acquire('g1'); const b = f.acquire('g1');
    assert.ok(a && b);
    assert.equal(f.acquire('g1'), null, 'third on the same server waits its turn');
    const c = f.acquire('g2');
    assert.ok(c);
    assert.equal(f.acquire('g3'), null, 'the platform-wide cap');
    a(); a(); // a double release frees one slot, not two
    assert.equal(f.inflight(), 2);
    assert.ok(f.acquire('g3'));
    assert.equal(f.acquire('g4'), null);
    assert.ok(billing.askInflight && typeof billing.askInflight.acquire === 'function', 'the route uses a shared limiter');
  });

  const usageDb = (fail = false) => {
    const rows = [];
    const p = {
      rows,
      $transaction: async (fn) => fn(p),
      botCreditLedger: { aggregate: async () => ({ _sum: { remaining: 0 } }), findMany: async () => [], update: async () => ({}), create: async () => ({}) },
      botAiUsage: { upsert: async (x) => { if (fail) throw new Error('db down'); rows.push(x); return x; } },
    };
    return p;
  };

  test('automod: a budget that could not be read still lets moderation run AND counts the call', async () => {
    assert.equal(typeof billing.recordAutomodUsage, 'function', 'recordAutomodUsage exported');
    const before = billing.billingHealth().automodBudgetUnknown;
    const p = usageDb();
    const r = await billing.recordAutomodUsage(p, '12345', null);
    assert.equal(r.counted, true);
    assert.equal(p.rows.length, 1, 'the call is in the monthly usage');
    assert.equal(p.rows[0].create.platform, 1);
    assert.equal(p.rows[0].create.creditsSpent, 0, 'nothing charged when the budget was unknown');
    assert.equal(billing.billingHealth().automodBudgetUnknown, before + 1, 'and the gap is counted');
  });

  test('automod: a failed commit never fails the check, and is counted', async () => {
    const before = billing.billingHealth().automodCommitFailed;
    const r = await billing.recordAutomodUsage(usageDb(true), '12345', { ok: true, charge: 0, over: false, source: 'platform' });
    assert.equal(r.counted, false);
    assert.equal(billing.billingHealth().automodCommitFailed, before + 1);
  });
});

// ── routes, real database ───────────────────────────────────────────────────────────────────
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the bot billing route tests';
const TAG = `botbill-${Date.now()}-`;
const G1 = `7${String(Date.now()).slice(-12)}01`;
const G2 = `7${String(Date.now()).slice(-12)}02`;
const OWNER = `6${String(Date.now()).slice(-12)}77`;
const SECRET = process.env.BOT_SHARED_SECRET || process.env.LINK_LOOKUP_SECRET || 'dev-bot-secret';
let p, app, user, admin, cookie, adminCookie, fake, fakeUrl, savedEnt, savedCfg;

before(async () => {
  if (!RUN) return;
  fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: `echo: ${JSON.parse(body).messages[1].content}` } }] }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${fake.address().port}/v1`;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  // bot.entitlements is the singleton bot-plans.test.mjs also stands up: the same lock.
  await lockRow(p, 'economy.global');
  savedEnt = await p.adminSetting.findUnique({ where: { key: 'bot.entitlements' } });
  savedCfg = await p.adminSetting.findUnique({ where: { key: 'bot.config' } });
  await p.adminSetting.deleteMany({ where: { key: 'bot.entitlements' } }); // the default free tier
  user = await p.user.create({ data: { email: `${TAG}owner@bettercommunity.invalid`, displayName: 'Owner', emailVerified: true } });
  admin = await p.user.create({ data: { email: `${TAG}admin@bettercommunity.invalid`, displayName: 'Admin', emailVerified: true, role: 'SUPERADMIN', totpEnabled: true } });
  const s1 = await p.session.create({ data: { userId: user.id }, select: { id: true } });
  const s2 = await p.session.create({ data: { userId: admin.id }, select: { id: true } });
  cookie = `bcw_session=${jwt.sign({ uid: user.id, role: user.role, sid: s1.id }, JWT)}`;
  adminCookie = `bcw_session=${jwt.sign({ uid: admin.id, role: 'SUPERADMIN', sid: s2.id }, JWT)}`;
  await p.discordLink.create({ data: { userId: user.id, discordId: OWNER, username: `${TAG}d` } });
  await p.botGuild.create({ data: { guildId: G1, name: `${TAG}mine`, ownerDiscordId: OWNER } });
  await p.botGuild.create({ data: { guildId: G2, name: `${TAG}theirs`, ownerDiscordId: '1' } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/bot-billing.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  await p.botCreditLedger.deleteMany({ where: { guildId: { in: [G1, G2] } } });
  await p.botAiUsage.deleteMany({ where: { guildId: { in: [G1, G2] } } });
  await p.botAiSettings.deleteMany({ where: { guildId: { in: [G1, G2] } } });
  await p.botGuild.deleteMany({ where: { guildId: { in: [G1, G2] } } });
  await p.discordLink.deleteMany({ where: { discordId: OWNER } });
  await p.auditLogEntry.deleteMany({ where: { actorId: { in: [user?.id || '-', admin?.id || '-'] } } }).catch(() => {});
  await p.session.deleteMany({ where: { userId: { in: [user?.id || '-', admin?.id || '-'] } } });
  await p.user.deleteMany({ where: { email: { startsWith: TAG } } });
  if (savedEnt) await p.adminSetting.upsert({ where: { key: 'bot.entitlements' }, create: savedEnt, update: { value: savedEnt.value } });
  if (savedCfg) await p.adminSetting.upsert({ where: { key: 'bot.config' }, create: savedCfg, update: { value: savedCfg.value } });
  else await p.adminSetting.deleteMany({ where: { key: 'bot.config' } });
  await unlockRow(p, 'economy.global');
  await app?.close();
  await new Promise((r) => fake.close(r));
  await p?.$disconnect?.();
});

const inject = (method, url, payload, headers = { cookie }) => app.inject({ method, url, headers, payload });
const bot = (method, url, payload) => app.inject({ method, url, headers: { 'x-bot-secret': SECRET }, payload });

describe('bot billing routes', { skip }, () => {
  test('the owner reads their server; somebody else’s is a 404', async () => {
    let r = await inject('GET', `/me/discord/guilds/${G1}/billing`);
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.equal(b.tier, 'free');
    assert.equal(b.ai.included, 100);
    assert.equal(b.ai.source, 'platform');
    assert.equal(b.credits.balance, 0);
    assert.ok(b.packs.length >= 1);
    r = await inject('GET', `/me/discord/guilds/${G2}/billing`);
    assert.equal(r.statusCode, 404);
  });

  test('BYOK: a key is required, is never returned, and the audit line does not carry it', async () => {
    let r = await inject('PUT', `/me/discord/guilds/${G1}/ai`, { source: 'byok' });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error, 'no_key');
    r = await inject('PUT', `/me/discord/guilds/${G1}/ai`, { source: 'byok', baseUrl: fakeUrl, key: 'sk-test-guildkey-123456', model: 'fake-1' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.body.includes('guildkey-123456'), false);
    assert.equal(r.json().ai.keyLast4, '3456');
    const audit = await p.auditLogEntry.findMany({ where: { actorId: user.id, action: 'bot.ai.settings' } });
    assert.ok(audit.length >= 1);
    for (const a of audit) assert.equal(String(a.detail).includes('guildkey'), false);
    r = await inject('PUT', `/me/discord/guilds/${G2}/ai`, { source: 'platform' });
    assert.equal(r.statusCode, 404, 'not their server');
  });

  test('/ask with BYOK: refused without credits, answered and charged the fee with them', async () => {
    let r = await bot('POST', '/bot/ai/ask', { guildId: G1, userId: OWNER, question: 'ping?' });
    assert.equal(r.statusCode, 402, r.body);
    assert.equal(r.json().error, 'ai_credits');
    assert.match(r.json().links.pricing, /\/bot\/pricing\?feature=aiAsk&guild=/);
    // The admin grant needs a reason, then adds the credits.
    r = await inject('POST', `/admin/bot/credits/${G1}`, { delta: 3 }, { cookie: adminCookie });
    assert.equal(r.statusCode, 400);
    r = await inject('POST', `/admin/bot/credits/${G1}`, { delta: 3, note: 'test grant' }, { cookie: adminCookie });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().balance, 3);
    r = await bot('POST', '/bot/ai/ask', { guildId: G1, userId: OWNER, question: 'ping?' });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual({ ok: r.json().ok, text: r.json().text, charged: r.json().charged }, { ok: true, text: 'echo: ping?', charged: 2 });
    r = await bot('POST', '/bot/ai/ask', { guildId: G1, userId: OWNER, question: 'again?' });
    assert.equal(r.statusCode, 402, 'one credit left, the fee is two');
    const usage = await p.botAiUsage.findUnique({ where: { guildId_month: { guildId: G1, month: monthKey() } } });
    assert.deepEqual({ byok: usage.byok, platform: usage.platform, creditsSpent: usage.creditsSpent }, { byok: 1, platform: 0, creditsSpent: 2 });
    // Taking more than is there empties the wallet, never below zero.
    r = await inject('POST', `/admin/bot/credits/${G1}`, { delta: -50, note: 'test take' }, { cookie: adminCookie });
    assert.equal(r.json().balance, 0);
  });

  test('/ask past the in-flight cap is "busy" (429), and a finished call frees its slot', async () => {
    let r = await inject('POST', `/admin/bot/credits/${G1}`, { delta: 10, note: 'test inflight' }, { cookie: adminCookie });
    assert.equal(r.statusCode, 200, r.body);
    const held = [billing.askInflight.acquire(G1), billing.askInflight.acquire(G1)];
    assert.ok(held.every(Boolean));
    try {
      r = await bot('POST', '/bot/ai/ask', { guildId: G1, userId: '600000000000000001', question: 'slot?' });
      assert.equal(r.statusCode, 429, r.body);
      assert.equal(r.json().error, 'busy');
    } finally { held.forEach((f) => f()); }
    r = await bot('POST', '/bot/ai/ask', { guildId: G1, userId: '600000000000000001', question: 'slot?' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(billing.askInflight.inflight(), 0, 'released after the answer');
    r = await inject('POST', `/admin/bot/credits/${G1}`, { delta: -50, note: 'test take' }, { cookie: adminCookie });
    assert.equal(r.json().balance, 0);
  });

  test('the bot sees the plan, the budget and the links', async () => {
    const r = await bot('GET', `/bot/guilds/${G1}/plan`);
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.equal(b.tier, 'free');
    assert.ok(b.features.includes('aiAsk'));
    assert.equal(b.features.includes('jtcPro'), false);
    assert.equal(b.ai.source, 'byok');
    assert.match(b.links.pricing, /guild=/);
    assert.equal((await app.inject({ method: 'GET', url: `/bot/guilds/${G1}/plan` })).statusCode, 401);
  });

  test('a credit checkout needs the terms and a pack on sale', async () => {
    let r = await inject('POST', `/me/discord/guilds/${G1}/credits/checkout`, { packId: 'medium' });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error, 'terms_not_accepted');
    r = await inject('POST', `/me/discord/guilds/${G1}/credits/checkout`, { packId: 'nope', acceptedTerms: true });
    assert.equal(r.statusCode, 404);
    r = await inject('POST', `/me/discord/guilds/${G2}/credits/checkout`, { packId: 'medium', acceptedTerms: true });
    assert.equal(r.statusCode, 404, 'not their server');
  });

  test('lots: the balance ignores expired credits, spending takes the oldest, the sweep writes it down', async () => {
    const now = new Date();
    const past = new Date(now.getTime() - 864e5);
    const soon = new Date(now.getTime() + 30 * 864e5);
    const later = new Date(now.getTime() + 300 * 864e5);
    await grantCredits(p, { guildId: G2, delta: 40, reason: 'purchase', ref: `${TAG}dead`, expiresAt: past });
    await grantCredits(p, { guildId: G2, delta: 10, reason: 'purchase', ref: `${TAG}soon`, expiresAt: soon });
    await grantCredits(p, { guildId: G2, delta: 20, reason: 'purchase', ref: `${TAG}later`, expiresAt: later });
    assert.equal(await balanceOf(p, G2), 30, 'the expired lot does not count');
    assert.deepEqual(await nextExpiry(p, G2), { credits: 10, at: soon });
    // Taking 15 empties the older live lot first.
    const r = await grantCredits(p, { guildId: G2, delta: -15, reason: 'refund', note: 'test' });
    assert.equal(r.delta, -15);
    const lots = await p.botCreditLedger.findMany({ where: { guildId: G2, delta: { gt: 0 } }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(lots.map((l) => l.remaining), [40, 0, 15], 'expired untouched, oldest live emptied, then the next');
    assert.equal(await expireCredits(p), 1);
    assert.equal(await expireCredits(p), 0, 'idempotent');
    const exp = await p.botCreditLedger.findFirst({ where: { guildId: G2, reason: 'expire' } });
    assert.equal(exp.delta, -40);
    assert.equal(await balanceOf(p, G2), 15);
  });

  test('a purchase from before the expiry rule gets the configured period from the announcement day', async () => {
    const old = await p.botCreditLedger.create({ data: { guildId: G2, delta: 7, remaining: 7, reason: 'purchase', ref: `${TAG}legacy`, createdAt: new Date('2026-09-15T00:00:00Z') } });
    const gift = await p.botCreditLedger.create({ data: { guildId: G2, delta: 3, remaining: 3, reason: 'grant', createdAt: new Date('2026-09-15T00:00:00Z') } });
    const n = await backfillLegacyLots(p, normalizeBilling({ expiryMonths: 6 }));
    assert.ok(n >= 1);
    assert.equal((await p.botCreditLedger.findUnique({ where: { id: old.id } })).expiresAt.toISOString(), '2027-04-01T00:00:00.000Z');
    assert.equal((await p.botCreditLedger.findUnique({ where: { id: gift.id } })).expiresAt, null, 'a gift keeps no expiry');
    assert.equal(await backfillLegacyLots(p, normalizeBilling({ expiryMonths: 6 })), 0, 'idempotent');
    assert.equal(EXPIRY_ANNOUNCED_AT.toISOString(), '2026-10-01T00:00:00.000Z');
  });

  test('the owner sets what happens to bought roles; the billing view shows it and the validity', async () => {
    let r = await inject('GET', `/me/discord/guilds/${G1}/billing`);
    assert.deepEqual(r.json().purchasedRoles, { onEnd: 'grace', graceDays: 7 });
    assert.equal(r.json().credits.expiryMonths, 12);
    assert.ok(r.json().packs.every((x) => x.months === 12));
    r = await inject('PUT', `/me/discord/guilds/${G1}/purchased-roles`, { onEnd: 'grace', graceDays: 14 });
    assert.equal(r.statusCode, 200, r.body);
    r = await inject('GET', `/me/discord/guilds/${G1}/billing`);
    assert.deepEqual(r.json().purchasedRoles, { onEnd: 'grace', graceDays: 14 });
    r = await inject('PUT', `/me/discord/guilds/${G2}/purchased-roles`, { onEnd: 'keep' });
    assert.equal(r.statusCode, 404, 'not their server');
    r = await inject('PUT', `/me/discord/guilds/${G1}/purchased-roles`, { onEnd: 'burn' });
    assert.equal(r.statusCode, 400);
  });
});
