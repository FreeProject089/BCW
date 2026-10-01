// agent-bcw-pools: payment links, pools dedicated to a project, the early-access right, and the
// simple loyalty form. No database and no network: an in-memory Prisma stand-in, the Stripe
// webhook replayed through dispatchStripeEvent, stubs for everything that would call out.
process.env.STRIPE_SECRET_KEY ||= 'sk_test_dummy';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  paylinkSchema, paylinkProblem, amountFor, unavailable, countingUses, checkoutParams, fulfilPaylink, expirePaylinkHold, serPublic,
} from '../src/lib/paylinks.mjs';
import { splitTarget, targetOf, checkProjectRoom, isTargetShaped } from '../src/lib/project-pool.mjs';
import { normaliseLoyalty, simpleTiers, effectiveTiers } from '../src/lib/loyalty.mjs';
import { grantRights, scopeRights, GRANT_RIGHTS, SCOPE_RIGHTS, CAPABILITIES } from '../src/lib/lib.mjs';
import { dispatchStripeEvent } from '../src/routes/stripe-webhook.mjs';

// ── a small in-memory Prisma (the where operators these paths use) ─────────────────────────
function matchValue(v, cond) {
  if (cond === null) return v == null;
  if (typeof cond !== 'object') return v === cond;
  for (const [op, arg] of Object.entries(cond)) {
    if (op === 'in' && !arg.includes(v)) return false;
    if (op === 'not' && (arg === null ? v == null : v === arg)) return false;
  }
  return true;
}
function matches(row, where = {}) {
  for (const [k, c] of Object.entries(where || {})) {
    if (k === 'prereleaseId_userId') { if (row.prereleaseId !== c.prereleaseId || row.userId !== c.userId) return false; continue; }
    if (!matchValue(row[k], c)) return false;
  }
  return true;
}
function memDb(seed = {}) {
  const tables = {};
  let seq = 0;
  const table = (name) => (tables[name] ||= (seed[name] || []).map((r) => ({ ...r })));
  const model = (name) => ({
    findUnique: async ({ where }) => table(name).find((r) => matches(r, where)) || null,
    findFirst: async ({ where } = {}) => table(name).find((r) => matches(r, where)) || null,
    findMany: async ({ where } = {}) => table(name).filter((r) => matches(r, where)),
    count: async ({ where } = {}) => table(name).filter((r) => matches(r, where)).length,
    create: async ({ data }) => { const r = { id: `${name}_${++seq}`, createdAt: new Date(), ...data }; table(name).push(r); return r; },
    update: async ({ where, data }) => { const r = table(name).find((x) => matches(x, where)); if (!r) throw Object.assign(new Error('nf'), { code: 'P2025' }); return Object.assign(r, data); },
    updateMany: async ({ where, data }) => { const rows = table(name).filter((x) => matches(x, where)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
    aggregate: async () => ({ _sum: {} }),
    delete: async ({ where }) => { const t = table(name); const i = t.findIndex((x) => matches(x, where)); return i >= 0 ? t.splice(i, 1)[0] : null; },
  });
  return new Proxy({ _t: table }, { get: (o, k) => (k in o ? o[k] : model(k)) });
}
const quiet = { warn() {}, info() {} };
const evt = (type, object) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } });

const base = { title: 'A thing', kind: 'custom', priceMode: 'custom', amountCents: 500, interval: 'once' };
const parse = (x) => paylinkSchema.parse({ ...base, ...x });

describe('payment links: what an admin may create', () => {
  test('a pool needs its specs, a pre-release its id, and is one payment only', () => {
    assert.equal(paylinkProblem(parse({ kind: 'pool' })), 'pool_specs_required');
    assert.equal(paylinkProblem(parse({ kind: 'prerelease' })), 'prerelease_required');
    assert.equal(paylinkProblem(parse({ kind: 'prerelease', prereleaseId: 'x', interval: 'month' })), 'prerelease_is_one_payment');
    assert.equal(paylinkProblem(parse({ kind: 'custom', priceMode: 'auto' })), 'auto_price_is_for_pools');
    assert.equal(paylinkProblem(parse({ amountCents: 10 })), 'amount_required');
    assert.equal(paylinkProblem(parse({ onlyEmail: 'nope' })), 'invalid_email');
    assert.equal(paylinkProblem(parse({ kind: 'pool', pool: { storageGB: 50 } })), null);
  });
  test('the automatic price is the usual tariff, times the months of a one-off term', () => {
    const tariff = (gb, mbps) => gb * 10 + mbps; // cents
    const once = parse({ kind: 'pool', priceMode: 'auto', pool: { storageGB: 50, uploadMbps: 8, months: 6 } });
    assert.equal(amountFor(once, tariff), (500 + 8) * 6);
    const monthly = parse({ kind: 'pool', priceMode: 'auto', interval: 'month', pool: { storageGB: 50, uploadMbps: 8, months: 6 } });
    assert.equal(amountFor(monthly, tariff), 508);
    assert.equal(amountFor(parse({ amountCents: 1234 }), tariff), 1234);
  });
});

