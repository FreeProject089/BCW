// The editor's operations, on the board being EDITED (PLAN-STUDIO-2026 phase 1, bug A).
//
// A.1  The page height froze at the first edit: `emit()` wrote back the height normalisation
//      had COMPUTED, the next normalisation read it as pinned, and every block added below
//      was cut, in the editor and for visitors. canvas.test.mjs tested normalizeCanvas alone,
//      never the round trip through a save, which is why it stayed green. This is that test.
// A.2  On the phone board half the tools worked in DESKTOP coordinates: aligning on the phone
//      moved the desktop page. Each operation is now a pure function that reads the board it
//      is given and writes to that board's layer only.
// A.3  The first drag of an unplaced block on the phone board changed its width.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../src/lib/canvas.js';

const { normalizeCanvas, contentHeight, phoneBoardBlocks, PHONE_WIDTH, DESIGN_WIDTH } = lib;
const fn = (name) => { assert.equal(typeof lib[name], 'function', `${name} is not exported`); return lib[name]; };
const B = (id, x, y, w, h, extra = {}) => ({ id, kind: 'box', x, y, w, h, props: {}, ...extra });
const desktop = (c) => c.blocks.map((b) => [b.id, b.x, b.y, b.w, b.h].join(':'));

describe('A.1: the height is never frozen by a save', () => {
  test('a round trip through serialisation does not pin the computed height', () => {
    const serializeCanvas = fn('serializeCanvas');
    const raw = { id: 'c1', title: 'p', blocks: [B('a', 0, 0, 200, 100)] };
    const norm = normalizeCanvas(raw);
    const stored = serializeCanvas(norm, raw);
    assert.equal(stored.height, undefined, 'the computed height was written back as if pinned');
    assert.equal(stored.phoneHeight, undefined, 'the computed phone height was written back');
    assert.equal(stored.phoneBoard, undefined, 'the derived phoneBoard flag was written back');
    // Now add a block below everything, the way add() does, and read it back.
    const added = { ...stored, blocks: [...norm.blocks, B('n', 64, contentHeight(norm.blocks) + 24, 300, 200)] };
    const again = normalizeCanvas(added);
    const n = again.blocks.find((b) => b.id === 'n');
    assert.ok(n.y + n.h <= again.height, `the new block ends at ${n.y + n.h} but the page is ${again.height} tall: it is cut`);
  });

  test('an author-pinned height survives the round trip', () => {
    const serializeCanvas = fn('serializeCanvas');
    const raw = { id: 'c1', height: 2000, phoneHeight: 1500, phoneBoard: true, blocks: [B('a', 0, 0, 200, 100)] };
    const stored = serializeCanvas(normalizeCanvas(raw), raw);
    assert.equal(stored.height, 2000);
    assert.equal(stored.phoneHeight, 1500);
    assert.equal(stored.phoneBoard, true);
    // ... and one set by the height handle in this very edit.
    assert.equal(serializeCanvas(normalizeCanvas({ blocks: [] }), {}, { height: 900 }).height, 900);
  });

  test('D4: a stored height shorter than the content grows to the content', () => {
    // The pages the bug already froze: a block below the stored height must be visible.
    const c = normalizeCanvas({ height: 300, phoneHeight: 300, blocks: [B('a', 0, 600, 200, 200, { phone: { x: 0, y: 700, h: 100 } })] });
    assert.ok(c.height >= 800, `height ${c.height} still cuts a block ending at 800`);
    assert.ok(c.phoneHeight >= 800, `phone height ${c.phoneHeight} still cuts a block ending at 800`);
  });
});

