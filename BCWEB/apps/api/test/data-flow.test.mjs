// Where the data goes: route → model → read/write, joined with the guard.
//
// The test that carries the weight is the in-handler guard. bot.mjs authenticates with
// botAuth(req, reply) inside each handler rather than through a preHandler, so a map that
// only reads preHandler calls fifteen bot routes "writable by an unauthenticated request".
// A list that is mostly wrong is a list nobody finishes reading, which costs more than
// having no list.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findDbCalls, findInHandlerGuards, attribute, buildDataFlow } from '../src/lib/data-flow.mjs';
import { parseRoutes } from '../src/lib/rbac-map.mjs';

describe('findDbCalls', () => {
  test('a write and a read are told apart', () => {
    const calls = findDbCalls('await p.user.create({});\nawait p.user.findMany();');
    assert.deepEqual(calls.map((c) => [c.model, c.op, c.write]), [['user', 'create', true], ['user', 'findMany', false]]);
  });

  test('every write operation counts as one', () => {
    for (const op of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'])
      assert.equal(findDbCalls(`p.x.${op}(`)[0].write, true, op);
  });

  test('something that is not a model operation is not a call', () => {
    // $transaction and $queryRaw are not model calls, and `p.user.somethingElse` is not an
    // operation. Guessing here would put invented edges on a map somebody trusts.
    assert.deepEqual(findDbCalls('await p.$transaction([]);\np.user.somethingElse();'), []);
  });

  test('a commented-out query is not a query', () => {
    assert.deepEqual(findDbCalls('// await p.user.deleteMany();'), []);
  });

  test('the line is the line', () => {
    assert.equal(findDbCalls('\n\np.user.create(')[0].line, 3);
  });
});

describe('findInHandlerGuards', () => {
  test('a local function that rejects with 401 is a guard', () => {
    // Derived from the source, not a hardcoded list of names: a function that sends a 401
    // or a 403 is a guard whatever it is called.
    const src = "function botAuth(req, reply) { if (!ok) { reply.code(401).send({}); return false; } return true; }";
    assert.deepEqual([...findInHandlerGuards(src)], ['botAuth']);
  });

  test('a function that does not reject is not a guard', () => {
    assert.deepEqual([...findInHandlerGuards('function ser(row) { return { id: row.id }; }')], []);
  });
});

describe('attribute', () => {
  const ROUTES = [
    { verb: 'GET', path: '/a', line: 10, guard: { kind: 'none' }, file: 'f.mjs' },
    { verb: 'POST', path: '/b', line: 20, guard: { kind: 'role' }, file: 'f.mjs' },
  ];

  test('a call belongs to the route above it', () => {
    const { byRoute } = attribute(ROUTES, [{ model: 'user', op: 'create', write: true, line: 25 }]);
    assert.equal(byRoute[0].route, 'POST /b');
  });

  test('a call ABOVE the first route belongs to no route', () => {
    // Module-level helpers, sweepers and boot code. Folding them into the first route would
    // be a confident lie about who can reach them.
    const { byRoute, outsideRoutes } = attribute(ROUTES, [{ model: 'user', op: 'update', write: true, line: 3 }]);
    assert.deepEqual(byRoute, []);
    assert.equal(outsideRoutes.length, 1);
  });
});

describe('buildDataFlow', () => {
  // Padded between routes on purpose. parseRoutes looks for the guard in a SIX-LINE window
  // below the path — enough for every shape in the real files and not enough for a fixture
  // where routes sit four lines apart: the first version of this had /webhooks/x picking up
  // the `preHandler: requireRole('ADMIN')` belonging to the route underneath it, and the
  // test failed for a reason that exists nowhere in the codebase.
  const FILES = [{
    name: 'bot.mjs',
    src: [
      "function botAuth(req, reply) { reply.code(401).send({}); return false; }",
      '', '', '', '', '', '',
      "app.post('/bot/ping', async (req, reply) => {",
      '  if (!botAuth(req, reply)) return;',
      '  await p.adminSetting.update({});',
      '});',
      '', '', '', '', '', '',
      "app.post('/public/write', async (req, reply) => {",
      '  await p.newsletterSubscriber.create({});',
      '});',
      '', '', '', '', '', '',
      "app.post('/webhooks/x', async (req, reply) => {",
      "  if (!safeEqual(a, b)) return reply.code(401).send({});",
      '  await p.kofiDonation.create({});',
      '});',
      '', '', '', '', '', '',
      "app.get('/admin/thing', { preHandler: requireRole('ADMIN') }, async () => {",
      '  await p.user.findMany();',
      '});',
    ].join('\n'),
  }];

  test('a route guarded inside its handler is not called unauthenticated', () => {
    const m = buildDataFlow(FILES, parseRoutes);
    assert.deepEqual(m.writableInHandlerGuard.map((w) => w.route), ['POST /bot/ping']);
    assert.equal(m.writableUnauthenticated.some((w) => w.route === 'POST /bot/ping'), false);
  });

  test('a genuinely public write is listed', () => {
    const m = buildDataFlow(FILES, parseRoutes);
    const w = m.writableUnauthenticated.find((x) => x.route === 'POST /public/write');
    assert.deepEqual(w.models, ['newsletterSubscriber']);
    assert.equal(w.selfRejects, false);
  });

  test('an inline 401 is a FACT on the row, not a promotion to guarded', () => {
    // /webhooks/kofi safeEquals a token and 401s. /auth/login/2fa also 401s, on a failed
    // password check on a genuinely public endpoint. Identical shape, opposite meaning —
    // so the row carries the fact and no verdict is invented.
    const m = buildDataFlow(FILES, parseRoutes);
    const w = m.writableUnauthenticated.find((x) => x.route === 'POST /webhooks/x');
    assert.equal(w.selfRejects, true);
  });

  test('a guarded route contributes to the model map but not to either list', () => {
    const m = buildDataFlow(FILES, parseRoutes);
    assert.equal(m.models.some((x) => x.model === 'user'), true);
    assert.equal([...m.writableUnauthenticated, ...m.writableInHandlerGuard].some((w) => w.route === 'GET /admin/thing'), false);
  });

  test('a read-only public route is not a writable one', () => {
    const files = [{ name: 'f.mjs', src: "app.get('/feed', async () => { await p.post.findMany(); });" }];
    assert.deepEqual(buildDataFlow(files, parseRoutes).writableUnauthenticated, []);
  });
});
