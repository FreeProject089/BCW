// Loyalty (tenure) pricing: the tenure count, what breaks it, the cap, and the Stripe sync.
// N-hosting (agent-hosting-N). No database and no network: the Stripe client and the Prisma
// client are recording fakes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseLoyalty, monthsBetween, tenureBroken, tenureMonthsAt, nextTenureStart, loyaltyPct,
  applyLoyalty, pctForNextRenewal, graceHoursFor, syncLoyaltyCoupon, loyaltyCouponId,
  LOYALTY_DEFAULT, LOYALTY_HARD_MAX_PCT,
} from '../src/lib/loyalty.mjs';

const D = (s) => new Date(`${s}T12:00:00Z`);
const ON = { enabled: true, tiers: [{ months: 3, pct: 5 }, { months: 6, pct: 10 }, { months: 12, pct: 15 }], maxPct: 15 };

describe('normaliseLoyalty', () => {
  test('nothing stored → the default, and it is OFF', () => {
    const n = normaliseLoyalty(undefined);
    assert.equal(n.enabled, false);
    assert.deepEqual(n.tiers, LOYALTY_DEFAULT.tiers.map((x) => ({ ...x })));
    assert.equal(n.maxPct, LOYALTY_DEFAULT.maxPct);
  });
  test('tiers are sorted, deduplicated per month count and clamped', () => {
    const n = normaliseLoyalty({ enabled: true, tiers: [{ months: 12, pct: 15 }, { months: 3, pct: 5 }, { months: 3, pct: 7 }, { months: 0, pct: 999 }, { months: 'x', pct: 5 }], maxPct: 500 });
    assert.deepEqual(n.tiers, [{ months: 1, pct: LOYALTY_HARD_MAX_PCT }, { months: 3, pct: 7 }, { months: 12, pct: 15 }]);
    assert.equal(n.maxPct, LOYALTY_HARD_MAX_PCT);
  });
  test('only a literal true enables it', () => {
    assert.equal(normaliseLoyalty({ enabled: 'yes' }).enabled, false);
  });
});

describe('monthsBetween (whole calendar months)', () => {
  test('exact months', () => {
    assert.equal(monthsBetween(D('2026-01-12'), D('2026-04-12')), 3);
    assert.equal(monthsBetween(D('2025-09-24'), D('2026-09-24')), 12);
  });
  test('a day short is not a month', () => {
    assert.equal(monthsBetween(D('2026-01-12'), D('2026-04-11')), 2);
    assert.equal(monthsBetween(D('2026-01-31'), D('2026-02-28')), 0);
  });
  test('backwards is zero', () => {
    assert.equal(monthsBetween(D('2026-05-01'), D('2026-01-01')), 0);
  });
});

