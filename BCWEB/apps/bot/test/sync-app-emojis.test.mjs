// The owner's emoji upload script (scripts/sync-app-emojis.mjs), driven with a fake Discord and
// a fake site: no network, no token. What it must never do is the part tested hardest: write
// anything in a dry run, upload an icon that is already there, or print the token.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { run, planSync, waitFor, parseName, emojiName } from '../scripts/sync-app-emojis.mjs';
import { parseName as botParseName, emojiName as botEmojiName } from '../src/features/icons.mjs';

// Joined at run time: written whole, a Discord-token-shaped fake trips GitHub push protection.
const TOKEN = ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'GhIjKl', 'fake_token_value_for_tests_only'].join('.');
const APP = '111111111111111111';
const KEYS = [{ key: 'shop', version: 'aaaaaaaa' }, { key: 'casino', version: 'bbbbbbbb' }, { key: 'gift', version: 'cccccccc' }];

function world({ existing = [], rateLimitOnce = false } = {}) {
  const calls = [];
  let limited = !rateLimitOnce;
  let nextId = 900000000000000000n;
  const json = (status, body, headers = {}) => ({
    status, ok: status >= 200 && status < 300,
    headers: new Map(Object.entries({ 'content-type': 'application/json', ...headers })),
    json: async () => body, arrayBuffer: async () => new ArrayBuffer(0),
  });
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, headers: init.headers || {}, body: init.body });
    if (url.startsWith('http://site')) {
      if (url.endsWith('/bot/emoji/keys')) return json(200, { icons: KEYS });
      if (url.includes('/bot/emoji/') && url.endsWith('.png')) return { status: 200, ok: true, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer };
      if (url.endsWith('/bot/emoji/map') && method === 'PUT') return json(200, { ok: true, counts: { present: 3, outdated: 0, missing: 0 } });
      return json(404, { error: 'not_found' });
    }
    if (url.endsWith('/applications/@me')) return json(200, { id: APP });
    if (url.endsWith(`/applications/${APP}/emojis`) && method === 'GET') return json(200, { items: existing });
    if (url.endsWith(`/applications/${APP}/emojis`) && method === 'POST') {
      if (!limited) { limited = true; return json(429, { retry_after: 0.01, message: 'You are being rate limited.' }); }
      const b = JSON.parse(init.body);
      nextId += 1n;
      return json(201, { id: String(nextId), name: b.name, animated: false }, { 'x-ratelimit-remaining': '4' });
    }
    if (method === 'DELETE') return { status: 204, ok: true, headers: new Map(), json: async () => null };
    return json(404, { message: 'Unknown' });
  };
  return { fetch, calls };
}

const ENV = { DISCORD_TOKEN: TOKEN, BCWEB_API_URL: 'http://site', BOT_SHARED_SECRET: 's3cret' };
async function go(argv, w) {
  const lines = [], files = {}, sleeps = [];
  const code = await run({ argv, env: ENV, fetch: w.fetch, log: (l) => lines.push(l), sleep: async (ms) => { sleeps.push(ms); }, writeFile: async (f, d) => { files[f] = d; } });
  return { code, lines, files, sleeps, writes: w.calls.filter((c) => c.method !== 'GET') };
}

