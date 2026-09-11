// The phone board, the animations and the button block — the rules, not the pixels.
//
// Everything here is a decision the studio and the public page must agree on, and the way
// they agree is by calling the same function. So the function is what gets tested.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCanvas, layoutFor, phoneBoardBlocks, phoneContentHeight, dragTo, resizeTo, moveMany,
  PHONE_WIDTH, DESIGN_WIDTH, STACK_BELOW, BLOCK_KINDS, ANIM_KINDS, GRID,
  reorder, paintOrder, safeLink, presetBlocks, CANVAS_PRESETS, SHADOWS, HOVER_EFFECTS, GRID_SIZES,
} from '../src/lib/canvas.js';

const B = (id, x, y, w, h, extra = {}) => ({ id, kind: 'text', x, y, w, h, props: { md: id }, ...extra });

describe('the phone board', () => {
  test('a canvas nobody placed on phones still stacks', () => {
    const c = normalizeCanvas({ blocks: [B('a', 0, 0, 600, 100), B('b', 0, 200, 600, 100)] });
    assert.equal(c.phoneBoard, false);
    assert.equal(layoutFor(375, c).mode, 'stack');
  });

  test('one placed block turns the board on for phones, and only for phones', () => {
    const c = normalizeCanvas({ blocks: [B('a', 0, 0, 600, 100, { phone: { x: 16, y: 16, w: 358 } }), B('b', 0, 200, 600, 100)] });
    assert.equal(c.phoneBoard, true);
    assert.equal(layoutFor(375, c).mode, 'phone');
    assert.equal(layoutFor(STACK_BELOW, c).mode, 'scale', 'the desktop plane is untouched');
  });

  test('the board scales down to a narrower phone, never up', () => {
    const c = normalizeCanvas({ phoneBoard: true, blocks: [B('a', 0, 0, 600, 100, { phone: { x: 0, y: 0 } })] });
    assert.ok(Math.abs(layoutFor(320, c).scale - 320 / PHONE_WIDTH) < 1e-9);
    assert.equal(layoutFor(600, c).scale, 1);
    assert.equal(layoutFor(600, c).width, PHONE_WIDTH);
  });

  test('placed blocks keep their place; the rest are laid underneath in reading order', () => {
    // `b` is placed by hand at the top; `a` and `c` were never touched on the phone board.
    // They must appear BELOW b, in the order a reader would meet them on the desktop, full
    // width with a margin — so switching the board on never loses a block.
    const blocks = normalizeCanvas({ blocks: [
      B('a', 0, 0, 500, 80),
      B('b', 600, 0, 500, 120, { phone: { x: 16, y: 16, w: 360 } }),
      B('c', 0, 300, 500, 60),
    ] }).blocks;
    const out = phoneBoardBlocks(blocks);
    assert.deepEqual(out.map((b) => b.id), ['b', 'a', 'c']);
    const [b, a, c] = out;
    assert.equal(b.placed, true); assert.equal(a.placed, false);
    assert.equal(b.x, 16); assert.equal(b.w, 360);
    assert.equal(a.x, 16); assert.equal(a.w, 360, 'full width with a margin, on the grid');
    assert.ok(a.y >= b.y + b.h, 'an unplaced block sits under the placed ones');
    assert.ok(c.y >= a.y + a.h, 'and they do not overlap each other');
  });

  test('a block hidden on phones is not on the phone board either', () => {
    const blocks = normalizeCanvas({ blocks: [B('a', 0, 0, 500, 80, { phone: { hidden: true } }), B('b', 0, 100, 500, 80)] }).blocks;
    assert.deepEqual(phoneBoardBlocks(blocks).map((b) => b.id), ['b']);
  });

  test('phone coordinates are snapped and kept on the 390px board', () => {
    const c = normalizeCanvas({ blocks: [B('a', 0, 0, 500, 80, { phone: { x: 385, y: 13, w: 900 } })] });
    const p = c.blocks[0].phone;
    assert.equal(p.x, PHONE_WIDTH - GRID);
    assert.equal(p.y, 16);
    assert.equal(p.w, PHONE_WIDTH);
  });

  test('the board height follows its content unless pinned', () => {
    const blocks = normalizeCanvas({ blocks: [B('a', 0, 0, 500, 80, { phone: { x: 0, y: 200, h: 96 } })] }).blocks;
    assert.equal(phoneContentHeight(blocks), 336);
    assert.equal(normalizeCanvas({ blocks, phoneHeight: 900 }).phoneHeight, 900);
  });

  test('the movers clamp to the board they are given, not always to 1200', () => {
    const start = { x: 300, y: 0, w: 200, h: 80 };
    assert.equal(dragTo(start, 2000, 0, 1, { width: PHONE_WIDTH }).x, PHONE_WIDTH - 200);
    assert.equal(dragTo(start, 2000, 0, 1).x, DESIGN_WIDTH - 200, 'the default is still the desktop plane');
    const r = resizeTo(start, 'e', 2000, 0, 1, { width: PHONE_WIDTH });
    assert.equal(r.x + r.w, PHONE_WIDTH);
    const moved = moveMany([{ id: 'a', ...start }], ['a'], 2000, 0, 1, { width: PHONE_WIDTH });
    assert.equal(moved[0].x, PHONE_WIDTH - 200);
  });
});

