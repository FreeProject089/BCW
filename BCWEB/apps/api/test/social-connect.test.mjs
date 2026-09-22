// Steam (OpenID 2.0) and Twitch (OAuth2) as profile connections.
//
// Steam's callback is a query string anybody can write. The pure half pins what is refused
// before Steam is even asked; the DB half drives the real routes with Steam/Twitch stubbed at
// `fetch`, and pins that Steam's own verdict, the browser binding and the one-use nonce all
// have to agree before a row is written.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'social-connect-test-secret';
const { steamAssertionShape, steamSaysValid, STEAM_OP } = await import('../src/routes/connections.mjs');

const RT = 'http://localhost/api/auth/connect/steam/callback?s=abc.def';
const ID = '76561197960287930';
const good = (over = {}) => ({
  'openid.ns': 'http://specs.openid.net/auth/2.0',
  'openid.mode': 'id_res',
  'openid.op_endpoint': STEAM_OP,
  'openid.claimed_id': `https://steamcommunity.com/openid/id/${ID}`,
  'openid.identity': `https://steamcommunity.com/openid/id/${ID}`,
  'openid.return_to': RT,
  'openid.response_nonce': `2026-09-22T10:00:00Z${Math.random().toString(36).slice(2)}`,
  'openid.assoc_handle': '1234567890',
  'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
  'openid.sig': 'c2lnbmF0dXJl',
  ...over,
});

describe('Steam assertion: refused before Steam is asked', () => {
  test('a well-formed assertion yields the 17-digit id', () => {
    assert.deepEqual(steamAssertionShape(good(), RT), { steamId: ID });
  });
  const bad = {
    'another OP endpoint': { 'openid.op_endpoint': 'https://evil.example/openid/login' },
    'a return_to that is not ours': { 'openid.return_to': 'https://evil.example/cb?s=abc.def' },
    'our path with another state': { 'openid.return_to': 'http://localhost/api/auth/connect/steam/callback?s=other' },
    'a claimed_id on another host': { 'openid.claimed_id': `https://evil.example/openid/id/${ID}`, 'openid.identity': `https://evil.example/openid/id/${ID}` },
    'a claimed_id that only ENDS like Steam': { 'openid.claimed_id': `https://evil.example/x?https://steamcommunity.com/openid/id/${ID}` },
    'an id of the wrong length': { 'openid.claimed_id': 'https://steamcommunity.com/openid/id/123', 'openid.identity': 'https://steamcommunity.com/openid/id/123' },
    'identity differing from claimed_id': { 'openid.identity': 'https://steamcommunity.com/openid/id/76561197960287931' },
    'claimed_id left out of the signature': { 'openid.signed': 'signed,op_endpoint,identity,return_to,response_nonce,assoc_handle' },
    'no signature at all': { 'openid.sig': '' },
    'the wrong mode': { 'openid.mode': 'checkid_setup' },
    'a repeated key (array)': { 'openid.claimed_id': [`https://steamcommunity.com/openid/id/${ID}`, 'x'] },
  };
  for (const [name, over] of Object.entries(bad)) {
    test(`refused: ${name}`, () => assert.ok(steamAssertionShape(good(over), RT).error));
  }
  test('a cancel is told apart', () => assert.equal(steamAssertionShape(good({ 'openid.mode': 'cancel' }), RT).error, 'cancelled'));
  test("Steam's verdict is read as a key:value line, not a substring", () => {
    assert.equal(steamSaysValid('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n'), true);
    assert.equal(steamSaysValid('ns:http://specs.openid.net/auth/2.0\nis_valid:false\n'), false);
    assert.equal(steamSaysValid('error: not is_valid:true'), false);
    assert.equal(steamSaysValid(''), false);
  });
});

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres to run the connect route tests';
const MAIL = '@social-connect.test';
let p, app, jwt, realFetch;
let steamVerdict = 'is_valid:true';
const ids = [];

