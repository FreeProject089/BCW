// The bounded-map helper backs every in-process cache (the L1 payload cache and the per-uid
// role/lock/epoch caches). Its whole job is that a TTL alone never frees anything, so these
// Maps must not grow with the number of distinct keys the process has ever seen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedSet } from '../src/lib/boundedmap.mjs';

test('never exceeds the cap, however many distinct keys are written', () => {
  const m = new Map();
  for (let i = 0; i < 10_000; i++) boundedSet(m, `k${i}`, { at: Date.now(), v: i }, 100, 60_000);
  assert.ok(m.size <= 100, `size ${m.size} must stay within the cap`);
});

test('evicts expired entries before live ones', () => {
  const m = new Map();
  const old = Date.now() - 60_000; // long past a 1s TTL
  for (let i = 0; i < 50; i++) m.set(`stale${i}`, { at: old, v: i });
  for (let i = 0; i < 50; i++) m.set(`fresh${i}`, { at: Date.now(), v: i });
  // Pushing past the cap must reclaim the 50 stale entries, not the fresh ones.
  boundedSet(m, 'trigger', { at: Date.now(), v: 'x' }, 60, 1000);
  assert.ok(m.size <= 60);
  assert.equal([...m.keys()].some((k) => k.startsWith('stale')), false, 'stale entries should be reclaimed first');
  assert.equal(m.has('fresh49'), true, 'fresh entries survive');
  assert.equal(m.has('trigger'), true);
});

test('falls back to oldest-first when nothing is expired', () => {
  const m = new Map();
  for (let i = 0; i < 10; i++) boundedSet(m, `k${i}`, { at: Date.now(), v: i }, 5, 60_000);
  assert.equal(m.size, 5);
  assert.equal(m.has('k0'), false, 'the oldest insertion is evicted');
  assert.equal(m.has('k9'), true, 'the newest is kept');
});

test('uses each entry\'s own ttl when no fixed ttlMs is given (the L1 cache shape)', () => {
  const m = new Map();
  // Per-entry ttl: these are already expired by their own field.
  for (let i = 0; i < 50; i++) m.set(`old${i}`, { at: Date.now() - 5000, ttl: 1000, v: i });
  for (let i = 0; i < 50; i++) m.set(`live${i}`, { at: Date.now(), ttl: 60_000, v: i });
  boundedSet(m, 'trigger', { at: Date.now(), ttl: 60_000, v: 'x' }, 60);
  assert.ok(m.size <= 60);
  assert.equal([...m.keys()].some((k) => k.startsWith('old')), false, 'per-entry ttl drives expiry');
  assert.equal(m.has('live49'), true);
});

test('a write under the cap is a plain set (no eviction, value updates in place)', () => {
  const m = new Map();
  boundedSet(m, 'a', { at: Date.now(), v: 1 }, 10, 60_000);
  boundedSet(m, 'a', { at: Date.now(), v: 2 }, 10, 60_000);
  assert.equal(m.size, 1);
  assert.equal(m.get('a').v, 2, 're-writing a key updates it');
});
