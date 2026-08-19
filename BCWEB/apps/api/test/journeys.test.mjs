// Journeys: several subsystems, in order, through real HTTP.
//
// The other integration tests call one function and assert one table. These drive the actual
// Fastify routes — cookies, preHandlers, capability checks, the API-key middleware — because
// every bug this file was written for lived in the seam between two of those, where a unit
// test looks green. Two examples that shipped: a sanction that froze sign-in when it was only
// meant to freeze the service, and a sandbox flag set one line too late, which filed console
// experiments as real errors.
//
// Needs a throwaway Postgres (DATABASE_URL), like webhook/pool-billing; skips cleanly without
// one, so a developer with no database still gets a green `npm test` that is honest about
// what it did not run.
//
// The app is assembled here rather than imported: src/server.mjs starts listening at import
// time, so importing it in a test would bind a port. Registering the route plugins gives the
// same routing and the same guards without the socket.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run journey tests';

process.env.JWT_SECRET ||= 'journey-test-secret';

let p, app, lib, argon2;

before(async () => {
  if (!RUN) return;
  lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  argon2 = (await import('argon2')).default;
  const Fastify = (await import('fastify')).default;
  const cookie = (await import('@fastify/cookie')).default;
  app = Fastify();
  await app.register(cookie);
  // The same recorder the server attaches, not a copy of its rule: what a call is *filed as*
  // is under test here (sandbox vs real traffic), so it must be the production classifier.
  (await import('../src/lib/apiusage.mjs')).registerApiUsageHook(app);
  await app.register((await import('../src/routes/auth.mjs')).default);
  await app.register((await import('../src/routes/misc.mjs')).default);
  await app.register((await import('../src/routes/api-keys.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  // Fixtures are namespaced by e-mail so a crashed run cannot leave a user behind that the
  // next run then trips over.
  const users = await p.user.findMany({ where: { email: { endsWith: '@journey.test' } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    const keys = await p.apiKey.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    const keyIds = keys.map((k) => k.id);
    await p.apiRequest.deleteMany({ where: { OR: [{ userId: { in: ids } }, { keyId: { in: keyIds } }] } });
    await p.apiUsageDay.deleteMany({ where: { OR: [{ userId: { in: ids } }, { keyId: { in: keyIds } }] } });
    await p.apiKey.deleteMany({ where: { userId: { in: ids } } });
    await p.notification.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
  }
  await app?.close();
  await p?.$disconnect?.();
});

// ── helpers ─────────────────────────────────────────────────────────────────────

let seq = 0;
const mkUser = async (over = {}) => p.user.create({
  data: {
    email: `j${Date.now()}-${seq++}@journey.test`,
    passwordHash: await argon2.hash('Passw0rd!journey', { type: argon2.argon2id }),
    displayName: 'journey', emailVerified: true, status: 'active', ...over,
  },
});

/** Log in over HTTP and return the session cookie. Deliberately not a minted JWT: the cookie
 *  a browser gets is the thing the guards actually read, and issuing one by hand would skip
 *  the code that decides whether a locked account may have one at all. */
async function login(email) {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Passw0rd!journey' } });
  const raw = r.cookies?.find((c) => c.name === 'bcw_session');
  return { status: r.statusCode, cookie: raw ? `bcw_session=${raw.value}` : null, body: r.json?.() };
}

const as = (cookie, opts) => app.inject({ headers: { cookie }, ...opts });

// ── sanctions ───────────────────────────────────────────────────────────────────

describe('sanctions freeze the right things', { skip }, () => {
  // The distinction the whole feature rests on: a suspension takes the SERVICE away, a ban
  // takes the ACCOUNT away. Asserted from both sides — a suspended user must still be able to
  // sign in and read their own account, or they cannot see why they were suspended, cancel a
  // subscription, or export anything.
  test('a suspended account can still sign in, but its API key is refused', async () => {
    const u = await mkUser();
    const { cookie } = await login(u.email);
    assert.ok(cookie, 'an active account gets a session');

    const key = await mintKey(u.id, ['account:read']);
    assert.equal((await callApi(key, '/v1/account')).statusCode, 200);

    await p.user.update({ where: { id: u.id }, data: { status: 'suspended' } });
    lib.clearAccountLockCache?.(u.id);

    const again = await login(u.email);
    assert.ok(again.cookie, 'sign-in still works while suspended');
    assert.equal((await as(again.cookie, { method: 'GET', url: '/me' })).statusCode, 200);

    const refused = await callApi(key, '/v1/account');
    assert.equal(refused.statusCode, 403, 'the service is frozen even though the account is not');
    assert.equal(refused.json().status, 'suspended');
  });

  test('a banned account cannot sign in at all', async () => {
    const u = await mkUser();
    const first = await login(u.email);
    assert.ok(first.cookie);

    await p.user.update({ where: { id: u.id }, data: { status: 'banned' } });
    lib.clearAccountLockCache?.(u.id);

    const after = await login(u.email);
    assert.equal(after.cookie, null, 'no session is issued to a banned account');
    // And an already-issued cookie stops working — a ban that only blocked the login form
    // would leave whoever was signed in exactly where they were. /me is a soft-auth route, so
    // "stops working" means it reads as signed-out rather than answering 403: the client then
    // shows the signed-out site instead of the account.
    const r = await as(first.cookie, { method: 'GET', url: '/me' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().user, null, 'a banned session must not resolve to an account');
    // A hard-auth route does refuse outright.
    const hard = await as(first.cookie, { method: 'GET', url: '/me/api-keys' });
    assert.equal(hard.statusCode, 403);
    assert.equal(hard.json().status, 'banned');
  });

  test('reactivating gives both back', async () => {
    const u = await mkUser({ status: 'banned' });
    assert.equal((await login(u.email)).cookie, null);
    await p.user.update({ where: { id: u.id }, data: { status: 'active' } });
    lib.clearAccountLockCache?.(u.id);
    assert.ok((await login(u.email)).cookie);
    const key = await mintKey(u.id, ['account:read']);
    assert.equal((await callApi(key, '/v1/account')).statusCode, 200);
  });
});

// ── API keys ────────────────────────────────────────────────────────────────────

/** Mint a key through the real endpoint, so the scope validation and the hashing under test
 *  are the ones the product uses. Returns the secret, which exists only in this response. */
async function mintKey(userId, scopes) {
  const u = await p.user.findUnique({ where: { id: userId }, select: { email: true } });
  const { cookie } = await login(u.email);
  const r = await as(cookie, { method: 'POST', url: '/me/api-keys', payload: { label: 'journey', scopes } });
  assert.equal(r.statusCode, 201, `key creation failed: ${r.payload}`);
  return r.json().secret;
}

// `headers` is merged last on purpose. Spreading `opts` after building the header object
// silently dropped the Authorization header whenever a caller passed headers of its own —
// three tests then failed with 401 and looked like a product bug.
const callApi = (secret, url, opts = {}) =>
  app.inject({ method: 'GET', url, ...opts, headers: { authorization: `Bearer ${secret}`, ...(opts.headers || {}) } });

describe('API keys carry exactly their scopes', { skip }, () => {
  test('a key without the scope is refused, and the refusal names it', async () => {
    const u = await mkUser();
    const key = await mintKey(u.id, ['account:read']);
    const r = await callApi(key, '/v1/pools');
    assert.equal(r.statusCode, 403);
    const b = r.json();
    assert.equal(b.error, 'insufficient_scope');
    assert.equal(b.required, 'pools:read');
    assert.deepEqual(b.granted, ['account:read']);
  });

  test('a deleted key is deleted, not just revoked', async () => {
    const u = await mkUser();
    const key = await mintKey(u.id, ['account:read']);
    const { cookie } = await login(u.email);
    const list = await as(cookie, { method: 'GET', url: '/me/api-keys' });
    const id = list.json().keys[0].id;

    const del = await as(cookie, { method: 'DELETE', url: `/me/api-keys/${id}` });
    assert.ok(del.statusCode >= 200 && del.statusCode < 300, `delete answered ${del.statusCode}`);
    assert.equal(await p.apiKey.count({ where: { id } }), 0, 'the row is gone, not flagged');
    assert.equal((await callApi(key, '/v1/account')).statusCode, 401);
  });
});

describe('the sandbox writes nothing', { skip }, () => {
  // The console's whole promise. A regression here is silent and expensive: somebody clicks
  // "try it" to learn the API and changes their own account instead.
  test('a sandbox write is answered, and the record is untouched', async () => {
    const u = await mkUser({ bio: 'before' });
    const key = await mintKey(u.id, ['account:write']);
    const r = await callApi(key, '/v1/account', {
      method: 'PATCH', payload: { bio: 'AFTER' },
      headers: { 'x-bcw-sandbox': '1', 'content-type': 'application/json' },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().sandbox, true);
    const fresh = await p.user.findUnique({ where: { id: u.id }, select: { bio: true } });
    assert.equal(fresh.bio, 'before', 'the sandbox must not write');
  });

  test('a sandbox call still obeys the scopes, and is still recorded as sandbox', async () => {
    const u = await mkUser();
    const key = await mintKey(u.id, ['account:read']); // NOT account:write
    const r = await callApi(key, '/v1/account', {
      method: 'PATCH', payload: { bio: 'x' },
      headers: { 'x-bcw-sandbox': '1', 'content-type': 'application/json' },
    });
    // Refused, because a console that skipped the scope check would be teaching an API that
    // does not exist — and the refusal is the row the sandbox view is built to show, so it
    // must be classified as sandbox rather than as real traffic.
    assert.equal(r.statusCode, 403);
    const { recordedSandbox } = await lastRecord(u.id);
    assert.equal(recordedSandbox, true);
  });

  test('a GET is never simulated', async () => {
    const u = await mkUser();
    const key = await mintKey(u.id, ['account:read']);
    const r = await callApi(key, '/v1/account', { headers: { 'x-bcw-sandbox': '1' } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().sandbox, undefined, 'a read changes nothing, so there is nothing to simulate');
  });
});

/**
 * The usage recorder buffers and flushes on a timer; flush it by hand and read THIS test's row
 * back, so "was it filed as sandbox" is answered by the table rather than by the response.
 *
 * Scoped to the user whose call it was. It used to read the newest row in the entire table,
 * which made it a coin toss: `at` has millisecond precision, several tests call the API inside
 * the same millisecond, and the tie resolves however Postgres feels. That is the whole reason
 * this suite failed intermittently on a change that touched none of it — and an intermittent
 * failure teaches everybody to re-run rather than to look.
 */
async function lastRecord(userId) {
  const { flushApiUsage } = await import('../src/lib/apiusage.mjs');
  await flushApiUsage();
  const row = await p.apiRequest.findFirst({
    ...(userId ? { where: { userId } } : {}),
    // `id` breaks the tie when two rows share a millisecond. cuid is monotonic within a
    // process, so the newest really is the newest.
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    select: { sandbox: true, status: true },
  });
  return { recordedSandbox: row?.sandbox, status: row?.status };
}

// ── notification preferences ────────────────────────────────────────────────────

describe('notification preferences stop the write', { skip }, () => {
  test('a muted category creates nothing, and the locked one cannot be muted', async () => {
    const u = await mkUser();
    const { cookie } = await login(u.email);

    const muted = await as(cookie, { method: 'PUT', url: '/me/notification-prefs', payload: { category: 'repos', enabled: false } });
    assert.equal(muted.statusCode, 200);
    const locked = await as(cookie, { method: 'PUT', url: '/me/notification-prefs', payload: { category: 'security', enabled: false } });
    assert.equal(locked.statusCode, 409, 'a security notice cannot be switched off');

    await lib.notify(p, u.id, 'repo_online', 'muted');
    await lib.notify(p, u.id, 'account_locked', 'not muted');
    await lib.notify(p, u.id, 'kind_nobody_has_seen', 'unknown kinds are delivered, not dropped');

    const kinds = (await p.notification.findMany({ where: { userId: u.id }, select: { kind: true } })).map((n) => n.kind).sort();
    assert.deepEqual(kinds, ['account_locked', 'kind_nobody_has_seen']);
  });

  // notifyAll means ALL — it is the behaviour under test, so this necessarily writes one
  // row for every account in the database it runs against, not only the two created here.
  //
  // That is fine in CI, where the database is thrown away. It was not fine here: this suite
  // runs against the developer's own database, and 559 copies of "a broadcast" had piled up
  // across five days of test runs, arriving in the real notification bell as the same
  // message over and over with nothing to explain it.
  //
  // The body is unique to this test and the rows are removed after it, so the assertion is
  // unchanged and the side effect does not outlive the run.
  test('a broadcast skips the accounts that muted it', async (t) => {
    const BODY = 'a broadcast (test fixture)';
    t.after(() => p.notification.deleteMany({ where: { body: BODY } }).catch(() => {}));
    const quiet = await mkUser({ notifPrefs: { broadcasts: false } });
    const loud = await mkUser();
    await lib.notifyAll(p, 'event', BODY);
    const got = async (id) => p.notification.count({ where: { userId: id, body: BODY } });
    assert.equal(await got(quiet.id), 0);
    assert.equal(await got(loud.id), 1);
  });
});

// ── the staff wall ──────────────────────────────────────────────────────────────

describe('staff-only routes refuse a member', { skip }, () => {
  test('/admin/pending is 403 for a signed-in member', async () => {
    const u = await mkUser();
    const { cookie } = await login(u.email);
    const r = await as(cookie, { method: 'GET', url: '/admin/pending' });
    assert.equal(r.statusCode, 403);
  });

  // 401 with no cookie, 403 with one that is simply not staff — the distinction matters to
  // the client, which turns 401 into "sign in" and 403 into "you cannot". What is being
  // guarded against is either of them becoming 200, or a missing cookie becoming a 500.
  test('and 401 with no session at all — not 500, not 200', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/admin/pending' })).statusCode, 401);
  });
});
