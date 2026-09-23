// Demo mode: admin-only, invisible to everybody else, and gone when it is switched off.
//
// Three kinds of assertion, each aimed at a way this feature could quietly go wrong:
//
//   · WHO: every demo route refuses an anonymous visitor (401), a signed-in USER, a MOD and a
//     user holding every grantable capability (403), and an admin without 2FA (403
//     2fa_required) — WHILE a demo is running, so a refusal cannot be explained by "nothing to
//     show". The public catalogue routes are read in the same state and must carry no trace.
//   · OFF IS COMPLETE: after DELETE /admin/demo, nothing demo-mode made survives — including a
//     `demo.*` key it did not write itself (a future key somebody forgets to clean up) and the
//     in-memory action list. Proven by counting, not by the route's word.
//   · NO REAL SIDE EFFECTS: every database call the routes make is recorded, and the only
//     writes allowed are on AdminSetting. The import lists of lib/demo.mjs and routes/demo.mjs
//     are read for Stripe, mail, the bot and the network.
//
// Real HTTP through the real route plugin against the real database (needs DATABASE_URL, like
// CI). Fixtures are namespaced @demo-mode.test and removed afterwards; any `demo.*` settings
// row that existed before the run is put back exactly as it was.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run the demo-mode route tests';
process.env.JWT_SECRET ||= 'demo-mode-test-secret';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const demo = await import('../src/lib/demo.mjs');
const { DEMO_TAG, DEMO_KEY } = demo;

// ── Pure: no database ───────────────────────────────────────────────────────────────────

describe('one body of fixtures', () => {
  test('seed:demo imports the generator from lib/demo.mjs and has no word lists of its own', () => {
    const seed = read('seed-demo.mjs');
    assert.match(seed, /import\s*\{[^}]*generateCatalogItems[^}]*\}\s*from\s*'\.\/lib\/demo\.mjs'/);
    assert.doesNotMatch(seed, /const (ADJ|NOUN|TAGS|CATS)\s*=/, 'a second copy of the word lists is a second body of fixtures');
    assert.doesNotMatch(seed, /1103515245/, 'a second PRNG is a second body of fixtures');
  });
  test('the generator is deterministic and keeps the production shape (only plugins validated)', () => {
    const at = '2026-01-01T00:00:00.000Z';
    const a = demo.generateCatalogItems({ seed: 7, n: 60, at });
    assert.deepEqual(a, demo.generateCatalogItems({ seed: 7, n: 60, at }));
    assert.notDeepEqual(a, demo.generateCatalogItems({ seed: 8, n: 60, at }));
    for (const it of a) assert.equal('validation' in it.meta, it.kind === 'PLUGIN', `${it.kind} ${it.slug}`);
  });
});

