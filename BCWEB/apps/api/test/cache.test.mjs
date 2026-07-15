// Tests the two-tier cache helper's core guarantees, which the /catalog.json feed (and
// other hot public reads) now rely on: a hit within TTL doesn't re-run the producer,
// concurrent misses coalesce onto ONE producer call (no thundering herd on Postgres),
// and the value refreshes after the TTL lapses. Pure — no DB, no Redis (L1-only path).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cached, cachedTagged, replyCachedJson, invalidate } from '../src/lib/cache.mjs';
import { hasNative } from '../src/lib/native.mjs';

const key = () => `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal Fastify-reply stand-in that records what the handler set.
function fakeReply() {
  const r = { statusCode: 200, headers: {}, body: undefined, sent: false };
  r.header = (k, v) => { r.headers[k.toLowerCase()] = v; return r; };
  r.code = (n) => { r.statusCode = n; return r; };
  r.send = (b) => { r.body = b; r.sent = true; return r; };
  return r;
}

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

test('the L1 map stays bounded no matter how many distinct keys are used', async () => {
  // A TTL alone only makes an entry stale, never freed. Without a cap, one request per
  // distinct key (e.g. an unvalidated ?project= in a cache key) pins a payload forever.
  // 2000 distinct keys must not leave 2000 live entries.
  const tagKey = `bound-${Date.now()}`;
  for (let i = 0; i < 2000; i++) {
    await cached(`${tagKey}-${i}`, 60_000, async () => ({ payload: 'x'.repeat(200), i }));
  }
  // Probe the bound via observable behaviour: an early key must have been evicted, so its
  // producer runs again (a live cache would return the memoised value without calling it).
  let reran = false;
  await cached(`${tagKey}-0`, 60_000, async () => { reran = true; return { payload: 'y', i: 0 }; });
  assert.equal(reran, true, 'the oldest entries must be evicted once past the cap');
  // …while a just-written key is still cached (the cap evicts oldest-first, not everything).
  let recentReran = false;
  await cached(`${tagKey}-1999`, 60_000, async () => { recentReran = true; return { nope: true }; });
  assert.equal(recentReran, false, 'the most recent entry should still be a hit');
});

test('cachedTagged returns the value plus a stable content ETag', async () => {
  const k = key();
  const { val, etag } = await cachedTagged(k, 1000, async () => ({ a: 1 }));
  const again = await cachedTagged(k, 1000, async () => ({ a: 2 }));
  assert.deepEqual(val, { a: 1 });
  assert.deepEqual(again.val, { a: 1 }, 'second call is a cache hit');
  assert.equal(again.etag, etag, 'the ETag is stable across hits');
  // The native (blake3) path yields a 64-hex digest; the JS fallback yields null.
  if (hasNative) assert.match(etag, /^[0-9a-f]{64}$/); else assert.equal(etag, null);
  invalidate(k);
});

test('replyCachedJson sends an ETag and 304s a matching If-None-Match', async () => {
  const k = key();
  const producer = async () => ({ hello: 'world', list: Array.from({ length: 50 }, (_, i) => i) });

  // First request: no validator → full 200 body, ETag attached (when native is present).
  const rep1 = fakeReply();
  await replyCachedJson({ headers: {} }, rep1, k, 1000, producer);
  assert.equal(rep1.statusCode, 200);
  assert.deepEqual(rep1.body, await producer());
  const etag = rep1.headers['etag'];

  if (!hasNative) {
    assert.equal(etag, undefined, 'no native hasher → no ETag, always a plain 200');
    invalidate(k);
    return;
  }
  assert.match(etag, /^"[0-9a-f]{64}"$/, 'quoted blake3 ETag');

  // Same ETag back in If-None-Match → empty 304 (the repeat-visitor bandwidth/p99 win).
  const rep2 = fakeReply();
  await replyCachedJson({ headers: { 'if-none-match': etag } }, rep2, k, 1000, producer);
  assert.equal(rep2.statusCode, 304);
  assert.equal(rep2.body, undefined, '304 carries no body');

  // A stale/other ETag → still a full 200 with the body.
  const rep3 = fakeReply();
  await replyCachedJson({ headers: { 'if-none-match': '"stale00"' } }, rep3, k, 1000, producer);
  assert.equal(rep3.statusCode, 200);
  assert.deepEqual(rep3.body, await producer());
  invalidate(k);
});
