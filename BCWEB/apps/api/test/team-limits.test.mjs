// The team limit and the invite rule, pure.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { teamLimitFor, teamSlotPrice, inviteUsable, invitePolicy, invitePlanFor, isPermanentInvite } from '../src/lib/teams.mjs';

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

  test('permanent is the absence of an expiry, not a second flag', () => {
    assert.equal(isPermanentInvite({ uses: 0 }), true);
    assert.equal(isPermanentInvite({ uses: 0, expiresAt: now }), false);
    assert.equal(isPermanentInvite(null), false);
  });
});

describe('invite policy', () => {
  test('the admin caps, with the defaults when unset or nonsense', () => {
    assert.deepEqual(invitePolicy({}), { maxTemporary: 5, lifetimeDays: [1, 7, 30] });
    assert.deepEqual(invitePolicy({ 'teams.inviteMaxTemporary': 2, 'teams.inviteLifetimeDays': '14, 3,3' }), { maxTemporary: 2, lifetimeDays: [3, 14] });
    // 0 is a real answer (permanent links only) and must not be read as "unset".
    assert.equal(invitePolicy({ 'teams.inviteMaxTemporary': 0 }).maxTemporary, 0);
    assert.equal(invitePolicy({ 'teams.inviteMaxTemporary': 'x' }).maxTemporary, 5);
    // An unparseable list must not leave a team unable to invite anybody.
    assert.deepEqual(invitePolicy({ 'teams.inviteLifetimeDays': 'oui' }).lifetimeDays, [1, 7, 30]);
    assert.deepEqual(invitePolicy({ 'teams.inviteLifetimeDays': [0, 400, 9] }).lifetimeDays, [9]);
  });
});

describe('invitePlanFor', () => {
  const now = new Date('2026-09-16T12:00:00Z');
  const policy = invitePolicy({});
  const perm = { uses: 0, expiresAt: null };
  const temp = (days) => ({ uses: 0, expiresAt: new Date(now.getTime() + days * 86400e3) });

  test('the first permanent link is allowed; the second is refused by name', () => {
    assert.deepEqual(invitePlanFor([], 0, policy, now), { expiresAt: null, permanent: true });
    assert.deepEqual(invitePlanFor([perm], 0, policy, now), { error: 'permanent_exists' });
    assert.deepEqual(invitePlanFor([perm], null, policy, now), { error: 'permanent_exists' });
  });

  test('a revoked or expired permanent link frees the single slot', () => {
    assert.equal(invitePlanFor([{ ...perm, revokedAt: now }], 0, policy, now).permanent, true);
    // Temporary links, however many, never occupy the permanent slot.
    assert.equal(invitePlanFor([temp(1), temp(7)], 0, policy, now).permanent, true);
  });

  test('a temporary link gets the lifetime asked for, and only an offered one', () => {
    const got = invitePlanFor([], 7, policy, now);
    assert.equal(got.days, 7);
    assert.equal(got.expiresAt.toISOString(), new Date(now.getTime() + 7 * 86400e3).toISOString());
    assert.deepEqual(invitePlanFor([], 5, policy, now), { error: 'invalid_lifetime', allowed: [1, 7, 30] });
    assert.deepEqual(invitePlanFor([], 3650, policy, now), { error: 'invalid_lifetime', allowed: [1, 7, 30] });
  });

  test('the temporary cap counts only links that still work', () => {
    const three = { maxTemporary: 3, lifetimeDays: [7] };
    assert.deepEqual(invitePlanFor([temp(1), temp(2), temp(3)], 7, three, now), { error: 'too_many_invites', limit: 3, open: 3 });
    // An expired one is a dead row; if it held a slot the cap would shrink to zero for a
    // team that never revoked anything.
    const dead = { uses: 0, expiresAt: new Date(now.getTime() - 1) };
    assert.equal(invitePlanFor([temp(1), temp(2), dead], 7, three, now).days, 7);
    // The permanent link does not eat a temporary slot either.
    assert.equal(invitePlanFor([perm, temp(1), temp(2)], 7, three, now).days, 7);
  });

  test('a cap of zero refuses every temporary link and still allows the permanent one', () => {
    const none = { maxTemporary: 0, lifetimeDays: [7] };
    assert.equal(invitePlanFor([], 7, none, now).error, 'too_many_invites');
    assert.equal(invitePlanFor([], 0, none, now).permanent, true);
  });
});
