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
//
// Two things an author may now say ON TOP of that, and neither of them reopens free placement
// on a phone — that trade is still made the same way:
//
//   · `block.phone` — the ORDER of the stack, whether a block appears in it at all, and how
//     tall it is there. Derived reading order remains the default and stays the answer for
//     every block that says nothing, so an existing canvas is unchanged and an author only
//     spends attention on the two blocks that came out wrong.
//   · `block.themes.light` / `.dark` — a partial override applied when the page is being read
//     in that theme. A hero built for a dark background is not the same picture on a light
//     one, and the alternative was authoring two pages.
//
// Both are OVERLAYS: absent means "the same as the desktop, light-theme block", never "empty".
// A stored partial that is missing a field falls through to the base, so an author who nudged
// one coordinate has not silently frozen the other three.

/** The width every stored coordinate is relative to. Changing it would move every canvas. */
export const DESIGN_WIDTH = 1200;
/** Below this viewport width the canvas stacks instead of scaling into illegibility. */
export const STACK_BELOW = 700;
/** Smallest scale we will render at before stacking is the better answer. */
export const MIN_SCALE = 0.55;
/** Grid step, in design px. Placement snaps to it so hand-placed blocks still line up. */
export const GRID = 8;

/**
 * Block kinds the renderer knows. `text` is B.MD, so it inherits the whole vocabulary.
 *
 * `image` covers PNG, JPEG, WebP and a plain .svg URL — one kind, because a reader does not
 * care which of those a picture is and neither does <img>.
 *
 * There is deliberately NO inline-SVG kind. Inlining author markup on a public page is stored
 * XSS unless it is sanitised, and the only sanitiser here is B.MD's rehype pipeline, which
 * runs over markdown rather than over an SVG string. Its one real advantage — an icon that
 * inherits the page's colours — is not worth an injection point on a platform that meters and
 * gates everything else. It can come back behind a real sanitiser.
 */
export const BLOCK_KINDS = ['text', 'image', 'box', 'video', 'embed', 'replay'];

/** Kinds whose height is theirs to keep in a stack — a media box with no intrinsic height in
 *  the column would collapse to nothing the way `box` did. */
const KEEPS_HEIGHT = new Set(['box', 'video', 'embed', 'replay']);
export const keepsHeightStacked = (kind) => KEEPS_HEIGHT.has(kind);

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
        // Opacity lives on the BLOCK, not in props: it applies to the wrapper, so it works the
        // same for a picture, a video and a text block. In props it would have had to be
        // re-implemented per kind, and three of them would have been forgotten.
        opacity: clamp(num(b.opacity, 1), 0, 1),
        themes: themeOverlays(b.themes),
        phone: phoneOverlay(b.phone),
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

/**
 * A per-theme partial. Only the fields that were actually written survive — an overlay that
 * filled in defaults would freeze every coordinate the author never touched, so nudging a
 * hero 20px on the dark theme would silently pin its width and height there too.
 */
function themeOverlays(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const mode of ['light', 'dark']) {
    const o = src[mode];
    if (!o || typeof o !== 'object') continue;
    const t = {};
    for (const k of ['x', 'y', 'w', 'h']) if (o[k] != null && Number.isFinite(Number(o[k]))) t[k] = snap(num(o[k]));
    if (o.opacity != null && Number.isFinite(Number(o.opacity))) t.opacity = clamp(num(o.opacity, 1), 0, 1);
    if (o.hidden === true) t.hidden = true;
    if (o.props && typeof o.props === 'object') t.props = o.props;
    if (Object.keys(t).length) out[mode] = t;
  }
  return out;
}

/** What an author said about this block ON A PHONE. Absent fields fall through to the
 *  derived reading order and the block's own height. */
function phoneOverlay(raw) {
  const o = raw && typeof raw === 'object' ? raw : null;
  if (!o) return null;
  const out = {};
  if (o.order != null && Number.isFinite(Number(o.order))) out.order = num(o.order);
  if (o.hidden === true) out.hidden = true;
  if (o.h != null && Number.isFinite(Number(o.h))) out.h = Math.max(GRID, snap(num(o.h)));
  return Object.keys(out).length ? out : null;
}

/**
 * The block as it should be drawn, for a theme.
 *
 * One function, called by the public page AND the editor's preview, because "what does the
 * dark version look like" answered twice is how the two come to disagree — the same reason
 * layoutFor() is not duplicated.
 */