describe('the dataset is marked by a field, everywhere', () => {
  const session = { id: `dm_${'a'.repeat(32)}`, seed: 1234, n: 30, startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  test('every record carries the tag and a demo-only id', () => {
    const d = demo.buildDemoData(session);
    assert.equal(d[DEMO_TAG], true);
    for (const list of ['users', 'catalog', 'posts', 'analytics']) {
      assert.ok(d[list].length > 0, list);
      for (const r of d[list]) assert.equal(r[DEMO_TAG], true, `${list} record without the tag`);
    }
    for (const u of d.users) assert.match(u.email, /@demo\.invalid$/, 'undeliverable by RFC 6761');
    for (const c of d.catalog) assert.match(c.id, /^demo-item-\d+$/);
    assert.equal(d.billing.provider, 'demo');
    assert.equal(d.discord.connected, false);
  });
  test('a hand-written row cannot ask for more than startDemo allows', () => {
    const d = demo.buildDemoData({ ...session, n: 1e9, expiresAt: '2099-01-01T00:00:00.000Z' });
    assert.equal(d.catalog.length, demo.MAX_ITEMS);
    assert.ok(Date.parse(d.session.expiresAt) <= Date.parse(session.startedAt) + demo.MAX_MINUTES * 60_000);
    assert.throws(() => demo.buildDemoData({ ...session, id: 'not-a-demo-id' }));
  });
});

describe('the wider dataset: every screen a demo is asked to show', () => {
  const session = { id: `dm_${'b'.repeat(32)}`, seed: 99, n: 40, startedAt: '2026-03-01T00:00:00.000Z', expiresAt: '2026-03-01T01:00:00.000Z' };
  const LISTS = ['users', 'catalog', 'posts', 'analytics', 'repos', 'conversations', 'staffLog'];

  test('the new sections exist, are non-empty, and are tagged like the old ones', () => {
    const d = demo.buildDemoData(session);
    for (const list of LISTS) {
      assert.ok(Array.isArray(d[list]) && d[list].length > 0, `${list} is empty`);
      for (const r of d[list]) assert.equal(r[DEMO_TAG], true, `${list} record without the tag`);
    }
    for (const nested of [d.economy.leaderboard, d.economy.shop, d.economy.transactions, d.moderation.queue, d.hosting.pools, d.hosting.invoices, d.traffic.referrers, d.traffic.countries, d.traffic.devices, d.traffic.topPages]) {
      assert.ok(nested.length > 0);
      for (const r of nested) assert.equal(r[DEMO_TAG], true);
    }
    for (const c of d.conversations) for (const m of c.messages) assert.equal(m[DEMO_TAG], true);
    // The totals are the numbers a screen puts in a tile, so they have to be real counts.
    assert.equal(d.totals.repos, d.repos.length);
    assert.equal(d.totals.openReports, d.moderation.queue.filter((r) => r.status === 'OPEN').length);
    assert.equal(d.totals.views30d, d.analytics.reduce((a, x) => a + x.views, 0));
  });

  test('nothing in it can be mistaken for, or used as, a real row', () => {
    const d = demo.buildDemoData(session);
    const ids = [
      ...d.repos.map((r) => r.id), ...d.hosting.pools.map((r) => r.id), ...d.hosting.invoices.map((r) => r.id),
      ...d.economy.shop.map((r) => r.id), ...d.economy.transactions.map((r) => r.id),
      ...d.moderation.queue.map((r) => r.id), ...d.conversations.map((r) => r.id), ...d.staffLog.map((r) => r.id),
    ];
    for (const id of ids) assert.match(id, /^demo-[a-z]+-\d+$/, `${id} is not a demo-shaped id`);
    // Money: a demo invoice must carry no processor id and must say what it is.
    for (const i of d.hosting.invoices) {
      assert.equal(i.provider, 'demo');
      assert.equal(JSON.stringify(i).includes('cs_'), false);
      assert.doesNotMatch(JSON.stringify(i), /\b(pi|sub|cus|in|price|prod)_[A-Za-z0-9]{8,}/);
    }
    // Mail: every address in the dataset is at the RFC 6761 domain that cannot resolve.
    for (const m of JSON.stringify(d).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) || []) {
      assert.match(m, /@demo\.invalid$/, `${m} is a deliverable-looking address`);
    }
  });

  test('a reload shows the same site: the whole dataset is a function of the seed', () => {
    assert.deepEqual(demo.buildDemoData(session), demo.buildDemoData(session));
    assert.notDeepEqual(demo.buildDemoData(session), demo.buildDemoData({ ...session, seed: 100 }));
  });
});

