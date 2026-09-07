// Selecting and moving several blocks at once.
//
// The failures here are the ones that make a multi-select feel broken rather than look broken:
// a rubber band that misses what it crossed, a group that collapses against the canvas edge,
// an "align left" that also moves the blocks you did not select. None of them throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsOf, blocksInRect, moveMany, alignMany, distributeMany,
  DESIGN_WIDTH, GRID,
} from '../src/lib/canvas.js';

const b = (id, x, y, w = 100, h = 50) => ({ id, x, y, w, h, z: 0, kind: 'box', props: {} });

test('the bounding box wraps the whole selection', () => {
  const bb = boundsOf([b('a', 100, 100), b('b', 300, 200, 200, 100)]);
  assert.deepEqual(bb, { x: 100, y: 100, w: 400, h: 200 });
});

test('a marquee takes what it TOUCHES, not only what it swallows', () => {
  // Containment-only is the version that feels broken: dragging across a wide hero to catch
  // the two captions sitting on it would select neither, because the hero is not contained
  // and the captions are under the pointer path rather than inside the box you managed to draw.
  const blocks = [b('hero', 0, 0, 1200, 300), b('cap', 80, 120), b('far', 0, 900)];
  const hit = blocksInRect(blocks, { x: 60, y: 100, w: 200, h: 100 }).map((x) => x.id);
  assert.deepEqual(hit.sort(), ['cap', 'hero']);
  assert.ok(!hit.includes('far'));
});

test('a marquee dragged up-and-left works too', () => {
  // A negative-width rect is what you get dragging from bottom-right to top-left, and it is
  // half of all rubber-band gestures.
  const blocks = [b('a', 100, 100)];
  assert.equal(blocksInRect(blocks, { x: 300, y: 300, w: -250, h: -250 }).length, 1);
});

test('moving a selection keeps its shape', () => {
  const blocks = [b('a', 100, 100), b('b', 300, 100)];
  const out = moveMany(blocks, ['a', 'b'], 80, 40, 1);
  assert.equal(out[1].x - out[0].x, 200, 'the gap between them is unchanged');
  assert.equal(out[0].y, out[1].y, 'and they stay level');
});

test('a selection clamps as a GROUP at the edge, and does not pile up', () => {
  // Clamping each block on its own is the bug: drag a row towards the right wall and the
  // leading blocks stop while the trailing ones keep coming, so a row you spaced carefully
  // collapses into a heap against the edge.
  const blocks = [b('a', 800, 100), b('b', 1000, 100)];   // b's right edge is at 1100
  const out = moveMany(blocks, ['a', 'b'], 5000, 0, 1);
  assert.equal(out[1].x + out[1].w, DESIGN_WIDTH, 'the trailing block lands exactly on the edge');
  assert.equal(out[1].x - out[0].x, 200, 'and the gap survived the clamp');
  assert.ok(out[0].x < out[1].x);
});

test('a selection cannot be pushed above the canvas', () => {
  const out = moveMany([b('a', 100, 40), b('b', 300, 120)], ['a', 'b'], 0, -5000, 1);
  assert.equal(Math.min(out[0].y, out[1].y), 0);
  assert.equal(out[1].y - out[0].y, 80, 'the vertical gap survived');
});

test('a drag is scaled for a selection exactly as for one block', () => {
  const out = moveMany([b('a', 96, 96)], ['a'], 40, 0, 0.5);
  assert.equal(out[0].x, 176, '40 screen px at 0.5 is 80 design px');
});

test('align left, centre and right, on the selection only', () => {
  const blocks = [b('a', 100, 0, 100), b('b', 300, 60, 200), b('other', 700, 300, 100)];
  const left = alignMany(blocks, ['a', 'b'], 'left');
  assert.equal(left[0].x, 100); assert.equal(left[1].x, 100);
  assert.equal(left[2].x, 700, 'a block outside the selection is never moved');

  const right = alignMany(blocks, ['a', 'b'], 'right');
  // The box spans 100..500, so both right edges land on 500.
  assert.equal(right[0].x + right[0].w, 500);
  assert.equal(right[1].x + right[1].w, 500);

  const centre = alignMany(blocks, ['a', 'b'], 'hcenter');
  const mid = (x) => x.x + x.w / 2;
  assert.ok(Math.abs(mid(centre[0]) - mid(centre[1])) <= GRID, 'centres agree within a grid step');
});

test('aligning fewer than two blocks changes nothing', () => {
  const blocks = [b('a', 100, 100)];
  assert.deepEqual(alignMany(blocks, ['a'], 'left'), blocks);
  assert.deepEqual(alignMany(blocks, [], 'left'), blocks);
});

test('distribute evens the GAPS, and pins the outermost two', () => {
  // Different widths on purpose: spacing by equal centres would look wrong here, and looking
  // right is the entire job.
  const blocks = [b('a', 0, 0, 100), b('m', 150, 0, 300), b('z', 900, 0, 100)];
  const out = distributeMany(blocks, ['a', 'm', 'z'], 'x');
  const by = Object.fromEntries(out.map((x) => [x.id, x]));
  assert.equal(by.a.x, 0, 'first pinned');
  assert.equal(by.z.x, 900, 'last pinned');
  const gap1 = by.m.x - (by.a.x + by.a.w);
  const gap2 = by.z.x - (by.m.x + by.m.w);
  assert.ok(Math.abs(gap1 - gap2) <= GRID, `gaps should match, got ${gap1} and ${gap2}`);
});

test('distribute needs three blocks', () => {
  const blocks = [b('a', 0, 0), b('z', 900, 0)];
  assert.deepEqual(distributeMany(blocks, ['a', 'z'], 'x'), blocks, 'two blocks have one gap');
});

test('everything leaves unselected blocks byte-identical', () => {
  const blocks = [b('a', 100, 100), b('b', 300, 100), b('keep', 700, 700, 123, 45)];
  const untouched = JSON.stringify(blocks[2]);
  for (const out of [
    moveMany(blocks, ['a', 'b'], 50, 50, 1),
    alignMany(blocks, ['a', 'b'], 'top'),
    distributeMany([...blocks, b('c', 500, 100)], ['a', 'b', 'c'], 'x'),
  ]) {
    assert.equal(JSON.stringify(out.find((x) => x.id === 'keep')), untouched);
  }
});
