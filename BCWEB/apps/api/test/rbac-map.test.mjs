// The RBAC map. Pure text in, structure out — no database, no server.
//
// These exist because the first version of this parser knew four of the seven guard forms
// and reported twenty PROPERLY GUARDED /admin routes as unguarded. A security report that is
// wrong in the alarming direction is worse than none: it is the kind people stop reading
// after the first false alarm, and then miss the real one.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoutes, buildRbacMap, isPublicByDesign } from '../src/lib/rbac-map.mjs';

const file = (src) => [{ name: 'x.mjs', src }];

describe('parseRoutes', () => {
  test('a capability guard, with its extra roles', () => {
    const [r] = parseRoutes('x.mjs', "app.get('/admin/x', { preHandler: requireCap('manage_users', 'MOD') }, h);");
    assert.equal(r.verb, 'GET');
    assert.equal(r.path, '/admin/x');
    assert.equal(r.guard.kind, 'cap');
    assert.equal(r.guard.capability, 'manage_users');
    assert.deepEqual(r.guard.alsoRoles, ['MOD']);
  });

  test('SEVERAL roles — the case that broke the first version', () => {
    // requireRole('MOD', 'ADMIN') is common here. A single-argument pattern misses every
    // one of them and calls the route unguarded.
    const [r] = parseRoutes('x.mjs', "app.get('/admin/catalog', { preHandler: requireRole('MOD', 'ADMIN') }, h);");
    assert.equal(r.guard.kind, 'role');
    assert.deepEqual(r.guard.roles, ['MOD', 'ADMIN']);
  });

  test('requireRole() with no argument means signed in, not unguarded', () => {
    const [r] = parseRoutes('x.mjs', "app.post('/me/thing', { preHandler: requireRole() }, h);");
    assert.equal(r.guard.kind, 'signed-in');
  });

  test('an API key and an OAuth bearer are guards too', () => {
    const [a] = parseRoutes('x.mjs', "app.get('/v1/x', { preHandler: apiAuth('read') }, h);");
    const [b] = parseRoutes('x.mjs', "app.get('/oidc/x', { preHandler: oauthBearer() }, h);");
    assert.equal(a.guard.kind, 'api-key');
    assert.equal(b.guard.kind, 'oauth');
  });

  test('optionalAuth is NOT counted as protection', () => {
    // It fills req.user when a session exists and lets the request through either way. That
    // is legitimate — /me answers { user: null } — and it is also how a route ends up open
    // by accident, so it must never read as guarded.
    const [r] = parseRoutes('x.mjs', "app.get('/me', { preHandler: optionalAuth() }, h);");
    assert.equal(r.guard.kind, 'optional');
  });

  test('a guard on the following line is still found', () => {
    const src = [
      "app.post('/admin/y', {",
      "    preHandler: requireCap('manage_repos', 'ADMIN'),",
      '    config: { rateLimit: { max: 5 } },',
      '  }, h);',
    ].join('\n');
    const [r] = parseRoutes('x.mjs', src);
    assert.equal(r.guard.kind, 'cap');
    assert.equal(r.guard.capability, 'manage_repos');
  });

  test('no guard is reported as none, not guessed at', () => {
    const [r] = parseRoutes('x.mjs', "app.get('/public', async () => ({ ok: true }));");
    assert.equal(r.guard.kind, 'none');
  });
});

describe('buildRbacMap', () => {
  test('an unguarded /admin route is suspicious', () => {
    const m = buildRbacMap(file("app.get('/admin/secret', async () => ({}));"));
    assert.equal(m.suspicious.length, 1);
    assert.equal(m.suspicious[0].route, 'GET /admin/secret');
  });

  test('a guarded one is not', () => {
    const m = buildRbacMap(file("app.get('/admin/secret', { preHandler: requireRole('MOD', 'ADMIN') }, h);"));
    assert.equal(m.suspicious.length, 0);
    assert.deepEqual(m.byRole[0], { role: 'MOD or ADMIN', paths: ['GET /admin/secret'] });
  });

  test('an /me route carrying only optionalAuth IS suspicious', () => {
    // Added because a mutation exposed the gap: parseRoutes was tested for classifying
    // optionalAuth correctly, and nothing checked that buildRbacMap then treats it as
    // unprotected. Removing `|| kind === 'optional'` from the branch broke no test, which
    // means that behaviour — the whole reason optionalAuth is called out separately — was
    // decorative.
    const m = buildRbacMap(file("app.get('/me/secret', { preHandler: optionalAuth() }, h);"));
    assert.equal(m.suspicious.length, 1);
    assert.equal(m.suspicious[0].route, 'GET /me/secret');
  });

  test('a public feed is unguarded and NOT suspicious', () => {
    // A report where every public endpoint is a finding is one nobody reads twice.
    const m = buildRbacMap(file("app.get('/repos.json', async () => ({}));"));
    assert.equal(m.unguarded.length, 1);
    assert.equal(m.suspicious.length, 0);
  });

  test('capabilities are grouped and sorted by how much they guard', () => {
    const m = buildRbacMap(file([
      "app.get('/a', { preHandler: requireCap('manage_users') }, h);",
      "app.get('/b', { preHandler: requireCap('manage_users') }, h);",
      "app.get('/c', { preHandler: requireCap('manage_faq') }, h);",
    ].join('\n')));
    assert.equal(m.byCapability[0].capability, 'manage_users');
    assert.equal(m.byCapability[0].paths.length, 2);
  });

  test('isPublicByDesign matches a prefix, since feeds carry parameters', () => {
    assert.equal(isPublicByDesign('/catalog.json'), true);
    assert.equal(isPublicByDesign('/auth/login'), true);
    assert.equal(isPublicByDesign('/admin/users'), false);
  });
});
