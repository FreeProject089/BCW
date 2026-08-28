// The boolean view of the dependency checks and the timed view must never disagree.
//
// `checkDependencies` returns `{ key: true|false|null }` and three places branch on it — the
// status page, the sampler that opens outages, and the admin panel. `checkDependenciesTimed`
// returns `{ key: { ok, ms } }` so the panel can show how long each probe took.
//
// Two shapes for one question is the arrangement that quietly goes wrong: if a caller of the
// boolean one ever received the object instead, `{ ok: false }` is TRUTHY, so a service that
// is down reads as up and no outage is ever opened. Nothing else would notice — the page
// would just be green during an outage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDependencies, checkDependenciesTimed } from '../src/lib/monitor.mjs';

/**
 * A prisma stand-in.
 *
 * `serverperf.deps` turns off every probe that would touch the network, so the test measures
 * the two functions rather than this machine's internet connection. `db` is left on, because
 * a run with nothing enabled would pass without either function doing anything.
 */
const fakePrisma = (dbUp) => ({
  adminSetting: {
    findUnique: async ({ where }) => (where.key === 'serverperf.deps'
      ? { value: { db: true, storage: false, bot: false, telemetry: false, web: false, stripe: false } }
      : null),
  },
  $queryRaw: async () => { if (!dbUp) throw new Error('down'); return [{ '?column?': 1 }]; },
});

test('the timed view reports the same ok as the boolean view', async () => {
  for (const up of [true, false]) {
    const p = fakePrisma(up);
    const plain = await checkDependencies(p);
    const timed = await checkDependenciesTimed(p);
    assert.deepEqual(Object.keys(plain), Object.keys(timed));
    for (const k of Object.keys(plain)) {
      assert.equal(plain[k], timed[k].ok, `${k} disagrees when db is ${up ? 'up' : 'down'}`);
    }
  }
});

test('the boolean view really is booleans, not objects', async () => {
  // The failure this whole file exists for. `{ ok: false }` passes an `if (x)` test.
  const plain = await checkDependencies(fakePrisma(false));
  for (const [k, v] of Object.entries(plain)) {
    assert.equal(typeof v === 'boolean' || v === null, true, `${k} is ${JSON.stringify(v)}`);
  }
});

test('a duration is recorded for a check that ran, and not for one that did not apply', async () => {
  const timed = await checkDependenciesTimed(fakePrisma(true));
  assert.equal(typeof timed.db.ms, 'number');
  assert.equal(timed.db.ms >= 0, true);
  // Only `db` is enabled, so nothing else should be in the result at all — a disabled check
  // must not appear as a row the panel would draw.
  assert.deepEqual(Object.keys(timed), ['db']);
});
