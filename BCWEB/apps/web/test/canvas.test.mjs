// The free-form canvas rules.
//
// Everything here is a decision that is invisible until it is wrong on somebody's phone, so
// each one is pinned: where scaling stops and stacking starts, what order a stacked canvas
// reads in, and what happens to author JSON that has been through a migration and a hand edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCanvas, layoutFor, readingOrder, paintOrder, contentHeight, snap,
  DESIGN_WIDTH, STACK_BELOW, MIN_SCALE, GRID,
  CANVAS_PRESETS, presetBlocks,
} from '../src/lib/canvas.js';

const canvas = (blocks, extra = {}) => normalizeCanvas({ blocks, ...extra });

test('a canvas scales down to fit and is never magnified', () => {
  const c = canvas([{ x: 0, y: 0, w: 100, h: 100 }]);
  assert.equal(layoutFor(DESIGN_WIDTH, c).scale, 1);
  // A width genuinely between the stacking floor and the design width scales proportionally.
  assert.equal(layoutFor(900, c).scale, 900 / DESIGN_WIDTH);
  // A 2400px window must not draw a 2x poster with 30px body text.
  assert.equal(layoutFor(2400, c).scale, 1);
});

test('below the stacking width it stops scaling and stacks', () => {
  const c = canvas([{ x: 0, y: 0, w: 100, h: 100 }]);
  assert.equal(layoutFor(STACK_BELOW, c).mode, 'scale', 'at the boundary it still scales');
  assert.equal(layoutFor(STACK_BELOW - 1, c).mode, 'stack');
  assert.equal(layoutFor(375, c).mode, 'stack', 'a phone never gets the scaled canvas');
  // The reason the floor exists: at 375 the scale would be 0.31, and 15px text becomes 4.7px.
  assert.ok(375 / DESIGN_WIDTH < MIN_SCALE, 'a phone is below the legibility floor by construction');
});

test('the scaled wrapper reports the SCALED height', () => {
  // A CSS transform does not affect layout. If the wrapper kept the design height the page
  // below would sit under a page of empty space; if it ignored the scale it would overlap.
  const c = canvas([{ x: 0, y: 0, w: 100, h: 460 }]);
  const L = layoutFor(900, c);
  assert.equal(L.height, c.height * L.scale);
});

test('stacking reads top-to-bottom, then left-to-right', () => {
  const c = canvas([
    { id: 'right', x: 700, y: 100, w: 200, h: 80 },
    { id: 'left', x: 40, y: 100, w: 200, h: 80 },
    { id: 'top', x: 300, y: 0, w: 200, h: 80 },
  ]);
  assert.deepEqual(readingOrder(c.blocks).map((b) => b.id), ['top', 'left', 'right']);
});

test('two blocks a designer called "side by side" are not reordered by a few pixels', () => {
  // Without the tolerance band, `right` being 6px higher would put it FIRST on a phone and
  // the two halves of a sentence would swap.
  const c = canvas([
    { id: 'left', x: 40, y: 200, w: 200, h: 80 },
    { id: 'right', x: 700, y: 194, w: 200, h: 80 },
  ]);
  assert.deepEqual(readingOrder(c.blocks).map((b) => b.id), ['left', 'right']);
});

test('painting follows z, and ties keep their stored order', () => {
  const c = canvas([
    { id: 'a', z: 5, x: 0, y: 0, w: 10, h: 10 },
    { id: 'b', z: 1, x: 0, y: 0, w: 10, h: 10 },
    { id: 'c', z: 1, x: 0, y: 0, w: 10, h: 10 },
  ]);
  assert.deepEqual(paintOrder(c.blocks).map((b) => b.id), ['b', 'c', 'a']);
});

test('the canvas is as tall as its content, so deleting the last block shortens it', () => {
  const tall = canvas([{ x: 0, y: 600, w: 100, h: 200 }]);
  assert.equal(tall.height, contentHeight(tall.blocks));
  assert.ok(tall.height > 800);
  const short = canvas([{ x: 0, y: 0, w: 100, h: 100 }]);
  assert.ok(short.height < tall.height, 'height is computed, not remembered');
});

test('an author-pinned height wins over the computed one', () => {
  const c = canvas([{ x: 0, y: 0, w: 100, h: 100 }], { height: 2000 });
  assert.equal(c.height, 2000);
});

