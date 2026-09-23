// The three things a canvas gained: opacity, a per-theme overlay, and an authored phone order.
//
// All three are OVERLAYS, and an overlay has one interesting failure: filling in what the
// author never wrote. A theme override that returns a complete block freezes every coordinate
// the author did not touch, so nudging a hero 20px on the dark theme silently pins its width
// and height there for ever — and nobody finds out until they move it on the light theme and
// the dark one stops following.
//
// The phone order has the mirror of that: a naive "authored ones first, then the rest" moves
// blocks nobody asked to move.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCanvas, resolveBlock, phoneOrder, readingOrder, BLOCK_KINDS, keepsHeightStacked } from '../src/lib/canvas.js';

const canvas = (blocks) => normalizeCanvas({ blocks });
const B = (o) => ({ id: o.id, kind: o.kind || 'text', x: o.x ?? 0, y: o.y ?? 0, w: o.w ?? 320, h: o.h ?? 120, ...o });

describe('the new kinds', () => {
  test('every kind the editor can make survives normalising', () => {
    for (const kind of BLOCK_KINDS) {
      const c = canvas([B({ id: 'a', kind })]);
      assert.equal(c.blocks[0].kind, kind, `${kind} was not kept`);
    }
  });
  test('an unknown kind becomes text rather than disappearing', () => {
    assert.equal(canvas([B({ id: 'a', kind: 'iframe-of-doom' })]).blocks[0].kind, 'text');
  });
  test('the kinds with no intrinsic height keep it in a stack', () => {
    // `box` collapsed to nothing in a column before this rule existed; video, embed and
    // replay are the same shape of thing and would have collapsed the same way.
    for (const k of ['box', 'video', 'embed', 'replay']) assert.ok(keepsHeightStacked(k), `${k} would collapse`);
    for (const k of ['text', 'image']) assert.ok(!keepsHeightStacked(k), `${k} should size itself`);
  });
});

describe('opacity', () => {
  test('defaults to fully opaque, and is clamped rather than trusted', () => {
    assert.equal(canvas([B({ id: 'a' })]).blocks[0].opacity, 1);
    assert.equal(canvas([B({ id: 'a', opacity: 0.4 })]).blocks[0].opacity, 0.4);
    assert.equal(canvas([B({ id: 'a', opacity: 5 })]).blocks[0].opacity, 1);
    assert.equal(canvas([B({ id: 'a', opacity: -2 })]).blocks[0].opacity, 0);
    assert.equal(canvas([B({ id: 'a', opacity: 'nope' })]).blocks[0].opacity, 1);
  });
});

describe('the theme overlay', () => {
  // Grid-aligned on purpose: normalizeCanvas snaps every coordinate to GRID, so a test written
  // with 100 and 50 asserts against 104 and 48 and reads like a bug in the overlay.
  const base = canvas([B({ id: 'a', x: 96, y: 48, w: 400, h: 200, props: { md: 'hi', align: 'center' },
    themes: { dark: { y: 80, opacity: 0.5, props: { md: 'dark hi' } } } })]).blocks[0];

  test('light is the block itself when nothing was written for it', () => {
    assert.equal(resolveBlock(base, 'light'), base);
  });

  test('dark applies only what was written', () => {
    const d = resolveBlock(base, 'dark');
    assert.equal(d.y, 80);
    assert.equal(d.opacity, 0.5);
    // The fields the author never touched must still be the base's — this is the whole point.
    assert.equal(d.x, 96);
    assert.equal(d.w, 400);
    assert.equal(d.h, 200);
  });

  test('props MERGE — an overlay that changes one prop must not drop the others', () => {
    const d = resolveBlock(base, 'dark');
    assert.equal(d.props.md, 'dark hi');
    // CHANGED in studio phase 3: the fixture's second prop was `alt`, which a TEXT block
    // never reads and the per-kind allow-list now drops; `align` is one it does read.
    assert.equal(d.props.align, 'center', 'a prop the overlay did not name was dropped by the dark overlay');
  });

  test('a block can be hidden in one theme only', () => {
    const b = canvas([B({ id: 'a', themes: { light: { hidden: true } } })]).blocks[0];
    assert.equal(resolveBlock(b, 'light').hidden, true);
    assert.ok(!resolveBlock(b, 'dark').hidden);
  });

  test('junk in the stored overlay is dropped, not drawn at NaN', () => {
    const b = canvas([B({ id: 'a', x: 16, themes: { dark: { x: 'left', w: null, opacity: 'half', props: 7 } } })]).blocks[0];
    const d = resolveBlock(b, 'dark');
    assert.equal(d.x, 16);
    assert.ok(Number.isFinite(d.w));
    assert.equal(d.opacity, 1);
  });

  test('an unknown theme name behaves like light, never like empty', () => {
    assert.equal(resolveBlock(base, 'sepia').y, 48);
  });
});

