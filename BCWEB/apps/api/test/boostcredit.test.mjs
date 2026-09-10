// Included boosts: when they are granted, and what spending one is worth.
//
// The expensive mistake in here is not arithmetic, it is `boostEndFrom` measuring from now on
// something that is already featured — which silently destroys whatever was left of the
// current boost, for somebody who is stacking them precisely so there is no gap.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { periodStartFor, owedThisPeriod, boostEndFrom, creditState, pickCredit } from '../src/lib/boostcredit.mjs';

const D = (s) => new Date(s);
const DAY = 24 * 3600 * 1000;

describe('periodStartFor', () => {
  test('the first period starts at the anchor', () => {
    assert.equal(periodStartFor(D('2026-03-20T10:00:00Z'), D('2026-03-25T00:00:00Z'), 1).toISOString(),
      D('2026-03-20T10:00:00Z').toISOString());
  });

  test('it steps from the anchor, not from the calendar', () => {
    // Somebody who bought on the 20th gets their boosts on the 20th. Anchoring to the calendar
    // would hand a buyer a second month's worth ten days after the first.
    const anchor = D('2026-03-20T10:00:00Z');
    const p1 = periodStartFor(anchor, D('2026-04-19T00:00:00Z'), 1);
    const p2 = periodStartFor(anchor, D('2026-04-25T00:00:00Z'), 1);
    assert.equal(p1.getTime(), anchor.getTime());
    assert.ok(p2.getTime() > p1.getTime());
  });

  test('a multi-month period does not turn over early', () => {
    const anchor = D('2026-01-01T00:00:00Z');
    const inside = periodStartFor(anchor, D('2026-03-01T00:00:00Z'), 3);
    assert.equal(inside.getTime(), anchor.getTime());
    const after = periodStartFor(anchor, D('2026-05-01T00:00:00Z'), 3);
    assert.ok(after.getTime() > anchor.getTime());
  });

  test('a date before the anchor is the first period, not a negative one', () => {
    const anchor = D('2026-03-20T00:00:00Z');
    assert.equal(periodStartFor(anchor, D('2026-01-01T00:00:00Z'), 1).getTime(), anchor.getTime());
  });

  test('the same instant always gives the same answer', () => {
    const a = D('2026-03-20T10:00:00Z'); const t = D('2026-07-02T13:37:00Z');
    assert.equal(periodStartFor(a, t, 1).getTime(), periodStartFor(a, t, 1).getTime());
  });
});

describe('owedThisPeriod', () => {
  test('grants the difference, not a fresh batch', () => {
    assert.equal(owedThisPeriod({ boostsPerPeriod: 3 }, 0), 3);
    assert.equal(owedThisPeriod({ boostsPerPeriod: 3 }, 2), 1);
    assert.equal(owedThisPeriod({ boostsPerPeriod: 3 }, 3), 0);
  });

  test('a plan edited downward never asks for one back', () => {
    assert.equal(owedThisPeriod({ boostsPerPeriod: 1 }, 5), 0);
  });

  test('a plan with none owes none', () => {
    assert.equal(owedThisPeriod({ boostsPerPeriod: 0 }, 0), 0);
    assert.equal(owedThisPeriod({}, 0), 0);
    assert.equal(owedThisPeriod(null, 0), 0);
  });

  test('an absurd plan value is clamped rather than honoured', () => {
    assert.equal(owedThisPeriod({ boostsPerPeriod: 100000 }, 0), 50);
  });
});

describe('boostEndFrom', () => {
  const now = D('2026-06-01T00:00:00Z');

  test('nothing featured yet: it runs from now', () => {
    assert.equal(boostEndFrom(null, 7, now).getTime(), now.getTime() + 7 * DAY);
  });

  test('already featured: it STACKS, it does not restart', () => {
    // The whole point. Measuring from now would throw away the three days remaining.
    const until = new Date(now.getTime() + 3 * DAY);
    assert.equal(boostEndFrom(until, 7, now).getTime(), until.getTime() + 7 * DAY);
  });

  test('a boost that has already ended does not extend from the past', () => {
    const expired = new Date(now.getTime() - 30 * DAY);
    assert.equal(boostEndFrom(expired, 7, now).getTime(), now.getTime() + 7 * DAY);
  });

  test('days are clamped to something a boost can be', () => {
    assert.equal(boostEndFrom(null, 0, now).getTime(), now.getTime() + 1 * DAY);
    assert.equal(boostEndFrom(null, 99999, now).getTime(), now.getTime() + 365 * DAY);
    assert.equal(boostEndFrom(null, -5, now).getTime(), now.getTime() + 1 * DAY);
  });
});

describe('creditState', () => {
  const now = D('2026-06-01T00:00:00Z');
  test('available, used, expired, missing', () => {
    assert.equal(creditState({ }, now), 'available');
    assert.equal(creditState({ usedAt: now }, now), 'used');
    assert.equal(creditState({ expiresAt: D('2026-05-01T00:00:00Z') }, now), 'expired');
    assert.equal(creditState(null, now), 'missing');
  });

  test('a credit expiring exactly now is spent, not spendable', () => {
    assert.equal(creditState({ expiresAt: now }, now), 'expired');
  });
});

describe('pickCredit', () => {
  const now = D('2026-06-01T00:00:00Z');
  const soon = new Date(now.getTime() + 2 * DAY);
  const later = new Date(now.getTime() + 30 * DAY);

  test('spends the one expiring soonest, not the oldest', () => {
    // With expiry in play those differ, and spending the oldest leaves a credit expiring
    // tonight to be thrown away.
    const credits = [
      { id: 'old', createdAt: D('2026-01-01'), expiresAt: later },
      { id: 'urgent', createdAt: D('2026-05-01'), expiresAt: soon },
    ];
    assert.equal(pickCredit(credits, now).id, 'urgent');
  });

  test('a credit with no expiry is the last resort', () => {
    const credits = [{ id: 'forever', createdAt: D('2026-01-01') }, { id: 'urgent', createdAt: D('2026-05-01'), expiresAt: soon }];
    assert.equal(pickCredit(credits, now).id, 'urgent');
  });

  test('used and expired ones are not candidates', () => {
    const credits = [{ id: 'u', usedAt: now }, { id: 'e', expiresAt: D('2026-01-01') }];
    assert.equal(pickCredit(credits, now), null);
  });

  test('nothing to spend is null, not a throw', () => {
    assert.equal(pickCredit([], now), null);
    assert.equal(pickCredit(null, now), null);
  });

  test('the choice is deterministic', () => {
    const credits = [
      { id: 'a', createdAt: D('2026-01-01'), expiresAt: later },
      { id: 'b', createdAt: D('2026-02-01'), expiresAt: later },
    ];
    assert.equal(pickCredit(credits, now).id, 'a');
    assert.equal(pickCredit(credits.slice().reverse(), now).id, 'a');
  });
});
