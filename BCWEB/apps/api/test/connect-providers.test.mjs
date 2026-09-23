// G1 — the public list of configured social providers, the one the profile reads to hide what
// this server cannot use.
//
// Two things are pinned. The list is booleans only (it is public: a client id or a key in it
// would be a leak). And it is the SAME rule /start applies: the list used to spell the env
// names out a second time, so a provider could be offered while /start answered 503.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'connect-providers-test-secret';
const KEYS = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'STEAM_API_KEY'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const setEnv = (vals) => { for (const k of KEYS) { if (vals[k] == null) delete process.env[k]; else process.env[k] = vals[k]; } };
const { providerStatus, connectConfigured } = await import('../src/routes/connections.mjs');

let app;
before(async () => {
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/cookie')).default);
  await app.register((await import('../src/routes/connections.mjs')).default);
  await app.ready();
});
after(async () => { setEnv(saved); await app?.close(); });

describe('configured providers list', () => {
  test('nothing configured: every OAuth provider is false, Ko-fi (manual) stays true', async () => {
    setEnv({});
    const r = await app.inject({ method: 'GET', url: '/auth/connect/providers' });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), { github: false, twitch: false, youtube: false, steam: false, kofi: true });
  });

  test('an id without its secret is NOT configured', () => {
    setEnv({ TWITCH_CLIENT_ID: 'tw-id' });
    assert.equal(providerStatus().twitch, false);
    assert.equal(connectConfigured('twitch'), false);
  });

  test('id + secret turns exactly that provider on; YouTube rides the Google pair', () => {
    setEnv({ TWITCH_CLIENT_ID: 'tw-id', TWITCH_CLIENT_SECRET: 'tw-secret', GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret', STEAM_API_KEY: 'st-key' });
    assert.deepEqual(providerStatus(), { github: false, twitch: true, youtube: true, steam: true, kofi: true });
  });

  test('the public payload carries booleans only, never a credential', async () => {
    setEnv({ TWITCH_CLIENT_ID: 'tw-id-VISIBLE', TWITCH_CLIENT_SECRET: 'tw-secret-VISIBLE', STEAM_API_KEY: 'st-key-VISIBLE' });
    const r = await app.inject({ method: 'GET', url: '/auth/connect/providers' });
    assert.ok(!r.body.includes('VISIBLE'), 'a credential leaked into the public list');
    for (const v of Object.values(r.json())) assert.equal(typeof v, 'boolean');
  });

  test('unknown names are never configured', () => {
    setEnv({ TWITCH_CLIENT_ID: 'a', TWITCH_CLIENT_SECRET: 'b' });
    assert.equal(connectConfigured('myspace'), false);
    assert.equal(connectConfigured('__proto__'), false);
  });
});
