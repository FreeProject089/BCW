// How often one account may cause a confirmation mail.
//
// The route already carried a fastify rate limit, and it is the wrong shape for this: it is
// keyed on the CALLER'S IP, while the thing being protected is a MAILBOX the caller typed —
// which may not be theirs. Somebody who wants to post twenty messages into a stranger's inbox
// does not mind changing IP between them, and does not need to.
//
// So the real limit is per account and is counted from the EmailVerification rows themselves:
// an in-process counter resets when a container restarts and is per-replica besides, which
// means the limit would be "five per hour, per container, until the next deploy".
//
// The `p` here is a stub with exactly the one method the limiter calls. Deliberately not a
// database: the interesting cases are "what does it do at the boundary", and a test that has
// to insert five rows to ask that question is one nobody reads.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resendWaitMs } from '../src/routes/auth.mjs';
import { RESEND_MIN_GAP_MS, RESEND_MAX_PER_DAY, RESEND_DAY_MS } from '../src/lib/verify-gate.mjs';

const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);
/** A stub returning the given ages (ms before NOW) as rows, newest first — the order the real
 *  query asks for, because the limiter reads rows[0] as "the last one sent". */
const stub = (agesMs) => ({
  emailVerification: {
    findMany: async ({ where }) => {
      const floor = where.createdAt.gte.getTime();
      return agesMs
        .map((age) => ({ createdAt: new Date(NOW - age) }))
        .filter((r) => r.createdAt.getTime() >= floor)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
  },
});

describe('the confirmation-mail resend limit', () => {
  test('a first request goes straight through', async () => {
    assert.equal(await resendWaitMs(stub([]), 'u1', NOW), 0);
  });

  test('a second one inside the gap is refused, and says for how long', async () => {
    const wait = await resendWaitMs(stub([60_000]), 'u1', NOW);
    assert.ok(wait > 0);
    assert.equal(wait, RESEND_MIN_GAP_MS - 60_000);
  });

  test('the double-click costs one mail, not two', async () => {
    // The commonest way this is hit: the button is pressed twice in a second because nothing
    // visibly happened the first time.
    assert.ok(await resendWaitMs(stub([200]), 'u1', NOW) > 0);
  });

  test('once the gap has passed it goes through again', async () => {
    assert.equal(await resendWaitMs(stub([RESEND_MIN_GAP_MS + 1]), 'u1', NOW), 0);
  });

  test('the daily ceiling holds even when every gap was respected', async () => {
    // A patient sender spacing them out is exactly the case a minimum gap does not catch.
    const spaced = Array.from({ length: RESEND_MAX_PER_DAY }, (_, i) => (i + 1) * RESEND_MIN_GAP_MS * 2);
    const wait = await resendWaitMs(stub(spaced), 'u1', NOW);
    assert.ok(wait > 0, `${RESEND_MAX_PER_DAY} in a day should be the ceiling`);
  });

  test('one below the ceiling still goes through', async () => {
    const spaced = Array.from({ length: RESEND_MAX_PER_DAY - 1 }, (_, i) => (i + 1) * RESEND_MIN_GAP_MS * 2);
    assert.equal(await resendWaitMs(stub(spaced), 'u1', NOW), 0);
  });

  test('the ceiling is a ROLLING day, so it lets go on its own', async () => {
    // Every mail older than the window is simply not counted. Nobody is locked out for ever
    // by five clicks last week, and no cron job is needed to release them.
    const old = Array.from({ length: RESEND_MAX_PER_DAY + 3 }, () => RESEND_DAY_MS + 60_000);
    assert.equal(await resendWaitMs(stub(old), 'u1', NOW), 0);
  });

  test('at the ceiling, the wait is until the OLDEST one ages out', async () => {
    // Not "24 hours from now": that would punish somebody for a mail sent 23 hours ago by
    // making them wait another full day.
    const ages = [RESEND_MIN_GAP_MS + 1_000];
    for (let i = 1; i < RESEND_MAX_PER_DAY; i++) ages.push(RESEND_DAY_MS - 60_000 - i);
    const wait = await resendWaitMs(stub(ages), 'u1', NOW);
    assert.ok(wait > 0 && wait <= 61_000, `expected about a minute, got ${wait}ms`);
  });

  test('a database that will not answer does not lock the account out', async () => {
    // A confirmation mail is the way back into an account. A failed read here must not be the
    // thing that refuses it.
    const broken = { emailVerification: { findMany: async () => { throw new Error('down'); } } };
    assert.equal(await resendWaitMs(broken, 'u1', NOW), 0);
  });
});