export function resolveBlock(b, theme = 'light') {
  const o = b?.themes?.[theme === 'dark' ? 'dark' : 'light'];
  if (!o) return b;
  return {
    ...b,
    ...(o.x != null ? { x: o.x } : {}),
    ...(o.y != null ? { y: o.y } : {}),
    ...(o.w != null ? { w: o.w } : {}),
    ...(o.h != null ? { h: o.h } : {}),
    ...(o.opacity != null ? { opacity: o.opacity } : {}),
    ...(o.hidden ? { hidden: true } : {}),
    // Props MERGE rather than replace: a dark overlay that only changes the background must
    // not drop the caption, the alt text and the fit mode along with it.
    ...(o.props ? { props: { ...(b.props || {}), ...o.props } } : {}),
  };
}

/**
 * The blocks a phone gets, in the order it gets them.
 *
 * Authored order wins where it exists; everything else keeps its reading order, and the two
 * are interleaved by SORTING on the authored value with the reading position as the
 * tiebreaker. The naive version — authored ones first, then the rest — moves a block an
 * author never touched, which is the opposite of what setting one block's order should do.
 */
export function phoneOrder(blocks, band = 40) {
  const read = readingOrder(blocks, band);
  const pos = new Map(read.map((b, i) => [b.id, i]));
  return read
    .filter((b) => !b.phone?.hidden)
    .map((b) => ({ b, key: b.phone?.order != null ? num(b.phone.order) : pos.get(b.id) }))
    .sort((p, q) => (p.key - q.key) || (pos.get(p.b.id) - pos.get(q.b.id)))
    .map((p) => p.b);
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

// ── Undo ─────────────────────────────────────────────────────────────────────
// A canvas editor without undo is one bad drag away from losing work, and undo in a canvas
// editor is not "one entry per change": a single drag fires a state update on every pointer
// move, so the naive version needs sixty presses of Ctrl+Z to walk back one gesture.
//
// So entries COALESCE. A key identifies the gesture — "dragging block b7", "typing in b7's
// text" — and consecutive pushes with the same key inside a short window collapse into the
// one entry that was there when the gesture started. A different key, or a long enough pause,
// starts a new entry. Kept pure so the rule can be tested rather than felt out by clicking.

export const HISTORY_LIMIT = 50;
export const COALESCE_MS = 700;

export const emptyHistory = () => ({ past: [], future: [], key: null, at: 0 });

/**
 * Record `snapshot` (the state BEFORE the change being made) as an undo point.
 *
 * @param {object} hist
 * @param {object} snapshot   the canvas as it was
 * @param {string|null} key   the gesture. null = always a new entry (a discrete action)
 * @param {number} now
 */
export function pushHistory(hist, snapshot, key = null, now = Date.now()) {
  const h = hist || emptyHistory();
  // Same gesture, still going: the entry already on the stack is the right one to come back
  // to, so keep it and only refresh the clock.
  if (key && h.key === key && now - h.at < COALESCE_MS && h.past.length) {
    return { ...h, at: now };
  }
  const past = [...h.past, snapshot].slice(-HISTORY_LIMIT);
  // Any new change abandons the redo branch — the future being undone into no longer exists.
  return { past, future: [], key, at: now };
}

/** @returns {{hist: object, value: object}|null} null when there is nothing to undo. */
export function undo(hist, current) {
  const h = hist || emptyHistory();
  if (!h.past.length) return null;
  const past = h.past.slice(0, -1);
  const value = h.past[h.past.length - 1];
  // `key: null` so the next edit after an undo always starts a fresh entry rather than
  // coalescing into the gesture that was just undone.
  return { hist: { past, future: [...h.future, current].slice(-HISTORY_LIMIT), key: null, at: 0 }, value };
}

/** @returns {{hist: object, value: object}|null} null when there is nothing to redo. */
export function redo(hist, current) {
  const h = hist || emptyHistory();
  if (!h.future.length) return null;
  const future = h.future.slice(0, -1);
  const value = h.future[h.future.length - 1];
  return { hist: { past: [...h.past, current].slice(-HISTORY_LIMIT), future, key: null, at: 0 }, value };
}

// ── Many at once ─────────────────────────────────────────────────────────────
// Selecting several blocks is what turns a canvas from "place things" into "lay a page out":
// nudge a header and its subtitle together, line six cards up on their left edges, space four
// columns evenly. All of it is arithmetic over a set, so all of it is here and tested.

/** The bounding box of a set of blocks. */
export function boundsOf(blocks) {
  if (!blocks.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of blocks) {
    x1 = Math.min(x1, num(b.x)); y1 = Math.min(y1, num(b.y));
    x2 = Math.max(x2, num(b.x) + num(b.w)); y2 = Math.max(y2, num(b.y) + num(b.h));
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Which blocks a marquee touches.
 *
 * INTERSECTION, not containment. A rubber band that only takes what it fully swallows means
 * dragging across a wide hero to catch the two captions on it selects neither, and you learn
 * to draw boxes bigger than the thing you want — which on a 1200px canvas often is not
 * possible. Touching is what every design tool means by this gesture.
 */
export function blocksInRect(blocks, rect) {
  const r = { x: num(rect.x), y: num(rect.y), w: Math.abs(num(rect.w)), h: Math.abs(num(rect.h)) };
  // A drag up-and-left produces negative width/height; normalise before comparing.
  if (num(rect.w) < 0) r.x = num(rect.x) + num(rect.w);
  if (num(rect.h) < 0) r.y = num(rect.y) + num(rect.h);
  return blocks.filter((b) => num(b.x) < r.x + r.w && num(b.x) + num(b.w) > r.x
    && num(b.y) < r.y + r.h && num(b.y) + num(b.h) > r.y);
}

/**
 * Move a whole selection by one pointer delta.
 *
 * The clamp is applied to the GROUP, not to each block. Clamping individually is the bug that
 * makes a multi-select feel broken: drag a row of six cards at the right-hand edge and the
 * leading ones stop while the trailing ones keep coming, so the row you carefully spaced
 * collapses into a pile against the wall. Here the group stops as one and the shape survives.
 */
export function moveMany(blocks, ids, dxScreen, dyScreen, scale, opts = {}) {
  const set = new Set(ids);
  const chosen = blocks.filter((b) => set.has(b.id));
  if (!chosen.length) return blocks;
  const bb = boundsOf(chosen);
  const s = Math.abs(num(scale, 1)) || 1;
  const grid = opts.snap === false ? 1 : (opts.grid || GRID);
  // Where the BOX wants to go, snapped, then clamped so the whole box stays on the canvas.
  const wantX = Math.round((num(opts.startX ?? bb.x) + num(dxScreen) / s) / grid) * grid;
  const wantY = Math.round((num(opts.startY ?? bb.y) + num(dyScreen) / s) / grid) * grid;
  const nx = clamp(wantX, 0, Math.max(0, DESIGN_WIDTH - bb.w));
  const ny = Math.max(0, wantY);
  const dx = nx - bb.x, dy = ny - bb.y;
  return blocks.map((b) => (set.has(b.id) ? { ...b, x: num(b.x) + dx, y: num(b.y) + dy } : b));
}

/** Where each alignment puts a block, given the selection's bounding box. */
const ALIGN = {
  left: (b, bb) => ({ x: bb.x }),
  hcenter: (b, bb) => ({ x: Math.round((bb.x + (bb.w - num(b.w)) / 2) / GRID) * GRID }),
  right: (b, bb) => ({ x: bb.x + bb.w - num(b.w) }),
  top: (b, bb) => ({ y: bb.y }),
  vmiddle: (b, bb) => ({ y: Math.round((bb.y + (bb.h - num(b.h)) / 2) / GRID) * GRID }),
  bottom: (b, bb) => ({ y: bb.y + bb.h - num(b.h) }),
};
export const ALIGNMENTS = Object.keys(ALIGN);

/** Line a selection up. Blocks outside it are never touched. */
export function alignMany(blocks, ids, how) {
  const fn = ALIGN[how];
  const set = new Set(ids);
  const chosen = blocks.filter((b) => set.has(b.id));
  if (!fn || chosen.length < 2) return blocks;      // aligning one block to itself is a no-op
  const bb = boundsOf(chosen);
  return blocks.map((b) => (set.has(b.id) ? { ...b, ...fn(b, bb) } : b));
}

/**
 * Even gaps between three or more blocks, along one axis.
 *
 * The two outermost stay put — they define the span — and the rest are spread between them.
 * Spacing by equal CENTRES would look wrong the moment two blocks are different sizes, so the
 * gaps between edges are what is equalised, which is what the eye actually reads.
 */
export function distributeMany(blocks, ids, axis = 'x') {
  const set = new Set(ids);
  const chosen = blocks.filter((b) => set.has(b.id));
  if (chosen.length < 3) return blocks;             // two blocks have one gap; nothing to even out
  const pos = axis === 'y' ? 'y' : 'x';
  const size = axis === 'y' ? 'h' : 'w';
  const sorted = [...chosen].sort((a, b) => num(a[pos]) - num(b[pos]));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const span = (num(last[pos]) + num(last[size])) - num(first[pos]);
  const used = sorted.reduce((a, b) => a + num(b[size]), 0);
  const gap = (span - used) / (sorted.length - 1);
  const at = new Map();
  let cursor = num(first[pos]);
  for (const b of sorted) {
    at.set(b.id, Math.round(cursor / GRID) * GRID);
    cursor += num(b[size]) + gap;
  }
  // The outermost two are pinned exactly, so rounding never shrinks or grows the span.
  at.set(first.id, num(first[pos]));
  at.set(last.id, num(last[pos]));
  return blocks.map((b) => (at.has(b.id) ? { ...b, [pos]: at.get(b.id) } : b));
}

// ── Presets ──────────────────────────────────────────────────────────────────
// A blank canvas is the worst thing to hand somebody who has never used one. These are
// starting points, not templates to be preserved: every block is ordinary, editable and
// deletable the moment it lands, and nothing downstream knows a canvas came from a preset.
//
// Positions are on the 8px grid and inside the 1200px design width by construction — a preset
// that needs nudging before it looks right teaches the wrong first lesson.
const P = (kind, x, y, w, h, props = {}) => ({ kind, x, y, w, h, props });

export const CANVAS_PRESETS = [
  {
    id: 'hero',
    name: 'Hero + two columns',
    nameFr: 'Bandeau + deux colonnes',
    blocks: () => [
      P('box', 0, 0, 1200, 280, { bg: 'color-mix(in srgb, var(--primary) 10%, transparent)', radius: 20 }),
      P('text', 64, 56, 640, 168, { md: '# Your title\n\nOne sentence that says what this is.\n\n:button[Get started]{href="/"}' }),
      P('image', 760, 40, 376, 200, { src: '', alt: '', fit: 'contain' }),
      P('text', 64, 336, 520, 200, { md: '## What it does\n\nA paragraph.\n\n- A point\n- Another' }),
      P('text', 616, 336, 520, 200, { md: '## Why it matters\n\nA paragraph.\n\n- A point\n- Another' }),
    ],
  },
  {
    id: 'features',
    name: 'Feature grid',
    nameFr: 'Grille de fonctionnalités',
    blocks: () => {
      const out = [P('text', 64, 0, 720, 96, { md: '# Features\n\nWhat you get.' })];
      // Three across, two down — 344 wide with 32 between, inside 64px margins.
      for (let i = 0; i < 6; i++) {
        const col = i % 3, row = Math.floor(i / 3);
        out.push(P('text', 64 + col * 376, 128 + row * 216, 344, 184, {
          md: `:::card[Feature ${i + 1}]{icon=star}\nWhat it does, in a line or two.\n:::`,
        }));
      }
      return out;
    },
  },
  {
    id: 'split',
    name: 'Text beside a picture',
    nameFr: 'Texte à côté d’une image',
    blocks: () => [
      P('text', 64, 40, 520, 280, { md: '## A heading\n\nA paragraph explaining the thing beside it.\n\n:::tip[Good to know]\nSomething worth pulling out.\n:::' }),
      P('image', 640, 40, 496, 280, { src: '', alt: '', fit: 'cover' }),
    ],
  },
  {
    id: 'blank',
    name: 'Blank',
    nameFr: 'Vide',
    blocks: () => [],
  },
];

/** Instantiate a preset: real blocks with fresh ids, ready to edit. */
export function presetBlocks(id) {
  const preset = CANVAS_PRESETS.find((p) => p.id === id) || CANVAS_PRESETS[CANVAS_PRESETS.length - 1];
  // A timestamp alone is not unique: two presets instantiated in the same millisecond produced
  // identical ids, and identical ids mean React keys collide and the editor's selection points
  // at "both" blocks. A random tail costs nothing and removes the whole class.
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return preset.blocks().map((b, i) => ({ ...b, id: `p${run}${i}`, z: i }));
}