describe('the phone order', () => {
  // Four blocks that read a, b, c, d top to bottom.
  const four = canvas([
    B({ id: 'a', y: 0 }), B({ id: 'b', y: 200 }), B({ id: 'c', y: 400 }), B({ id: 'd', y: 600 }),
  ]).blocks;
  const ids = (list) => list.map((b) => b.id);

  test('with nothing authored it IS the reading order', () => {
    assert.deepEqual(ids(phoneOrder(four)), ids(readingOrder(four)));
    assert.deepEqual(ids(phoneOrder(four)), ['a', 'b', 'c', 'd']);
  });

  test('moving ONE block leaves the others where they were', () => {
    // The naive implementation — authored first, then the rest — answers d,a,b,c here, which
    // moves three blocks nobody touched.
    const blocks = canvas([
      B({ id: 'a', y: 0 }), B({ id: 'b', y: 200 }), B({ id: 'c', y: 400 }),
      B({ id: 'd', y: 600, phone: { order: 1.5 } }),
    ]).blocks;
    assert.deepEqual(ids(phoneOrder(blocks)), ['a', 'b', 'd', 'c']);
  });

  test('a block hidden on phones is not in the list at all', () => {
    const blocks = canvas([B({ id: 'a', y: 0 }), B({ id: 'b', y: 200, phone: { hidden: true } }), B({ id: 'c', y: 400 })]).blocks;
    assert.deepEqual(ids(phoneOrder(blocks)), ['a', 'c']);
  });

  test('two blocks claiming the same slot keep their reading order between them', () => {
    const blocks = canvas([
      B({ id: 'a', y: 0, phone: { order: 0 } }), B({ id: 'b', y: 200, phone: { order: 0 } }), B({ id: 'c', y: 400 }),
    ]).blocks;
    assert.deepEqual(ids(phoneOrder(blocks)), ['a', 'b', 'c']);
  });

  test('an empty phone object is the same as none — not an order of zero', () => {
    const blocks = canvas([B({ id: 'a', y: 0 }), B({ id: 'b', y: 200, phone: {} }), B({ id: 'c', y: 400 })]).blocks;
    assert.equal(blocks[1].phone, null);
    assert.deepEqual(ids(phoneOrder(blocks)), ['a', 'b', 'c']);
  });

  test('phone height is authored per block, and never below the grid', () => {
    const b = canvas([B({ id: 'a', phone: { h: 3 } })]).blocks[0];
    assert.ok(b.phone.h >= 8, `phone height ${b.phone.h} would be invisible`);
  });
});

describe('an old canvas still normalises', () => {
  test('no opacity, no themes, no phone — and nothing throws', () => {
    const c = normalizeCanvas({ blocks: [{ id: 'x', kind: 'text', x: 0, y: 0, w: 300, h: 100, props: { md: 'hi' } }] });
    const b = c.blocks[0];
    assert.equal(b.opacity, 1);
    assert.deepEqual(b.themes, {});
    assert.equal(b.phone, null);
    assert.equal(resolveBlock(b, 'dark'), b);
  });
});