describe('animations', () => {
  test('every kind normalises with its defaults, and junk is "no animation"', () => {
    for (const kind of ANIM_KINDS) {
      const a = normalizeCanvas({ blocks: [B('a', 0, 0, 100, 100, { anim: { kind } })] }).blocks[0].anim;
      assert.equal(a.kind, kind);
      assert.equal(a.trigger, 'show');
      assert.equal(a.duration, 700);
    }
    assert.equal(normalizeCanvas({ blocks: [B('a', 0, 0, 100, 100, { anim: { kind: 'wobble' } })] }).blocks[0].anim, null);
    assert.equal(normalizeCanvas({ blocks: [B('a', 0, 0, 100, 100)] }).blocks[0].anim, null);
  });

  test('the ambient kinds loop unless told not to; an entrance loops only if asked', () => {
    const anim = (o) => normalizeCanvas({ blocks: [B('a', 0, 0, 100, 100, { anim: o })] }).blocks[0].anim;
    assert.equal(anim({ kind: 'pulse' }).loop, true);
    assert.equal(anim({ kind: 'pulse', loop: false }).loop, false);
    assert.equal(anim({ kind: 'fade' }).loop, false);
    assert.equal(anim({ kind: 'fade', loop: true }).loop, true);
  });

  test('timing is clamped and the custom body is kept only for the custom kind', () => {
    const anim = (o) => normalizeCanvas({ blocks: [B('a', 0, 0, 100, 100, { anim: o })] }).blocks[0].anim;
    assert.equal(anim({ kind: 'fade', delay: -5, duration: 1 }).delay, 0);
    assert.equal(anim({ kind: 'fade', delay: -5, duration: 1 }).duration, 50);
    assert.equal(anim({ kind: 'fade', custom: 'x' }).custom, undefined);
    assert.equal(anim({ kind: 'custom', custom: 'from{opacity:0}' }).custom, 'from{opacity:0}');
  });
});

describe('the button block', () => {
  test('is a kind the renderer knows, and keeps its props', () => {
    assert.ok(BLOCK_KINDS.includes('button'));
    const b = normalizeCanvas({ blocks: [{ id: 'b', kind: 'button', x: 0, y: 0, w: 240, h: 56, props: { label: 'Go', variant: 'card', action: { type: 'copy', text: 'hi' } } }] }).blocks[0];
    assert.equal(b.kind, 'button');
    assert.equal(b.props.action.type, 'copy');
  });
});

