// The studio document v2 and the free board (PLAN-STUDIO-2026, phase 3).
//
// Four promises, each one that clicking around cannot check:
//   · a v1 page read through the v2 code is laid out EXACTLY as v1 laid it out (fixtures:
//     the real stored pages of the dev DB, anonymised, plus synthetic edge cases, each with
//     the geometry the v1 code computed, recorded from that code before it was replaced);
//   · a drag lands under the pointer at any zoom, anywhere on the board, negative included;
//   · a zoom (wheel, buttons, two fingers) keeps the board point under the pointer still;
//   · a reader never gets a block that is entirely outside the frame.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as lib from '../src/lib/canvas.js';
import * as pkg from '../../../packages/studio/src/index.js';

const {
  normalizeDoc, serializeDoc, migrate, validateDoc, dragTo, moveMany, resizeTo, frameBlocks, inFrame,
  toBoard, toScreen, zoomAt, wheelZoom, pinchView, fitFrameView, showAllView, revealView, offFrameIds,
  phoneBoardBlocks, ZOOM_MIN, ZOOM_MAX, BOUND,
} = lib;

const FIXTURES = JSON.parse(fs.readFileSync(new URL('./fixtures/studio-v1-docs.json', import.meta.url), 'utf8'));

describe('v1 to v2 migration, on stored pages', () => {
  test('there are real stored pages in the corpus, not only made-up ones', () => {
    assert.ok(FIXTURES.some((f) => /dev DB/.test(f.source)));
    assert.ok(FIXTURES.length >= 10);
  });
  for (const f of FIXTURES) {
    test(`${f.name}: same geometry as v1, same heights, same phone board`, () => {
      const n = normalizeDoc(f.doc);
      assert.equal(n.v, 2);
      assert.equal(n.id, f.v1.id);
      assert.equal(n.height, f.v1.height, 'desktop frame height');
      assert.equal(n.phoneHeight, f.v1.phoneHeight, 'phone frame height');
      assert.equal(n.phoneBoard, f.v1.phoneBoard, 'phone mode');
      assert.equal(n.blocks.length, f.v1.blocks.length);
      n.blocks.forEach((b, i) => {
        const o = f.v1.blocks[i];
        assert.deepEqual({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h }, { id: o.id, x: o.x, y: o.y, w: o.w, h: o.h }, `block ${o.id}`);
        assert.deepEqual(b.phone, o.phone ?? null, `phone place of ${o.id}`);
        if (o.dark) for (const k of ['x', 'y', 'w', 'h']) assert.equal(b.themes.dark?.[k], o.dark[k] ?? undefined, `dark ${k} of ${o.id}`);
        // Every migrated block is ON the page: nothing a v1 reader saw disappears.
        assert.ok(inFrame(b, n.frames.desktop), `${o.id} fell off the frame in migration`);
      });
      if (f.v1.phoneBoardBlocks) {
        const pb = phoneBoardBlocks(n.blocks, 40, n.frames.desktop).map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h }));
        assert.deepEqual(pb, f.v1.phoneBoardBlocks, 'the phone board lays out as it did');
      }
      // Stored as v2 and read back: stable, and accepted by the validator.
      const stored = serializeDoc(n);
      assert.deepEqual(normalizeDoc(stored), n, 'a save and a read change nothing');
      assert.deepEqual(validateDoc(stored).map((p) => `${p.path}:${p.reason}`), [], 'what the studio writes is what the API accepts');
    });
  }
  test('migrate is pure and idempotent, and a v2 document passes through untouched', () => {
    const v1 = FIXTURES[0].doc;
    const snapshot = JSON.stringify(v1);
    const once = migrate(v1);
    assert.equal(JSON.stringify(v1), snapshot, 'the input was mutated');
    assert.equal(migrate(once), once);
    assert.equal(once.v, 2);
    for (const k of ['height', 'phoneHeight', 'phoneBoard']) assert.equal(once[k], undefined);
  });
  test('D4: a pinned height shorter than the content becomes a fixed frame that holds it', () => {
    const n = normalizeDoc({ height: 300, blocks: [{ id: 'a', kind: 'box', x: 0, y: 600, w: 100, h: 200 }] });
    assert.equal(n.frames.desktop.fit, 'fixed');
    assert.equal(n.frames.desktop.h, 840);
  });
  test('v2: a fixed frame may be shorter than its content (the block below is off the page)', () => {
    const n = normalizeDoc({ v: 2, frames: { desktop: { w: 1200, h: 300, fit: 'fixed' }, phone: { w: 390, fit: 'content', mode: 'stack' } }, blocks: [{ id: 'a', kind: 'box', x: 0, y: 600, w: 100, h: 200 }] });
    assert.equal(n.height, 300);
    assert.equal(frameBlocks(n, 'scale').length, 0);
  });
  test('a frame that follows its content is stored WITHOUT a height (bug A.1 cannot come back)', () => {
    const stored = serializeDoc(normalizeDoc({ blocks: [{ id: 'a', kind: 'box', x: 0, y: 0, w: 100, h: 100 }] }));
    assert.deepEqual(stored.frames.desktop, { w: 1200, fit: 'content' });
    const grown = normalizeDoc({ ...stored, blocks: [...stored.blocks, { id: 'b', kind: 'box', x: 0, y: 900, w: 100, h: 100 }] });
    assert.equal(grown.height, 1040);
  });
  test('a block parked beside the page does not stretch a content frame', () => {
    const n = normalizeDoc({ v: 2, frames: { desktop: { w: 1200, fit: 'content' }, phone: { w: 390, fit: 'content', mode: 'stack' } },
      blocks: [{ id: 'a', kind: 'box', x: 0, y: 0, w: 100, h: 100 }, { id: 'far', kind: 'box', x: -900, y: 5000, w: 100, h: 100 }] });
    assert.equal(n.height, 240);
  });
});

