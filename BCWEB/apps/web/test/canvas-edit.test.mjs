// Drag, resize, snap and z-order.
//
// None of this is verifiable by clicking around, which is why it is pure and tested here: the
// failures are half a pixel of drift per frame and a handle that moves the wrong edge, and
// both look fine for the first few drags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragTo, resizeTo, alignmentGuides, bringTo, GRID, BOUND } from '../src/lib/canvas.js';

// 96/200/96 are all multiples of the 8px grid: an off-grid fixture would make every
// expectation below also an assertion about snapping, which has its own test.
const B = (o = {}) => ({ id: 'b', x: 96, y: 96, w: 200, h: 96, z: 0, ...o });

test('a drag follows the cursor at any scale', () => {
  const start = B();
  // At 100% a 40px move is 40 design px.
  assert.deepEqual(dragTo(start, 40, 40, 1), { x: 136, y: 136 });
  // At 50% the SAME 40px of mouse travel is 80 design px. Missing this is the classic bug:
  // the block lags the cursor, and further the more you drag.
  assert.deepEqual(dragTo(start, 40, 40, 0.5), { x: 176, y: 176 });
  // Zoomed IN, the same travel is half the design distance: 96 + 40/2 = 116, which is not on
  // the 8px grid, so it lands on 120. Snapping applies after the scale, not before it.
  assert.deepEqual(dragTo(start, 40, 40, 2), { x: 120, y: 120 });
});

test('a drag is measured from where it began, so nothing creeps', () => {
  // Twenty frames of a slow drag, each computed from the ORIGINAL position. If the code
  // accumulated snapped deltas instead, sub-grid movement would round away every frame and
  // the block would drift behind the pointer — invisible once, obvious after twenty.
  const start = B({ x: 0, y: 0 });
  let last = null;
  for (let f = 1; f <= 20; f++) last = dragTo(start, f * 3, 0, 1);
  assert.equal(last.x, Math.round(60 / GRID) * GRID, 'ends where 60px of travel should land');
});

// CHANGED in studio phase 3 (PLAN-STUDIO-2026): this was "a block cannot be dragged out of
// reach" and asserted the v1 clamp (x >= 0, y >= 0, right edge at 1200), the rule phase 3
// exists to remove. On the v2 board a block goes anywhere, stays grabbable in the editor and
// is simply not shown to a reader; only the ±BOUND guard rail stops it.
test('v2: a block goes off the page in every direction, and only the guard rail stops it', () => {
  const start = B({ x: 0, y: 0, w: 200 });
  assert.deepEqual(dragTo(start, -500, -500, 1), { x: -496, y: -496 }, 'off the left and above the page, on the grid');
  assert.equal(dragTo(start, 5000, 0, 1).x, 5000, 'past the right edge of the frame');
  assert.equal(dragTo(start, -1e9, 1e9, 1).x, -BOUND, 'the guard rail, not the page, is the limit');
  assert.equal(dragTo(start, -1e9, 1e9, 1).y, BOUND);
  // And back: the same block, dragged home from far off the page, lands where it started.
  const away = dragTo(start, -2400, -800, 1);
  assert.deepEqual(dragTo({ ...start, ...away }, 2400, 800, 1), { x: 0, y: 0 });
});

test('holding the snap off gives pixel placement', () => {
  assert.deepEqual(dragTo(B({ x: 0, y: 0 }), 13, 27, 1, { snap: false }), { x: 13, y: 27 });
  assert.deepEqual(dragTo(B({ x: 0, y: 0 }), 13, 27, 1), { x: 16, y: 24 });
});

test('a south-east handle changes size only', () => {
  const r = resizeTo(B(), 'se', 80, 40, 1);
  assert.deepEqual(r, { x: 96, y: 96, w: 280, h: 136 });
});

test('a north-west handle moves the origin AND the size, keeping the far corner still', () => {
  const start = B();                       // 96,96 200x96 → right edge 296, bottom 192
  const r = resizeTo(start, 'nw', 40, 40, 1);
  assert.equal(r.x, 136); assert.equal(r.y, 136);
  assert.equal(r.x + r.w, 296, 'the right edge must not move');
  assert.equal(r.y + r.h, 192, 'the bottom edge must not move');
});

test('a west handle keeps the right edge still at a scale other than 1', () => {
  const start = B();
  const r = resizeTo(start, 'w', 40, 0, 0.5);   // 40 screen px = 80 design px
  assert.equal(r.x, 176);
  assert.equal(r.x + r.w, 296);
  assert.equal(r.h, start.h, 'a horizontal handle leaves the height alone');
});

test('resizing snaps the EDGES, not the size', () => {
  // Snapping width alone would leave the far edge off-grid — the exact misalignment the grid
  // exists to prevent.
  const r = resizeTo(B({ x: 96, w: 200 }), 'e', 13, 0, 1);
  assert.equal((r.x + r.w) % GRID, 0);
  assert.equal(r.x % GRID, 0);
});

test('a block stops at its minimum instead of inverting', () => {
  const start = B({ x: 96, w: 200 });
  const r = resizeTo(start, 'w', 5000, 0, 1);   // drag the left edge far past the right one
  assert.ok(r.w >= GRID * 2, 'never negative — a negative width renders as nothing');
  assert.ok(r.x + r.w <= 296 + GRID, 'and it collapses against the edge it was anchored to');
  const r2 = resizeTo(start, 'e', -5000, 0, 1);
  assert.ok(r2.w >= GRID * 2);
  assert.equal(r2.x, 96, 'an east drag never moves the left edge');
});

test('guides find the nearest edge of another block, not just any', () => {
  const others = [B({ id: 'a', x: 400, y: 100, w: 200, h: 100 })];
  // Moving block's left edge at 396 is 4px from the other's left edge (400).
  const g = alignmentGuides(B({ id: 'm', x: 396, y: 500, w: 100, h: 50 }), others);
  assert.equal(g.v.at, 400);
  assert.equal(g.v.delta, 4, 'and it reports how far to nudge');
  assert.equal(g.h, null, 'nothing is near vertically');
});

test('guides ignore the block being moved and anything out of tolerance', () => {
  const m = B({ id: 'm', x: 100, y: 100, w: 100, h: 50 });
  assert.equal(alignmentGuides(m, [m]).v, null, 'a block does not snap to itself');
  assert.equal(alignmentGuides(m, [B({ id: 'far', x: 900, y: 900, w: 10, h: 10 })]).v, null);
});

test('front and back do not renumber every other block', () => {
  const blocks = [B({ id: 'a', z: 0 }), B({ id: 'b', z: 5 }), B({ id: 'c', z: 2 })];
  const front = bringTo(blocks, 'a', 'front');
  assert.equal(front.find((b) => b.id === 'a').z, 6);
  assert.deepEqual(front.filter((b) => b.id !== 'a').map((b) => b.z), [5, 2], 'others untouched');
  const back = bringTo(blocks, 'b', 'back');
  assert.ok(back.find((b) => b.id === 'b').z < 0);
});
