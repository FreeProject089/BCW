// The bot no longer draws the casino, and no longer asks the site for its Discord token
// (SECURITY_SUMMARY §9 #4).
//
// The API used to pay whatever `multiplier` the bot sent, so the bot's shared secret minted
// points; and `GET /bot/token` handed the Discord token to that same secret. The API side is
// pinned by apps/api/test/bot-secret.test.mjs. This file pins the bot side: what it SENDS.
//
// api.mjs is exercised with `fetch` stubbed — the request bodies are what the API receives,
// so they are read as JSON rather than guessed from the source.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.mjs') ? [p] : []; });

let sent = [];
let realFetch;
let api;
before(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ ok: true, outcome: {}, results: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  ({ api } = await import('../src/api.mjs'));
});
after(() => { globalThis.fetch = realFetch; });

describe('the bot sends choices, never a multiplier', () => {
  test('a single play sends the game and what was chosen', async () => {
    sent = [];
    await api.economyCasino('123', 50, 'wheel', { target: 5, betOn: 'red', risk: 'high' });
    await api.economyCasino('123', 50, 'roulette', { betOn: 'number', num: 7 });
    await api.economyCasino('123', 50, 'plinko', { risk: 'low' });
    await api.economyCasino('123', 50, 'coinflip', {});
    assert.deepEqual(sent.map((s) => s.body), [
      { discordId: '123', bet: 50, game: 'wheel', target: 5 },
      { discordId: '123', bet: 50, game: 'roulette', betOn: 'number', num: 7 },
      { discordId: '123', bet: 50, game: 'plinko', risk: 'low' },
      { discordId: '123', bet: 50, game: 'coinflip' },
    ]);
    for (const s of sent) assert.ok(!('multiplier' in s.body), `${s.body.game} sent a multiplier`);
  });

  test('no casino code in the bot builds a multiplier to send', () => {
    // The live tables and the single-player page used to build `{ ..., multiplier: … }` plays
    // from a Math.random draw. The API refuses such a body now; this keeps the bot from
    // growing one back.
    for (const f of ['commands.mjs', join('features', 'casino-live.mjs'), 'api.mjs']) {
      const src = readFileSync(join(SRC, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      assert.ok(!/\bmultiplier\s*:/.test(src), `${f} builds a multiplier`);
    }
  });
});

describe('the Discord token comes from the environment only', () => {
  test('api.mjs has no getToken, and nothing in the bot calls GET /bot/token', () => {
    assert.equal(typeof api.getToken, 'undefined');
    for (const f of files(SRC)) {
      const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      assert.ok(!/['"`]\/bot\/token/.test(src), `${f} still calls /bot/token`);
      assert.ok(!/api\.getToken\s*\(/.test(src), `${f} still calls api.getToken()`);
    }
  });
});