describe('the layer fields', () => {
  test('name, lock, hide, rotation, shadow, hover and link survive normalisation — and junk does not', () => {
    const b = normalizeCanvas({ blocks: [{ id: 'a', kind: 'box', x: 0, y: 0, w: 200, h: 100,
      name: 'Hero band', locked: true, hidden: true, rotate: 400, shadow: 'md', hover: 'lift', link: '/docs' }] }).blocks[0];
    assert.equal(b.name, 'Hero band');
    assert.equal(b.locked, true);
    assert.equal(b.hidden, true);
    assert.equal(b.rotate, 180, 'rotation is clamped to ±180');
    assert.equal(b.shadow, 'md');
    assert.equal(b.hover, 'lift');
    assert.equal(b.link, '/docs');
    const junk = normalizeCanvas({ blocks: [{ id: 'j', kind: 'box', x: 0, y: 0, w: 200, h: 100,
      name: 42, locked: 'yes', rotate: 'x', shadow: 'huge', hover: 'explode', link: 'javascript:alert(1)' }] }).blocks[0];
    assert.equal(junk.name, '');
    assert.equal(junk.locked, false);
    assert.equal(junk.hidden, false);
    assert.equal(junk.rotate, 0);
    assert.equal(junk.shadow, '');
    assert.equal(junk.hover, '');
    assert.equal(junk.link, '', 'a javascript: link never reaches an href');
  });

  test('a block link is a same-site path, an anchor, https or mailto — nothing else', () => {
    assert.equal(safeLink('/hosting'), '/hosting');
    assert.equal(safeLink('#plans'), '#plans');
    assert.equal(safeLink('https://example.org/x'), 'https://example.org/x');
    assert.equal(safeLink('mailto:hi@example.org'), 'mailto:hi@example.org');
    assert.equal(safeLink('//evil.example'), '', 'protocol-relative is another host');
    assert.equal(safeLink('data:text/html,hi'), '');
    assert.equal(safeLink(' JAVASCRIPT:void(0)'), '');
  });

  test('the grid step is one of the offered sizes and defaults to 8', () => {
    assert.equal(normalizeCanvas({ grid: 16 }).grid, 16);
    assert.equal(normalizeCanvas({ grid: 7 }).grid, GRID);
    assert.equal(normalizeCanvas({}).grid, GRID);
    assert.ok(GRID_SIZES.includes(GRID));
  });

  test('reorder swaps a block with its paint-order neighbour, and stops at the ends', () => {
    const blocks = [B('a', 0, 0, 100, 100, { z: 0 }), B('b', 0, 0, 100, 100, { z: 0 }), B('c', 0, 0, 100, 100, { z: 5 })];
    // a and b tie on z; array order paints a under b. Moving a up puts it over b, under c.
    const up = reorder(blocks, 'a', 'up');
    assert.deepEqual(paintOrder(up).map((b) => b.id), ['b', 'a', 'c']);
    const top = reorder(reorder(blocks, 'a', 'up'), 'a', 'up');
    assert.deepEqual(paintOrder(top).map((b) => b.id), ['b', 'c', 'a']);
    assert.equal(reorder(top, 'a', 'up'), top, 'already on top: unchanged');
    assert.equal(reorder(blocks, 'a', 'down'), blocks, 'already at the bottom: unchanged');
    assert.equal(reorder(blocks, 'nope', 'up'), blocks);
  });

  test('the two new presets are on the grid, inside the design width, and carry valid effects', () => {
    for (const id of ['cta', 'gallery']) {
      assert.ok(CANVAS_PRESETS.some((p) => p.id === id), id);
      const blocks = normalizeCanvas({ blocks: presetBlocks(id) }).blocks;
      assert.ok(blocks.length >= 4, id);
      for (const b of blocks) {
        assert.equal(b.x % GRID, 0); assert.equal(b.y % GRID, 0);
        assert.ok(b.x + b.w <= DESIGN_WIDTH, `${id}: ${b.id} inside`);
        if (b.shadow) assert.ok(SHADOWS.includes(b.shadow));
        if (b.hover) assert.ok(HOVER_EFFECTS.includes(b.hover));
      }
      // Normalising did not throw the effects away: the preset's author set them on purpose.
      assert.ok(blocks.some((b) => b.hover === 'lift'), `${id}: a lift on hover`);
    }
  });
});
