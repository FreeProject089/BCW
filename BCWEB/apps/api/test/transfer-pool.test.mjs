// Where a transferred repo's storage lands.
//
// The rule this file guards: storage does not follow the object and it does not stay
// behind either — the object moves INTO a pool the recipient already owns. Anything else
// leaves one of them paying for the other's content, and the specific failure it prevents
// is nasty and silent: leave the repo in the sender's pool, and the day the sender cancels
// their subscription the sweeper suspends a repo that is no longer theirs.
//
// `choosePool` is the part with rules in it, so it is the part tested here — no database
// needed. The half it is split from is a SUM over two tables, which is covered by
// pool-billing.test.mjs and by Prisma itself.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { choosePool } = await import('../src/routes/transfers.mjs');

const GiB = 1024n ** 3n;
const pool = (id, freeGiB, need) => ({ id, name: id, freeBytes: BigInt(freeGiB) * GiB, fits: BigInt(freeGiB) * GiB >= need });
const pools = (need, ...sizes) => sizes.map(([id, gib]) => pool(id, gib, need));

describe('choosePool', () => {
  test('no pools at all is a different problem from no room', () => {
    // Different fixes: one person needs to buy hosting, the other needs to free some up or
    // pick another pool. One shared "cannot accept" would send both to the wrong page.
    assert.equal(choosePool(5n * GiB, []).reason, 'no_pool');
    assert.equal(choosePool(5n * GiB, pools(5n * GiB, ['a', 1], ['b', 2])).reason, 'insufficient_pool_space');
  });

  test('with no preference, the roomiest pool that fits', () => {
    const need = 5n * GiB;
    const r = choosePool(need, pools(need, ['small', 6], ['big', 40], ['tiny', 1]));
    assert.equal(r.ok, true);
    assert.equal(r.chosen.id, 'big');
  });

  test('a named pool is used, or refused BY NAME — never swapped for another', () => {
    const need = 5n * GiB;
    const list = pools(need, ['chosen', 6], ['bigger', 90]);
    assert.equal(choosePool(need, list, 'chosen').chosen.id, 'chosen',
      'a pool the user picked must be the one used');

    // The important one. Somebody who names a pool has a reason; quietly using a different
    // one puts their content somewhere they did not choose and never sees a message.
    const tooSmall = pools(need, ['chosen', 1], ['bigger', 90]);
    const r = choosePool(need, tooSmall, 'chosen');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'pool_too_small');
    assert.equal(r.chosen, null);
  });

  test('a pool id that is not theirs is refused, not ignored', () => {
    const need = 5n * GiB;
    const r = choosePool(need, pools(need, ['mine', 90]), 'somebody-elses');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_such_pool');
  });

  test('an exact fit fits', () => {
    // `>=`, not `>`: a pool with precisely the right room is room. Off by one here means a
    // transfer that can never be accepted and no way to tell why from the message.
    const need = 5n * GiB;
    const r = choosePool(need, pools(need, ['exact', 5]));
    assert.equal(r.ok, true);
    assert.equal(r.chosen.id, 'exact');
  });

  test('nothing to move fits anywhere, including nowhere', () => {
    // A listed (non-hosted) repo reserves no bytes. movePlan short-circuits before calling
    // this, but a rule that only works because of its caller is one refactor from breaking.
    const r = choosePool(0n, []);
    assert.equal(r.ok, false, 'zero-need is handled by the caller, not by inventing a pool');
    assert.equal(r.reason, 'no_pool');
  });

  test('the comparison is on bytes, not on JS numbers', () => {
    // BigInt throughout: poolBytes and storageQuotaBytes are BigInt in Prisma, and a
    // Number round-trip loses precision above 2^53 — which is only ~9 PB, but the bug it
    // produces is a pool that accepts a repo it cannot hold.
    const need = 9_007_199_254_740_993n;              // 2^53 + 1
    const justUnder = [{ id: 'a', name: 'a', freeBytes: need - 1n, fits: false }];
    const justOver = [{ id: 'b', name: 'b', freeBytes: need, fits: true }];
    assert.equal(choosePool(need, justUnder).ok, false);
    assert.equal(choosePool(need, justOver).chosen.id, 'b');
  });
});