describe('zero drift: a drag lands under the pointer at any zoom, anywhere on the board', () => {
  const SCALES = [ZOOM_MIN, 0.137, 0.37, 1, 1.5, 2.71, ZOOM_MAX];
  const STARTS = [{ x: 0, y: 0 }, { x: -1234, y: -567 }, { x: 5000, y: -20 }, { x: -8, y: 3001 }];
  test('the result depends only on where the drag began and where the pointer is', () => {
    for (const s of SCALES) {
      for (const st of STARTS) {
        const start = { ...st, w: 200, h: 100 };
        // Sixty frames of a drag that wanders, off the left edge and back past the right one.
        let last = null;
        for (let f = 1; f <= 60; f++) last = dragTo(start, Math.sin(f / 7) * 900 - f * 3, f * 2.5 - 40, s, { snap: false });
        const dx = Math.sin(60 / 7) * 900 - 180; const dy = 150 - 40;
        assert.deepEqual(last, { x: Math.round(st.x + dx / s), y: Math.round(st.y + dy / s) }, `scale ${s}, start ${st.x},${st.y}`);
      }
    }
  });
  test('the camera and the drag agree: the board point under the pointer moves with it', () => {
    for (const s of SCALES) {
      const view = { x: 317, y: -42, s };
      const block = { x: -640, y: -320, w: 200, h: 100 };
      const grab = toScreen(view, block.x + 10, block.y + 10);
      const to = { x: grab.x - 473, y: grab.y + 211 };
      const moved = dragTo(block, to.x - grab.x, to.y - grab.y, s, { snap: false });
      const under = toBoard(view, to.x, to.y);
      assert.ok(Math.abs(moved.x + 10 - under.x) <= 0.5 && Math.abs(moved.y + 10 - under.y) <= 0.5, `scale ${s}: grabbed point ${under.x},${under.y}, block at ${moved.x},${moved.y}`);
    }
  });
  test('snapped, a drag out and back returns exactly home, negative coordinates included', () => {
    for (const s of SCALES) {
      const start = { x: -96, y: -48, w: 100, h: 100 };
      const away = dragTo(start, -777 * s, 555 * s, s);
      assert.deepEqual(dragTo({ ...start, ...away }, 777 * s, -555 * s, s), { x: -96, y: -48 }, `scale ${s}`);
    }
  });
  test('a group and a resize obey the same rule off the page', () => {
    const out = moveMany([{ id: 'a', x: -400, y: -400, w: 100, h: 100 }, { id: 'b', x: -200, y: -300, w: 100, h: 100 }], ['a', 'b'], -50, -50, 0.5, { snap: false });
    assert.deepEqual(out.map((b) => [b.x, b.y]), [[-500, -500], [-300, -400]]);
    const r = resizeTo({ x: -400, y: -400, w: 200, h: 100 }, 'nw', -40, -40, 0.25, { snap: false });
    assert.deepEqual(r, { x: -560, y: -560, w: 360, h: 260 });
  });
  test('nothing escapes the guard rail', () => {
    assert.equal(dragTo({ x: 0, y: 0, w: 1, h: 1 }, -1e12, 1e12, ZOOM_MIN).x, -BOUND);
    assert.equal(normalizeDoc({ v: 2, blocks: [{ id: 'a', x: 1e9, y: -1e9, w: 1e9, h: 5 }] }).blocks[0].x, BOUND);
  });
});