describe('A.2: operations on the phone board touch the phone board only', () => {
  const doc = () => normalizeCanvas({ id: 'c', blocks: [
    B('a', 96, 40, 400, 100, { phone: { x: 16, y: 16, w: 200, h: 80 } }),
    B('b', 704, 40, 300, 100, { phone: { x: 120, y: 200, w: 100, h: 80 } }),
    B('c', 96, 400, 496, 120),   // never placed on the phone
  ] });

  test('the view of a board is what the editor draws', () => {
    const boardBlocks = fn('boardBlocks');
    const c = doc();
    assert.deepEqual(boardBlocks(c, 'phone').map((b) => b.id).sort(), ['a', 'b', 'c']);
    assert.equal(boardBlocks(c, 'phone').find((b) => b.id === 'b').x, 120, 'the phone view reads the phone place');
    assert.equal(boardBlocks(c, 'light').find((b) => b.id === 'b').x, 704);
  });

  test('marquee selection tests the phone geometry', () => {
    const boardBlocks = fn('boardBlocks');
    const hit = lib.blocksInRect(boardBlocks(doc(), 'phone'), { x: 110, y: 190, w: 50, h: 50 }).map((b) => b.id);
    assert.deepEqual(hit, ['b'], 'the rubber band used the desktop coordinates');
  });

  test('align, distribute and same-size write the phone layer, never the desktop one', () => {
    const alignOnBoard = fn('alignOnBoard');
    const c = doc();
    const out = alignOnBoard(c, ['a', 'b'], 'left', 'phone');
    const next = normalizeCanvas({ ...c, ...out.extra, blocks: out.blocks });
    assert.deepEqual(desktop(next), desktop(c), 'aligning on the phone moved the desktop page');
    assert.equal(next.blocks.find((b) => b.id === 'b').phone.x, 16, 'the phone layer was not aligned');
    const same = fn('matchSizeOnBoard')(c, ['a', 'b'], 'w', 'phone');
    const n2 = normalizeCanvas({ ...c, blocks: same.blocks });
    assert.deepEqual(desktop(n2), desktop(c), 'same width on the phone changed the desktop page');
    assert.equal(n2.blocks.find((b) => b.id === 'b').phone.w, 200);
    const dist = fn('distributeOnBoard')(c, ['a', 'b', 'c'], 'y', 'phone');
    assert.deepEqual(desktop(normalizeCanvas({ ...c, blocks: dist.blocks })), desktop(c), 'distributing on the phone changed the desktop page');
  });

  test('on the desktop board they write the desktop base, as before', () => {
    const c = doc();
    const out = fn('alignOnBoard')(c, ['a', 'b'], 'top', 'light');
    assert.equal(out.blocks.find((b) => b.id === 'b').y, 40);
    const moved = fn('alignOnBoard')(c, ['a', 'c'], 'left', 'light');
    assert.equal(moved.blocks.find((b) => b.id === 'c').phone, null, 'a desktop align wrote a phone place');
  });

  test('on the dark board they write the dark overlay', () => {
    const c = doc();
    const out = fn('alignOnBoard')(c, ['a', 'b'], 'left', 'dark');
    assert.equal(out.blocks.find((b) => b.id === 'b').x, 704, 'a dark align moved the light layout');
    assert.equal(out.blocks.find((b) => b.id === 'b').themes.dark.x, 96);
  });

  test('duplicate on the phone: the copy is offset ON THE PHONE, the desktop copy stays sane', () => {
    const duplicateOnBoard = fn('duplicateOnBoard');
    let n = 0;
    const c = normalizeCanvas({ blocks: [B('w', 900, 40, 400, 100, { phone: { x: 16, y: 16, w: 358, h: 80 } })] });
    const out = duplicateOnBoard(c, ['w'], 'phone', () => `d${n++}`);
    const copy = out.blocks.find((b) => b.id === out.ids[0]);
    assert.notEqual(copy.phone.y, 16, 'the copy lands exactly on the original on the phone');
    assert.ok(copy.x >= 0 && copy.x + copy.w <= DESIGN_WIDTH, `the desktop copy was clamped into the phone width: x=${copy.x}`);
    assert.equal(copy.x, 800, 'a 400px block at 900 duplicated on the phone should keep its desktop place inside 1200');
    assert.equal(out.blocks.find((b) => b.id === 'w').phone.y, 16, 'the original moved');
  });

  test('new blocks (add, paste, component) get a place on the phone board, inside it, and keep their desktop layout', () => {
    const placeOnBoard = fn('placeOnBoard');
    const c = doc();
    const fresh = [B('n1', 600, 900, 480, 100), B('n2', 700, 1020, 300, 60)];
    const out = placeOnBoard(c, fresh, 'phone');
    const n1 = out.blocks.find((b) => b.id === 'n1'); const n2 = out.blocks.find((b) => b.id === 'n2');
    assert.equal(n1.x, 600, 'the desktop layout of a new block was squeezed into 390px');
    assert.equal(n2.x, 700);
    for (const b of [n1, n2]) {
      assert.ok(b.phone && b.phone.x != null && b.phone.y != null, `${b.id} has no place on the phone`);
      assert.ok(b.phone.x >= 0 && b.phone.x + b.phone.w <= PHONE_WIDTH, `${b.id} sticks out of the phone board`);
    }
    const bottom = Math.max(...phoneBoardBlocks(c.blocks).map((b) => b.y + b.h));
    assert.ok(n1.phone.y >= bottom, 'a new block landed on top of the existing phone layout');
    assert.ok(n2.phone.y > n1.phone.y, 'the group lost its arrangement on the phone');
    // On the desktop board nothing about the phone is invented.
    assert.equal(placeOnBoard(c, fresh, 'light').blocks.find((b) => b.id === 'n1').phone, undefined);
  });
});

describe('A.3: the first drag on the phone board keeps the width', () => {
  test('an unplaced block keeps the width it is drawn at when it is first moved', () => {
    const dragOnBoard = fn('dragPatch');
    const c = normalizeCanvas({ blocks: [B('btn', 0, 0, 240, 56)] });
    const view = phoneBoardBlocks(c.blocks).find((b) => b.id === 'btn');
    const patchv = dragOnBoard(view, { x: 40, y: 40 }, 'phone');
    const next = normalizeCanvas({ ...c, blocks: c.blocks.map((b) => (b.id === 'btn' ? { ...b, phone: { ...(b.phone || {}), ...patchv } } : b)) });
    const after = phoneBoardBlocks(next.blocks).find((b) => b.id === 'btn');
    assert.equal(after.w, view.w, `the block jumped from ${view.w} to ${after.w} on its first move`);
    assert.equal(after.h, view.h);
    // On the desktop a drag stays a move.
    assert.deepEqual(dragOnBoard(view, { x: 40, y: 40 }, 'light'), { x: 40, y: 40 });
  });
});
