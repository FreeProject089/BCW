// hosting2 (agent-hosting): what the loyalty policy gained after N-hosting — which
// subscriptions it covers (repos, catalogues, both), whether a lapse resets the count or only
// pauses it, the calendar month that terms and tenure now share, the member's own status line,
// catalogue file hosting, and the client's copy of the price rule agreeing with the server's.
// No database and no network: Stripe and Prisma are recording fakes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseLoyalty, loyaltyCovers, effectiveTiers, addMonths, monthsBetween, tenureMonthsAt, nextTenureStart,
  pctForNextRenewal, pctForRenewalNow, loyaltyStatus, loyaltyPct, catalogLoyaltyView, catalogTenureOnPayment,
  syncCatalogLoyaltyCoupon, syncLoyaltyCoupon, sweepLoyaltyCoupons,
} from '../src/lib/loyalty.mjs';
import * as web from '../../web/src/lib/hosting-term.js';

const D = (s) => new Date(`${s}T12:00:00Z`);
const TIERS = [{ months: 3, pct: 5 }, { months: 6, pct: 10 }, { months: 12, pct: 15 }];
const ON = { enabled: true, tiers: TIERS, maxPct: 15 };
const grace = { lapseHours: 72, unpaidHours: 168 };

describe('policy: scope and the lapse rule', () => {
  test('a policy saved before these fields keeps its meaning: storage hosting, continuous', () => {
    const n = normaliseLoyalty({ enabled: true, tiers: TIERS, maxPct: 15 });
    assert.equal(n.appliesTo, 'repos');
    assert.equal(n.lapseResets, true);
  });
  test('the three scopes are read, anything else falls back', () => {
    for (const s of ['repos', 'catalogs', 'both']) assert.equal(normaliseLoyalty({ appliesTo: s }).appliesTo, s);
    assert.equal(normaliseLoyalty({ appliesTo: 'everything' }).appliesTo, 'repos');
  });
  test('only a literal false turns the reset off', () => {
    assert.equal(normaliseLoyalty({ lapseResets: false }).lapseResets, false);
    assert.equal(normaliseLoyalty({ lapseResets: 'no' }).lapseResets, true);
    assert.equal(normaliseLoyalty({ lapseResets: 0 }).lapseResets, true);
  });
  test('loyaltyCovers', () => {
    assert.equal(loyaltyCovers({ appliesTo: 'repos' }, 'repos'), true);
    assert.equal(loyaltyCovers({ appliesTo: 'repos' }, 'catalogs'), false);
    assert.equal(loyaltyCovers({ appliesTo: 'catalogs' }, 'repos'), false);
    assert.equal(loyaltyCovers({ appliesTo: 'both' }, 'catalogs'), true);
  });
  test('effectiveTiers: capped, zero and non-raising steps dropped', () => {
    assert.deepEqual(effectiveTiers({ enabled: true, tiers: [{ months: 1, pct: 0 }, { months: 3, pct: 5 }, { months: 6, pct: 4 }, { months: 12, pct: 40 }], maxPct: 20 }),
      [{ months: 3, pct: 5 }, { months: 12, pct: 20 }]);
  });
});

describe('calendar months: a term and a month of tenure end on the same day', () => {
  test('addMonths clamps to the end of a shorter month, like Stripe', () => {
    assert.equal(addMonths(D('2026-01-31'), 1).toISOString(), D('2026-02-28').toISOString());
    assert.equal(addMonths(D('2028-01-31'), 1).toISOString(), D('2028-02-29').toISOString());
    assert.equal(addMonths(D('2026-03-15'), 12).toISOString(), D('2027-03-15').toISOString());
    assert.equal(addMonths(D('2026-10-31'), 4).toISOString(), D('2027-02-28').toISOString());
  });
  test('12 months is a year, not 360 days', () => {
    const end = addMonths(D('2026-09-26'), 12);
    assert.equal(end.toISOString(), D('2027-09-26').toISOString());
    assert.notEqual(end.getTime(), D('2026-09-26').getTime() + 360 * 864e5);
  });
  test('monthsBetween agrees with addMonths for every start day of a year', () => {
    for (let d = 0; d < 366; d += 1) {
      const from = new Date(Date.UTC(2026, 0, 1, 12) + d * 864e5);
      for (const k of [1, 2, 3, 6, 11, 12]) {
        assert.equal(monthsBetween(from, addMonths(from, k)), k, `${from.toISOString()} + ${k}`);
        assert.equal(monthsBetween(from, new Date(addMonths(from, k).getTime() - 1)), k - 1);
      }
    }
  });
  test('a monthly term bought on the 31st reaches its first month on 28 February', () => {
    assert.equal(monthsBetween(D('2026-01-31'), D('2026-02-28')), 1);
  });
});

