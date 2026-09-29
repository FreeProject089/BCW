// hosting2 (agent-hosting): the hosting branches of the Stripe webhook, replayed.
//
// Stripe delivers an event at least once: it resends on a timeout, and the crash reconciler
// (lib/stripe-reconcile.mjs) replays a session it thinks the webhook never finished. Every
// hosting branch must therefore do its work ONCE however many times the event lands:
//   · an automatic renewal (invoice.paid) — one receipt, the loyalty coupon put on once, the
//     tenure not moved by the replay;
//   · a renewal paid by hand (pool_renew) — the term extended once, from the paid-up date;
//   · a new pool — provisioned once;
//   · catalogue file hosting — one moderation entry, one receipt, the tenure started once.
// No database and no network: an in-memory Prisma stand-in and a recording Stripe stub.
process.env.STRIPE_SECRET_KEY ||= 'sk_test_dummy';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchStripeEvent } from '../src/routes/stripe-webhook.mjs';
import { addMonths } from '../src/lib/loyalty.mjs';

// ── A small in-memory Prisma: enough of findUnique/findFirst/findMany/create/update/upsert
// and the where operators these branches use. Any model name answers (empty until seeded).
function matchValue(v, cond) {
  if (cond === null) return v == null;
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  if (typeof cond !== 'object') return v === cond;
  if ('path' in cond) {
    let x = v; for (const k of cond.path) x = x?.[k];
    if ('equals' in cond) return x === cond.equals;
    if ('string_starts_with' in cond) return typeof x === 'string' && x.startsWith(cond.string_starts_with);
    if ('gt' in cond) return typeof x === 'number' && x > cond.gt;
    return false;
  }
  for (const [op, arg] of Object.entries(cond)) {
    if (op === 'in' && !arg.includes(v)) return false;
    if (op === 'not' && (arg === null ? v == null : v === arg)) return false;
    if (op === 'gt' && !(v > arg)) return false;
    if (op === 'gte' && !(v >= arg)) return false;
    if (op === 'lt' && !(v < arg)) return false;
    if (op === 'lte' && !(v <= arg)) return false;
    if (op === 'equals' && v !== arg) return false;
  }
  return true;
}
function matches(row, where = {}) {
  for (const [k, c] of Object.entries(where || {})) {
    if (k === 'OR') { if (!c.some((w) => matches(row, w))) return false; continue; }
    if (k === 'AND') { if (!c.every((w) => matches(row, w))) return false; continue; }
    if (!matchValue(row[k], c)) return false;
  }
  return true;
}
const DEFAULTS = {
  subscription: () => ({ status: 'active', loyaltyPct: 0, poolContribBytes: 0n, tenureStartAt: null, warnedAt: null, stripeSubId: null, hostingGroupId: null, serverRepoId: null, botGuildIds: [] }),
  hostingGroup: () => ({ poolBytes: 0n }),
};
function memDb(seed = {}) {
  const tables = {};
  let seq = 0;
  const table = (name) => (tables[name] ||= (seed[name] || []).map((r) => ({ ...r })));
  const apply = (row, data) => {
    for (const [k, v] of Object.entries(data || {})) {
      if (v && typeof v === 'object' && 'increment' in v) row[k] = (row[k] || 0) + v.increment;
      else row[k] = v;
    }
    return row;
  };
  const model = (name) => ({
    findUnique: async ({ where }) => table(name).find((r) => matches(r, where)) || null,
    findFirst: async ({ where } = {}) => table(name).find((r) => matches(r, where)) || null,
    findMany: async ({ where } = {}) => table(name).filter((r) => matches(r, where)),
    count: async ({ where } = {}) => table(name).filter((r) => matches(r, where)).length,
    create: async ({ data }) => { const r = { id: `${name}_${++seq}`, createdAt: new Date(), ...(DEFAULTS[name]?.() || {}), ...data }; table(name).push(r); return r; },
    createMany: async ({ data }) => { for (const d of data) table(name).push({ id: `${name}_${++seq}`, ...d }); return { count: data.length }; },
    update: async ({ where, data }) => { const r = table(name).find((x) => matches(x, where)); if (!r) { const e = new Error('not found'); e.code = 'P2025'; throw e; } return apply(r, data); },
    updateMany: async ({ where, data }) => { const rows = table(name).filter((x) => matches(x, where)); rows.forEach((r) => apply(r, data)); return { count: rows.length }; },
    upsert: async ({ where, create, update }) => { const r = table(name).find((x) => matches(x, where)); if (r) return apply(r, update); return model(name).create({ data: create }); },
    delete: async ({ where }) => { const t = table(name); const i = t.findIndex((x) => matches(x, where)); return i >= 0 ? t.splice(i, 1)[0] : null; },
    deleteMany: async ({ where } = {}) => { const t = table(name); const keep = t.filter((x) => !matches(x, where)); const n = t.length - keep.length; tables[name] = keep; return { count: n }; },
    aggregate: async () => ({ _sum: {} }),
  });
  return new Proxy({ _tables: tables, _t: table }, { get: (o, k) => (k in o ? o[k] : model(k)) });
}

