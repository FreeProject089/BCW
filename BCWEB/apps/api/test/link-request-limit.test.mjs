// The pairing-code request limit on POST /link/request.
//
// For a v4 creator id never seen with a v5 key, anyone may still ask for that id's pairing code
// — kept on purpose, for clients with no v5 key. What must not be free is doing it at scale, so
// the route now charges every request against its client IP and every UNPROVEN request against
// the creator id it names. The residual risk is written out at the route.
//
// The counter is in-process, so the pure function is tested with its own map (no shared state
// between cases) and the route is tested end to end once, which is what proves it is wired.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the /link/request limit test';
process.env.JWT_SECRET ||= 'link-limit-test-secret';

const links = await import('../src/routes/links.mjs');
const { hitLinkLimit, LINK_REQUEST_WINDOW_MS, LINK_REQUEST_MAX_PER_ID, LINK_REQUEST_MAX_PER_IP } = links;

describe('the limit itself', () => {
  test('allows exactly `max` in a window, then refuses with a wait', () => {
    const map = new Map();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) assert.equal(hitLinkLimit('k', 3, now, map).ok, true, `hit ${i + 1}`);
    const over = hitLinkLimit('k', 3, now, map);
    assert.equal(over.ok, false);
    assert.equal(over.retryAfterSec, LINK_REQUEST_WINDOW_MS / 1000);
  });

  test('the window rolls: the same key is allowed again once it has passed', () => {
    const map = new Map();
    const now = 1_000_000;
    hitLinkLimit('k', 1, now, map);
    assert.equal(hitLinkLimit('k', 1, now + LINK_REQUEST_WINDOW_MS - 1, map).ok, false);
    assert.equal(hitLinkLimit('k', 1, now + LINK_REQUEST_WINDOW_MS, map).ok, true);
  });

  test('keys are independent, and the map stays bounded', () => {
    const map = new Map();
    assert.equal(hitLinkLimit('a', 1, 0, map).ok, true);
    assert.equal(hitLinkLimit('b', 1, 0, map).ok, true, 'one id must not spend another id’s budget');
    for (let i = 0; i < 25_000; i++) hitLinkLimit(`k${i}`, 5, i, map);
    assert.ok(map.size <= 20_000, `unbounded counter under a flood: ${map.size}`);
  });
});

let p, app;
const CID = `linklimit-fixture-${Date.now()}`;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register(links.default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  await p.linkCode.deleteMany({ where: { creatorId: { startsWith: 'linklimit-fixture-' } } });
  await app?.close();
  await p?.$disconnect?.();
});

describe('POST /link/request (db)', { skip }, () => {
  test('an unproven caller gets a code, then is cut off per creator id', async () => {
    const ask = (creatorId, ip) => app.inject({
      method: 'POST', url: '/link/request',
      headers: { 'x-forwarded-for': ip },
      payload: { creatorId },
    });

    // Each call comes from a DIFFERENT address, so what stops it can only be the per-id limit.
    let last;
    for (let i = 0; i < LINK_REQUEST_MAX_PER_ID; i++) {
      last = await ask(CID, `203.0.113.${i + 1}`);
      assert.equal(last.statusCode, 200, last.body);
      assert.ok(last.json().code, 'a v4 id with no key pin still gets its code — compatibility, on purpose');
    }
    const over = await ask(CID, '203.0.113.200');
    assert.equal(over.statusCode, 429, over.body);
    assert.equal(over.json().error, 'rate_limited');
    assert.ok(over.json().retryAfterSec > 0);

    // A different id from a fresh address is unaffected: the limit is per id, not global.
    const other = await ask(`${CID}-other`, '203.0.113.201');
    assert.equal(other.statusCode, 200, other.body);
  });

  test('and per IP, across different ids', async () => {
    const ip = '203.0.113.250';
    let refused = null;
    for (let i = 0; i < LINK_REQUEST_MAX_PER_IP + 1 && !refused; i++) {
      const r = await app.inject({ method: 'POST', url: '/link/request', headers: { 'x-forwarded-for': ip }, payload: { creatorId: `${CID}-ip-${i}` } });
      if (r.statusCode === 429) refused = r;
    }
    assert.ok(refused, `one address enumerated ${LINK_REQUEST_MAX_PER_IP + 1} creator ids without being stopped`);
  });

  test('the residual risk is written down at the route', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/routes/links.mjs'), 'utf8');
    assert.match(src, /RESIDUAL RISK/, 'a deliberate hole with no comment is an accident to the next reader');
  });
});
