// notify (agent-notify): the RSS/Atom feeds (lib/feeds.mjs, routes/notify.mjs).
//
// The personal feed URL is a credential, so most of this is about the token: it opens only its
// own account, a wrong secret and an unknown id look the same, rotating kills the old URL,
// revoking kills it for good, only a hash is stored, and the path never reaches a log. The rest
// is the XML: everything a member or an admin wrote is escaped, and characters XML forbids are
// dropped instead of breaking the document.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run the feed route tests';
process.env.JWT_SECRET ||= 'notify-feeds-test-secret';
process.env.SITE_URL = 'https://bettercommunity.example';
// Imported AFTER the env is set: lib.mjs reads JWT_SECRET when it loads, and a static import
// would load it before the line above runs.
const { xmlText, buildRss, buildAtom, etagOf } = await import('../src/lib/feeds.mjs');
const { redactPath } = await import('../src/lib/errorlog.mjs');

describe('XML escaping', () => {
  test('the five specials are escaped', () => {
    assert.equal(xmlText(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;');
  });

  test('characters XML 1.0 forbids are dropped, not passed through', () => {
    assert.equal(xmlText('a\u0000b\u0008c\u001Fd￾e'), 'abcde');
    assert.equal(xmlText('tab\tnl\ncr\r'), 'tab\tnl\ncr\r', 'tab, newline and return are legal');
    assert.equal(xmlText('lone \uD800 high, lone \uDC00 low'), 'lone  high, lone  low');
    assert.equal(xmlText('pair 😀 kept'), 'pair 😀 kept');
  });

  test('a hostile title cannot open an element or end a CDATA in the document', () => {
    const items = [{ id: '1', title: '</title><script>x</script>]]>', link: 'https://x.example/?a=1&b=2', description: '<img src=x onerror=alert(1)>', date: new Date('2026-09-01T00:00:00Z'), category: 'k&k' }];
    for (const doc of [buildRss({ title: 'T&T', link: 'https://x.example/', description: 'D' }, items), buildAtom({ title: 'T', link: 'https://x.example/', description: 'D' }, items)]) {
      assert.ok(!doc.includes('<script>'));
      assert.ok(!doc.includes('<img'));
      assert.ok(!doc.includes(']]>'));
      assert.ok(doc.includes('a=1&amp;b=2'));
      assert.ok(doc.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    }
  });

  test('RSS carries RFC 822 dates, Atom RFC 3339', () => {
    const items = [{ id: '1', title: 't', link: 'https://x.example/', date: new Date('2026-09-01T10:00:00Z') }];
    assert.match(buildRss({ title: 't', link: 'https://x.example/', description: 'd' }, items), /<pubDate>Tue, 01 Sep 2026 10:00:00 GMT<\/pubDate>/);
    assert.match(buildAtom({ title: 't', link: 'https://x.example/', description: 'd' }, items), /<updated>2026-09-01T10:00:00.000Z<\/updated>/);
  });

  test('the ETag is a quoted, stable function of the bytes', () => {
    assert.equal(etagOf('abc'), etagOf('abc'));
    assert.notEqual(etagOf('abc'), etagOf('abd'));
    assert.match(etagOf('abc'), /^"[A-Za-z0-9_-]+"$/);
  });

  test('the personal feed path is redacted in logs', () => {
    const logged = redactPath('/feeds/u/cmabc123def456.SECRETSECRETSECRETSECRETSECRET12.xml?lang=fr');
    assert.ok(!logged.includes('SECRET'), logged);
    assert.ok(!logged.includes('cmabc123def456'), 'the id half goes too');
  });
});

const MAIL = '@notify-feeds.test';
const RUNID = Date.now().toString(36);
let p, app, jwt, alice, bob, cookieA;

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  jwt = (await import('jsonwebtoken')).default;
  alice = await p.user.create({ data: { email: `alice-${RUNID}${MAIL}`, displayName: 'feed alice', emailVerified: true, locale: 'fr' } });
  bob = await p.user.create({ data: { email: `bob-${RUNID}${MAIL}`, displayName: 'feed bob', emailVerified: true } });
  const s = await p.session.create({ data: { userId: alice.id }, select: { id: true } });
  cookieA = `bcw_session=${jwt.sign({ uid: alice.id, role: 'USER', sid: s.id }, process.env.JWT_SECRET)}`;
  await p.notification.create({ data: { userId: alice.id, kind: 'announce', body: `Alice <b>&"only"</b> ${RUNID}`, bodyFr: `Pour Alice <b>&"seulement"</b> ${RUNID}`, href: '/blog/x' } });
  await p.notification.create({ data: { userId: bob.id, kind: 'announce', body: `Bob private ${RUNID}` } });
  await p.notification.create({ data: { userId: alice.id, kind: 'announce', body: `Expired ${RUNID}`, expiresAt: new Date(Date.now() - 1000) } });
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/notify.mjs')).default);
  await app.ready();
});

after(async () => {
  if (!RUN) return;
  const ids = [alice?.id, bob?.id].filter(Boolean);
  await p.notification.deleteMany({ where: { userId: { in: ids } } });
  await p.notificationSend.deleteMany({ where: { dedupeKey: { startsWith: `feed-${RUNID}` } } });
  await p.announcement.deleteMany({ where: { createdBy: `feed-test-${RUNID}` } });
  await p.feedToken.deleteMany({ where: { userId: { in: ids } } });
  await p.session.deleteMany({ where: { userId: { in: ids } } });
  await p.user.deleteMany({ where: { email: { endsWith: MAIL } } });
  await app?.close();
});

const fileOf = (url) => url.slice(url.indexOf('/feeds/u/') + '/feeds/u/'.length);

describe('the personal feed token', { skip }, () => {
  let first;

  test('minting returns the URLs once; only a hash is stored', async () => {
    const r = await app.inject({ method: 'POST', url: '/me/feed-token', headers: { cookie: cookieA } });
    assert.equal(r.statusCode, 200, r.body);
    first = r.json();
    assert.match(first.rss, /^https:\/\/bettercommunity\.example\/feeds\/u\/[a-z0-9]+\.[A-Za-z0-9_-]{43}\.xml$/);
    assert.match(first.atom, /\.atom$/);
    assert.equal(r.headers['cache-control'], 'no-store');
    const secret = fileOf(first.rss).split('.')[1];
    const row = await p.feedToken.findUnique({ where: { userId: alice.id } });
    assert.ok(row.secretHash && !row.secretHash.includes(secret), 'the secret itself is not stored');
    const st = (await app.inject({ method: 'GET', url: '/me/feed-token', headers: { cookie: cookieA } })).json();
    assert.equal(st.active, true);
    assert.ok(!JSON.stringify(st).includes(secret), 'the status never repeats the URL');
  });

  test('the feed shows this account, escaped, in its language, and nobody else', async () => {
    const r = await app.inject({ method: 'GET', url: `/feeds/u/${fileOf(first.rss)}` });
    assert.equal(r.statusCode, 200);
    assert.match(r.headers['content-type'], /^application\/rss\+xml/);
    assert.match(r.headers['cache-control'], /^private/);
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.ok(r.body.includes(`Pour Alice &lt;b&gt;&amp;&quot;seulement&quot;&lt;/b&gt; ${RUNID}`), 'French, because the account is French; escaped');
    assert.ok(!r.body.includes(`<b>`), 'nothing unescaped');
    assert.ok(!r.body.includes(`Bob private ${RUNID}`), "another account's notification never appears");
    assert.ok(!r.body.includes(`Expired ${RUNID}`), 'an expired notification is not in the feed');
    assert.ok(r.body.includes('https://bettercommunity.example/blog/x'));
    const en = await app.inject({ method: 'GET', url: `/feeds/u/${fileOf(first.rss)}?lang=en` });
    assert.ok(en.body.includes(`Alice &lt;b&gt;&amp;&quot;only&quot;&lt;/b&gt; ${RUNID}`));
    const atom = await app.inject({ method: 'GET', url: `/feeds/u/${fileOf(first.atom)}` });
    assert.equal(atom.statusCode, 200);
    assert.match(atom.headers['content-type'], /^application\/atom\+xml/);
    assert.ok(atom.body.includes('<feed xmlns="http://www.w3.org/2005/Atom"'));
  });

  test('ETag answers a matching If-None-Match with 304', async () => {
    const url = `/feeds/u/${fileOf(first.rss)}`;
    const r = await app.inject({ method: 'GET', url });
    assert.ok(r.headers.etag);
    const again = await app.inject({ method: 'GET', url, headers: { 'if-none-match': r.headers.etag } });
    assert.equal(again.statusCode, 304);
    assert.equal(again.body, '');
  });

  test('a wrong secret, an unknown id and a malformed name all answer the same 404', async () => {
    const [id, secret] = fileOf(first.rss).split('.');
    const wrong = secret.slice(0, -1) + (secret.endsWith('A') ? 'B' : 'A');
    for (const file of [`${id}.${wrong}.xml`, `zz${id.slice(2)}.${secret}.xml`, `${id}.${secret}.html`, 'nothing', `${id}.short.xml`]) {
      const r = await app.inject({ method: 'GET', url: `/feeds/u/${file}` });
      assert.equal(r.statusCode, 404, file);
      assert.equal(r.body, 'Not found');
    }
  });

  test('rotating kills the old URL; revoking kills the new one', async () => {
    const rot = (await app.inject({ method: 'POST', url: '/me/feed-token', headers: { cookie: cookieA } })).json();
    assert.notEqual(rot.rss, first.rss);
    assert.equal((await app.inject({ method: 'GET', url: `/feeds/u/${fileOf(first.rss)}` })).statusCode, 404, 'the old URL is dead');
    assert.equal((await app.inject({ method: 'GET', url: `/feeds/u/${fileOf(rot.rss)}` })).statusCode, 200);
    const del = await app.inject({ method: 'DELETE', url: '/me/feed-token', headers: { cookie: cookieA } });
    assert.equal(del.json().revoked, true);
    assert.equal((await app.inject({ method: 'GET', url: `/feeds/u/${fileOf(rot.rss)}` })).statusCode, 404, 'revoked');
    assert.equal((await app.inject({ method: 'GET', url: '/me/feed-token', headers: { cookie: cookieA } })).json().active, false);
  });

  test('a closed account has no feed, even with a valid token', async () => {
    const rot = (await app.inject({ method: 'POST', url: '/me/feed-token', headers: { cookie: cookieA } })).json();
    await p.user.update({ where: { id: alice.id }, data: { closedAt: new Date() } });
    try {
      assert.equal((await app.inject({ method: 'GET', url: `/feeds/u/${fileOf(rot.rss)}` })).statusCode, 404);
    } finally { await p.user.update({ where: { id: alice.id }, data: { closedAt: null } }); }
  });

  test('the token routes need a session', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/me/feed-token' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/me/feed-token' })).statusCode, 401);
  });
});

