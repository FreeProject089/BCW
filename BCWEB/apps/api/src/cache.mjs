// Tiny in-process TTL cache for hot, low-churn public reads. Two wins:
//   1. fewer DB round-trips (the value is reused for `ttlMs`), and
//   2. request-coalescing: concurrent misses share ONE producer call (no thundering
//      herd hammering Postgres when a popular key expires under load).
// In-memory is per-process; with multiple API replicas each keeps its own copy
// (fine for a few-seconds TTL). Swap the Map for Redis if you need a shared cache.
const store = new Map();     // key -> { at, val }
const inflight = new Map();  // key -> Promise (dedupes concurrent misses)

export async function cached(key, ttlMs, producer) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.val;
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = (async () => {
    try { const val = await producer(); store.set(key, { at: Date.now(), val }); return val; }
    finally { inflight.delete(key); }
  })();
  inflight.set(key, promise);
  return promise;
}

// Drop a cached key (call after a write that invalidates it).
export function invalidate(key) { store.delete(key); }