describe('payment links: who may pay', () => {
  const now = Date.now();
  const hold = (userId, mins) => ({ userId, status: 'pending', holdUntil: new Date(now + mins * 60_000) });
  test('paid uses and live holds count, expired holds do not', () => {
    assert.equal(countingUses([{ status: 'paid' }, hold('a', 5), hold('b', -5), { status: 'expired', holdUntil: new Date(now) }], now), 2);
  });
  test('sold out, expired, revoked, wrong account, already paid', () => {
    const link = { maxUses: 2, onlyEmail: '', expiresAt: null, revokedAt: null };
    assert.equal(unavailable(link, { uses: [{ userId: 'x', status: 'paid' }, hold('y', 5)], now, userId: 'z' }), 'sold_out');
    assert.equal(unavailable(link, { uses: [{ userId: 'x', status: 'paid' }, hold('y', -1)], now, userId: 'z' }), null);
    assert.equal(unavailable({ ...link, expiresAt: new Date(now - 1) }, { now }), 'expired');
    assert.equal(unavailable({ ...link, revokedAt: new Date() }, { now }), 'revoked');
    assert.equal(unavailable({ ...link, onlyEmail: 'a@b.c' }, { now, email: 'A@B.C' }), null);
    assert.equal(unavailable({ ...link, onlyEmail: 'a@b.c' }, { now, email: 'x@b.c' }), 'wrong_account');
    assert.equal(unavailable({ ...link, maxUses: null }, { uses: [{ userId: 'u', status: 'paid' }], now, userId: 'u' }), 'already_paid');
  });
  test('the public view never carries the creator, the e-mail or who paid', () => {
    const v = serPublic({ token: 't', title: 'T', description: '', kind: 'custom', amountCents: 500, currency: 'usd', interval: 'once', maxUses: 3, onlyEmail: 'a@b.c', createdById: 'admin', provision: {} }, { uses: [{ userId: 'u', status: 'paid' }] });
    assert.equal(v.left, 2);
    assert.equal(v.restricted, true);
    assert.ok(!JSON.stringify(v).includes('a@b.c') && !JSON.stringify(v).includes('admin'));
  });
  test('checkout: a monthly link is a subscription, a one-off link issues an invoice, both expire with the hold', () => {
    const link = { id: 'l1', token: 'tok', title: 'T', currency: 'usd', amountCents: 900, interval: 'month' };
    const m = checkoutParams(link, { useId: 'u1', userId: 'me', siteUrl: 'https://x.test/' });
    assert.equal(m.mode, 'subscription');
    assert.equal(m.line_items[0].price_data.recurring.interval, 'month');
    assert.deepEqual(m.metadata, { type: 'paylink', linkId: 'l1', useId: 'u1', userId: 'me' });
    assert.equal(m.success_url, 'https://x.test/pay/tok?paid=1');
    const o = checkoutParams({ ...link, interval: 'once' }, { useId: 'u1', userId: 'me', siteUrl: '' });
    assert.equal(o.mode, 'payment');
    assert.equal(o.invoice_creation.enabled, true);
    assert.ok(o.expires_at - Date.now() / 1000 >= 30 * 60);
  });
});

