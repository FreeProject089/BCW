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
