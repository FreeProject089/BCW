// Editing one block of a document must leave every other block byte-identical.
//
// The live preview edits in place: you open one paragraph on the rendered page, change it, and
// the rest of the document has to come back exactly as it was. That is the whole risk of the
// feature — a round-trip that "tidies" fences, collapses blank lines or re-indents a table
// would quietly rewrite a document every time somebody fixed a typo in it, and nobody would
// notice until a diff looked insane.
//
// The operations are splitBlocks/joinBlocks from the kit, so this pins the property the
// component relies on rather than re-testing the component's buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBlocks, joinBlocks, newBlock } from '../../../packages/bmd/src/editor-blocks.js';

const DOC = [
  '# Title',
  '',
  'A paragraph with **bold** and a [link](/x).',
  '',
  ':::tip[Careful]',
  'Mind the gap.',
  ':::',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '```js',
  'const x = 1;   //  deliberately   odd   spacing',
  '```',
  '',
  '::::steps',
  ':::step[One]',
  'Do the thing.',
  ':::',
  '::::',
  '',
].join('\n');

test('a document survives a split/join round trip untouched', () => {
  assert.equal(joinBlocks(splitBlocks(DOC)), DOC);
});

test('editing one block changes only that block', () => {
  const blocks = splitBlocks(DOC);
  const i = blocks.findIndex((b) => b.src.includes('A paragraph'));
  assert.ok(i >= 0, 'found the paragraph to edit');
  const before = blocks.map((b) => b.src);

  const edited = blocks.map((b, n) => (n === i ? { ...b, src: 'A paragraph, now rewritten.' } : b));
  const out = joinBlocks(edited);

  // Every OTHER block comes back exactly as it was — including the code fence's odd spacing
  // and the four-colon steps block, which are the two things a careless re-serialiser eats.
  const after = splitBlocks(out).map((b) => b.src);
  assert.equal(after.length, before.length);
  for (let n = 0; n < before.length; n++) {
    if (n === i) continue;
    assert.equal(after[n], before[n], `block ${n} was modified by editing block ${i}`);
  }
  assert.ok(out.includes('const x = 1;   //  deliberately   odd   spacing'), 'code kept verbatim');
  assert.ok(out.includes('::::steps'), 'the four-colon fence survived');
});

test('inserting a block does not disturb its neighbours', () => {
  const blocks = splitBlocks(DOC);
  const at = 2;
  const next = [...blocks];
  // The block AND the blank line after it. Without the blank, joinBlocks (which joins with a
  // single newline) glues the new block to the one below and the two become one — they then
  // edit, move and delete together, which is how an editor eats a paragraph.
  next.splice(at, 0, newBlock('paragraph', 'Inserted here.'), newBlock('blank', ''));
  const out = splitBlocks(joinBlocks(next)).map((b) => b.src);
  // ONE new block, not two: the blank is absorbed back into the inserted block as its
  // trailing newline, which is the same shape every other block in the document has.
  assert.equal(out.length, blocks.length + 1);
  assert.equal(out[at].trim(), 'Inserted here.');
  assert.ok(!out.some((sr) => sr.includes('Inserted here.') && sr.includes('A paragraph')), 'not merged into its neighbour');
  for (let n = 0; n < at; n++) assert.equal(out[n], blocks[n].src);
  for (let n = at + 1; n < out.length; n++) assert.equal(out[n], blocks[n - 1].src, `block ${n} shifted or changed`);
});

test('removing a block leaves a document that still round-trips', () => {
  const blocks = splitBlocks(DOC);
  const i = blocks.findIndex((b) => b.src.startsWith(':::tip'));
  const out = joinBlocks(blocks.filter((_, n) => n !== i));
  assert.ok(!out.includes(':::tip'), 'the tip is gone');
  assert.equal(joinBlocks(splitBlocks(out)), out, 'and what is left is still stable');
});

test('every block has a distinct id, so React keys and edit targets do not collide', () => {
  const ids = splitBlocks(DOC).map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('editing a paragraph does not swallow the paragraph after it', () => {
  // The one that nearly shipped. A paragraph block is stored WITH the blank line that
  // separates it from the next ("First paragraph.\n"); the textarea shows only the text, so
  // writing its value straight back drops the separator. Two paragraphs have no fence between
  // them, so they then merge into a single block — fixing a typo in the first paragraph of a
  // page ate the second one, and the page still rendered, just with two paragraphs run
  // together and now inseparable.
  const doc = 'First paragraph.\n\nSecond paragraph.\n';
  const blocks = splitBlocks(doc);
  assert.equal(blocks.length, 2);

  const naive = joinBlocks(blocks.map((b, i) => (i === 0 ? { ...b, src: 'First, edited.' } : b)));
  assert.equal(splitBlocks(naive).length, 1, 'this is the bug, pinned so the fix is meaningful');

  // What the component does: keep the block's own trailing newlines.
  const keepTail = (b, src) => ({ ...b, src: String(src).replace(/\n*$/, '') + (b.src.match(/\n*$/) || [''])[0] });
  const fixed = joinBlocks(blocks.map((b, i) => (i === 0 ? keepTail(b, 'First, edited.') : b)));
  const out = splitBlocks(fixed);
  assert.equal(out.length, 2, 'still two paragraphs');
  assert.equal(out[0].src.trim(), 'First, edited.');
  assert.equal(out[1].src, blocks[1].src, 'and the second is byte-identical');
});