describe('the lapse rule: continuous (reset) or cumulative (pause)', () => {
  // Paid 1 Jan → 1 Jul, then renewed on 1 Sep: two months nobody paid for.
  const sub = { status: 'active', createdAt: D('2026-01-01'), currentPeriodEnd: D('2026-07-01'), stripeSubId: null, hostingGroupId: 'g' };
  const late = D('2026-09-01');

  test('continuous: the late renewal starts the count again', () => {
    assert.equal(tenureMonthsAt(sub, late, 72, true), 0);
    assert.equal(nextTenureStart(sub, late, 72, true).toISOString(), late.toISOString());
  });
  test('cumulative: the gap is not counted, the six paid months are', () => {
    assert.equal(tenureMonthsAt(sub, late, 72, false), 6);
    // Moved forward by the two unpaid calendar months (not by 62 days, which would cost a month).
    assert.equal(nextTenureStart(sub, late, 72, false).toISOString(), D('2026-03-01').toISOString());
    // And by the rest in time: renewed on 15 Sep, the count resumes as of 15 Mar.
    assert.equal(nextTenureStart(sub, D('2026-09-15'), 72, false).toISOString(), D('2026-03-15').toISOString());
  });
  test('cumulative: a cancelled subscription is paused, not reset', () => {
    const c = { ...sub, status: 'canceled' };
    assert.equal(tenureMonthsAt(c, late, 72, true), 0);
    assert.equal(tenureMonthsAt(c, late, 72, false), 6);
  });
  test('both rules agree while nothing was missed', () => {
    for (const at of [D('2026-03-01'), D('2026-06-30'), D('2026-07-01')]) {
      assert.equal(tenureMonthsAt(sub, at, 72, true), tenureMonthsAt(sub, at, 72, false));
    }
  });
  test('the renewal price follows the rule the admin chose', () => {
    assert.equal(pctForRenewalNow({ ...ON, lapseResets: true }, sub, late, grace), 0);
    assert.equal(pctForRenewalNow({ ...ON, lapseResets: false }, sub, late, grace), 10);
  });
  test('a renewal paid early is priced on the day the new term starts, not today', () => {
    // Paid up to 1 Jul (six months), renewed by hand on 15 Jun: the new term starts on 1 Jul.
    assert.equal(pctForRenewalNow(ON, sub, D('2026-06-15'), grace), 10);
  });
});

describe('scope: what each kind of subscription earns', () => {
  const pool = { status: 'active', createdAt: D('2026-01-01'), currentPeriodEnd: D('2027-01-01'), stripeSubId: 'sub_1', hostingGroupId: 'g1' };
  test('a pool earns it under repos and both, not under catalogs', () => {
    assert.equal(pctForNextRenewal({ ...ON, appliesTo: 'repos' }, pool, D('2026-06-01'), 168), 15);
    assert.equal(pctForNextRenewal({ ...ON, appliesTo: 'both' }, pool, D('2026-06-01'), 168), 15);
    assert.equal(pctForNextRenewal({ ...ON, appliesTo: 'catalogs' }, pool, D('2026-06-01'), 168), 0);
    assert.equal(pctForRenewalNow({ ...ON, appliesTo: 'catalogs' }, pool, D('2027-01-01'), grace), 0);
  });
  test('a bot-only plan is never covered', () => {
    assert.equal(pctForRenewalNow(ON, { ...pool, hostingGroupId: null, serverRepoId: null }, D('2027-01-01'), grace), 0);
  });
});