describe('tenure: continuity and what breaks it', () => {
  const grace = { lapseHours: 72, unpaidHours: 168 };
  const prepaid = { status: 'active', createdAt: D('2026-01-01'), currentPeriodEnd: D('2026-07-01'), stripeSubId: null };
  const recurring = { ...prepaid, stripeSubId: 'sub_x' };

  test('grace window: 72 h for a prepaid term, 7 days for an automatic renewal', () => {
    assert.equal(graceHoursFor(prepaid, grace), 72);
    assert.equal(graceHoursFor(recurring, grace), 168);
  });

  test('counted from the purchase when tenureStartAt is unset', () => {
    assert.equal(tenureMonthsAt(prepaid, D('2026-07-01'), 72), 6);
  });

  test('tenureStartAt wins over the purchase date', () => {
    assert.equal(tenureMonthsAt({ ...prepaid, tenureStartAt: D('2026-04-01') }, D('2026-07-01'), 72), 3);
  });

  test('a renewal inside the grace keeps the count', () => {
    const at = new Date(D('2026-07-01').getTime() + 48 * 3600e3); // 2 days late, grace 72 h
    assert.equal(tenureBroken(prepaid, at, 72), false);
    assert.equal(tenureMonthsAt(prepaid, at, 72), 6);
    assert.equal(nextTenureStart(prepaid, at, 72).toISOString(), prepaid.createdAt.toISOString());
  });

  test('a lapse beyond the grace resets it to zero', () => {
    const at = new Date(D('2026-07-01').getTime() + 73 * 3600e3);
    assert.equal(tenureBroken(prepaid, at, 72), true);
    assert.equal(tenureMonthsAt(prepaid, at, 72), 0);
    assert.equal(nextTenureStart(prepaid, at, 72).toISOString(), at.toISOString());
  });

  test('the same gap is inside the grace of an automatic renewal (a failed card)', () => {
    const at = new Date(D('2026-07-01').getTime() + 5 * 24 * 3600e3);
    assert.equal(tenureBroken(recurring, at, graceHoursFor(recurring, grace)), false);
    assert.equal(tenureBroken(prepaid, at, graceHoursFor(prepaid, grace)), true);
  });

  test('a cancelled subscription is broken whatever the dates say', () => {
    const c = { ...prepaid, status: 'canceled', currentPeriodEnd: D('2030-01-01') };
    assert.equal(tenureMonthsAt(c, D('2026-06-01'), 72), 0);
    assert.equal(nextTenureStart(c, D('2026-06-01'), 72).toISOString(), D('2026-06-01').toISOString());
  });

  test('an expired prepaid term inside the grace still counts', () => {
    const e = { ...prepaid, status: 'expired' };
    assert.equal(tenureMonthsAt(e, new Date(D('2026-07-01').getTime() + 3600e3), 72), 6);
  });
});

describe('loyaltyPct: tiers and the hard cap', () => {
  test('off → 0 whatever the tenure', () => {
    assert.equal(loyaltyPct({ ...ON, enabled: false }, 60), 0);
  });
  test('the highest tier reached', () => {
    assert.equal(loyaltyPct(ON, 0), 0);
    assert.equal(loyaltyPct(ON, 2), 0);
    assert.equal(loyaltyPct(ON, 3), 5);
    assert.equal(loyaltyPct(ON, 11), 10);
    assert.equal(loyaltyPct(ON, 12), 15);
    assert.equal(loyaltyPct(ON, 48), 15);
  });
  test('the admin maximum caps a tier above it', () => {
    const p = { enabled: true, tiers: [{ months: 6, pct: 10 }, { months: 12, pct: 40 }], maxPct: 20 };
    assert.equal(loyaltyPct(p, 12), 20);
    assert.equal(loyaltyPct(p, 6), 10);
  });
  test('the hard ceiling holds even against a stored 100', () => {
    assert.equal(loyaltyPct({ enabled: true, tiers: [{ months: 1, pct: 100 }], maxPct: 100 }, 5), LOYALTY_HARD_MAX_PCT);
  });
  test('applyLoyalty rounds once', () => {
    assert.equal(applyLoyalty(9600, 15), 8160);
    assert.equal(applyLoyalty(999, 5), 949);
    assert.equal(applyLoyalty(1000, 0), 1000);
  });
});

describe('pctForNextRenewal: the tier reached ON the renewal date', () => {
  test('an annual subscription earns the 12-month tier at its first renewal', () => {
    const sub = { status: 'active', createdAt: D('2026-01-01'), currentPeriodEnd: D('2027-01-01'), stripeSubId: 'sub_1' };
    assert.equal(pctForNextRenewal(ON, sub, D('2026-06-01'), 168), 15);
  });
  test('a monthly one earns nothing before its third month', () => {
    const sub = { status: 'active', createdAt: D('2026-01-01'), currentPeriodEnd: D('2026-03-01'), stripeSubId: 'sub_1' };
    assert.equal(pctForNextRenewal(ON, sub, D('2026-02-15'), 168), 0);
    assert.equal(pctForNextRenewal(ON, { ...sub, currentPeriodEnd: D('2026-04-01') }, D('2026-03-15'), 168), 5);
  });
  test('cancelled → nothing', () => {
    assert.equal(pctForNextRenewal(ON, { status: 'canceled', createdAt: D('2020-01-01'), currentPeriodEnd: D('2027-01-01') }, D('2026-06-01'), 168), 0);
  });
});