function stripeStub() {
  const calls = [];
  const coupons = new Set();
  return {
    calls,
    coupons: {
      retrieve: async (id) => { calls.push(['coupons.retrieve', id]); if (!coupons.has(id)) throw new Error('No such coupon'); return { id }; },
      create: async (o) => { calls.push(['coupons.create', o.id]); coupons.add(o.id); return { id: o.id }; },
    },
    subscriptions: {
      update: async (id, o) => { calls.push(['subscriptions.update', id, o]); return {}; },
      deleteDiscount: async (id) => { calls.push(['subscriptions.deleteDiscount', id]); return {}; },
      cancel: async (id) => { calls.push(['subscriptions.cancel', id]); return {}; },
    },
    refunds: { create: async () => { throw new Error('no refunds here'); } },
  };
}

const quiet = { warn() {}, info() {} };
const LOYALTY = { key: 'hosting.loyalty', value: { enabled: true, tiers: [{ months: 3, pct: 5 }, { months: 6, pct: 10 }, { months: 12, pct: 15 }], maxPct: 15, appliesTo: 'both' } };
const evt = (type, object) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, type, data: { object } });
const monthsAgo = (n) => addMonths(new Date(), -n);

describe('invoice.paid (an automatic renewal), replayed', () => {
  test('one receipt, one coupon, one notice, and the tenure is not moved by the replay', async () => {
    const renewedTo = addMonths(new Date(), 12);
    const p = memDb({
      adminSetting: [LOYALTY],
      hostingGroup: [{ id: 'g1', name: 'pool', ownerId: 'u1', poolBytes: 10n }],
      subscription: [{ id: 's1', userId: 'u1', hostingGroupId: 'g1', planId: 'pl', stripeSubId: 'sub_1', status: 'active', poolContribBytes: 10n, createdAt: monthsAgo(13), currentPeriodEnd: new Date(), loyaltyPct: 0, tenureStartAt: null }],
      user: [{ id: 'u1', notifPrefs: null }],
    });
    const stripe = stripeStub();
    const inv = { id: 'in_1', billing_reason: 'subscription_cycle', subscription: 'sub_1', amount_paid: 9600, currency: 'usd', lines: { data: [{ period: { end: Math.floor(renewedTo.getTime() / 1000) } }] } };
    for (let i = 0; i < 3; i++) await dispatchStripeEvent({ p, stripe, event: evt('invoice.paid', inv), log: quiet });

    const pays = p._t('payment').filter((x) => x.stripeSessionId === 'in_1');
    assert.equal(pays.length, 1, 'one receipt for one invoice');
    const updates = stripe.calls.filter((c) => c[0] === 'subscriptions.update');
    assert.equal(updates.length, 1, 'the coupon is put on once');
    assert.deepEqual(updates[0][2], { discounts: [{ coupon: 'bcw-loyalty-15' }], proration_behavior: 'none' });
    const sub = p._t('subscription')[0];
    assert.equal(sub.loyaltyPct, 15);
    assert.equal(sub.currentPeriodEnd.getTime(), Math.floor(renewedTo.getTime() / 1000) * 1000);
    assert.equal(p._t('notification').length, 1, 'the owner is told once');
  });
});

describe('pool_renew (a term renewed by hand), replayed', () => {
  test('the term is extended once, from the paid-up date, in calendar months', async () => {
    const paidUpTo = addMonths(new Date(), 2); // renewing two months early
    const p = memDb({
      adminSetting: [LOYALTY],
      hostingGroup: [{ id: 'g1', name: 'pool', ownerId: 'u1', poolBytes: 10n }],
      subscription: [{ id: 's1', userId: 'u1', hostingGroupId: 'g1', planId: 'pl', stripeSubId: null, status: 'active', poolContribBytes: 10n, createdAt: monthsAgo(4), currentPeriodEnd: paidUpTo }],
      user: [{ id: 'u1', notifPrefs: null }],
    });
    const stripe = stripeStub();
    const s = { id: 'cs_renew_1', mode: 'payment', payment_status: 'paid', amount_total: 5400, currency: 'usd', subscription: null, metadata: { type: 'pool_renew', kind: 'hosting', userId: 'u1', groupId: 'g1', months: '6', loyaltyPct: '5' } };
    for (let i = 0; i < 3; i++) await dispatchStripeEvent({ p, stripe, event: evt('checkout.session.completed', s), log: quiet });

    const sub = p._t('subscription')[0];
    assert.equal(sub.currentPeriodEnd.toISOString(), addMonths(paidUpTo, 6).toISOString(), 'six months added after the two already paid, once');
    assert.equal(p._t('payment').filter((x) => x.stripeSessionId === 'cs_renew_1').length, 1);
    assert.equal(stripe.calls.length, 0, 'a one-time renewal never touches a Stripe subscription');
  });
});