describe('loyaltyStatus: the member line', () => {
  const sub = { status: 'active', createdAt: D('2026-01-10'), currentPeriodEnd: D('2026-11-10'), stripeSubId: 'sub_1', hostingGroupId: 'g1' };
  test('"step 2 of 3, −10 %; the next step (−15 %) in 4 months"', () => {
    const s = loyaltyStatus(ON, sub, D('2026-09-10'), grace);
    assert.equal(s.covered, true);
    assert.equal(s.tenureMonths, 8);
    assert.equal(s.pct, 10);
    assert.equal(s.tierIndex, 2);
    assert.equal(s.tierCount, 3);
    assert.deepEqual(s.nextTier, { months: 12, pct: 15, inMonths: 4, at: D('2027-01-10').toISOString() });
    assert.equal(s.nextRenewalAt, D('2026-11-10').toISOString());
    assert.equal(s.nextRenewalPct, 10); // 10 months on 10 Nov
  });
  test('at the top step there is no next step', () => {
    assert.equal(loyaltyStatus(ON, { ...sub, currentPeriodEnd: D('2027-06-10') }, D('2027-03-10'), grace).nextTier, null);
  });
  test('off, or not covered: nothing is promised', () => {
    const off = loyaltyStatus({ ...ON, enabled: false }, sub, D('2026-09-10'), grace);
    assert.equal(off.covered, false); assert.equal(off.pct, 0); assert.equal(off.nextTier, null);
    assert.equal(loyaltyStatus({ ...ON, appliesTo: 'catalogs' }, sub, D('2026-09-10'), grace).covered, false);
  });
});