describe('connect routes', { skip }, () => {
  before(async () => {
    process.env.STEAM_API_KEY = 'test-steam-key';
    process.env.TWITCH_CLIENT_ID = 'test-twitch-id';
    process.env.TWITCH_CLIENT_SECRET = 'test-twitch-secret';
    const lib = await import('../src/lib/lib.mjs');
    p = await lib.db();
    jwt = (await import('jsonwebtoken')).default;
    realFetch = globalThis.fetch;
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u === STEAM_OP && init?.method === 'POST') return new Response(`ns:http://specs.openid.net/auth/2.0\n${steamVerdict}\n`, { status: 200 });
      if (u.startsWith('https://api.steampowered.com/ISteamUser/GetPlayerSummaries')) return json({ response: { players: [{ steamid: ID, personaname: 'Gordon', profileurl: 'https://steamcommunity.com/id/gordon/' }] } });
      if (u.startsWith('https://id.twitch.tv/oauth2/token')) return json({ access_token: 'twitch-tok' });
      if (u.startsWith('https://api.twitch.tv/helix/users')) return json({ data: [{ id: '4242', login: 'streamer_x', display_name: 'Streamer_X' }] });
      return realFetch(url, init);
    };
    const Fastify = (await import('fastify')).default;
    app = Fastify();
    await app.register((await import('@fastify/cookie')).default);
    await app.register((await import('../src/routes/connections.mjs')).default);
    await app.ready();
  });
  after(async () => {
    globalThis.fetch = realFetch;
    const users = await p.user.findMany({ where: { email: { endsWith: MAIL } }, select: { id: true } });
    const uids = users.map((u) => u.id);
    if (uids.length) {
      await p.socialConnection.deleteMany({ where: { userId: { in: uids } } });
      await p.session.deleteMany({ where: { userId: { in: uids } } });
      await p.user.deleteMany({ where: { id: { in: uids } } });
    }
    assert.equal(await p.user.count({ where: { email: { endsWith: MAIL } } }), 0, 'fixtures left behind');
    await app?.close();
    await p?.$disconnect?.();
  });

  const mk = async () => {
    const u = await p.user.create({ data: { email: `c${Date.now()}-${ids.length}${MAIL}`, displayName: 'connect-test', emailVerified: true } });
    ids.push(u.id);
    const s = await p.session.create({ data: { userId: u.id }, select: { id: true } });
    return { user: u, cookie: `bcw_session=${jwt.sign({ uid: u.id, role: u.role, sid: s.id }, process.env.JWT_SECRET, { expiresIn: '1h' })}` };
  };
  const setCookies = (r) => [].concat(r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).filter((c) => !/=$/.test(c));

  async function steamStart(cookie) {
    const r = await app.inject({ method: 'GET', url: '/auth/connect/steam/start', headers: { cookie } });
    assert.equal(r.statusCode, 302, r.body);
    const loc = new URL(r.headers.location);
    assert.equal(loc.origin + loc.pathname, STEAM_OP);
    const returnTo = loc.searchParams.get('openid.return_to');
    return { returnTo, bind: setCookies(r).find((c) => c.startsWith('bcw_connect=')) };
  }
  const steamCallback = (returnTo, q, cookie) => {
    const s = new URL(returnTo).searchParams.get('s');
    const qs = new URLSearchParams({ s, ...q }).toString();
    return app.inject({ method: 'GET', url: `/auth/connect/steam/callback?${qs}`, headers: cookie ? { cookie } : {} });
  };

  test('providers: Twitch and Steam show only when configured', async () => {
    let r = (await app.inject({ method: 'GET', url: '/auth/connect/providers' })).json();
    assert.equal(r.twitch, true); assert.equal(r.steam, true);
    const saved = { a: process.env.TWITCH_CLIENT_SECRET, b: process.env.STEAM_API_KEY };
    delete process.env.TWITCH_CLIENT_SECRET; delete process.env.STEAM_API_KEY;
    try {
      r = (await app.inject({ method: 'GET', url: '/auth/connect/providers' })).json();
      assert.equal(r.twitch, false); assert.equal(r.steam, false);
      const { cookie } = await mk();
      assert.equal((await app.inject({ method: 'GET', url: '/auth/connect/twitch/start', headers: { cookie } })).statusCode, 503);
      assert.equal((await app.inject({ method: 'GET', url: '/auth/connect/steam/start', headers: { cookie } })).statusCode, 503);
    } finally { process.env.TWITCH_CLIENT_SECRET = saved.a; process.env.STEAM_API_KEY = saved.b; }
  });

  test('Steam: a verified assertion links once; the replay, a foreign browser and a "no" from Steam link nothing', async () => {
    const { user, cookie } = await mk();
    const { returnTo, bind } = await steamStart(cookie);
    const assertion = good({ 'openid.return_to': returnTo });

    // Steam says no → nothing.
    steamVerdict = 'is_valid:false';
    let r = await steamCallback(returnTo, assertion, `${cookie}; ${bind}`);
    assert.match(r.headers.location, /connect_error=not_verified/);
    assert.equal(await p.socialConnection.count({ where: { userId: user.id } }), 0);

    // A second flow, Steam says yes, but the callback lands in a browser without the binding.
    steamVerdict = 'is_valid:true';
    const f2 = await steamStart(cookie);
    const a2 = good({ 'openid.return_to': f2.returnTo });
    r = await steamCallback(f2.returnTo, a2, cookie);
    assert.match(r.headers.location, /connect_error=bad_state/);
    assert.equal(await p.socialConnection.count({ where: { userId: user.id } }), 0);

    // The real thing.
    const f3 = await steamStart(cookie);
    const a3 = good({ 'openid.return_to': f3.returnTo });
    r = await steamCallback(f3.returnTo, a3, `${cookie}; ${f3.bind}`);
    assert.match(r.headers.location, /connected=steam/, r.headers.location);
    const row = await p.socialConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: 'steam' } } });
    assert.equal(row.externalId, ID);
    assert.equal(row.handle, 'Gordon');
    assert.equal(row.url, 'https://steamcommunity.com/id/gordon/');

    // The same assertion replayed with the same cookie value (the browser that started it,
    // inside the state's lifetime): Steam's stub still says yes, the nonce is what refuses it.
    await p.socialConnection.deleteMany({ where: { userId: user.id } });
    r = await steamCallback(f3.returnTo, a3, `${cookie}; ${f3.bind}`);
    assert.match(r.headers.location, /connect_error=not_verified/);
    assert.equal(await p.socialConnection.count({ where: { userId: user.id } }), 0);
  });

  test('Twitch: asks which account, and links through its own callback', async () => {
    const { user, cookie } = await mk();
    const r0 = await app.inject({ method: 'GET', url: '/auth/connect/twitch/start', headers: { cookie } });
    assert.equal(r0.statusCode, 302, r0.body);
    const loc = new URL(r0.headers.location);
    assert.equal(loc.origin, 'https://id.twitch.tv');
    assert.equal(loc.searchParams.get('force_verify'), 'true');
    assert.equal(loc.searchParams.get('redirect_uri'), 'http://localhost/api/auth/connect/twitch/callback');
    const state = loc.searchParams.get('state');
    const bind = setCookies(r0).find((c) => c.startsWith('bcw_connect='));
    // No binding → nothing.
    let r = await app.inject({ method: 'GET', url: `/auth/connect/twitch/callback?code=x&state=${encodeURIComponent(state)}` });
    assert.match(r.headers.location, /connect_error=bad_state/);
    // Bound → linked.
    const r1 = await app.inject({ method: 'GET', url: '/auth/connect/twitch/start', headers: { cookie } });
    const state1 = new URL(r1.headers.location).searchParams.get('state');
    const bind1 = setCookies(r1).find((c) => c.startsWith('bcw_connect='));
    assert.ok(bind && bind1);
    r = await app.inject({ method: 'GET', url: `/auth/connect/twitch/callback?code=x&state=${encodeURIComponent(state1)}`, headers: { cookie: bind1 } });
    assert.match(r.headers.location, /connected=twitch/, r.headers.location);
    const row = await p.socialConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: 'twitch' } } });
    assert.equal(row.handle, 'Streamer_X');
    assert.equal(row.url, 'https://twitch.tv/streamer_x');
  });
});
