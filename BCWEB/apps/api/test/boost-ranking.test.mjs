// A boost has to put the buyer ABOVE the people who did not buy one.
//
// It did the opposite. The listings order by `featuredUntil DESC`, Prisma emits a bare DESC,
// and Postgres sorts NULLs FIRST on a descending order. So every repo and every catalogue
// that had never been boosted sorted ahead of every one that had: paying for the feature
// moved you down the page. The card's own badge was right (it compares the date to now), so
// the page said "not featured" about the rows at the top and "Featured" about the rows below
// them.
//
// This is checked against a real database rather than by reading the source, because the
// defect lives in the gap between what the query says and what the database does with it.
// Reading `featuredUntil: 'desc'` tells you nothing about where the NULLs go.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/lib/lib.mjs';

const skip = process.env.DATABASE_URL ? false : 'no DATABASE_URL';
const TAG = `boost-test-${Date.now()}`;

describe('boost ranking', { skip }, () => {
  let p;
  let owner;

  before(async () => {
    p = await db();
    owner = await p.user.create({
      data: { email: `${TAG}@test.local`, displayName: TAG, passwordHash: 'x' },
      select: { id: true },
    });
    const day = 86400000;
    // Four rows covering every case the ordering has to separate.
    for (const [name, featuredUntil] of [
      ['never', null],
      ['expired', new Date(Date.now() - 30 * day)],
      ['ends soon', new Date(Date.now() + 2 * day)],
      ['ends later', new Date(Date.now() + 30 * day)],
    ]) {
      await p.serverRepo.create({ data: { name: `${TAG} ${name}`, ownerId: owner.id, featuredUntil } });
    }
  });

  after(async () => {
    // The user's own development database: take the fixtures back out.
    await p.serverRepo.deleteMany({ where: { name: { startsWith: TAG } } });
    await p.user.deleteMany({ where: { email: `${TAG}@test.local` } });
  });

  test('a live boost outranks no boost at all', async () => {
    const rows = await p.serverRepo.findMany({
      where: { name: { startsWith: TAG } },
      orderBy: [{ featuredUntil: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: { name: true, featuredUntil: true },
    });
    const order = rows.map((r) => r.name.replace(`${TAG} `, ''));
    // Furthest end date first, then the nearer one, then the expired, then never. The last
    // two swap once the sweeper has cleared the expired date, and either way both sit below
    // the live boosts, which is the part that was broken.
    assert.deepEqual(order.slice(0, 2), ['ends later', 'ends soon']);
    assert.ok(order.indexOf('never') > order.indexOf('ends soon'), 'never boosted must not outrank a live boost');
  });

  test('the bare DESC this replaced really did invert it', async () => {
    // The regression, demonstrated rather than described: if somebody drops `nulls: 'last'`
    // the query silently goes back to this, and this test says what that costs.
    const rows = await p.serverRepo.findMany({
      where: { name: { startsWith: TAG } },
      orderBy: [{ featuredUntil: 'desc' }, { createdAt: 'desc' }],
      select: { name: true },
    });
    const order = rows.map((r) => r.name.replace(`${TAG} `, ''));
    assert.equal(order[0], 'never', 'a bare DESC puts the never-boosted row first, which is the bug');
  });

  test('the sweeper clears a boost that has ended, so the badge and the order agree', async () => {
    const { sweepEndedBoostsForTest } = await import('../src/lib/sweeper.mjs').then((m) => ({
      sweepEndedBoostsForTest: m.sweepEndedBoostsForTest,
    }));
    await sweepEndedBoostsForTest(p);
    const rows = await p.serverRepo.findMany({
      where: { name: { startsWith: TAG } },
      select: { name: true, featuredUntil: true },
    });
    const byName = Object.fromEntries(rows.map((r) => [r.name.replace(`${TAG} `, ''), r.featuredUntil]));
    assert.equal(byName.expired, null, 'an ended boost keeps no ranking date');
    assert.ok(byName['ends soon'], 'a live boost is untouched');
    assert.ok(byName['ends later'], 'a live boost is untouched');
  });
});
