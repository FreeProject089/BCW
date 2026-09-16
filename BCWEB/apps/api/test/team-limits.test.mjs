// The team limit and the invite rule, pure.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { teamLimitFor, teamSlotPrice, inviteUsable } from '../src/lib/teams.mjs';

describe('team limits', () => {
  test('the admin limit plus bought slots; defaults when unset or nonsense', () => {
    assert.deepEqual(teamLimitFor({}, {}), { base: 3, extra: 0, limit: 3 });
    assert.deepEqual(teamLimitFor({ 'teams.maxOwned': 1 }, { extraTeamSlots: 2 }), { base: 1, extra: 2, limit: 3 });
    assert.deepEqual(teamLimitFor({ 'teams.maxOwned': 'x' }, { extraTeamSlots: -4 }), { base: 3, extra: 0, limit: 3 });
    assert.equal(teamLimitFor({ 'teams.maxOwned': 0 }, {}).limit, 0);
  });
  test('the slot price: cents ≥ 50 and a three-letter currency, else the defaults', () => {
    assert.deepEqual(teamSlotPrice({}), { cents: 500, currency: 'eur' });
    assert.deepEqual(teamSlotPrice({ 'teams.slotPriceCents': 1299, 'teams.slotCurrency': 'CHF' }), { cents: 1299, currency: 'chf' });
    assert.deepEqual(teamSlotPrice({ 'teams.slotPriceCents': 10, 'teams.slotCurrency': 'dollars!' }), { cents: 500, currency: 'dol' });
  });
});

describe('invite links', () => {
  const now = new Date('2026-09-16T12:00:00Z');
  test('usable until revoked, expired or used up', () => {
    assert.equal(inviteUsable({ uses: 0 }, now), true);
    assert.equal(inviteUsable({ revokedAt: now, uses: 0 }, now), false);
    assert.equal(inviteUsable({ expiresAt: new Date(now.getTime() - 1), uses: 0 }, now), false);
    assert.equal(inviteUsable({ expiresAt: new Date(now.getTime() + 1), uses: 0 }, now), true);
    assert.equal(inviteUsable({ maxUses: 2, uses: 2 }, now), false);
    assert.equal(inviteUsable({ maxUses: 2, uses: 1 }, now), true);
    assert.equal(inviteUsable(null, now), false);
  });
});