describe('no path from demo mode to Stripe, mail, the bot or the network', () => {
  const importsOf = (src) => [...src.matchAll(/^\s*import\s[^;]*?from\s*'([^']+)'/gms)].map((m) => m[1])
    .concat([...src.matchAll(/import\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]));
  for (const rel of ['lib/demo.mjs', 'routes/demo.mjs']) {
    test(rel, () => {
      const src = read(rel);
      const imps = importsOf(src);
      const allowed = rel === 'lib/demo.mjs' ? ['node:crypto', './lib.mjs'] : ['zod', '../lib/lib.mjs', '../lib/demo.mjs'];
      assert.deepEqual([...new Set(imps)].sort(), [...allowed].sort(), `unexpected import in ${rel}: ${imps.join(', ')}`);
      // Code only: comments and string literals say "never calls Stripe" on purpose.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n')
        .replace(/'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "''");
      const hit = code.match(/\bfetch\s*\(|\bsendMail\b|\bstripe\b|discord\.js|\bnew\s+Client\b|\bnotify(All)?\s*\(/i);
      assert.equal(hit, null, `${rel} reaches a side-effecting service: ${hit?.[0]}`);
    });
  }
  test('every route in routes/demo.mjs is behind requireRole(\'ADMIN\')', () => {
    const src = read('routes/demo.mjs');
    const routes = [...src.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,\s*\{\s*preHandler:\s*([^}]+?)\s*\}/g)];
    const all = [...src.matchAll(/app\.(get|post|put|patch|delete)\(/g)];
    assert.equal(routes.length, all.length, 'a route whose guard this test cannot read');
    for (const [, verb, p, guard] of routes) {
      assert.ok(p.startsWith('/admin/demo'), `${verb} ${p} is outside /admin/demo`);
      assert.equal(guard.trim(), "requireRole('ADMIN')", `${verb} ${p}`);
    }
  });
  test('the generic settings writer refuses demo.* keys', () => {
    assert.equal(demo.isDemoKey('demo.session'), true);
    assert.equal(demo.isDemoKey('demo.anything'), true);
    assert.equal(demo.isDemoKey('seo.title'), false);
    // The generic door's rules live in checkAdminSetting (so the config import applies the same
    // ones); the route must go through it, and it must refuse demo.* with a 409.
    const misc = read('routes/misc.mjs');
    assert.match(misc, /if \(isDemoKey\(key\)\) return refuse\(409, \{ error: 'use_demo_routes'/);
    assert.match(misc, /app\.put\('\/admin\/settings\/:key'[\s\S]{0,300}await checkAdminSetting\(p, req\.params\.key, value/);
  });
});

// ── Against the database ────────────────────────────────────────────────────────────────

const MAIL = '@demo-mode.test';
let p, app, jwt, saved = [];
const ops = [];           // every database call the demo routes made: 'model.operation'
const audits = [];        // what the routes asked to audit
const cookies = {};
const users = {};
let seq = 0;

// A Prisma handle that records every model call before making it.
function recording(real) {
  return new Proxy(real, {
    get(t, model) {
      const v = t[model];
      if (typeof model !== 'string' || model.startsWith('$') || !v || typeof v !== 'object') return typeof v === 'function' ? v.bind(t) : v;
      return new Proxy(v, {
        get(m, op) {
          const f = m[op];
          if (typeof f !== 'function') return f;
          return (...a) => { ops.push(`${model}.${String(op)}`); return f.apply(m, a); };
        },
      });
    },
  });
}
const WRITE = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|executeRaw)$/;

async function mkUser(role, over = {}) {
  const u = await p.user.create({ data: { email: `u${Date.now()}-${seq++}${MAIL}`, displayName: `demo-mode-${seq}`, role, emailVerified: true, ...over } });
  const s = await p.session.create({ data: { userId: u.id } });
  const token = jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { user: u, cookie: `bcw_session=${token}` };
}
const call = (who, opts) => app.inject({ ...opts, headers: { ...(opts.headers || {}), ...(who ? { cookie: cookies[who] } : {}) } });

const ROUTES = (sid = 'x') => [
  { method: 'GET', url: '/admin/demo' },
  { method: 'POST', url: '/admin/demo', payload: {} },
  { method: 'DELETE', url: '/admin/demo' },
  { method: 'GET', url: '/admin/demo/data' },
  { method: 'POST', url: '/admin/demo/actions', payload: { session: sid, action: 'publish' } },
];

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  // Whatever demo state the dev database had, keep it to put back.
  saved = await p.adminSetting.findMany({ where: { key: { startsWith: 'demo.' } } });
  await p.adminSetting.deleteMany({ where: { key: { startsWith: 'demo.' } } });

  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/demo.mjs')).default, {
    db: async () => recording(p),
    audit: async (_p, actor, action, detail) => { audits.push({ actor, action, detail }); },
  });
  await app.register((await import('../src/routes/catalog.mjs')).default);
  await app.register((await import('../src/routes/misc.mjs')).default);
  await app.ready();

  const everyCap = (await import('../src/lib/lib.mjs')).CAPABILITIES;
  for (const [k, role, over] of [
    ['admin', 'ADMIN', { totpEnabled: true }],
    ['super', 'SUPERADMIN', { totpEnabled: true }],
    ['admin2faOff', 'ADMIN', { totpEnabled: false }],
    ['mod', 'MOD', { totpEnabled: true }],
    ['user', 'USER', {}],
    ['granted', 'USER', { totpEnabled: true, permissions: everyCap }],
  ]) {
    const made = await mkUser(role, over);
    users[k] = made.user; cookies[k] = made.cookie;
  }
});

after(async () => {
  if (!RUN) return;
  try {
    await p.adminSetting.deleteMany({ where: { key: { startsWith: 'demo.' } } });
    for (const r of saved) await p.adminSetting.create({ data: { key: r.key, value: r.value } });
    const ids = (await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } })).map((u) => u.id);
    if (ids.length) {
      await p.notification.deleteMany({ where: { userId: { in: ids } } });
      await p.session.deleteMany({ where: { userId: { in: ids } } });
      await p.user.deleteMany({ where: { id: { in: ids } } });
    }
  } finally {
    await app?.close();
    await p?.$disconnect?.();
  }
});

