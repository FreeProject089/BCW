// Two-tier TTL cache for hot, low-churn public reads:
//   L1 — a per-process Map (near-zero latency, absorbs the local burst), and
//   L2 — Redis (shared across ALL api replicas, so N replicas do ~1 DB read per TTL
//        window between them, not N). Plus request-coalescing so concurrent misses
//        share ONE producer call (no thundering herd on Postgres at expiry).
// If Redis is unavailable it silently runs L1-only (still correct, just per-process).
import { getRedis } from './redis.mjs';

const l1 = new Map();        // key -> { at, ttl, val }
const inflight = new Map();  // key -> Promise (dedupes concurrent misses)
const PREFIX = 'bcw:cache:';

export async function cached(key, ttlMs, producer) {
  const now = Date.now();
  const hit = l1.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.val;
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const r = getRedis();
      // L2: shared Redis copy — a value another replica already computed.
      if (r) {
        try {
          const raw = await r.get(PREFIX + key);
          if (raw != null) { const val = JSON.parse(raw); l1.set(key, { at: Date.now(), ttl: ttlMs, val }); return val; }
        } catch { /* Redis down → fall through to producer */ }
      }
      const val = await producer();
      l1.set(key, { at: Date.now(), ttl: ttlMs, val });
      if (r) { try { await r.set(PREFIX + key, JSON.stringify(val), 'PX', ttlMs); } catch { /* ignore */ } }
      return val;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, promise);
  return promise;
}

// Drop a cached key from BOTH tiers after a write that invalidates it. Other replicas'
// L1 self-heals within its TTL (these are seconds-long public reads, so that's fine).
export function invalidate(key) {
  l1.delete(key);
  const r = getRedis();
  if (r) { try { r.del(PREFIX + key); } catch { /* ignore */ } }
}