describe('centred zoom: the point under the pointer does not move', () => {
  const views = [{ x: 0, y: 0, s: 1 }, { x: 250, y: -80, s: 0.37 }, { x: -3000, y: 1200, s: 2.2 }];
  const points = [[0, 0], [412, 300], [1180, 15], [-20, 900]];
  const still = (a, b, px, py) => {
    const p = toBoard(a, px, py); const q = toBoard(b, px, py);
    assert.ok(Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6, `board point under ${px},${py} moved from ${p.x},${p.y} to ${q.x},${q.y}`);
  };
  test('zoomAt, to any level', () => {
    for (const v of views) for (const [px, py] of points) for (const s of [0.1, 0.5, 1.3, 4]) still(v, zoomAt(v, px, py, s), px, py);
  });
  test('the wheel, in pixels, lines and pages', () => {
    for (const v of views) for (const [px, py] of points) for (const [d, m] of [[-120, 0], [53, 0], [-3, 1], [1, 2]]) {
      const next = wheelZoom(v, px, py, d, m);
      still(v, next, px, py);
      assert.ok(d < 0 ? next.s >= v.s : next.s <= v.s, 'the wheel zooms the right way');
    }
  });
  test('the range is 10 % to 400 %, and holding the limit does not slide the board', () => {
    const v = { x: 100, y: 100, s: 3.9 };
    const max = zoomAt(v, 400, 300, 99);
    assert.equal(max.s, ZOOM_MAX); still(v, max, 400, 300);
    assert.deepEqual(zoomAt(max, 400, 300, 99), max, 'zooming in at the limit changes nothing');
    assert.equal(zoomAt(v, 0, 0, 0.0001).s, ZOOM_MIN);
    assert.equal(ZOOM_MIN, 0.1); assert.equal(ZOOM_MAX, 4);
  });
  test('two fingers: the board point under their midpoint follows it, the scale follows their spread', () => {
    const start = { x: 40, y: 60, s: 0.8 };
    const a0 = { x: 100, y: 100 }; const b0 = { x: 300, y: 100 };
    const mid0 = toBoard(start, 200, 100);
    // Pure pan: same spread, both fingers moved by (+50, -30).
    const pan = pinchView(start, a0, b0, { x: 150, y: 70 }, { x: 350, y: 70 });
    assert.equal(pan.s, start.s);
    assert.deepEqual([pan.x, pan.y], [90, 30]);
    // Pinch out to twice the spread, midpoint moved: the same board point is under the new midpoint.
    const pinch = pinchView(start, a0, b0, { x: 0, y: 150 }, { x: 400, y: 150 });
    assert.ok(Math.abs(pinch.s - 1.6) < 1e-9);
    const mid1 = toBoard(pinch, 200, 150);
    assert.ok(Math.abs(mid1.x - mid0.x) < 1e-9 && Math.abs(mid1.y - mid0.y) < 1e-9);
  });
  test('fit the frame, show everything, reveal a block', () => {
    const fit = fitFrameView({ w: 1200, h: 3000 }, 900, 600);
    assert.ok(Math.abs(fit.s - 852 / 1200) < 1e-9, 'the frame WIDTH fits the pane');
    assert.equal(fitFrameView({ w: 390 }, 1600, 600).s, 1, 'never magnified past 100 %');
    const all = showAllView({ w: 1200, h: 600 }, [{ x: -2000, y: 0, w: 100, h: 100 }], 1000, 700);
    const a = toScreen(all, -2000, 0); const b = toScreen(all, 1200, 600);
    assert.ok(a.x >= 23.9 && b.x <= 1000 - 23.9, 'the parked block and the frame are both in the pane');
    const v = { x: 0, y: 0, s: 1 };
    assert.equal(revealView(v, { x: 10, y: 10, w: 50, h: 50 }, 800, 600), v, 'already visible: the camera does not move');
    const moved = revealView(v, { x: -900, y: 10, w: 50, h: 50 }, 800, 600);
    const p = toScreen(moved, -900, 10);
    assert.ok(p.x >= 0 && p.x + 50 <= 800, 'a block off to the left is brought into the pane');
  });
});

