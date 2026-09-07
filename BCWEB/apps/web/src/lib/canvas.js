// The free-form page canvas: its format, and the one hard decision in it.
//
// A project page can be laid out by hand — blocks placed where the author wants them, not
// stacked in the order a template decided. That is the ask ("un studio comme Figma"), and it
// runs straight into the fact that a web page has no fixed width.
//
// FREE PLACEMENT AND RESPONSIVENESS ARE NOT COMPATIBLE. You can have one honestly. What
// follows is the compromise, written down so nobody has to reverse-engineer it later:
//
//   · Blocks are placed in absolute coordinates on a DESIGN WIDTH (1200 by default). That is
//     what makes placement free: the author moves a thing to where they want it and it stays
//     there, relative to everything else.
//   · On a narrower viewport the whole canvas is SCALED, not reflowed. Everything keeps its
//     proportions, so a design never breaks — it only gets smaller.
//   · Scaling has a floor. Below `STACK_BELOW` the canvas stops being a canvas and the blocks
//     STACK in reading order. This is the part a naive implementation gets wrong: a 1200px
//     canvas squeezed into a 380px phone is a 0.32 scale, and 15px body text becomes 5px.
//     Unreadable is not responsive. Past that width the layout is abandoned on purpose.
//
// Reading order for the stacked fallback is TOP-TO-BOTTOM, then left-to-right — how the page
// reads, not the order the blocks were created in and not the z-index. Two blocks side by side
// stack left first; a block dragged above another moves ahead of it. Anything else and the
// phone version of a page tells a different story from the desktop one.

/** The width every stored coordinate is relative to. Changing it would move every canvas. */
export const DESIGN_WIDTH = 1200;
/** Below this viewport width the canvas stacks instead of scaling into illegibility. */
export const STACK_BELOW = 700;
/** Smallest scale we will render at before stacking is the better answer. */
export const MIN_SCALE = 0.55;
/** Grid step, in design px. Placement snaps to it so hand-placed blocks still line up. */
export const GRID = 8;

/** Block kinds the renderer knows. `text` is B.MD, so it inherits the whole vocabulary. */
export const BLOCK_KINDS = ['text', 'image', 'box'];

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Snap a design-space coordinate to the grid. */
export const snap = (v, grid = GRID) => Math.round(num(v) / grid) * grid;

/**
 * Make sense of whatever is in the database.
 *
 * A canvas is author-written JSON that has been through an editor, a save, a migration and
 * possibly a hand edit. Anything can be missing or the wrong type, and the renderer must not
 * be the place that discovers it — a page that throws is worse than a page laid out badly.
 * Everything is coerced; a block that cannot be made sense of is dropped rather than drawn
 * at NaN,NaN where it would be invisible and unexplainable.
 */
export function normalizeCanvas(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const blocks = (Array.isArray(c.blocks) ? c.blocks : [])
    .map((b, i) => {
      if (!b || typeof b !== 'object') return null;
      const kind = BLOCK_KINDS.includes(b.kind) ? b.kind : 'text';
      const w = clamp(snap(num(b.w, 320)), GRID, DESIGN_WIDTH);
      return {
        // A stable id matters: it keys the React list and it is what the editor selects by.
        // Falling back to the index keeps an id-less legacy block editable instead of making
        // every one of them the "same" block.
        id: String(b.id || `b${i}`),
        kind,
        x: clamp(snap(num(b.x, 0)), 0, DESIGN_WIDTH - GRID),
        y: Math.max(0, snap(num(b.y, 0))),
        w,
        h: Math.max(GRID, snap(num(b.h, 120))),
        z: num(b.z, i),
        props: b.props && typeof b.props === 'object' ? b.props : {},
      };
    })
    .filter(Boolean);
  return {
    id: String(c.id || 'canvas'),
    title: String(c.title || ''),
    // The canvas is as tall as its content unless the author pinned a height. Computed rather
    // than stored so deleting the bottom block does not leave a page of blank space behind it.
    height: Math.max(240, num(c.height, 0) || contentHeight(blocks)),
    bg: typeof c.bg === 'string' ? c.bg : '',
    blocks,
  };
}