describe('a new pool, replayed', () => {
  test('provisioned once', async () => {
    const p = memDb({
      hostingPlan: [{ id: 'pl1', name: '25 GB', storageGB: 25, uploadLimitKbps: 8192, cpuShare: 0.5, priceMonthlyCents: 500, active: true, kind: 'hosting' }],
      user: [{ id: 'u1', notifPrefs: null }],
    });
    const stripe = stripeStub();
    const s = { id: 'cs_new_1', mode: 'payment', payment_status: 'paid', amount_total: 5400, currency: 'usd', subscription: null, metadata: { userId: 'u1', planId: 'pl1', repoName: 'my-pool', hostMode: 'multi', months: '7', promoCode: '' } };
    const before = new Date();
    for (let i = 0; i < 3; i++) await dispatchStripeEvent({ p, stripe, event: evt('checkout.session.completed', s), log: quiet });
    assert.equal(p._t('hostingGroup').length, 1, 'one pool for one payment');
    assert.equal(p._t('subscription').length, 1);
    const end = p._t('subscription')[0].currentPeriodEnd;
    // Seven calendar months from the purchase, not 210 days.
    assert.ok(Math.abs(end.getTime() - addMonths(before, 7).getTime()) < 60e3, end.toISOString());
  });
});

describe('catalogue file hosting, replayed', () => {
  test('one moderation entry, one receipt, the tenure started once', async () => {
    const p = memDb({
      adminSetting: [LOYALTY],
      catalogItem: [{ id: 'it1', name: 'My theme', ownerId: 'u1', createdAt: monthsAgo(1), meta: { _hostingUnpaid: true } }],
      user: [{ id: 'u1', notifPrefs: null }],
    });
    const stripe = stripeStub();
    const s = { id: 'cs_cat_1', mode: 'subscription', payment_status: 'paid', amount_total: 120, currency: 'usd', subscription: 'sub_c', metadata: { type: 'catalog_hosting', itemId: 'it1', userId: 'u1' } };
    await dispatchStripeEvent({ p, stripe, event: evt('checkout.session.completed', s), log: quiet });
    const since = p._t('catalogItem')[0].meta._hostingSince;
    assert.ok(since, 'the tenure starts when hosting is first paid');
    for (let i = 0; i < 2; i++) await dispatchStripeEvent({ p, stripe, event: evt('checkout.session.completed', s), log: quiet });
    assert.equal(p._t('submission').length, 1);
    assert.equal(p._t('payment').filter((x) => x.stripeSessionId === 'cs_cat_1').length, 1);
    const meta = p._t('catalogItem')[0].meta;
    assert.equal(meta._hostingSince, since);
    assert.equal(meta._hostingSubId, 'sub_c');
    assert.equal(meta._hostingUnpaid, undefined);
  });

  test('its automatic renewal moves the paid-up date and puts the coupon on once', async () => {
    const since = new Date(monthsAgo(11).getTime() - 60e3); // Stripe periods are whole seconds
    const p = memDb({
      adminSetting: [LOYALTY],
      catalogItem: [{ id: 'it1', name: 'My theme', ownerId: 'u1', createdAt: since, meta: { _hostingSubId: 'sub_c', _hostingSince: since.toISOString(), _hostingPeriodEnd: new Date().toISOString() } }],
      user: [{ id: 'u1', notifPrefs: null }],
    });
    const stripe = stripeStub();
    const next = addMonths(new Date(), 1);
    const inv = { id: 'in_c1', billing_reason: 'subscription_cycle', subscription: 'sub_c', amount_paid: 120, currency: 'usd', lines: { data: [{ period: { end: Math.floor(next.getTime() / 1000) } }] } };
    for (let i = 0; i < 3; i++) await dispatchStripeEvent({ p, stripe, event: evt('invoice.paid', inv), log: quiet });
    const meta = p._t('catalogItem')[0].meta;
    assert.equal(meta._hostingPeriodEnd, new Date(Math.floor(next.getTime() / 1000) * 1000).toISOString());
    assert.equal(meta._loyaltyPct, 15, '12 months on at the next renewal');
    assert.equal(stripe.calls.filter((c) => c[0] === 'subscriptions.update').length, 1);
    assert.equal(meta._hostingSince, since.toISOString(), 'the replay does not move the tenure');
  });
});
