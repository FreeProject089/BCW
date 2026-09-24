// CSRF: the one onRequest hook (lib/csrf.mjs), every case the decision names.
//
// Refused: a state-changing request authenticated by our cookie that the browser marks
// cross-site (`Sec-Fetch-Site: cross-site`, or no such header and an `Origin` that is not the
// site). Everything else passes — above all the callers that are cross-site by nature and
// must keep working: the Stripe and Ko-fi webhooks, the OAuth sign-in callbacks, Bearer /
// API-key / bot-secret clients, and the origins the CORS allowlist trusts.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { csrfVerdict, installCsrfGuard } from '../src/lib/csrf.mjs';

const SITE = 'https://bettercommunity.example';
const EVIL = 'https://evil.example';
const TAURI = 'tauri://localhost';
let app;

before(async () => {
  app = Fastify();
  await app.register(cookie);
  installCsrfGuard(app, { trustedOrigins: [TAURI, 'http://tauri.localhost'], siteUrl: SITE });
  const ok = async () => ({ ok: true });
  // The shapes of the real routes: a member write, the webhooks, the OAuth callbacks.
  app.post('/me/profile', ok);
  app.delete('/me/sessions/:id', ok);
  app.post('/webhook', ok);                           // Stripe (stripe-webhook.mjs)
  app.post('/hosting/webhook', ok);                   // Stripe, hosting
  app.post('/webhooks/kofi', ok);                     // Ko-fi (kofi.mjs)
  app.post('/webhooks/code/:key', ok);                // code webhooks
  app.get('/auth/oauth/:provider/callback', ok);      // sign-in with GitHub / Discord / Google
  app.get('/auth/connect/:provider/callback', ok);    // linking an account
  app.post('/oauth2/token', ok);                      // our OIDC provider, server to server
  app.post('/bot/economy/casino', ok);
  await app.ready();
});
after(() => app?.close());

const COOKIE = 'bcw_session=a.b.c';
const hit = (method, url, headers = {}) => app.inject({ method, url, headers });

describe('refused: a cookie-authenticated write the browser marks cross-site', () => {
  test('Sec-Fetch-Site: cross-site', async () => {
    const r = await hit('POST', '/me/profile', { cookie: COOKIE, 'sec-fetch-site': 'cross-site', origin: EVIL });
    assert.equal(r.statusCode, 403);
    assert.deepEqual(r.json(), { error: 'csrf_refused' });
    assert.equal((await hit('DELETE', '/me/sessions/x', { cookie: COOKIE, 'sec-fetch-site': 'cross-site' })).statusCode, 403);
  });
  test('no Sec-Fetch-Site (an older browser) and a foreign Origin', async () => {
    assert.equal((await hit('POST', '/me/profile', { cookie: COOKIE, origin: EVIL })).statusCode, 403);
  });
  test('an opaque origin ("null": a sandboxed frame, a data: URL) is never the site', async () => {
    assert.equal((await hit('POST', '/me/profile', { cookie: COOKIE, origin: 'null' })).statusCode, 403);
  });
  test('the elevated and telemetry cookies count as authentication too', async () => {
    assert.equal((await hit('POST', '/me/profile', { cookie: 'bcw_elevated=x', 'sec-fetch-site': 'cross-site' })).statusCode, 403);
    assert.equal((await hit('POST', '/me/profile', { cookie: 'tele_session=x', origin: EVIL })).statusCode, 403);
  });
});