/** The bottom edge of the lowest block, plus a little air. */
export function contentHeight(blocks) {
  let bottom = 0;
  for (const b of blocks) bottom = Math.max(bottom, num(b.y) + num(b.h));
  return bottom ? bottom + 40 : 0;
}

/**
 * How to draw this canvas at a given viewport width.
 *
 * Returns either a scaled canvas or the instruction to stack. The caller does not decide —
 * one function owns the rule, so the editor's preview and the public page cannot disagree
 * about what a reader will see.
 */
export function layoutFor(viewportWidth, canvas) {
  const vw = num(viewportWidth, DESIGN_WIDTH);
  if (vw <= 0) return { mode: 'scale', scale: 1, width: DESIGN_WIDTH, height: canvas.height };
  if (vw < STACK_BELOW) return { mode: 'stack', scale: 1, width: vw, height: null };
  const raw = vw / DESIGN_WIDTH;
  // Never magnify: a canvas designed at 1200 blown up to 2400 is a blurry poster, and text
  // that grows with the window is nobody's idea of a page.
  const scale = clamp(Math.min(1, raw), MIN_SCALE, 1);
  return { mode: 'scale', scale, width: DESIGN_WIDTH * scale, height: canvas.height * scale };
}

/**
 * The order blocks are read in when the canvas is abandoned for a stack.
 *
 * Top to bottom, then left to right — with a tolerance band, because two blocks a designer
 * put "side by side" are never at exactly the same y. Without the band, a block 3px higher
 * than its neighbour would jump above it on phones and the sentence would come apart.
 */
export function readingOrder(blocks, band = 40) {
  return [...blocks].sort((a, b) => {
    const dy = num(a.y) - num(b.y);
    if (Math.abs(dy) > band) return dy;
    return num(a.x) - num(b.x);
  });
}

/** Blocks back-to-front, for painting. Ties keep their array order so a save is stable. */
export function paintOrder(blocks) {
  return blocks.map((b, i) => [b, i]).sort((p, q) => (num(p[0].z) - num(q[0].z)) || (p[1] - q[1])).map((p) => p[0]);
}

// ── Editing ──────────────────────────────────────────────────────────────────
// The interaction maths, kept out of the component so it can be tested. Drag and resize are
// where a canvas editor is either precise or maddening, and neither is verifiable by clicking
// around: the failure is half a pixel of drift per frame, which only shows after twenty drags.

/**
 * Move a block by a pointer delta measured in SCREEN pixels.
 *
 * The canvas is drawn scaled, so a 10px mouse move is 10/scale design pixels. Forgetting that
 * is the classic bug: the block lags the cursor at any zoom but 100%, and the further you drag
 * the further behind it gets.
 *
 * `start` is the block's position when the drag BEGAN, never the current one. Accumulating
 * deltas frame by frame re-snaps an already-snapped value each time, and the block creeps.
 */
export function dragTo(start, dxScreen, dyScreen, scale, opts = {}) {
  const s = Math.abs(num(scale, 1)) || 1;
  const grid = opts.snap === false ? 1 : (opts.grid || GRID);
  const x = Math.round((num(start.x) + num(dxScreen) / s) / grid) * grid;
  const y = Math.round((num(start.y) + num(dyScreen) / s) / grid) * grid;
  return {
    // Off the left edge is a block you cannot grab again; off the right is one nobody sees.
    x: clamp(x, 0, DESIGN_WIDTH - num(start.w, GRID)),
    y: Math.max(0, y),
  };
}

/** The eight handles, as the axes each one moves. */
export const HANDLES = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1],
  w: [-1, 0], e: [1, 0],
  sw: [-1, 1], s: [0, 1], se: [1, 1],
};

