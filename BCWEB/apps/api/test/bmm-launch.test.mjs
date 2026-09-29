// notify (agent-notify): the BMM launch feed (lib/bmm-launch.mjs, routes/bmm-launch.mjs).
//
// GET /bmm/launch is a contract another agent codes against (contracts-laya-notify.md), so the
// shape is pinned key by key. Then what decides whether a card is shown: dates, versions, the
// switch, the language; that only https leaves; that `rev` moves when what the card SAYS
// changes and not when its display settings do; and the ETag.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sharedBmmProject } from './helpers/shared-project.mjs';

process.env.JWT_SECRET ||= 'bmm-launch-test-secret';
process.env.SITE_URL = 'https://bettercommunity.example';
const L = await import('../src/lib/bmm-launch.mjs');
const R = await import('../src/routes/bmm-launch.mjs');

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run the launch feed route tests';

describe('versions', () => {
  test('semver precedence, pre-releases included', () => {
    assert.equal(L.compareSemver('1.2.3', '1.2.3'), 0);
    assert.equal(L.compareSemver('1.2.3', '1.10.0'), -1);
    assert.equal(L.compareSemver('2.0.0', '1.99.99'), 1);
    assert.equal(L.compareSemver('1.0.0-beta.2', '1.0.0'), -1);
    assert.equal(L.compareSemver('1.0.0-beta.2', '1.0.0-beta.10'), -1);
    assert.equal(L.compareSemver('1.0.0-alpha', '1.0.0-beta'), -1);
    assert.equal(L.compareSemver('v1.2.3', '1.2.3'), 0);
  });

  test('min/max bounds are inclusive; an unknown version is not filtered', () => {
    const item = { minVersion: '1.4.0', maxVersion: '2.0.0' };
    assert.equal(L.matchesVersion(item, '1.3.9'), false);
    assert.equal(L.matchesVersion(item, '1.4.0'), true);
    assert.equal(L.matchesVersion(item, '2.0.0'), true);
    assert.equal(L.matchesVersion(item, '2.0.1'), false);
    assert.equal(L.matchesVersion(item, ''), true);
    assert.equal(L.matchesVersion(item, 'not-a-version'), true);
  });
});

describe('URLs', () => {
  test('only absolute https leaves, checked by parsing', () => {
    assert.equal(L.httpsUrl('https://bettercommunity.example/blog/x'), 'https://bettercommunity.example/blog/x');
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'http://example.com/', '\tjavascript:alert(1)', 'https://user:pw@example.com/', '//example.com/x', '/blog/x', 'vbscript:x', '']) {
      assert.equal(L.httpsUrl(bad), null, bad);
    }
  });

  test('a site link is https on a real site, and http only for a local development site', () => {
    assert.equal(L.siteLink('/blog/x'), 'https://bettercommunity.example/blog/x');
    const saved = process.env.SITE_URL;
    try {
      process.env.SITE_URL = 'http://localhost:5176';
      assert.equal(L.siteLink('/blog/x'), 'http://localhost:5176/blog/x');
      process.env.SITE_URL = 'http://bettercommunity.example';
      assert.equal(L.siteLink('/blog/x'), null, 'plain http on a real host is refused');
    } finally { process.env.SITE_URL = saved; }
  });
});