describe('payment links: the webhook provisions once', () => {
  const session = (over = {}) => ({ id: 'cs_1', payment_status: 'paid', amount_total: 4000, currency: 'usd', metadata: { type: 'paylink', linkId: 'l1', useId: 'use1', userId: 'u1' }, ...over });
  const seed = (link) => ({
    paymentLink: [{ id: 'l1', token: 'tok', title: '50 GB pool', kind: 'pool', interval: 'once', amountCents: 4000, currency: 'usd', provision: { storageGB: 50, uploadMbps: 8, months: 3, planId: 'plan1', projectTarget: 'sc:abcdefgh12' }, ...link }],
    paymentLinkUse: [{ id: 'use1', linkId: 'l1', userId: 'u1', sessionId: 'cs_1', status: 'pending', holdUntil: new Date(Date.now() + 60_000) }],
    hostingPlan: [{ id: 'plan1', name: 'Payment link: 50 GB pool', storageGB: 50, uploadLimitKbps: 8192, cpuShare: 0.25, priceMonthlyCents: 1333, active: false }],
    user: [{ id: 'u1', email: 'u1@x.test', notifPrefs: null }],
  });

  test('a pool: one pool, one subscription, one receipt, dedicated to its project, however often Stripe resends', async () => {
    const p = memDb(seed());
    for (let i = 0; i < 3; i++) await dispatchStripeEvent({ p, stripe: {}, event: evt('checkout.session.completed', session()), log: quiet });
    const pools = p._t('hostingGroup');
    assert.equal(pools.length, 1, 'one pool');
    assert.equal(pools[0].ownerId, 'u1');
    assert.equal(pools[0].projectTarget, 'sc:abcdefgh12');
    assert.equal(pools[0].poolBytes, BigInt(50 * 1024 ** 3));
    assert.equal(p._t('subscription').length, 1);
    const pays = p._t('payment');
    assert.equal(pays.length, 1);
    assert.equal(pays[0].kind, 'HOSTING');
    assert.equal(pays[0].hostingGroupId, pools[0].id);
    const use = p._t('paymentLinkUse')[0];
    assert.equal(use.status, 'paid');
    assert.deepEqual(use.result, { poolId: pools[0].id, projectTarget: 'sc:abcdefgh12' });
  });

  test('a project that already has a pool keeps it; the payer still gets theirs', async () => {
    const s = seed();
    s.hostingGroup = [{ id: 'g0', ownerId: 'other', projectTarget: 'sc:abcdefgh12', poolBytes: 1n }];
    const p = memDb(s);
    await dispatchStripeEvent({ p, stripe: {}, event: evt('checkout.session.completed', session()), log: quiet });
    const mine = p._t('hostingGroup').find((g) => g.ownerId === 'u1');
    assert.ok(mine && !mine.projectTarget);
    assert.equal(p._t('paymentLinkUse')[0].result.projectTaken, true);
  });

  test('early access: the sign-up becomes selected, once', async () => {
    const p = memDb({ ...seed({ kind: 'prerelease', provision: { prereleaseId: 'pr1', prereleaseSlug: 'v2' } }), preReleaseSignup: [{ id: 'su1', prereleaseId: 'pr1', userId: 'u1', status: 'pending' }] });
    for (let i = 0; i < 2; i++) await dispatchStripeEvent({ p, stripe: {}, event: evt('checkout.session.completed', session()), log: quiet });
    assert.equal(p._t('preReleaseSignup').length, 1);
    assert.equal(p._t('preReleaseSignup')[0].status, 'selected');
    assert.equal(p._t('payment').length, 1);
    assert.equal(p._t('payment')[0].kind, 'CUSTOM');
  });

  test('an unpaid session, or a session that is not the use it names, provisions nothing', async () => {
    const p = memDb(seed({ kind: 'custom', provision: {} }));
    assert.equal((await fulfilPaylink(p, session({ payment_status: 'unpaid' }), { provisionPool: async () => { throw new Error('no'); } })).why, 'unpaid');
    assert.equal((await fulfilPaylink(p, session({ metadata: { type: 'paylink', useId: 'use1', userId: 'intruder' } }), {})).why, 'unknown_use');
    assert.equal(p._t('payment').length, 0);
  });

  test('a late payment after the hold expired is still delivered (the money was taken)', async () => {
    const s = seed({ kind: 'custom', provision: {} });
    s.paymentLinkUse[0].status = 'expired';
    const p = memDb(s);
    const r = await fulfilPaylink(p, session(), { notify: async () => {} });
    assert.equal(r.done, true);
    assert.equal(p._t('paymentLinkUse')[0].status, 'paid');
  });

  test('an expired Checkout gives the place back; a paid use is never expired', async () => {
    const p = memDb(seed());
    await dispatchStripeEvent({ p, stripe: {}, event: evt('checkout.session.expired', { id: 'cs_1' }), log: quiet });
    assert.equal(p._t('paymentLinkUse')[0].status, 'expired');
    p._t('paymentLinkUse')[0].status = 'paid';
    assert.equal(await expirePaylinkHold(p, 'cs_1'), 0);
  });

  test('a monthly custom link: one receipt per renewal invoice', async () => {
    const p = memDb({ paymentLinkUse: [{ id: 'use1', linkId: 'l1', userId: 'u1', sessionId: 'cs_1', status: 'paid', stripeSubId: 'sub_9', link: { kind: 'custom', title: 'Support' } }] });
    const inv = { id: 'in_7', billing_reason: 'subscription_cycle', subscription: 'sub_9', amount_paid: 900, currency: 'usd' };
    for (let i = 0; i < 2; i++) await dispatchStripeEvent({ p, stripe: {}, event: evt('invoice.paid', inv), log: quiet });
    assert.equal(p._t('payment').length, 1);
    assert.equal(p._t('payment')[0].stripeSessionId, 'in_7');
  });
});