describe('the public news feed', { skip }, () => {
  test('public sends and active announcements, never a private send; ETag works', async () => {
    const N = await import('../src/lib/notify.mjs');
    await N.notify({ userIds: [bob.id], kind: 'announce', title: `Public & <loud> ${RUNID}`, public: true, dedupeKey: `feed-${RUNID}-pub` }, { p });
    await N.notify({ userIds: [bob.id], kind: 'announce', title: `Private ${RUNID}`, dedupeKey: `feed-${RUNID}-priv` }, { p });
    await p.announcement.create({ data: { title: `Banner ${RUNID}`, body: 'b', linkUrl: 'javascript:alert(1)', createdBy: `feed-test-${RUNID}` } });
    const { invalidate } = await import('../src/lib/cache.mjs');
    invalidate('feed:news:en:xml');
    const r = await app.inject({ method: 'GET', url: '/feeds/news.xml' });
    assert.equal(r.statusCode, 200);
    assert.match(r.headers['cache-control'], /^public/);
    assert.ok(r.body.includes(`Public &amp; &lt;loud&gt; ${RUNID}`));
    assert.ok(!r.body.includes(`Private ${RUNID}`));
    assert.ok(r.body.includes(`Banner ${RUNID}`));
    assert.ok(!r.body.includes('javascript:'), 'a non-http announcement link falls back to the site');
    const again = await app.inject({ method: 'GET', url: '/feeds/news.xml', headers: { 'if-none-match': r.headers.etag } });
    assert.equal(again.statusCode, 304);
    invalidate('feed:news:en:atom');
    const atom = await app.inject({ method: 'GET', url: '/feeds/news.atom' });
    assert.match(atom.headers['content-type'], /^application\/atom\+xml/);
  });
});