describe('catalogue file hosting', () => {
  const item = (meta, createdAt = D('2026-01-05')) => ({ id: 'it1', createdAt, meta });
  test('the meta fields read as a subscription', () => {
    const v = catalogLoyaltyView(item({ _hostingSubId: 'sub_c', _hostingSince: '2026-02-01T00:00:00.000Z', _hostingPeriodEnd: '2026-10-01T00:00:00.000Z', _loyaltyPct: 5 }));
    assert.equal(v.stripeSubId, 'sub_c'); assert.equal(v.status, 'active'); assert.equal(v.loyaltyPct, 5);
    assert.equal(v.tenureStartAt.toISOString(), '2026-02-01T00:00:00.000Z');
    assert.equal(catalogLoyaltyView(item({ _hostingUnpaid: true })).status, 'canceled');
  });
  test('first payment: the count starts today, paid up for one calendar month', () => {
    const at = D('2026-03-31');
    assert.deepEqual(catalogTenureOnPayment(item({ _hostingUnpaid: true }), at, grace, ON),
      { _hostingSince: at.toISOString(), _hostingPeriodEnd: D('2026-04-30').toISOString(), _loyaltyPct: 0 });
  });
  test('a re-upload on a live subscription keeps the count', () => {
    const at = D('2026-06-15');
    const r = catalogTenureOnPayment(item({ _hostingSubId: 'sub_c', _hostingSince: D('2026-01-05').toISOString(), _hostingPeriodEnd: D('2026-07-05').toISOString() }), at, grace, ON);
    assert.equal(r._hostingSince, D('2026-01-05').toISOString());
  });
  test('resumed after it ended: reset (continuous) or paused (cumulative)', () => {
    const ended = item({ _hostingSince: D('2026-01-05').toISOString(), _hostingPeriodEnd: D('2026-05-05').toISOString(), _hostingUnpaid: true });
    const at = D('2026-06-05');
    assert.equal(catalogTenureOnPayment(ended, at, grace, ON)._hostingSince, at.toISOString());
    assert.equal(catalogTenureOnPayment(ended, at, grace, { ...ON, lapseResets: false })._hostingSince, D('2026-02-05').toISOString());
  });

  function fakes(meta) {
    const calls = [];
    const row = { id: 'it1', createdAt: D('2026-01-05'), meta };
    const stripe = {
      coupons: { retrieve: async (id) => { calls.push(['coupons.retrieve', id]); throw new Error('none'); }, create: async (o) => { calls.push(['coupons.create', o.id]); return { id: o.id }; } },
      subscriptions: { update: async (id, o) => { calls.push(['subscriptions.update', id, o]); return {}; }, deleteDiscount: async (id) => { calls.push(['deleteDiscount', id]); return {}; } },
    };
    const p = { catalogItem: { update: async ({ where, data }) => { calls.push(['db', where.id]); Object.assign(row, data); return row; } } };
    return { calls, stripe, p, row };
  }
  test('the coupon goes on the catalogue subscription once, for future invoices only', async () => {
    const meta = { _hostingSubId: 'sub_c', _hostingSince: D('2026-01-05').toISOString(), _hostingPeriodEnd: D('2026-07-05').toISOString() };
    const f = fakes(meta);
    const both = { ...ON, appliesTo: 'both' };
    const r = await syncCatalogLoyaltyCoupon({ p: f.p, stripe: f.stripe, item: f.row, policy: both, grace, now: D('2026-06-20') });
    assert.deepEqual(r, { changed: true, pct: 10 });
    assert.deepEqual(f.calls.find((c) => c[0] === 'subscriptions.update'), ['subscriptions.update', 'sub_c', { discounts: [{ coupon: 'bcw-loyalty-10' }], proration_behavior: 'none' }]);
    assert.equal(f.row.meta._loyaltyPct, 10);
    assert.equal(f.row.meta._hostingSubId, 'sub_c', 'the rest of the meta is kept');
    const n = f.calls.length;
    const again = await syncCatalogLoyaltyCoupon({ p: f.p, stripe: f.stripe, item: f.row, policy: both, grace, now: D('2026-06-20') });
    assert.equal(again.changed, false);
    assert.equal(f.calls.length, n, 'in step: not one more Stripe call');
  });
  test('a policy that covers only repos takes a catalogue coupon off', async () => {
    const f = fakes({ _hostingSubId: 'sub_c', _hostingSince: D('2026-01-05').toISOString(), _hostingPeriodEnd: D('2026-07-05').toISOString(), _loyaltyPct: 10 });
    const r = await syncCatalogLoyaltyCoupon({ p: f.p, stripe: f.stripe, item: f.row, policy: ON, grace, now: D('2026-06-20') });
    assert.deepEqual(r, { changed: true, pct: 0 });
    assert.ok(f.calls.some((c) => c[0] === 'deleteDiscount' && c[1] === 'sub_c'));
  });
  test('a repo subscription is taken out of a catalogues-only policy', async () => {
    const calls = [];
    const stripe = { subscriptions: { deleteDiscount: async (id) => { calls.push(id); } } };
    const p = { subscription: { update: async () => ({}) } };
    const r = await syncLoyaltyCoupon({ p, stripe, sub: { id: 's', status: 'active', stripeSubId: 'sub_r', hostingGroupId: 'g', createdAt: D('2026-01-01'), currentPeriodEnd: D('2027-01-01'), loyaltyPct: 15 }, policy: { ...ON, appliesTo: 'catalogs' }, grace, now: D('2026-06-01') });
    assert.deepEqual(r, { changed: true, pct: 0 });
    assert.deepEqual(calls, ['sub_r']);
  });
  test('the sweep reaches catalogue subscriptions when they are covered', async () => {
    const seen = [];
    const p = {
      adminSetting: { findUnique: async ({ where }) => (where.key === 'hosting.loyalty' ? { value: { ...ON, appliesTo: 'both' } } : null), upsert: async () => ({}) },
      subscription: { findMany: async () => [] },
      catalogItem: {
        findMany: async (q) => { seen.push(q.where); return [{ id: 'it1', createdAt: D('2026-01-05'), meta: { _hostingSubId: 'sub_c', _hostingSince: D('2026-01-05').toISOString(), _hostingPeriodEnd: D('2026-07-05').toISOString() } }]; },
        update: async () => ({}),
      },
    };
    const stripe = { coupons: { retrieve: async (id) => ({ id }) }, subscriptions: { update: async () => ({}) } };
    const n = await sweepLoyaltyCoupons(p, { stripe, grace, now: D('2026-06-20'), force: true });
    assert.equal(n, 1);
    assert.deepEqual(seen[0], { meta: { path: ['_hostingSubId'], string_starts_with: 'sub' } });
  });
});

describe('the page and the server price the same way', () => {
  test('loyaltyPctFor (web) equals loyaltyPct (API) over every tenure and several policies', () => {
    const policies = [ON, { ...ON, maxPct: 8 }, { enabled: false, tiers: TIERS, maxPct: 15 }, { enabled: true, tiers: [{ months: 1, pct: 3 }, { months: 24, pct: 90 }], maxPct: 90 }];
    for (const pol of policies) {
      // The page receives exactly what GET /hosting/plans sends: tiers already capped.
      const sent = { enabled: pol.enabled, maxPct: normaliseLoyalty(pol).maxPct, tiers: effectiveTiers(pol) };
      for (let m = 0; m <= 40; m++) assert.equal(web.loyaltyPctFor(sent, m), loyaltyPct(pol, m), `${JSON.stringify(pol)} @ ${m}`);
    }
  });
  test('termEndDate (web) equals addMonths (API)', () => {
    for (let d = 0; d < 400; d += 7) {
      const from = new Date(Date.UTC(2026, 0, 31, 9) + d * 864e5);
      for (let m = 1; m <= 12; m++) assert.equal(web.termEndDate(from, m).toISOString(), addMonths(from, m).toISOString());
    }
  });
});