/**
 * Resize from one handle.
 *
 * A handle on the left or top moves the block's ORIGIN as well as its size — drag the west
 * handle right and x grows while w shrinks. Getting only the size right is why a block
 * "jumps" when you grab its left edge.
 *
 * Below the minimum the block stops rather than inverting: a negative width renders as
 * nothing, and a block you cannot see is a block you cannot fix.
 */
export function resizeTo(start, handle, dxScreen, dyScreen, scale, opts = {}) {
  const [ax, ay] = HANDLES[handle] || [0, 0];
  const s = Math.abs(num(scale, 1)) || 1;
  const grid = opts.snap === false ? 1 : (opts.grid || GRID);
  const min = opts.min || GRID * 2;
  const dx = num(dxScreen) / s;
  const dy = num(dyScreen) / s;
  let { x, y, w, h } = { x: num(start.x), y: num(start.y), w: num(start.w), h: num(start.h) };

  if (ax === 1) w = w + dx;
  else if (ax === -1) { const right = x + w; x = x + dx; w = right - x; }
  if (ay === 1) h = h + dy;
  else if (ay === -1) { const bottom = y + h; y = y + dy; h = bottom - y; }

  // Snap the EDGES, not the size: snapping width alone leaves the far edge off-grid, which is
  // exactly the misalignment the grid exists to prevent.
  //
  // And snap ONLY the edges this handle moves. Snapping the anchored edge too means grabbing
  // the south-east corner of a block sitting at x=100 silently slides it to 104 — the block
  // jumps sideways while you are dragging its right edge, which reads as the editor fighting
  // you. An off-grid block gets aligned when you drag the edge that is off, not before.
  const snapv = (v) => Math.round(v / grid) * grid;
  if (ax === -1) { const right = x + w; x = snapv(x); w = right - x; }
  else if (ax === 1) { w = snapv(x + w) - x; }
  if (ay === -1) { const bottom = y + h; y = snapv(y); h = bottom - y; }
  else if (ay === 1) { h = snapv(y + h) - y; }

  if (w < min) { if (ax === -1) x = x + (w - min); w = min; }
  if (h < min) { if (ay === -1) y = y + (h - min); h = min; }
  x = clamp(x, 0, DESIGN_WIDTH - min);
  y = Math.max(0, y);
  w = clamp(w, min, DESIGN_WIDTH - x);
  return { x, y, w, h };
}

/**
 * Guides: edges of OTHER blocks that the moving one is within `tol` of.
 *
 * Snapping to the grid lines things up to 8px. Snapping to what is already there is what makes
 * a hand-placed page look composed — the second card lands exactly on the first one's edge
 * instead of eight pixels off it.
 */
export function alignmentGuides(moving, others, tol = 6) {
  const v = []; const h = [];
  const mv = [num(moving.x), num(moving.x) + num(moving.w) / 2, num(moving.x) + num(moving.w)];
  const mh = [num(moving.y), num(moving.y) + num(moving.h) / 2, num(moving.y) + num(moving.h)];
  for (const o of others) {
    if (o.id === moving.id) continue;
    for (const ox of [num(o.x), num(o.x) + num(o.w) / 2, num(o.x) + num(o.w)]) {
      for (const m of mv) if (Math.abs(m - ox) <= tol) { v.push({ at: ox, delta: ox - m }); break; }
    }
    for (const oy of [num(o.y), num(o.y) + num(o.h) / 2, num(o.y) + num(o.h)]) {
      for (const m of mh) if (Math.abs(m - oy) <= tol) { h.push({ at: oy, delta: oy - m }); break; }
    }
  }
  // Nearest wins: two candidates within tolerance and the block should go to the closer one.
  const best = (arr) => arr.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0] || null;
  return { v: best(v), h: best(h) };
}

/** Send a block to the front / back without renumbering everything else. */
export function bringTo(blocks, id, where) {
  const zs = blocks.map((b) => num(b.z));
  const z = where === 'front' ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
  return blocks.map((b) => (b.id === id ? { ...b, z } : b));
}
