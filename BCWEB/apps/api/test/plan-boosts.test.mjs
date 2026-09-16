// Included boosts on a plan: granted once per period, whatever runs the sweeper.
//
// Idempotence here is NOT a check-then-write — two containers sweeping at the same instant
// would both pass a check and both grant. It is the unique index on
// (subscriptionId, periodStart, seq), and `grantIncludedBoosts` leans on the insert failing.
// That makes it exactly the kind of rule a test can only prove against something that
// ENFORCES the index, so the fake client below does: a second row with the same triple
// throws, the same way Postgres would.
//
// No database: the real one is not reachable from here and this rule does not need it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { grantIncludedBoosts } from '../src/routes/boosts.mjs';

/** A prisma stand-in with one table and one constraint — the one the idempotence rests on. */
function fakeDb(subs) {
  const rows = [];
  const key = (d) => `${d.subscriptionId}|${new Date(d.periodStart).getTime()}|${d.seq}`;
  return {
    rows,
    subscription: { findMany: async () => subs },
    boostCredit: {
      count: async ({ where }) => rows.filter((r) => r.subscriptionId === where.subscriptionId
        && new Date(r.periodStart).getTime() === new Date(where.periodStart).getTime()).length,
      create: async ({ data }) => {
        if (rows.some((r) => key(r) === key(data))) throw new Error('unique constraint failed');
        rows.push({ ...data });
        return data;
      },
    },
    // notify() writes a Notification; grantIncludedBoosts already swallows its failures, but
    // a throw here would hide a real one behind a fixture bug.
    notification: { create: async () => ({}) },
    user: { findUnique: async () => null },
  };
}

const sub = (over = {}) => ({
  id: 'sub1', userId: 'u1',
  createdAt: new Date('2026-03-01T00:00:00Z'),
  currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
  plan: { id: 'plan-top', boostsPerPeriod: 3, boostPeriodMonths: 1, boostDays: 7 },
  ...over,
});

describe('grantIncludedBoosts', () => {
  const now = new Date('2026-03-10T00:00:00Z');

  test('a plan with boosts grants exactly what it promises', async () => {
    const p = fakeDb([sub()]);
    assert.equal(await grantIncludedBoosts(p, now), 3);
    assert.equal(p.rows.length, 3);
    assert.deepEqual(p.rows.map((r) => r.seq), [0, 1, 2]);
    assert.deepEqual([...new Set(p.rows.map((r) => r.days))], [7]);
  });

  test('running it twice grants once', async () => {
    const p = fakeDb([sub()]);
    await grantIncludedBoosts(p, now);
    const second = await grantIncludedBoosts(p, now);
    assert.equal(second, 0, 'the second sweep must grant nothing');
    assert.equal(p.rows.length, 3);
  });

  test('a later period grants again — the cap is per period, not for ever', async () => {
    const p = fakeDb([sub()]);
    await grantIncludedBoosts(p, now);
    await grantIncludedBoosts(p, new Date('2026-04-15T00:00:00Z'));
    assert.equal(p.rows.length, 6);
    assert.equal(new Set(p.rows.map((r) => new Date(r.periodStart).getTime())).size, 2);
  });

  test('a plan raised mid-period grants the difference, not a fresh batch', async () => {
    const p = fakeDb([sub()]);
    await grantIncludedBoosts(p, now);
    p.subscription.findMany = async () => [sub({ plan: { id: 'plan-top', boostsPerPeriod: 5, boostPeriodMonths: 1, boostDays: 7 } })];
    assert.equal(await grantIncludedBoosts(p, now), 2);
    assert.equal(p.rows.length, 5);
  });

  test('a plan with no boosts grants nothing', async () => {
    const p = fakeDb([sub({ plan: { id: 'plan-small', boostsPerPeriod: 0, boostPeriodMonths: 1, boostDays: 7 } })]);
    assert.equal(await grantIncludedBoosts(p, now), 0);
    assert.equal(p.rows.length, 0);
  });
});
