// Tests the two-tier cache helper's core guarantees, which the /catalog.json feed (and
// other hot public reads) now rely on: a hit within TTL doesn't re-run the producer,
// concurrent misses coalesce onto ONE producer call (no thundering herd on Postgres),
// and the value refreshes after the TTL lapses. Pure — no DB, no Redis (L1-only path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached, invalidate } from '../src/lib/cache.mjs';

const key = () => `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a hit within TTL does not re-run the producer', async () => {
  const k = key(); let calls = 0;
  const v1 = await cached(k, 1000, async () => { calls++; return { n: 1 }; });
  const v2 = await cached(k, 1000, async () => { calls++; return { n: 2 }; });
  assert.equal(calls, 1, 'producer should run once');
  assert.deepEqual(v1, { n: 1 });
  assert.deepEqual(v2, { n: 1 }, 'second call returns the cached value');
  invalidate(k);
});

test('concurrent misses coalesce onto one producer call', async () => {
  const k = key(); let calls = 0;
  const producer = async () => { calls++; await sleep(30); return calls; };
  const [a, b, c] = await Promise.all([cached(k, 1000, producer), cached(k, 1000, producer), cached(k, 1000, producer)]);
  assert.equal(calls, 1, 'three concurrent misses → one producer call');
  assert.deepEqual([a, b, c], [1, 1, 1]);
  invalidate(k);
});

test('the value refreshes after the TTL lapses', async () => {
  const k = key(); let calls = 0;
  const producer = async () => ++calls;
  assert.equal(await cached(k, 40, producer), 1);
  await sleep(60);
  assert.equal(await cached(k, 40, producer), 2, 'producer re-runs once the TTL is past');
  invalidate(k);
});

test('invalidate() drops the cached value', async () => {
  const k = key(); let calls = 0;
  const producer = async () => ++calls;
  assert.equal(await cached(k, 5000, producer), 1);
  invalidate(k);
  assert.equal(await cached(k, 5000, producer), 2, 'after invalidate the producer runs again');
  invalidate(k);
});