describe('the document', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const content = (o = {}) => ({ kind: 'custom', title: 'Hello', titleFr: 'Bonjour', summary: 'Sum', summaryFr: 'Résumé', url: 'https://bettercommunity.example/x', imageUrl: null, publishedAt: '2026-09-20T00:00:00.000Z', ...o });
  const item = (o = {}) => ({ id: 'i1', rev: 3, enabled: true, displayMode: 'times', times: 3, startsAt: null, endsAt: null, minVersion: null, maxVersion: null, priority: 0, ...o });
  const snap = (list) => ({ at: '2026-09-29T11:59:00.000Z', list });

  test('the contract shape, key by key', () => {
    const doc = R.launchDocument(snap([{ item: item(), content: content() }]), { version: '1.5.0', lang: 'en', now });
    assert.deepEqual(Object.keys(doc).sort(), ['generatedAt', 'items', 'v']);
    assert.equal(doc.v, 1);
    const [it] = doc.items;
    assert.deepEqual(Object.keys(it).sort(), ['display', 'id', 'imageUrl', 'kind', 'priority', 'publishedAt', 'rev', 'summary', 'title', 'url'].sort());
    assert.deepEqual(Object.keys(it.display).sort(), ['from', 'maxVersion', 'minVersion', 'mode', 'times', 'until'].sort());
    assert.deepEqual(it, {
      id: 'i1', rev: 3, kind: 'custom', title: 'Hello', summary: 'Sum', url: 'https://bettercommunity.example/x', imageUrl: null,
      publishedAt: '2026-09-20T00:00:00.000Z',
      display: { mode: 'times', times: 3, from: null, until: null, minVersion: null, maxVersion: null }, priority: 0,
    });
  });

  test('French where it exists, English otherwise', () => {
    const fr = R.launchDocument(snap([{ item: item(), content: content() }, { item: item({ id: 'i2' }), content: content({ titleFr: null, summaryFr: null }) }]), { lang: 'fr', now });
    assert.equal(fr.items.find((x) => x.id === 'i1').title, 'Bonjour');
    assert.equal(fr.items.find((x) => x.id === 'i1').summary, 'Résumé');
    assert.equal(fr.items.find((x) => x.id === 'i2').title, 'Hello');
  });

  test('dates: not before `from`, not from `until` on', () => {
    const list = [
      { item: item({ id: 'future', startsAt: '2026-10-01T00:00:00Z' }), content: content() },
      { item: item({ id: 'past', endsAt: '2026-09-29T11:00:00Z' }), content: content() },
      { item: item({ id: 'now', startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' }), content: content() },
      { item: item({ id: 'off', enabled: false }), content: content() },
    ];
    assert.deepEqual(R.launchDocument(snap(list), { lang: 'en', now }).items.map((x) => x.id), ['now']);
  });

  test('versions filter on the server when BMM says which one it runs', () => {
    const list = [
      { item: item({ id: 'old-only', maxVersion: '1.9.9' }), content: content() },
      { item: item({ id: 'new-only', minVersion: '2.0.0' }), content: content() },
      { item: item({ id: 'any' }), content: content() },
    ];
    assert.deepEqual(R.launchDocument(snap(list), { version: '2.1.0', lang: 'en', now }).items.map((x) => x.id).sort(), ['any', 'new-only']);
    assert.deepEqual(R.launchDocument(snap(list), { version: '1.0.0', lang: 'en', now }).items.map((x) => x.id).sort(), ['any', 'old-only']);
    assert.equal(R.launchDocument(snap(list), { version: '', lang: 'en', now }).items.length, 3);
  });

  test('display modes map to the contract: once = 1, always = null', () => {
    const d = (m) => R.launchDocument(snap([{ item: item({ displayMode: m, times: 5 }), content: content() }]), { lang: 'en', now }).items[0].display;
    assert.deepEqual([d('once').mode, d('once').times], ['once', 1]);
    assert.deepEqual([d('always').mode, d('always').times], ['always', null]);
    assert.deepEqual([d('times').mode, d('times').times], ['times', 5]);
  });

  test('priority first, then newest; a non-https link never leaves', () => {
    const list = [
      { item: item({ id: 'low-new', priority: 0 }), content: content({ publishedAt: '2026-09-28T00:00:00Z' }) },
      { item: item({ id: 'high', priority: 5 }), content: content({ publishedAt: '2026-01-01T00:00:00Z' }) },
      { item: item({ id: 'low-old', priority: 0 }), content: content({ publishedAt: '2026-09-01T00:00:00Z' }) },
      { item: item({ id: 'evil', priority: 9 }), content: content({ url: 'javascript:alert(1)' }) },
    ];
    assert.deepEqual(R.launchDocument(snap(list), { lang: 'en', now }).items.map((x) => x.id), ['high', 'low-new', 'low-old']);
  });

  test('the ETag follows the items, not the clock', () => {
    const a = R.launchDocument(snap([{ item: item(), content: content() }]), { lang: 'en', now });
    const b = R.launchDocument({ ...snap([{ item: item(), content: content() }]), at: '2030-01-01T00:00:00Z' }, { lang: 'en', now });
    const c = R.launchDocument(snap([{ item: item({ rev: 4 }), content: content() }]), { lang: 'en', now });
    assert.equal(R.launchEtag(a), R.launchEtag(b));
    assert.notEqual(R.launchEtag(a), R.launchEtag(c));
  });

  test('a blog excerpt becomes plain text of at most 400 characters', () => {
    assert.equal(L.plainSummary('**Big** [news](https://x) ![img](y) `code`'), 'Big news code');
    assert.equal(L.plainSummary('x'.repeat(500)).length, 400);
  });

  test('cross-field problems are named', () => {
    assert.equal(R.itemProblem({ source: 'custom', title: 'T', url: 'javascript:alert(1)' }), 'url_must_be_https');
    assert.equal(R.itemProblem({ source: 'custom', title: 'T', url: 'http://example.com' }), 'url_must_be_https');
    assert.equal(R.itemProblem({ source: 'custom', title: '', url: 'https://example.com' }), 'title_required');
    assert.equal(R.itemProblem({ source: 'custom', title: 'T', url: 'https://example.com', imageUrl: 'data:image/png;base64,xx' }), 'image_must_be_https');
    assert.equal(R.itemProblem({ source: 'post', postId: null }), 'post_required');
    assert.equal(R.itemProblem({ source: 'latest', startsAt: '2026-10-02T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' }), 'dates_reversed');
    assert.equal(R.itemProblem({ source: 'latest', minVersion: '2.0.0', maxVersion: '1.0.0' }), 'versions_reversed');
    assert.equal(R.itemProblem({ source: 'custom', title: 'T', url: 'https://example.com', imageUrl: '/uploads/a.png' }), null);
  });
});

// ── Over HTTP, against the database ─────────────────────────────────────────────────────

const MAIL = '@bmm-launch.test';
const RUNID = Date.now().toString(36);
let p, app, jwt, admin, cookie, savedCfg, project, invalidate;

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  jwt = (await import('jsonwebtoken')).default;
  ({ invalidate } = await import('../src/lib/cache.mjs'));
  savedCfg = await p.adminSetting.findUnique({ where: { key: L.LAUNCH_CONFIG_KEY } });
  await p.adminSetting.upsert({ where: { key: L.LAUNCH_CONFIG_KEY }, create: { key: L.LAUNCH_CONFIG_KEY, value: { enabled: true } }, update: { value: { enabled: true } } });
  admin = await p.user.create({ data: { email: `admin-${RUNID}${MAIL}`, displayName: 'launch admin', role: 'ADMIN', totpEnabled: true, emailVerified: true, status: 'active' } });
  const s = await p.session.create({ data: { userId: admin.id }, select: { id: true } });
  cookie = `bcw_session=${jwt.sign({ uid: admin.id, role: 'ADMIN', sid: s.id }, process.env.JWT_SECRET)}`;
  project = await sharedBmmProject(p); // shared, never deleted: see the helper
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register(R.default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  await p.bmmLaunchItem.deleteMany({ where: { createdById: admin?.id || '-' } });
  await p.blogPost.deleteMany({ where: { authorId: admin?.id || '-' } });
  if (savedCfg) await p.adminSetting.update({ where: { key: L.LAUNCH_CONFIG_KEY }, data: { value: savedCfg.value } });
  else await p.adminSetting.deleteMany({ where: { key: L.LAUNCH_CONFIG_KEY } });
  // The admin routes write the audit chain; a test actor's entries go with the test actor.
  await p.auditLogEntry.deleteMany({ where: { actor: { email: { endsWith: MAIL } } } }).catch(() => {});
  await p.session.deleteMany({ where: { userId: admin?.id || '-' } });
  await p.user.deleteMany({ where: { email: { endsWith: MAIL } } });
  await app?.close();
});

const mine = (doc, id) => doc.items.find((x) => x.id === id);
const launch = async (q = '', headers = {}) => { invalidate('bmm-launch:resolved'); return app.inject({ method: 'GET', url: `/bmm/launch${q}`, headers }); };
const CARD = { source: 'custom', title: `Card ${RUNID}`, titleFr: `Carte ${RUNID}`, summary: 'Read this', url: 'https://bettercommunity.example/news', displayMode: 'times', times: 3 };

describe('GET /bmm/launch and the admin routes', { skip }, () => {
  let id;

  test('a custom card with a javascript:, data: or http link is refused', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'http://example.com/']) {
      const r = await app.inject({ method: 'POST', url: '/admin/bmm-launch/items', headers: { cookie }, payload: { ...CARD, url } });
      assert.equal(r.statusCode, 400, url);
      assert.equal(r.json().error, 'url_must_be_https');
    }
  });

  test('the admin routes need the capability', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/admin/bmm-launch/items', payload: CARD })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/admin/bmm-launch' })).statusCode, 401);
  });

  test('a saved card is served, in both languages, with an ETag', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/bmm-launch/items', headers: { cookie }, payload: CARD });
    assert.equal(r.statusCode, 201, r.body);
    id = r.json().item.id;
    const g = await launch('?version=1.0.0&lang=en');
    assert.equal(g.statusCode, 200);
    assert.match(g.headers['cache-control'], /public/);
    const it = mine(g.json(), id);
    assert.ok(it, 'served');
    assert.equal(it.rev, 1);
    assert.equal(it.kind, 'custom');
    assert.equal(it.title, `Card ${RUNID}`);
    assert.equal(it.url, 'https://bettercommunity.example/news');
    assert.equal(mine((await launch('?lang=fr')).json(), id).title, `Carte ${RUNID}`);
    const again = await launch('?version=1.0.0&lang=en', { 'if-none-match': g.headers.etag });
    assert.equal(again.statusCode, 304);
  });

  test('changing what it says moves rev; changing how often it shows does not', async () => {
    await app.inject({ method: 'PUT', url: `/admin/bmm-launch/items/${id}`, headers: { cookie }, payload: { ...CARD, times: 5 } });
    assert.equal(mine((await launch()).json(), id).rev, 1, 'display settings are not content');
    await app.inject({ method: 'PUT', url: `/admin/bmm-launch/items/${id}`, headers: { cookie }, payload: { ...CARD, times: 5, title: `Card v2 ${RUNID}` } });
    const it = mine((await launch()).json(), id);
    assert.equal(it.rev, 2, 'a new title is a new message');
    assert.equal(it.display.times, 5);
  });

  test('a version outside the bounds, or a card not yet live, is not served', async () => {
    await app.inject({ method: 'PUT', url: `/admin/bmm-launch/items/${id}`, headers: { cookie }, payload: { ...CARD, title: `Card v2 ${RUNID}`, minVersion: '3.0.0' } });
    assert.equal(mine((await launch('?version=2.5.0')).json(), id), undefined);
    assert.ok(mine((await launch('?version=3.1.0')).json(), id));
    await app.inject({ method: 'PUT', url: `/admin/bmm-launch/items/${id}`, headers: { cookie }, payload: { ...CARD, title: `Card v2 ${RUNID}`, startsAt: new Date(Date.now() + 86400e3).toISOString() } });
    assert.equal(mine((await launch()).json(), id), undefined);
  });

  test('"the newest BMM post" follows the blog, and a new post is a new rev', async () => {
    const mk = (slug, when) => p.blogPost.create({ data: { projectId: project.id, authorId: admin.id, title: `Post ${slug}`, slug: `${slug}-${RUNID}`, body: 'x', excerpt: '**Bold** start', cover: '/uploads/c.png', status: 'PUBLISHED', publishedAt: when } });
    await mk('first', new Date(Date.now() + 1000 * 60 * 60 * 24 * 365)); // newest by far, so no other suite's post wins
    const r = await app.inject({ method: 'POST', url: '/admin/bmm-launch/items', headers: { cookie }, payload: { source: 'latest', projectKey: 'bmm', displayMode: 'once' } });
    assert.equal(r.statusCode, 201, r.body);
    const lid = r.json().item.id;
    const it = mine((await launch()).json(), lid);
    assert.equal(it.kind, 'blog');
    assert.equal(it.title, 'Post first');
    assert.equal(it.summary, 'Bold start');
    assert.equal(it.url, `https://bettercommunity.example/blog/first-${RUNID}`);
    assert.equal(it.imageUrl, 'https://bettercommunity.example/uploads/c.png');
    assert.equal(it.rev, 1);
    await mk('second', new Date(Date.now() + 1000 * 60 * 60 * 24 * 366));
    const it2 = mine((await launch()).json(), lid);
    assert.equal(it2.title, 'Post second');
    assert.equal(it2.rev, 2, 'a new latest post resets the display count');
  });

  test('switched off, the feed is empty', async () => {
    await app.inject({ method: 'PUT', url: '/admin/bmm-launch/config', headers: { cookie }, payload: { enabled: false } });
    assert.deepEqual((await launch()).json().items, []);
    await app.inject({ method: 'PUT', url: '/admin/bmm-launch/config', headers: { cookie }, payload: { enabled: true } });
  });

  test('the preview resolves an unsaved card exactly as BMM would get it', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/bmm-launch/preview', headers: { cookie }, payload: CARD });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().en.title, `Card ${RUNID}`);
    assert.equal(r.json().fr.title, `Carte ${RUNID}`);
  });

  test('delete', async () => {
    assert.equal((await app.inject({ method: 'DELETE', url: `/admin/bmm-launch/items/${id}`, headers: { cookie } })).statusCode, 200);
    assert.equal(mine((await launch()).json(), id), undefined);
  });
});
