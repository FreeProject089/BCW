// End-to-end checks against a RUNNING server: real HTTP, real routing, real auth middleware.
//
// Why these live apart from test/*.test.mjs and out of `npm test`: those run against the
// database directly and CI has no server, so folding these in would turn CI red for a reason
// that has nothing to do with the change under review. Run them with `npm run test:e2e`.
//
// They are read-only on purpose. This suite is expected to be pointed at a developer's live
// stack — the user's own dev database — so it must never create, mutate or delete anything.
// Coverage that needs a session is asserted from the OUTSIDE (does the wall hold?) rather than
// by logging in, which would mean handling a password.
//
// If no server answers, every test SKIPS rather than fails: a missing server is not a broken
// build, and a suite that goes red when you simply have not started anything trains you to
// ignore it. It says so LOUDLY, because a fully-skipped run still exits 0 and would otherwise
// look exactly like a pass.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const BASE = (process.env.E2E_BASE_URL || 'http://localhost:5176').replace(/\/$/, '');

const get = (path, init) => fetch(`${BASE}${path}`, { redirect: 'manual', ...init });

// Probed at MODULE LOAD with top-level await, not in a `before` hook. node:test evaluates a
// test's `skip` option while collecting the file, which happens BEFORE hooks run — so setting
// this flag from a hook left all 16 tests skipped no matter what, and the run still exited 0.
// Measured: that is exactly what the first version of this file did.
const up = await (async () => {
  try { return (await get('/api/health', { signal: AbortSignal.timeout(4000) })).ok; }
  catch { return false; }
})();
if (!up) {
  console.error('\n  ┌─ [e2e] NOTHING WAS TESTED ────────────────────────────────');
  console.error(`  │ No server answered at ${BASE}`);
  console.error('  │ Start the stack, or set E2E_BASE_URL.');
  console.error('  └───────────────────────────────────────────────────────────\n');
}

describe('health and routing', () => {
  test('GET /api/health is 200', { skip: !up }, async () => {
    const r = await get('/api/health');
    assert.equal(r.status, 200);
  });

  // The discriminator the auth tests below depend on: an unknown route must 404, so a 401
  // really does mean "this route exists and refused me" rather than "this route is missing".
  test('an unknown API route is 404, not 401', { skip: !up }, async () => {
    const r = await get('/api/definitely-not-a-route-xyz');
    assert.equal(r.status, 404);
  });
});

describe('authentication wall', () => {
  // Every one of these was added recently. The failure this guards against is a route that
  // silently loses its preHandler and starts answering 200 to anyone.
  const guarded = [
    '/api/admin/pending',
    '/api/admin/hosting/pools',
    '/api/admin/catalog',
    '/api/me/catalogs',
    '/api/me/reports/some-id/stream',
    '/api/myo/requests/some-id/stream',
  ];
  for (const path of guarded) {
    test(`${path} refuses an anonymous caller`, { skip: !up }, async () => {
      const r = await get(path);
      assert.ok(r.status === 401 || r.status === 403,
        `expected 401/403 for an anonymous caller, got ${r.status}`);
    });
  }

  test('PATCH /api/admin/catalog/:id refuses an anonymous caller', { skip: !up }, async () => {
    const r = await get('/api/admin/catalog/some-id', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'nope' }),
    });
    assert.ok(r.status === 401 || r.status === 403, `expected 401/403, got ${r.status}`);
  });
});

describe('official catalog feed (what BMM reads)', () => {
  // BMM consumes one feed per kind, each with its own payload shape. The array key IS the
  // contract: renaming it silently empties the catalog in every installed copy of BMM.
  for (const [kind, key] of [['plugin', 'plugins'], ['theme', 'themes'], ['app', 'apps']]) {
    test(`?kind=${kind} returns a ${key} array`, { skip: !up }, async () => {
      const r = await get(`/api/catalog.json?project=bmm&kind=${kind}`);
      assert.equal(r.status, 200);
      const body = await r.json();
      assert.ok(Array.isArray(body[key]), `expected body.${key} to be an array, got ${typeof body[key]}`);
      assert.equal(typeof body.version, 'string');
    });
  }

  test('an unknown project does not widen the query to every project', { skip: !up }, async () => {
    const r = await get('/api/catalog.json?project=not-a-project&kind=plugin');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.plugins));
    assert.equal(body.plugins.length, 0, 'an unvalidated project key used to return EVERY project’s items');
  });
});

describe('community catalogs', () => {
  test('GET /api/c lists catalogs', { skip: !up }, async () => {
    const r = await get('/api/c');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(Array.isArray(body.catalogs));
  });

  // One catalog serves ONE kind. Asking a catalog for a kind it does not serve must say so,
  // not return an empty-but-successful feed that reads as "this catalog is broken".
  test('a foreign ?kind= is refused by name', { skip: !up }, async () => {
    const list = await (await get('/api/c')).json();
    const cat = list.catalogs?.[0];
    if (!cat) return; // nothing hosted here yet — nothing to assert against
    const own = String(cat.kind || cat.kinds?.[0] || 'app').toLowerCase();
    const foreign = ['plugin', 'theme', 'app'].find((k) => k !== own);
    const r = await get(`/api/c/${encodeURIComponent(cat.slug)}/catalog.json?kind=${foreign}`);
    assert.equal(r.status, 404);
    const body = await r.json();
    assert.equal(body.error, 'unsupported_type');
    assert.equal(String(body.supported).toLowerCase(), own);
  });

  test('the bare feed URL — the one pasted into BMM — serves the catalog’s own kind', { skip: !up }, async () => {
    const list = await (await get('/api/c')).json();
    const cat = list.catalogs?.[0];
    if (!cat) return;
    const r = await get(`/api/c/${encodeURIComponent(cat.slug)}/catalog.json`);
    assert.equal(r.status, 200);
    const body = await r.json();
    const own = String(cat.kind || cat.kinds?.[0] || 'app').toLowerCase();
    const key = { plugin: 'plugins', theme: 'themes', app: 'apps', preset: 'presets' }[own];
    assert.ok(Array.isArray(body[key]), `expected body.${key} for a ${own} catalog`);
  });
});