describe('sync-app-emojis', () => {
  test('a dry run reads and writes nothing, and says what it would do', async () => {
    const r = await go([], world({ existing: [{ id: '222222222222222222', name: emojiName('shop', 'aaaaaaaa') }] }));
    assert.equal(r.code, 0);
    assert.deepEqual(r.writes, [], 'no POST, PUT or DELETE anywhere');
    assert.deepEqual(r.files, {}, 'no file');
    assert.ok(r.lines.some((l) => l.includes('would upload bc_casino_bbbbbbbb')));
    assert.ok(!r.lines.some((l) => l.includes('would upload bc_shop_')), 'present at the right version: not planned');
  });

  test('--apply uploads only what is missing, writes the map and sends it', async () => {
    const existing = [
      { id: '222222222222222222', name: 'bc_shop_aaaaaaaa' },
      { id: '333333333333333333', name: 'bc_casino_00000000' }, // stale: another drawing
      { id: '444444444444444444', name: 'SomebodyElse' },        // not ours, not a valid map name
    ];
    const r = await go(['--apply', '--out', 'map.json'], world({ existing }));
    assert.equal(r.code, 0);
    const posts = r.writes.filter((c) => c.method === 'POST').map((c) => JSON.parse(c.body).name);
    assert.deepEqual(posts.sort(), ['bc_casino_bbbbbbbb', 'bc_gift_cccccccc']);
    assert.ok(!r.writes.some((c) => c.method === 'DELETE'), 'stale ones are kept without --prune');
    const map = JSON.parse(r.files['map.json']);
    assert.equal(map.appId, APP);
    assert.equal(map.emojis.bc_shop_aaaaaaaa, '222222222222222222');
    assert.ok(map.emojis.bc_casino_bbbbbbbb && map.emojis.bc_gift_cccccccc);
    assert.equal(map.emojis.SomebodyElse, undefined, 'a name the site would refuse is left out');
    const push = r.writes.find((c) => c.method === 'PUT');
    assert.ok(push && push.url === 'http://site/bot/emoji/map');
    assert.equal(push.headers['x-bot-secret'], 's3cret');
    assert.equal(JSON.parse(push.body).mode, 'replace');
  });

  test('a second run uploads nothing', async () => {
    const existing = KEYS.map((k, i) => ({ id: `55555555555555555${i}`, name: emojiName(k.key, k.version) }));
    const r = await go(['--apply', '--no-push'], world({ existing }));
    assert.equal(r.code, 0);
    assert.deepEqual(r.writes, []);
  });

  test('--prune deletes our stale emojis and nobody else\'s', async () => {
    const existing = [{ id: '333333333333333333', name: 'bc_casino_00000000' }, { id: '666666666666666666', name: 'party_parrot' }];
    const r = await go(['--apply', '--prune', '--no-push'], world({ existing }));
    const dels = r.writes.filter((c) => c.method === 'DELETE').map((c) => c.url);
    assert.deepEqual(dels, [`https://discord.com/api/v10/applications/${APP}/emojis/333333333333333333`]);
  });

  test('a 429 is waited out, not fatal', async () => {
    const r = await go(['--apply', '--no-push'], world({ rateLimitOnce: true }));
    assert.equal(r.code, 0);
    assert.ok(r.sleeps.some((ms) => ms >= 10), 'slept the retry_after');
    assert.equal(r.writes.filter((c) => c.method === 'POST').length, 4, 'three uploads plus the one retried');
  });

  test('the token is sent as a header and never printed', async () => {
    const w = world();
    const r = await go(['--apply'], w);
    assert.ok(w.calls.filter((c) => c.url.startsWith('https://discord.com')).every((c) => c.headers.authorization === `Bot ${TOKEN}`));
    assert.ok(w.calls.filter((c) => c.url.startsWith('http://site')).every((c) => !JSON.stringify(c.headers).includes(TOKEN)), 'the site never sees it');
    assert.ok(r.lines.every((l) => !l.includes(TOKEN)));
  });

  test('no token: refuses to start', async () => {
    const lines = [];
    const code = await run({ argv: [], env: {}, fetch: async () => { throw new Error('no call expected'); }, log: (l) => lines.push(l) });
    assert.equal(code, 1);
    assert.match(lines.join('\n'), /DISCORD_TOKEN/);
  });

  test("the same naming rule as the bot's own sync", () => {
    // The script keeps its own copy so it loads without discord.js; the two must not drift, or
    // the bot would treat every emoji the script uploaded as stale and replace it.
    for (const n of ['bc_shop_aaaaaaaa', 'bc_vis_server_0a1b2c3d', 'bc_shop', 'party_parrot', 'bc_x_ABCDEF12']) assert.deepEqual(parseName(n), botParseName(n), n);
    assert.equal(emojiName('shop', 'aaaaaaaa'), botEmojiName('shop', 'aaaaaaaa'));
  });

  test('pure helpers', () => {
    assert.deepEqual(parseName('bc_vis_server_0a1b2c3d'), { key: 'vis_server', version: '0a1b2c3d' });
    assert.equal(parseName('bc_shop'), null);
    const p = planSync(KEYS, [{ name: 'bc_shop_aaaaaaaa' }, { name: 'bc_gift_ffffffff' }], ['gift']);
    assert.deepEqual(p.upload.map((k) => k.key), ['gift'], '--only limits the uploads');
    assert.equal(p.stale.length, 1);
    const h = (o) => new Map(Object.entries(o));
    assert.equal(waitFor(429, h({}), { retry_after: 2 }), 2250);
    assert.equal(waitFor(200, h({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '1.5' }), null), 1600);
    assert.equal(waitFor(200, h({ 'x-ratelimit-remaining': '3' }), null), 0);
  });
});
