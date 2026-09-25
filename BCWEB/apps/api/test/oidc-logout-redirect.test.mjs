// POST /oauth2/logout is not an open redirect.
//
// The trigger, as it was: a page on any site auto-submits
//
//     <form method="POST" action="https://<site>/oauth2/logout">
//       <input name="redirect" value="https://evil.example/login">
//
// The browser sends no cookie with it (SameSite=Lax), so the CSRF guard — which judges
// cookie-authenticated requests — has nothing to refuse; the handler then redirected to the
// body's `redirect` whenever it was ANY http(s) URL. Result: a 302 from our origin to any site.
//
// The fix recomputes the destination from the inputs with the GET's rule (logoutTarget):
// a REGISTERED post_logout_redirect_uri of the named client, or the site itself.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'oidc-logout-redirect-test-secret';
const SITE = 'https://site.example';
const savedSite = process.env.SITE_URL;
process.env.SITE_URL = SITE;
const { logoutTarget } = await import('../src/lib/oidc.mjs');

const client = { redirectUris: ['https://app.example/after-logout', 'https://app.example/cb?x=1'] };

describe('logoutTarget (the rule shared by GET and POST)', () => {
  test('a registered post_logout_redirect_uri is honoured, with state', () => {
    assert.equal(logoutTarget({ client, want: 'https://app.example/after-logout', state: 'a b' }), 'https://app.example/after-logout?state=a%20b');
    assert.equal(logoutTarget({ client, want: 'https://app.example/cb?x=1', state: 's' }), 'https://app.example/cb?x=1&state=s');
    assert.equal(logoutTarget({ client, want: 'https://app.example/after-logout' }), 'https://app.example/after-logout');
  });

  test('an unregistered one, or one with no client, goes home', () => {
    assert.equal(logoutTarget({ client, want: 'https://evil.example/' }), `${SITE}/`);
    assert.equal(logoutTarget({ client: null, want: 'https://app.example/after-logout' }), `${SITE}/`);
    // Exact comparison: a registered URI as a prefix is not the registered URI.
    assert.equal(logoutTarget({ client, want: 'https://app.example/after-logout/../../x' }), `${SITE}/`);
  });

  test('the legacy `redirect` field is kept only on the site origin', () => {
    assert.equal(logoutTarget({ legacy: `${SITE}/dashboard` }), `${SITE}/dashboard`);
    assert.equal(logoutTarget({ legacy: 'https://evil.example/login' }), `${SITE}/`);
    // The string-prefix check it replaces accepted these two.
    assert.equal(logoutTarget({ legacy: 'https://site.example.evil.com/' }), `${SITE}/`);
    assert.equal(logoutTarget({ legacy: 'https://site.example@evil.example/' }), `${SITE}/`);
    assert.equal(logoutTarget({ legacy: 'javascript:alert(1)' }), `${SITE}/`);
    assert.equal(logoutTarget({ legacy: '//evil.example/' }), `${SITE}/`);
  });

  test('a legacy redirect cannot override a post_logout_redirect_uri that failed', () => {
    assert.equal(logoutTarget({ client, want: 'https://evil.example/', legacy: `${SITE}/x` }), `${SITE}/`);
  });
});

describe('POST /oauth2/logout, driven through the route', () => {
  let app;
  before(async () => {
    const Fastify = (await import('fastify')).default;
    app = Fastify();
    await app.register((await import('@fastify/cookie')).default);
    await app.register((await import('../src/routes/oidc-provider.mjs')).default);
    await app.ready();
  });
  after(async () => {
    await app?.close();
    if (savedSite === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = savedSite;
  });

  test('a cross-site form with an arbitrary redirect lands on the site, not on the attacker', async () => {
    const r = await app.inject({
      method: 'POST', url: '/oauth2/logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      payload: 'redirect=' + encodeURIComponent('https://evil.example/login'),
    });
    assert.equal(r.statusCode, 302);
    assert.equal(r.headers.location, `${SITE}/`);
  });

  test('a same-site redirect still works (a page rendered before the change)', async () => {
    const r = await app.inject({
      method: 'POST', url: '/oauth2/logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'redirect=' + encodeURIComponent(`${SITE}/blog`),
    });
    assert.equal(r.headers.location, `${SITE}/blog`);
  });
});