describe('the public page mounts the frame and nothing outside it', () => {
  const doc = normalizeDoc({ v: 2, id: 'p', frames: { desktop: { w: 1200, h: 500, fit: 'fixed' }, phone: { w: 390, fit: 'content', mode: 'board' } }, blocks: [
    { id: 'in', kind: 'box', x: 100, y: 100, w: 200, h: 100 },
    { id: 'cross', kind: 'box', x: 1100, y: 450, w: 300, h: 200 },
    { id: 'left', kind: 'image', x: -500, y: 0, w: 300, h: 200, props: { src: '/never.png' } },
    { id: 'below', kind: 'box', x: 0, y: 500, w: 300, h: 200 },
    { id: 'touch', kind: 'box', x: 1200, y: 0, w: 100, h: 100 },
    { id: 'placed', kind: 'box', x: -500, y: 900, w: 200, h: 100, phone: { x: 10, y: 10 } },
    { id: 'phoneOff', kind: 'box', x: 10, y: 10, w: 100, h: 100, phone: { x: 400, y: 0 } },
  ] });
  const ids = (mode) => frameBlocks(doc, mode, 'light').map((b) => b.id).sort();
  test('desktop: inside and crossing only; beside, below and edge-touching are not mounted', () => {
    assert.deepEqual(ids('scale'), ['cross', 'in', 'phoneOff']);
  });
  test('the phone stack is the desktop page read in order', () => {
    assert.deepEqual(ids('stack'), ['cross', 'in', 'phoneOff']);
  });
  test('the phone board: placed on its frame, or laid there from the desktop page; parked blocks stay parked', () => {
    assert.deepEqual(ids('phone'), ['cross', 'in', 'placed']);
  });
  test('the editor marks exactly the blocks a reader will not get', () => {
    assert.deepEqual([...offFrameIds(doc, 'light')].sort(), ['below', 'left', 'placed', 'touch']);
    assert.deepEqual([...offFrameIds(doc, 'phone')].sort(), ['below', 'left', 'phoneOff', 'touch']);
  });
  test('a dark overlay that moves a block off the page takes it off the dark page only', () => {
    const d = normalizeDoc({ blocks: [{ id: 'a', kind: 'box', x: 0, y: 0, w: 100, h: 100, themes: { dark: { x: -400 } } }] });
    assert.deepEqual(frameBlocks(d, 'scale', 'light').map((b) => b.id), ['a']);
    assert.deepEqual(frameBlocks(d, 'scale', 'dark'), []);
  });
});

describe('the package', () => {
  test('the web modules are re-exports of the package, not copies', () => {
    assert.equal(lib.normalizeDoc, pkg.normalizeDoc);
    assert.equal(lib.validateDoc, pkg.validateDoc);
    assert.equal(lib.normalizeCanvas, pkg.normalizeDoc, 'the v1 name is the same function');
  });
  test('index.d.ts declares every runtime export, and nothing that does not exist', () => {
    const dts = fs.readFileSync(new URL('../../../packages/studio/src/index.d.ts', import.meta.url), 'utf8');
    const declared = new Set([...dts.matchAll(/^export (?:declare )?(?:function|const|let) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
    const runtime = Object.keys(pkg);
    const missing = runtime.filter((k) => !declared.has(k));
    const ghost = [...declared].filter((k) => !runtime.includes(k));
    assert.deepEqual(missing, [], `exported without a type: ${missing.join(', ')}`);
    assert.deepEqual(ghost, [], `typed but not exported: ${ghost.join(', ')}`);
  });
  test('props are an allow-list per kind: what the renderer never reads is not carried', () => {
    const b = normalizeDoc({ blocks: [{ id: 'a', kind: 'image', x: 0, y: 0, w: 10, h: 10, props: { src: '/a.png', md: 'no', onload: 'x', radius: 4 } }] }).blocks[0];
    assert.deepEqual(b.props, { src: '/a.png', radius: 4 });
  });
});