describe('pools dedicated to a project', () => {
  test('targets, both ways', () => {
    assert.deepEqual(splitTarget('sc:abc123xyz9'), { showcaseProjectId: 'abc123xyz9' });
    assert.deepEqual(splitTarget('bsm'), { projectKey: 'bsm' });
    assert.equal(targetOf({ showcaseProjectId: 'abc' }), 'sc:abc');
    assert.equal(targetOf({ projectKey: 'bmm' }), 'bmm');
    assert.equal(isTargetShaped('sc:abcdefgh12'), true);
    assert.equal(isTargetShaped('../etc'), false);
  });
  test('no pool: the site limits apply; a pool: its room decides, counting what a file replaces', async () => {
    const p = memDb({ hostingGroup: [{ id: 'g1', name: 'Team pool', projectTarget: 'sc:abcdefgh12' }] });
    assert.deepEqual(await checkProjectRoom(p, 'bmm', 10, { room: async () => 0n }), { ok: true, pooled: false });
    const full = await checkProjectRoom(p, 'sc:abcdefgh12', 100, { room: async () => 50n });
    assert.equal(full.ok, false); assert.equal(full.pooled, true); assert.equal(full.needBytes, 100);
    const swap = await checkProjectRoom(p, 'sc:abcdefgh12', 100, { replacedBytes: 60, room: async () => 50n });
    assert.equal(swap.ok, true, 'replacing a 60-byte file with a 100-byte one needs 40');
  });
});

describe('the early-access right and capability', () => {
  test('a grant or a scoped role may carry early_access; unknown rights still grant nothing', () => {
    assert.ok(GRANT_RIGHTS.includes('early_access') && SCOPE_RIGHTS.includes('early_access'));
    assert.deepEqual(grantRights({ rights: ['early_access'] }), ['early_access']);
    assert.deepEqual(grantRights({ rights: ['root'] }), ['pages']);
    assert.deepEqual(scopeRights({ scope: { rights: ['early_access', 'nope'] } }), ['early_access']);
    assert.ok(CAPABILITIES.includes('manage_prereleases'));
  });
});

describe('the simple loyalty form', () => {
  test('every 3 months 5 % less, up to 20 %: four steps, continuous', () => {
    const pol = normaliseLoyalty({ enabled: true, simple: { everyMonths: 3, stepPct: 5 }, maxPct: 20, lapseResets: false, tiers: [{ months: 1, pct: 80 }] });
    assert.deepEqual(pol.tiers, [{ months: 3, pct: 5 }, { months: 6, pct: 10 }, { months: 9, pct: 15 }, { months: 12, pct: 20 }]);
    assert.equal(pol.lapseResets, true, 'cancel and the price is full again');
    assert.deepEqual(pol.simple, { everyMonths: 3, stepPct: 5 });
    assert.deepEqual(effectiveTiers(pol), pol.tiers);
  });
  test('a step that overshoots the cap lands on it; no more than 12 steps; nonsense is no simple form', () => {
    assert.deepEqual(simpleTiers({ everyMonths: 6, stepPct: 7 }, 10), [{ months: 6, pct: 7 }, { months: 12, pct: 10 }]);
    assert.equal(simpleTiers({ everyMonths: 1, stepPct: 1 }, 90).length, 12);
    const pol = normaliseLoyalty({ simple: { everyMonths: 'x' } });
    assert.equal(pol.simple, undefined);
  });
});
