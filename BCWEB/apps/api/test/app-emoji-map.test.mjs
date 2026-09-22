// The application-emoji map the owner's script (or the dashboard) hands the site, and the
// per-icon status computed from it. The map becomes `<:name:id>` tokens in bot messages, so
// what it accepts is narrow on purpose: names ^[a-z0-9_]+$, ids that are Discord snowflakes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmojiMapBody, nextEmojiMap } from '../src/lib/app-emoji-map.mjs';
import { iconEmojiStatus, appIconTokens, iconVersion, parseIconEmojiName, iconEmojiName, ICONS } from '../src/lib/bot-emoji.mjs';

const ID = '123456789012345678', ID2 = '223456789012345678';

describe('what the map accepts', () => {
  test('the three spellings: the script file, a list, Discord\'s raw answer', () => {
    for (const body of [
      { emojis: { bc_shop_aaaaaaaa: ID } },
      { emojis: [{ name: 'bc_shop_aaaaaaaa', id: ID }] },
      { items: [{ name: 'bc_shop_aaaaaaaa', id: ID, animated: false, user: { id: ID2 }, roles: [] }] },
    ]) {
      const r = parseEmojiMapBody(body);
      assert.equal(r.ok, true, JSON.stringify(body));
      assert.deepEqual(r.emojis, { bc_shop_aaaaaaaa: ID });
      assert.equal(r.mode, 'replace');
    }
  });

  test('a name outside ^[a-z0-9_]+$ or an id that is not a snowflake is refused, and named', () => {
    for (const body of [
      { emojis: { 'Bc_Shop': ID } }, { emojis: { 'bc-shop': ID } }, { emojis: { 'a:b': ID } }, { emojis: { '<:x:1>': ID } },
      { emojis: { bc_shop: '12' } }, { emojis: { bc_shop: `${ID}x` } }, { emojis: { bc_shop: 123456789012345678 } },
      { emojis: [{ name: 'ok_name', id: 'nope' }] }, { appId: 'x', emojis: {} }, {},
    ]) {
      const r = parseEmojiMapBody(body);
      assert.equal(r.ok, false, JSON.stringify(body));
      assert.ok(r.issues.length > 0);
    }
  });

  test('merge adds, replace replaces', () => {
    const prev = nextEmojiMap(null, parseEmojiMapBody({ emojis: { a_one: ID } }), 'script');
    assert.deepEqual(nextEmojiMap(prev, parseEmojiMapBody({ emojis: { b_two: ID2 }, mode: 'merge' }), 'dashboard').emojis, { a_one: ID, b_two: ID2 });
    assert.deepEqual(nextEmojiMap(prev, parseEmojiMapBody({ emojis: { b_two: ID2 } }), 'script').emojis, { b_two: ID2 });
  });
});

describe('per-icon status', () => {
  const keys = [{ key: 'shop', version: 'aaaaaaaa' }, { key: 'casino', version: 'bbbbbbbb' }, { key: 'vis_server', version: 'cccccccc' }];
  test('present / outdated / missing', () => {
    const s = iconEmojiStatus(keys, { bc_shop_aaaaaaaa: ID, bc_casino_00000000: ID2, party_parrot: ID });
    assert.deepEqual(s.map((x) => [x.key, x.status]), [['shop', 'present'], ['casino', 'outdated'], ['vis_server', 'missing']]);
    assert.equal(s[1].want, 'bc_casino_bbbbbbbb');
  });
  test('only a current drawing becomes a token the bot uses', () => {
    assert.deepEqual(appIconTokens(keys, { bc_shop_aaaaaaaa: ID, bc_casino_00000000: ID2, bc_vis_server_cccccccc: ID2 }, ['bc_vis_server_cccccccc']),
      { shop: `<:bc_shop_aaaaaaaa:${ID}>`, vis_server: `<a:bc_vis_server_cccccccc:${ID2}>` });
  });
  test('names round-trip, and every real key fits Discord\'s 32 characters', () => {
    for (const key of Object.keys(ICONS)) {
      const n = iconEmojiName(key, iconVersion(key));
      assert.ok(n.length <= 32 && /^[a-z0-9_]+$/.test(n), n);
      assert.deepEqual(parseIconEmojiName(n), { key, version: iconVersion(key) });
    }
  });
});
