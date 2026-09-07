// The block canvas's own operations: what a block IS, and what a duplicate costs.
//
// `newBlock` is the seam. It used to take the kind as given, and both callers passed
// `'paragraph'` for everything they inserted — so a callout picked from the palette arrived
// labelled "paragraph" and stayed that way until something re-split the document. The badge on
// each block is the one place the editor says what a block is, and it was saying the wrong
// thing about every block you had just made.
//
// Nothing errored, and it self-corrected on the next round trip, which is exactly why it
// survived: by the time you looked again it was right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newBlock, inferKind, splitBlocks, joinBlocks } from '../../../packages/bmd/src/editor-blocks.js';

test('a new block takes its kind from its SOURCE, not from what the caller guessed', () => {
  // Every one of these is inserted by the palette with a hardcoded 'paragraph'.
  for (const [src, want] of [
    [':::tip[Careful]\nx\n:::', 'directive:tip'],
    ['::::steps[How to]\n:::step[One]\nx\n:::\n::::', 'directive:steps'],
    ['## A heading', 'heading'],
    ['- one\n- two', 'list'],
    ['> quoted', 'quote'],
    ['| a | b |\n|---|---|\n| 1 | 2 |', 'table'],
    ['```js\nx\n```', 'code'],
    ['---', 'hr'],
    ['Just words.', 'paragraph'],
  ]) {
    assert.equal(newBlock('paragraph', src).kind, want, JSON.stringify(src.slice(0, 24)));
  }
});

test('the inferred kind is the one splitBlocks would have given it', () => {
  // The whole justification: inferring only makes the block agree with itself sooner. If these
  // two ever disagreed, a block would change identity on save.
  for (const src of [':::tip[T]\nx\n:::', '## H', '- a', '```\nx\n```', 'text', '> q', '---']) {
    const built = newBlock('paragraph', src);
    const [split] = splitBlocks(src);
    assert.equal(built.kind, split.kind, src.slice(0, 20));
  }
});

test('an EMPTY block keeps the kind it was asked for — that is what the argument is still for', () => {
  // The blank spacer between blocks is created as `newBlock('blank', '')`, and the canvas
  // styles and counts on that kind. Inferring from an empty string would call it 'blank'
  // anyway, but a caller asking for something else on an empty block still gets it.
  assert.equal(newBlock('blank', '').kind, 'blank');
  assert.equal(newBlock('paragraph', '').kind, 'paragraph');
  assert.equal(newBlock('blank', '   ').kind, 'blank', 'whitespace is still empty');
});

test('every block gets its own id, so two inserted in one gesture are two blocks', () => {
  // Duplicating splices a copy AND a blank in one call; sharing an id would make everything
  // that finds a block by id find the first one — move the second, the first moves.
  const ids = [newBlock('paragraph', 'a'), newBlock('blank', ''), newBlock('paragraph', 'a')].map((b) => b.id);
  assert.equal(new Set(ids).size, 3);
});

test('a duplicate is a separate block with the same text', () => {
  const src = ':::tip[Careful]\nMind the gap.\n:::';
  const orig = newBlock('paragraph', src);
  const copy = newBlock(orig.kind, orig.src);
  assert.notEqual(copy.id, orig.id);
  assert.equal(copy.src, orig.src);
  assert.equal(copy.kind, orig.kind);
});

test('a duplicated block comes back as TWO blocks, and the document still round-trips', () => {
  // The property that matters, in the shape the canvas actually splices: copy + blank, right
  // after the original. Both halves are asserted, because the failure is silent either way —
  // a copy that merges into its neighbour edits, moves and deletes as one block, and a
  // document that no longer round-trips has quietly changed under the author.
  const doc = 'First.\n\nSecond.\n';
  const blocks = splitBlocks(doc);
  const i = blocks.findIndex((b) => b.src.startsWith('First'));
  const next = [...blocks];
  next.splice(i + 1, 0, newBlock(blocks[i].kind, blocks[i].src), newBlock('blank', ''));

  const out = joinBlocks(next);
  const back = splitBlocks(out);
  assert.equal(back.filter((b) => b.src.trim() === 'First.').length, 2, 'two separate paragraphs, not one merged block');
  assert.ok(back.some((b) => b.src.trim() === 'Second.'), 'and the block after it is untouched');
  assert.equal(joinBlocks(back), out, 'split/join is still lossless over the result');
});

test('duplicating a DIRECTIVE keeps its fences intact', () => {
  // A container copied without its closing fence swallows everything after it — the document
  // renders as one enormous callout and the source looks almost right.
  const doc = ':::tip[Careful]\nMind the gap.\n:::\n\nAfter.\n';
  const blocks = splitBlocks(doc);
  const next = [...blocks];
  next.splice(1, 0, newBlock(blocks[0].kind, blocks[0].src), newBlock('blank', ''));
  const back = splitBlocks(joinBlocks(next));
  assert.equal(back.filter((b) => b.kind === 'directive:tip').length, 2);
  assert.ok(back.some((b) => b.src.trim() === 'After.'), 'the paragraph after is still its own block');
});

test('inferKind is exported, because a host that builds a block has to be able to label it', () => {
  assert.equal(typeof inferKind, 'function');
  assert.equal(inferKind(':::card[X]\ny\n:::'), 'directive:card');
  assert.equal(inferKind(''), 'blank');
});
