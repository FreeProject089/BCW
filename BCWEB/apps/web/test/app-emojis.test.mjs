// What the "Icons on Discord" card accepts from a paste, before the server sees it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmojiPaste, parseEmojiToken } from '../src/lib/app-emojis.js';

const ID = '123456789012345678';

test('the script file, a list and Discord raw answer all read the same', () => {
  for (const s of [{ emojis: { bc_shop_1a2b3c4d: ID } }, { emojis: [{ name: 'bc_shop_1a2b3c4d', id: ID }] }, { items: [{ name: 'bc_shop_1a2b3c4d', id: ID }] }, [{ name: 'bc_shop_1a2b3c4d', id: ID }]]) {
    const r = parseEmojiPaste(JSON.stringify(s));
    assert.equal(r.ok, true);
    assert.deepEqual(r.emojis, { bc_shop_1a2b3c4d: ID });
    assert.equal(r.ours, 1);
  }
});

test('names the server would refuse are left out and counted, not sent', () => {
  const r = parseEmojiPaste(JSON.stringify({ items: [{ name: 'PartyParrot', id: ID }, { name: 'ok_one', id: ID, animated: true }, { name: 'bad', id: '12' }] }));
  assert.deepEqual(r.emojis, { ok_one: ID });
  assert.deepEqual(r.animated, ['ok_one']);
  assert.equal(r.ignored, 2);
  assert.equal(parseEmojiPaste('not json').error, 'json');
  assert.equal(parseEmojiPaste('{"items":[]}').error, 'empty');
});

test('one custom emoji token', () => {
  assert.deepEqual(parseEmojiToken(` <a:party:${ID}> `), { token: `<a:party:${ID}>`, name: 'party', id: ID, animated: true });
  assert.equal(parseEmojiToken(':party:'), null);
  assert.equal(parseEmojiToken('🎉'), null);
});
