// Live traffic for catalogues, pools and the whole platform (lib/access-traffic.mjs).
//
// Two things this suite exists to keep true, both of which fail quietly:
//
//   · A catalogue's ?k= is its PRIVATE SHARE LINK. Recording traffic must never write it
//     down, and no traffic response may carry it (CWE-532) — only `keyed`, a boolean.
//   · A pool's traffic lists client IPs for every repo and catalogue in it. Somebody who
//     does not own the pool must get a 404, not the list; and staff read it through the
//     2FA-gated admin route, not the owner one.
//
// The pure half runs everywhere; the HTTP half needs DATABASE_URL (as CI provides) and
// deletes every row it made.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
// JWT_SECRET before anything imports lib.mjs, which reads it once at load: a static import of
// access-traffic.mjs (which imports lib.mjs) would be hoisted above this line.
process.env.JWT_SECRET ||= 'traffic-test-secret';
const { catalogAccessRow, shapeTraffic, pruneAccessEvents } = await import('../src/lib/access-traffic.mjs');

const SECRET = 'sk_TEST_share_key_do_not_log_12';

describe('catalogAccessRow (pure)', () => {
  const cat = { id: 'cat1', shareKey: SECRET };
  test('a valid share key becomes keyed:true and is not in the row', () => {
    const row = catalogAccessRow(cat, { query: { k: SECRET }, headers: {} }, { path: 'catalog.json', kind: 'connect', identity: { ip: '203.0.113.9' } });
    assert.equal(row.keyed, true);
    assert.equal(row.path, 'catalog.json');
    assert.equal(row.ip, '203.0.113.9');
    assert.ok(!JSON.stringify(row).includes(SECRET), 'the share key must never reach a stored row');
    assert.deepEqual(Object.keys(row).sort(), ['catalogId', 'discordId', 'ip', 'keyed', 'kind', 'path', 'userId']);
  });
  test('a wrong or absent key is keyed:false; an unknown kind is stored as connect', () => {
    assert.equal(catalogAccessRow(cat, { query: { k: 'nope' }, headers: {} }, { path: 'x', kind: 'download', identity: {} }).keyed, false);
    assert.equal(catalogAccessRow(cat, { query: {}, headers: {} }, { path: 'x', kind: 'download', identity: {} }).keyed, false);
    assert.equal(catalogAccessRow({ id: 'c', shareKey: null }, { query: { k: '' }, headers: {} }, { path: 'x', kind: 'weird', identity: {} }).kind, 'connect');
  });
});

describe('shapeTraffic (pure)', () => {
  test('merges both tables newest-first, rolls up by subject and by pool', () => {
    const t0 = Date.now();
    const out = shapeTraffic({
      recentRepo: [{ id: 'r1', serverRepoId: 'R', ip: '1', path: 'repo.json', kind: 'connect', userId: null, discordId: null, createdAt: new Date(t0 - 1000), accessKey: 'sandbox' }],
      recentCatalog: [{ id: 'c1', catalogId: 'C', ip: '2', path: 'catalog.json', kind: 'connect', keyed: true, userId: null, discordId: null, createdAt: new Date(t0) }],
      rollupRepo: [{ serverRepoId: 'R', _count: { _all: 3 } }],
      rollupCatalog: [{ catalogId: 'C', _count: { _all: 5 } }, { catalogId: 'X', _count: { _all: 1 } }],
      repoMeta: new Map([['R', { name: 'Repo', owner: 'o', poolId: 'G' }]]),
      catalogMeta: new Map([['C', { name: 'Cat', slug: 'cat', owner: 'o', poolId: 'G' }], ['X', { name: 'Raw', slug: 'raw', owner: 'o', poolId: null }]]),
    });
    assert.deepEqual(out.recent.map((e) => [e.id, e.source, e.keyed]), [['c1', 'catalog', true], ['r1', 'repo', null]]);
    assert.ok(!('accessKey' in out.recent[1]), 'the repo sandbox key is not part of an aggregated view');
    assert.deepEqual(out.rollup.map((r) => [r.source, r.subjectId, r.count]), [['catalog', 'C', 5], ['repo', 'R', 3], ['catalog', 'X', 1]]);
    assert.deepEqual(out.pools, [{ poolId: 'G', repos: 1, catalogs: 1, count: 8 }, { poolId: null, repos: 0, catalogs: 1, count: 1 }]);
    assert.deepEqual(out.totals, { recent: 2, repo24h: 3, catalog24h: 6, all24h: 9 });
  });
});

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run the catalogue/pool traffic tests';