test('junk in the stored JSON never reaches the renderer', () => {
  const c = normalizeCanvas({
    blocks: [
      null,
      'not a block',
      { kind: 'nonsense', x: 'left', y: undefined, w: NaN, h: -50 },
      { kind: 'image', x: 99999, y: 10, w: 200, h: 100, props: { src: '/a.png' } },
    ],
  });
  assert.equal(c.blocks.length, 2, 'null and the string are dropped, not drawn at NaN');
  const [odd, img] = c.blocks;
  assert.equal(odd.kind, 'text', 'an unknown kind falls back to text rather than rendering nothing');
  assert.ok(Number.isFinite(odd.x) && Number.isFinite(odd.y) && Number.isFinite(odd.w) && Number.isFinite(odd.h));
  assert.ok(odd.h >= GRID, 'a negative height would make the block unclickable and invisible');
  assert.ok(img.x <= DESIGN_WIDTH - GRID, 'a block cannot be parked off the right edge forever');
});

test('blocks with no id still get distinct ones', () => {
  // They key the React list and the editor selects by them; two blocks sharing "" would be
  // the same block as far as both are concerned.
  const c = normalizeCanvas({ blocks: [{ x: 0, y: 0 }, { x: 0, y: 200 }] });
  assert.equal(new Set(c.blocks.map((b) => b.id)).size, 2);
});

test('placement snaps to the grid so hand-placed blocks line up', () => {
  assert.equal(snap(0), 0);
  assert.equal(snap(GRID / 2 - 1), 0);
  assert.equal(snap(GRID / 2 + 1), GRID);
  const c = canvas([{ x: 13, y: 27, w: 101, h: 99 }]);
  for (const v of [c.blocks[0].x, c.blocks[0].y, c.blocks[0].w, c.blocks[0].h]) {
    assert.equal(v % GRID, 0, `${v} is not on the grid`);
  }
});

test('an empty canvas is a canvas, not a crash', () => {
  for (const input of [undefined, null, {}, { blocks: 'nope' }]) {
    const c = normalizeCanvas(input);
    assert.deepEqual(c.blocks, []);
    assert.ok(c.height >= 240);
    assert.equal(layoutFor(1000, c).mode, 'scale');
  }
});

test('a decorative box keeps a height when the canvas stacks', () => {
  // In the column the parent is auto-height, so `height: 100%` on a block with no content of
  // its own resolves to ZERO and the box vanishes on phones — silently, because nothing
  // errors and the surrounding text still reads fine. The renderer gives a stacked box its
  // design height instead; this pins the shape the renderer relies on.
  const c = canvas([{ id: 'band', kind: 'box', x: 0, y: 0, w: 1200, h: 256 }]);   // 256 = 32 × the grid
  const box = c.blocks[0];
  assert.equal(box.kind, 'box');
  assert.ok(box.h >= GRID, 'a box carries its own height into the stacked rendering');
  assert.equal(box.h, 256);
});

test('every preset lands ready to use — on the grid and inside the canvas', () => {
  // A preset that needs nudging before it looks right teaches the wrong first lesson, and a
  // block placed off the right edge is one the author cannot see or grab.
  for (const preset of CANVAS_PRESETS) {
    const blocks = presetBlocks(preset.id);
    const c = normalizeCanvas({ blocks });
    assert.equal(c.blocks.length, blocks.length, `${preset.id}: normalize dropped a block`);
    assert.equal(new Set(c.blocks.map((x) => x.id)).size, c.blocks.length, `${preset.id}: duplicate ids`);
    for (const x of c.blocks) {
      assert.equal(x.x % GRID, 0, `${preset.id}: x off grid`);
      assert.equal(x.y % GRID, 0, `${preset.id}: y off grid`);
      assert.ok(x.x + x.w <= DESIGN_WIDTH, `${preset.id}: "${x.id}" runs past the right edge`);
      assert.ok(x.w >= GRID && x.h >= GRID, `${preset.id}: zero-sized block`);
    }
  }
});

test('an unknown preset id falls back instead of throwing', () => {
  assert.doesNotThrow(() => presetBlocks('nope'));
  assert.deepEqual(presetBlocks('blank'), []);
});

test('two uses of a preset do not share block ids', () => {
  // They key React lists and the editor selects by them; shared ids would make two blocks the
  // same block as far as both are concerned.
  const a = presetBlocks('split'), b = presetBlocks('split');
  assert.equal(new Set([...a, ...b].map((x) => x.id)).size, a.length + b.length);
});