describe('allowed: the site itself, and what cannot be forged', () => {
  test('same-origin and same-site writes', async () => {
    assert.equal((await hit('POST', '/me/profile', { cookie: COOKIE, 'sec-fetch-site': 'same-origin', origin: SITE })).statusCode, 200);
    assert.equal((await hit('POST', '/me/profile', { cookie: COOKIE, 'sec-fetch-site': 'same-site', origin: 'https://www.bettercommunity.example' })).statusCode, 200);
    assert.equal((await hit('POST', '/me/profile', { cookie: COOKIE, 'sec-fetch-site': 'none' })).statusCode, 200);
  });
  test('an older browser posting from the site itself, or with no Origin at all', async () => {
    assert.equal((await hit('POST', '/me/profile', { cookie: COOKIE, origin: SITE })).statusCode, 200);
    assert.equal((await hit('POST', '/me/profile', { cookie: COOKIE })).statusCode, 200);
  });
  test('Bearer, API-key and bot-secret requests are exempt, even marked cross-site', async () => {
    const x = { cookie: COOKIE, 'sec-fetch-site': 'cross-site', origin: EVIL };
    assert.equal((await hit('POST', '/me/profile', { ...x, authorization: 'Bearer k' })).statusCode, 200);
    assert.equal((await hit('POST', '/me/profile', { ...x, 'x-api-key': 'k' })).statusCode, 200);
    assert.equal((await hit('POST', '/bot/economy/casino', { ...x, 'x-bot-secret': 's' })).statusCode, 200);
  });
  test('the origins the CORS allowlist trusts (the BMM desktop app)', async () => {
    assert.equal((await hit('POST', '/me/profile', { cookie: COOKIE, 'sec-fetch-site': 'cross-site', origin: TAURI })).statusCode, 200);
    assert.equal((await hit('POST', '/me/profile', { cookie: COOKIE, origin: 'http://tauri.localhost' })).statusCode, 200);
  });
  test('a cross-site write with no cookie of ours is not cookie-authenticated', async () => {
    assert.equal((await hit('POST', '/me/profile', { 'sec-fetch-site': 'cross-site', origin: EVIL })).statusCode, 200);
    assert.equal((await hit('POST', '/me/profile', { cookie: 'unrelated=1', 'sec-fetch-site': 'cross-site' })).statusCode, 200);
  });
  test('reads are never refused', async () => {
    assert.equal(csrfVerdict({ method: 'GET', cookies: { bcw_session: 'x' }, headers: { 'sec-fetch-site': 'cross-site' } }, new Set()), null);
    assert.equal(csrfVerdict({ method: 'HEAD', cookies: { bcw_session: 'x' }, headers: { origin: EVIL } }, new Set()), null);
  });
});

describe('the callers that are cross-site by nature keep working', () => {
  test('Stripe and Ko-fi webhooks (server to server, no cookie)', async () => {
    for (const url of ['/webhook', '/hosting/webhook', '/webhooks/kofi', '/webhooks/code/abc']) {
      const r = await app.inject({ method: 'POST', url, headers: { 'sec-fetch-site': 'cross-site', origin: EVIL }, payload: { type: 'event' } });
      assert.equal(r.statusCode, 200, `${url} answered ${r.statusCode}`);
    }
  });
  test('the OAuth callbacks: a GET redirect from the provider, cookie and all', async () => {
    for (const url of ['/auth/oauth/github/callback?code=x&state=y', '/auth/connect/discord/callback?code=x&state=y']) {
      const r = await hit('GET', url, { cookie: COOKIE, 'sec-fetch-site': 'cross-site' });
      assert.equal(r.statusCode, 200, `${url} answered ${r.statusCode}`);
    }
  });
  test('the OIDC token endpoint, called by a relying party’s server', async () => {
    assert.equal((await hit('POST', '/oauth2/token', { origin: EVIL })).statusCode, 200);
  });
});

describe('the real server installs it, once, after the cookie plugin', () => {
  test('server.mjs', () => {
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/server.mjs'), 'utf8');
    const calls = [...src.matchAll(/^\s*installCsrfGuard\(app\b/gm)];
    assert.equal(calls.length, 1, 'installCsrfGuard(app, …) must be called exactly once');
    const cookieAt = src.search(/await app\.register\(cookie\)/);
    assert.ok(cookieAt >= 0 && calls[0].index > cookieAt, 'the hook reads req.cookies: it must come after the cookie plugin');
  });
});