const MAIL = '@traffic.test';
let p, app, jwt;
let admin, owner, stranger, pool, repo, cat, shareKey;
let adminC, ownerC, strangerC;

async function cookieFor(u) {
  const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
  return `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET)}`;
}
const as = (cookie, opts) => app.inject({ headers: { cookie }, ...opts });
// Recording is fire-and-forget (it must never slow or fail a download), so wait for the row.
async function waitForCount(where, n) {
  for (let i = 0; i < 50; i++) {
    if ((await p.catalogAccessEvent.count({ where })) >= n) return;
    await new Promise((r) => setTimeout(r, 40));
  }
}

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  jwt = (await import('jsonwebtoken')).default;
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/catalogs.mjs')).default);
  await app.register((await import('../src/routes/repos.mjs')).default);
  await app.ready();

  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // A staff fixture needs totpEnabled: every admin route goes through ensure2fa.
  admin = await p.user.create({ data: { email: `a${stamp}${MAIL}`, displayName: 'traffic admin', role: 'SUPERADMIN', totpEnabled: true, emailVerified: true, status: 'active' } });
  owner = await p.user.create({ data: { email: `o${stamp}${MAIL}`, displayName: 'traffic owner', emailVerified: true, status: 'active' } });
  stranger = await p.user.create({ data: { email: `s${stamp}${MAIL}`, displayName: 'traffic stranger', emailVerified: true, status: 'active' } });
  [adminC, ownerC, strangerC] = await Promise.all([cookieFor(admin), cookieFor(owner), cookieFor(stranger)]);

  pool = await p.hostingGroup.create({ data: { ownerId: owner.id, name: `Traffic pool ${stamp}` } });
  repo = await p.serverRepo.create({ data: { name: `traffic repo ${stamp}`, ownerId: owner.id, groupId: pool.id, hosted: false, status: 'OFFLINE', repoUrl: 'https://example.org/repo.json', contactEmail: `r${MAIL}` } });
  shareKey = `${SECRET}${stamp}`;
  cat = await p.communityCatalog.create({ data: { name: `traffic cat ${stamp}`, slug: `traffic-${stamp}`, ownerId: owner.id, groupId: pool.id, mode: 'managed', kinds: ['app'], visibility: 'private', listed: false, shareKey } });
  await p.repoAccessEvent.create({ data: { serverRepoId: repo.id, ip: '198.51.100.7', accessKey: 'sandbox-key', path: 'repo.json', kind: 'connect' } });
});

after(async () => {
  if (!RUN) return;
  const users = await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    // Access events cascade from their catalogue / repo.
    await p.communityCatalog.deleteMany({ where: { ownerId: { in: ids } } });
    await p.serverRepo.deleteMany({ where: { ownerId: { in: ids } } });
    await p.hostingGroup.deleteMany({ where: { ownerId: { in: ids } } });
    await p.notification.deleteMany({ where: { userId: { in: ids } } });
    await p.session.deleteMany({ where: { userId: { in: ids } } });
    await p.user.deleteMany({ where: { id: { in: ids } } });
  }
  await app?.close();
  await p?.$disconnect?.();
});

