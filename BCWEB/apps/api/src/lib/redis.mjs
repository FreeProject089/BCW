// Shared Redis client (ioredis). Optional: if REDIS_URL is unset, everything that
// uses this degrades gracefully to in-process behaviour. A single lazy connection is
// reused across the cache + the rate limiter so multiple API replicas share state.
import Redis from 'ioredis';

let client = null;
let tried = false;

export function getRedis() {
  if (tried) return client;
  tried = true;
  const url = process.env.REDIS_URL;
  if (!url) return (client = null);
  try {
    client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false, // fail fast instead of buffering when Redis is down
      retryStrategy: (n) => Math.min(n * 200, 2000),
    });
    client.on('error', (e) => { if (!client._loggedErr) { client._loggedErr = true; console.warn('[redis] error (continuing without Redis):', e.message); } });
    client.on('ready', () => { client._loggedErr = false; });
  } catch (e) {
    console.warn('[redis] init failed (continuing without Redis):', e.message);
    client = null;
  }
  return client;
}

// A SECOND connection dedicated to SUBSCRIBE mode. A Redis connection in subscribe mode
// can't run normal commands, so pub/sub needs its own connection separate from getRedis()
// (which the cache + rate-limiter use for regular commands). Null when Redis is unset.
let subscriber = null;
let subTried = false;
export function getRedisSubscriber() {
  if (subTried) return subscriber;
  subTried = true;
  const main = getRedis();
  if (!main) return (subscriber = null);
  try {
    subscriber = main.duplicate();
    subscriber.on('error', (e) => { if (!subscriber._loggedErr) { subscriber._loggedErr = true; console.warn('[redis] subscriber error:', e.message); } });
    subscriber.on('ready', () => { subscriber._loggedErr = false; });
  } catch (e) {
    console.warn('[redis] subscriber init failed:', e.message);
    subscriber = null;
  }
  return subscriber;
}
