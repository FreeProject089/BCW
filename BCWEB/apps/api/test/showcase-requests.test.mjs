// The two doors into "Other projects", and the rule that neither of them approves anything.
//
// The switches are the whole feature: with both off, the site must behave exactly as it did
// before this existed. A submission box on a site whose owner is not reading submissions is
// worse than no box, and a default that silently opens one is how that happens.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { showcaseConfig } from '../src/routes/showcase-requests.mjs';

/** A stand-in for the Prisma client, holding only what showcaseConfig reads. */
const fakeDb = (settings) => ({
  adminSetting: {
    findMany: async ({ where }) => Object.entries(settings)
      .filter(([k]) => where.key.in.includes(k))
      .map(([key, value]) => ({ key, value })),
  },
});

describe('showcaseConfig', () => {
  test('a fresh install offers NOTHING', async () => {
    // The point of the whole thing. `!== false` would have read an unset key as ON, which
    // is what the MYO config does — deliberately, because that feature shipped enabled.
    // This one has not, so an admin who has never seen these switches gets no form.
    const c = await showcaseConfig(fakeDb({}));
    assert.equal(c.requestsEnabled, false);
    assert.equal(c.paidEnabled, false);
  });

  test('the two doors are independent', async () => {
    const free = await showcaseConfig(fakeDb({ 'showcase.requestsEnabled': true }));
    assert.equal(free.requestsEnabled, true);
    assert.equal(free.paidEnabled, false);

    const paid = await showcaseConfig(fakeDb({ 'showcase.paidEnabled': true }));
    assert.equal(paid.requestsEnabled, false);
    assert.equal(paid.paidEnabled, true);

    const both = await showcaseConfig(fakeDb({ 'showcase.requestsEnabled': true, 'showcase.paidEnabled': true }));
    assert.equal(both.requestsEnabled, true);
    assert.equal(both.paidEnabled, true);
  });

  test('anything other than exactly true is off', async () => {
    // A key left as a string, a 1, or a null must not open a door. Settings are written by
    // a generic editor that does not know this key's type.
    for (const v of ['true', 1, 'yes', null, 0, '', {}]) {
      const c = await showcaseConfig(fakeDb({ 'showcase.requestsEnabled': v }));
      assert.equal(c.requestsEnabled, false, `${JSON.stringify(v)} must not enable it`);
    }
  });

  test('the price falls back rather than becoming free', async () => {
    // A missing or nonsense price must never charge 0 — that is a listing given away by a
    // typo, and it is the direction that cannot be undone.
    assert.equal((await showcaseConfig(fakeDb({}))).priceCents, 2000);
    assert.equal((await showcaseConfig(fakeDb({ 'showcase.priceCents': 'abc' }))).priceCents, 2000);
    assert.equal((await showcaseConfig(fakeDb({ 'showcase.priceCents': -5 }))).priceCents, 2000);
    // Zero IS allowed, because an admin may deliberately want a free "paid" flow while they
    // test it. It has to be typed, not arrived at by accident.
    assert.equal((await showcaseConfig(fakeDb({ 'showcase.priceCents': 0 }))).priceCents, 0);
  });

  test('the per-person cap defaults to something rather than to unlimited', async () => {
    // A default of 0 (no limit) would let one account bury the queue on a site whose owner
    // never looked at this screen.
    assert.equal((await showcaseConfig(fakeDb({}))).maxOpenPerUser, 3);
    assert.equal((await showcaseConfig(fakeDb({ 'showcase.maxOpenPerUser': 0 }))).maxOpenPerUser, 0);
  });

  test('the currency falls back to a usable code, never to a number', async () => {
    assert.equal((await showcaseConfig(fakeDb({}))).currency, 'usd');
    assert.equal((await showcaseConfig(fakeDb({ 'showcase.currency': 42 }))).currency, 'usd');
    assert.equal((await showcaseConfig(fakeDb({ 'showcase.currency': 'chf' }))).currency, 'chf');
  });
});