describe('catalogue + pool traffic over HTTP', { skip }, () => {
  test('a served feed is recorded with keyed:true and no trace of the share key; a refused one is not recorded', async () => {
    let r = await app.inject({ method: 'GET', url: `/c/${cat.slug}/catalog.json?k=wrong`, headers: { 'x-forwarded-for': '10.0.0.1, 203.0.113.9' } });
    assert.equal(r.statusCode, 403, r.body);
    r = await app.inject({ method: 'GET', url: `/c/${cat.slug}/catalog.json?k=${encodeURIComponent(shareKey)}`, headers: { 'x-forwarded-for': '10.0.0.1, 203.0.113.9' } });
    assert.equal(r.statusCode, 200, r.body);
    await waitForCount({ catalogId: cat.id }, 1);
    const rows = await p.catalogAccessEvent.findMany({ where: { catalogId: cat.id } });
    assert.equal(rows.length, 1, 'only the served request is recorded, not the refused one');
    assert.equal(rows[0].keyed, true);
    assert.equal(rows[0].path, 'catalog.json');
    assert.equal(rows[0].kind, 'connect');
    assert.equal(rows[0].ip, '203.0.113.9', 'same IP rule as repos: the LAST x-forwarded-for hop (the one our proxy appended)');
    assert.ok(!JSON.stringify(rows[0]).includes(shareKey), 'the stored row must not contain the share key');
  });

  test('the owner reads their catalogue and pool; the key is in neither response', async () => {
    let r = await as(ownerC, { method: 'GET', url: `/me/catalogs/${cat.id}/traffic` });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(!r.body.includes(shareKey), 'catalogue traffic response leaked the share key');
    const c = r.json();
    assert.deepEqual(c.catalog, { id: cat.id, name: cat.name, slug: cat.slug });
    assert.equal(c.recent.length, 1);
    assert.equal(c.recent[0].keyed, true);
    assert.equal(c.recent[0].source, 'catalog');

    r = await as(ownerC, { method: 'GET', url: `/me/hosting/groups/${pool.id}/traffic` });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(!r.body.includes(shareKey), 'pool traffic response leaked the share key');
    assert.ok(!r.body.includes('sandbox-key'), 'a repo sandbox key is not part of the pool view');
    const g = r.json();
    assert.equal(g.pool.id, pool.id);
    assert.deepEqual(g.recent.map((e) => e.source).sort(), ['catalog', 'repo'], 'a pool view covers its repos AND its catalogues');
    assert.equal(g.totals.all24h, 2);
    assert.deepEqual(g.pools, [{ poolId: pool.id, repos: 1, catalogs: 1, count: 2 }]);
  });

  test('somebody else\'s pool and catalogue are a 404 — and staff are sent to the admin route', async () => {
    for (const url of [`/me/hosting/groups/${pool.id}/traffic`, `/me/catalogs/${cat.id}/traffic`]) {
      const r = await as(strangerC, { method: 'GET', url });
      assert.equal(r.statusCode, 404, `a stranger read ${url}: ${r.body}`);
      assert.ok(!r.body.includes('203.0.113.9'), 'no client IP in the refusal');
      const s = await as(adminC, { method: 'GET', url });
      assert.equal(s.statusCode, 404, `staff must use the 2FA-gated admin route, not ${url}`);
    }
    for (const url of ['/admin/hosting/traffic', `/admin/hosting/groups/${pool.id}/traffic`, '/admin/catalogs/traffic', `/admin/catalogs/${cat.id}/traffic`]) {
      const r = await as(strangerC, { method: 'GET', url });
      assert.equal(r.statusCode, 403, `a non-staff account reached ${url}: ${r.body}`);
    }
  });

  test('the admin pool, catalogue and global views; the repo view keeps its shape', async () => {
    let r = await as(adminC, { method: 'GET', url: `/admin/hosting/groups/${pool.id}/traffic` });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().totals.all24h, 2);

    r = await as(adminC, { method: 'GET', url: '/admin/hosting/traffic' });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(!r.body.includes(shareKey));
    const gl = r.json();
    const mine = gl.pools.find((x) => x.poolId === pool.id);
    assert.ok(mine, 'the global view rolls traffic up per pool');
    assert.equal(mine.name, pool.name);
    assert.equal(mine.count, 2);
    assert.ok(gl.recent.some((e) => e.subjectId === cat.id) && gl.recent.some((e) => e.subjectId === repo.id));

    r = await as(adminC, { method: 'GET', url: '/admin/catalogs/traffic' });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(r.json().recent.every((e) => e.source === 'catalog'), 'the catalogue view has no repo rows');

    r = await as(adminC, { method: 'GET', url: `/admin/catalogs/${cat.id}/traffic` });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().recent.length, 1);

    r = await as(adminC, { method: 'GET', url: '/admin/repos/traffic' });
    assert.equal(r.statusCode, 200, r.body);
    const ev = r.json().recent.find((e) => e.repoId === repo.id);
    assert.deepEqual(Object.keys(ev).sort(), ['at', 'discordId', 'id', 'ip', 'kind', 'path', 'repo', 'repoId', 'userId'], 'the pre-existing repo response shape did not change');
    assert.ok(r.json().recent.every((e) => 'repoId' in e), 'no catalogue rows leak into the repo view');
    const roll = r.json().rollup.find((x) => x.repoId === repo.id);
    assert.deepEqual(Object.keys(roll).sort(), ['count', 'name', 'owner', 'repoId']);
  });

  test('retention prunes catalogue events past 30 days, like repo events', async () => {
    const old = await p.catalogAccessEvent.create({ data: { catalogId: cat.id, ip: '192.0.2.1', path: 'catalog.json', kind: 'connect', createdAt: new Date(Date.now() - 31 * 864e5) } });
    await pruneAccessEvents(p, 'catalog', cat.id);
    assert.equal(await p.catalogAccessEvent.count({ where: { id: old.id } }), 0, 'the 31-day-old event survived');
    assert.equal(await p.catalogAccessEvent.count({ where: { catalogId: cat.id } }), 1, 'a fresh event was pruned');
  });
});