describe('demo mode over HTTP', { skip }, () => {
  let session;

  test('an admin turns it on; status and data answer; nothing but AdminSetting is written', async () => {
    ops.length = 0;
    let r = await call('admin', { method: 'POST', url: '/admin/demo', payload: { minutes: 30, items: 40, label: 'test run' } });
    assert.equal(r.statusCode, 201, r.body);
    session = r.json().session;
    assert.match(session.id, /^dm_[0-9a-f]{32}$/);
    assert.equal(session.n, 40);
    assert.equal(audits.at(-1).action, 'demo.enable');

    r = await call('admin', { method: 'GET', url: '/admin/demo' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().active, true);
    assert.equal(r.headers['cache-control'], 'no-store, private');

    r = await call('admin', { method: 'GET', url: `/admin/demo/data?session=${session.id}` });
    assert.equal(r.statusCode, 200);
    const d = r.json();
    assert.equal(d[DEMO_TAG], true);
    assert.equal(d.catalog.length, 40);

    r = await call('super', { method: 'GET', url: '/admin/demo/data' });
    assert.equal(r.statusCode, 200, 'SUPERADMIN passes requireRole(ADMIN), as everywhere');

    r = await call('admin', { method: 'POST', url: '/admin/demo/actions', payload: { session: session.id, action: 'publish', note: 'demo-item-3' } });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().persisted, false);

    const writes = ops.filter((o) => WRITE.test(o));
    assert.ok(writes.length > 0, 'the recorder saw the enable');
    for (const w of writes) assert.ok(w.startsWith('adminSetting.'), `demo mode wrote outside AdminSetting: ${w}`);
  });

  test('RED if demo content is visible to a non-admin: every door refuses, while a demo is running', async () => {
    const live = await p.adminSetting.findUnique({ where: { key: DEMO_KEY } });
    assert.ok(live, 'precondition: a demo is running');
    const expect = { null: [401, 'unauthenticated'], user: [403, 'forbidden'], mod: [403, 'forbidden'], granted: [403, 'forbidden'], admin2faOff: [403, '2fa_required'] };
    for (const [who, [code, error]] of Object.entries(expect)) {
      for (const route of ROUTES(session.id)) {
        const r = await call(who === 'null' ? null : who, route);
        assert.equal(r.statusCode, code, `${who} ${route.method} ${route.url}: ${r.body}`);
        assert.equal(r.json().error, error, `${who} ${route.method} ${route.url}`);
        assert.ok(!r.body.includes(DEMO_TAG) && !r.body.includes(session.id), `${who} ${route.method} ${route.url} leaked demo content`);
      }
    }
    // Nothing a refused caller did changed the demo.
    assert.equal((await p.adminSetting.findUnique({ where: { key: DEMO_KEY } }))?.value?.id, session.id);
  });

  test('RED if demo content is visible to a non-admin: the public catalogue carries no trace of it', async () => {
    for (const who of [null, 'user', 'admin']) {
      for (const url of ['/catalog', '/catalog?take=500', '/catalog.json']) {
        const r = await call(who, { method: 'GET', url });
        assert.ok(r.statusCode < 500, `${url}: ${r.statusCode}`);
        assert.ok(!r.body.includes(DEMO_TAG), `${who} ${url} shows a demo-tagged object`);
        assert.ok(!r.body.includes('demo-item-') && !r.body.includes(session.id), `${who} ${url} shows demo content`);
      }
    }
  });

  test('the generic settings writer cannot plant or stretch a demo session', async () => {
    const r = await call('admin', { method: 'PUT', url: `/admin/settings/${DEMO_KEY}`, payload: { value: { id: session.id, seed: 1, n: 1e9 } } });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().error, 'use_demo_routes');
    assert.equal((await p.adminSetting.findUnique({ where: { key: DEMO_KEY } })).value.n, 40);
  });

  test('a stale session id is refused, not silently served a different demo', async () => {
    let r = await call('admin', { method: 'GET', url: `/admin/demo/data?session=dm_${'0'.repeat(32)}` });
    assert.equal(r.statusCode, 409);
    r = await call('admin', { method: 'POST', url: '/admin/demo/actions', payload: { session: `dm_${'0'.repeat(32)}`, action: 'ban' } });
    assert.equal(r.statusCode, 409);
  });

  test('RED if turning it off left something behind: one DELETE removes everything, counted afterwards', async () => {
    // Something demo mode might create in future and the author forgets to clean up: a second
    // key in the namespace. And an in-memory action list, which the enable test left.
    await p.adminSetting.create({ data: { key: 'demo.future-key', value: { leftover: true } } });
    assert.ok(demo.overlayCount() > 0, 'precondition: an action list exists');

    ops.length = 0;
    const r = await call('admin', { method: 'DELETE', url: '/admin/demo' });
    assert.equal(r.statusCode, 200, r.body);
    const body = r.json();
    assert.equal(body.active, false);
    assert.equal(body.removed.settings, 2);
    assert.equal(body.audit.clean, true);
    assert.equal(audits.at(-1).action, 'demo.disable');
    for (const w of ops.filter((o) => WRITE.test(o))) assert.ok(w.startsWith('adminSetting.'), w);

    // The proof is the tables and the process, not the route's word for it.
    assert.equal(await p.adminSetting.count({ where: { key: { startsWith: 'demo.' } } }), 0);
    assert.equal(demo.overlayCount(), 0);
    assert.equal((await demo.demoAudit(p)).clean, true);

    let g = await call('admin', { method: 'GET', url: '/admin/demo/data' });
    assert.equal(g.statusCode, 404);
    assert.equal(g.json().error, 'demo_off');
    g = await call('admin', { method: 'GET', url: '/admin/demo' });
    assert.equal(g.json().active, false);
    assert.equal(g.json().audit.clean, true);
  });

  test('turning it off twice is still success', async () => {
    const r = await call('admin', { method: 'DELETE', url: '/admin/demo' });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json().removed, { settings: 0, overlays: 0 });
  });

  test('an expired session removes itself on the next read', async () => {
    const s = await demo.startDemo(p, { byUserId: users.admin.id, minutes: 5, items: 5 });
    await p.adminSetting.update({ where: { key: DEMO_KEY }, data: { value: { ...s, expiresAt: new Date(Date.now() - 1000).toISOString() } } });
    const r = await call('admin', { method: 'GET', url: '/admin/demo' });
    assert.equal(r.json().active, false);
    assert.equal(await p.adminSetting.count({ where: { key: { startsWith: 'demo.' } } }), 0);
    assert.equal(demo.overlayCount(), 0);
  });

  test('RED if "off" hides a leftover: the check NAMES what it found, and finds nothing after a stop', async () => {
    // Plant one of everything demo mode is able to leave behind: the session itself, two more
    // keys in its namespace (a future key whose author forgot to clean it up), and a real
    // in-process action list with entries in it.
    const started = await call('admin', { method: 'POST', url: '/admin/demo', payload: { minutes: 15, items: 25 } });
    assert.equal(started.statusCode, 201, started.body);
    const sid = started.json().session.id;
    for (const a of ['publish', 'ban', 'refund']) {
      const r = await call('admin', { method: 'POST', url: '/admin/demo/actions', payload: { session: sid, action: a } });
      assert.equal(r.statusCode, 201, r.body);
    }
    await p.adminSetting.create({ data: { key: 'demo.leftover-a', value: { x: 1 } } });
    await p.adminSetting.create({ data: { key: 'demo.leftover-b', value: { x: 2 } } });

    // Before: the check must SAY what is there, not merely count it.
    const dirty = await demo.demoAudit(p);
    assert.equal(dirty.clean, false);
    assert.deepEqual(dirty.settingKeys, ['demo.leftover-a', 'demo.leftover-b', DEMO_KEY].sort());
    assert.equal(dirty.overlayEntries, 3);
    assert.ok(dirty.leftovers.some((l) => l.what === 'demo.leftover-a' && l.where === 'AdminSetting'));
    assert.ok(dirty.leftovers.some((l) => l.what.includes(sid)), 'the in-process list is named by its session');
    for (const l of dirty.leftovers) assert.ok(l.removedBy, `${l.what} does not say how it is removed`);
    // And it must say where it LOOKED, so a check that found nothing is distinguishable from
    // a check that looked nowhere.
    assert.deepEqual(dirty.checked.map((c) => c.where).sort(), ['AdminSetting', 'this API process']);

    // After: one DELETE, then count every place from scratch.
    const r = await call('admin', { method: 'DELETE', url: '/admin/demo' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().removed.settings, 3);
    assert.equal(r.json().audit.clean, true);
    assert.deepEqual(r.json().audit.leftovers, []);

    const after = await demo.demoAudit(p);
    assert.equal(after.clean, true);
    assert.deepEqual(after.settingKeys, []);
    assert.deepEqual(after.overlaySessions, []);
    assert.equal(after.overlayEntries, 0);
    assert.deepEqual(after.leftovers, []);
    assert.equal(await p.adminSetting.count({ where: { key: { startsWith: 'demo.' } } }), 0);
    assert.equal(demo.overlayCount(), 0);
    // Nothing of the demo reached a content table either: the wider dataset is served, never
    // written, so the rows it could have created do not exist to be counted.
    assert.equal(await p.catalogItem.count({ where: { slug: { startsWith: 'demo-' }, createdAt: { gte: new Date(Date.now() - 600_000) } } }), 0);
    assert.equal(await p.user.count({ where: { email: { endsWith: '@demo.invalid' } } }), 0);
  });

  test('a malformed row is treated as off and removed, never served', async () => {
    await p.adminSetting.create({ data: { key: DEMO_KEY, value: { id: 'x', seed: 'nope', n: 1e9 } } });
    const r = await call('admin', { method: 'GET', url: '/admin/demo/data' });
    assert.equal(r.statusCode, 404);
    assert.equal(await p.adminSetting.count({ where: { key: { startsWith: 'demo.' } } }), 0);
  });
});
