// Insert into a TTL-keyed Map while keeping it BOUNDED.
//
// Why this exists: a TTL alone only makes an entry STALE — it never frees it. Every
// in-process cache here (the L1 payload cache, the per-uid role/lock/epoch caches) is a
// plain Map keyed by something unbounded (a cache key, a user id), so without a cap each
// one holds every key it ever saw for the life of the process. Small entries × every user
// who ever hit the API still adds up, and a payload cache is far worse.
//
// Eviction order: every expired entry first (we're already walking the map, and they're pure
// garbage — reclaiming all of them in one pass frees the most and pushes the next overflow
// further out), then oldest-inserted until back under the cap. Map iterates in insertion
// order, so keys().next() is the oldest.
//
// `ttlMs` is optional: pass it for caches with one fixed TTL; omit it for caches that store
// a per-entry `ttl` (the entry's own field is used instead). Entries must carry `at`.
export function boundedSet(map, key, entry, max, ttlMs) {
  map.set(key, entry);
  if (map.size <= max) return; // fast path: nothing to reclaim
  const now = Date.now();
  for (const [k, v] of map) {
    const ttl = ttlMs ?? v.ttl;
    if (ttl != null && now - v.at >= ttl) map.delete(k);
  }
  while (map.size > max) map.delete(map.keys().next().value);
}