describe('syncLoyaltyCoupon (recording fakes, no network)', () => {
  function fakes() {
    const calls = [];
    const coupons = new Set();
    const stripe = {
      coupons: {
        retrieve: async (id) => { calls.push(['coupons.retrieve', id]); if (!coupons.has(id)) throw new Error('No such coupon'); return { id }; },
        create: async (o) => { calls.push(['coupons.create', o]); coupons.add(o.id); return { id: o.id }; },
      },
      subscriptions: {
        update: async (id, o) => { calls.push(['subscriptions.update', id, o]); return {}; },
        deleteDiscount: async (id) => { calls.push(['subscriptions.deleteDiscount', id]); return {}; },
      },
    };
    const p = { subscription: { update: async (q) => { calls.push(['db.update', q]); return {}; } } };
    return { calls, stripe, p };
  }
  const grace = { lapseHours: 72, unpaidHours: 168 };
  const sub = { id: 's1', status: 'active', stripeSubId: 'sub_1', hostingGroupId: 'g1', createdAt: D('2026-01-01'), currentPeriodEnd: D('2027-01-01'), loyaltyPct: 0 };

  test('creates the coupon once and puts it on the subscription, with no proration', async () => {
    const { calls, stripe, p } = fakes();
    const r = await syncLoyaltyCoupon({ p, stripe, sub, policy: ON, grace, now: D('2026-06-01') });
    assert.deepEqual(r, { changed: true, pct: 15 });
    const create = calls.find((c) => c[0] === 'coupons.create');
    assert.deepEqual(create[1], { id: loyaltyCouponId(15), percent_off: 15, duration: 'forever', name: 'Loyalty −15%' });
    const upd = calls.find((c) => c[0] === 'subscriptions.update');
    assert.deepEqual(upd, ['subscriptions.update', 'sub_1', { discounts: [{ coupon: 'bcw-loyalty-15' }], proration_behavior: 'none' }]);
    assert.deepEqual(calls.find((c) => c[0] === 'db.update')[1], { where: { id: 's1' }, data: { loyaltyPct: 15 } });
  });

  test('already in step → no Stripe call at all', async () => {
    const { calls, stripe, p } = fakes();
    const r = await syncLoyaltyCoupon({ p, stripe, sub: { ...sub, loyaltyPct: 15 }, policy: ON, grace, now: D('2026-06-01') });
    assert.equal(r.changed, false);
    assert.equal(calls.length, 0);
  });

  test('policy turned off → the discount is removed', async () => {
    const { calls, stripe, p } = fakes();
    const r = await syncLoyaltyCoupon({ p, stripe, sub: { ...sub, loyaltyPct: 15 }, policy: { ...ON, enabled: false }, grace, now: D('2026-06-01') });
    assert.deepEqual(r, { changed: true, pct: 0 });
    assert.ok(calls.some((c) => c[0] === 'subscriptions.deleteDiscount' && c[1] === 'sub_1'));
  });

  test('a bot-only plan (no repo, no pool) is not part of the offer', async () => {
    const { calls, stripe, p } = fakes();
    await syncLoyaltyCoupon({ p, stripe, sub: { ...sub, hostingGroupId: null }, policy: ON, grace, now: D('2026-06-01') });
    assert.equal(calls.length, 0);
  });

  test('a prepaid subscription (no Stripe sub) is never touched', async () => {
    const { calls, stripe, p } = fakes();
    await syncLoyaltyCoupon({ p, stripe, sub: { ...sub, stripeSubId: null }, policy: ON, grace, now: D('2026-06-01') });
    assert.equal(calls.length, 0);
  });
});
