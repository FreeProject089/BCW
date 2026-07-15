// Two-tier TTL cache for hot, low-churn public reads:
//   L1 — a per-process Map (near-zero latency, absorbs the local burst), and
//   L2 — Redis (shared across ALL api replicas, so N replicas do ~1 DB read per TTL
//        window between them, not N). Plus request-coalescing so concurrent misses
//        share ONE producer call (no thundering herd on Postgres at expiry).
// If Redis is unavailable it silently runs L1-only (still correct, just per-process).
//
// The L2 copy is compressed with zstd (native worker) above a small threshold, and a
// blake3 content hash is attached as an ETag so hot GET routes can answer If-None-Match
// with a 304 — both use the Rust addon and degrade to plain JSON / no-ETag if it's
// absent. This is a purely INTERNAL artifact (BCWEB produces and consumes it), so unlike
// the public repo/catalog download bytes it's free to re-encode. See guides/RUST_WORKERS_PLAN.
import { getRedis } from './redis.mjs';
import { zstdCompress, zstdDecompress, blake3Hex } from './native.mjs';
import { boundedSet } from './boundedmap.mjs';

const l1 = new Map();        // key -> { at, ttl, val, etag }
const inflight = new Map();  // key -> Promise (dedupes concurrent misses)
const PREFIX = 'bcw:cache:';
const ZSTD_MIN = 512;        // only worth compressing payloads above ~0.5 KB
// Hard cap on the L1 map — see boundedmap.mjs for why a TTL alone isn't enough. Each entry
// pins a whole payload, so this is the backstop; callers should still keep keys bounded.
const L1_MAX = 256;
const l1Set = (key, entry) => boundedSet(l1, key, entry, L1_MAX); // entries carry their own ttl

// Frame a serialized value for Redis as a Buffer: byte 0 is a flag (0 = raw utf-8 JSON,
// 1 = zstd-compressed JSON), the rest is the payload. Compression is best-effort — if the
// native addon is missing, or the value is small, or it doesn't actually shrink, we store raw.
async function encode(json) {
  const rawBuf = Buffer.from(json, 'utf8');
  if (rawBuf.length >= ZSTD_MIN) {
    try {
      const packed = await zstdCompress(rawBuf, 3);
      if (packed && packed.length < rawBuf.length) return Buffer.concat([Buffer.from([1]), packed]);
    } catch { /* fall through to raw */ }
  }
  return Buffer.concat([Buffer.from([0]), rawBuf]);
}

// Inverse of encode(). Returns the JSON string, or null for an unreadable/legacy value
// (e.g. a plain string written by an older build, or a zstd blob with no native decoder) —
// the caller then treats it as a miss and re-produces, which self-heals within one TTL.
async function decode(buf) {
  if (!buf || buf.length === 0) return null;
  const flag = buf[0];
  const body = buf.subarray(1);
  if (flag === 0) return body.toString('utf8');
  if (flag === 1) { const raw = await zstdDecompress(body); return raw ? raw.toString('utf8') : null; }
  return null; // unknown framing → miss
}

// Stable content ETag for a serialized value (blake3, native worker). Null when the addon
// is absent — routes then just skip the ETag and send normally.
async function tag(json) {
  try { const h = await blake3Hex(Buffer.from(json, 'utf8')); return h || null; }
  catch { return null; }
}

// Core load path shared by cached() and cachedTagged(): resolves { val, etag }, coalescing
// concurrent misses onto one producer call and populating both tiers.
async function load(key, ttlMs, producer) {
  const now = Date.now();
  const hit = l1.get(key);
  if (hit && now - hit.at < hit.ttl) return { val: hit.val, etag: hit.etag };
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const r = getRedis();
      // L2: shared Redis copy — a value another replica already computed.
      if (r) {
        try {
          const raw = await r.getBuffer(PREFIX + key);
          const json = await decode(raw);
          if (json != null) {
            const val = JSON.parse(json);
            const etag = await tag(json);
            l1Set(key, { at: Date.now(), ttl: ttlMs, val, etag });
            return { val, etag };
          }
        } catch { /* Redis down / corrupt entry → fall through to producer */ }
      }
      const val = await producer();
      const json = JSON.stringify(val);
      const etag = await tag(json);
      l1Set(key, { at: Date.now(), ttl: ttlMs, val, etag });
      if (r) { try { await r.set(PREFIX + key, await encode(json), 'PX', ttlMs); } catch { /* ignore */ } }
      return { val, etag };
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, promise);
  return promise;
}

export async function cached(key, ttlMs, producer) {
  return (await load(key, ttlMs, producer)).val;
}

// Like cached(), but also returns the value's blake3 ETag (or null) for conditional GETs.
export async function cachedTagged(key, ttlMs, producer) {
  return load(key, ttlMs, producer);
}

// Route helper: send a cached JSON value with a blake3 ETag, and answer a matching
// If-None-Match with an empty 304 — so repeat visitors on hot public feeds revalidate
// instead of re-downloading the whole list (fewer bytes, lower p99 on the repeat hit).
// Any Cache-Control the route already set is preserved.
export async function replyCachedJson(req, reply, key, ttlMs, producer) {
  const { val, etag } = await cachedTagged(key, ttlMs, producer);
  if (etag) {
    const quoted = `"${etag}"`;
    reply.header('ETag', quoted);
    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === quoted)) {
      return reply.code(304).send();
    }
  }
  return reply.send(val);
}

// Drop a cached key from BOTH tiers after a write that invalidates it. Other replicas'
// L1 self-heals within its TTL (these are seconds-long public reads, so that's fine).
export function invalidate(key) {
  l1.delete(key);
  const r = getRedis();
  if (r) { try { r.del(PREFIX + key); } catch { /* ignore */ } }
}
