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
//
// ── Document v2: a BOARD with FRAMES (PLAN-STUDIO-2026, 2.2, phase 3) ─────────────────────
// Up to v1 every coordinate was clamped to the page: x in [0, 1192], y >= 0, and the page grew
// to hold every block. That made the studio a form with a picture in it, not a drawing tool:
// a block could not be parked beside the page while the author tried something else, and a
// block dragged off the left edge came back at x = 0 on its own.
//
// v2 is the Inkscape model. Blocks live on an unbounded BOARD (bounded only at ±BOUND, a
// guard against absurd numbers, never a layout rule). The page is a FRAME on that board,
// anchored at (0,0) so every v1 coordinate keeps its meaning: `frames.desktop` is 1200 wide,
// `frames.phone` 390. A frame's height is either `fixed` (the handle) or `content` (as tall as
// the blocks that cross it). The reader gets the frame and nothing else: what is outside is
// clipped, and a block ENTIRELY outside is not mounted at all.
//
// A v1 document is migrated on READ (`migrate`), written as v2 at the next save
// (`serializeDoc`). Nothing is migrated in SQL.

/** The document version this code writes. */
export const DOC_VERSION = 2;
/** The board's guard rail: no coordinate or size may pass it. Not a layout rule. */
export const BOUND = 20_000;

/** The width every stored coordinate is relative to. Changing it would move every canvas. */
export const DESIGN_WIDTH = 1200;
/** The phone board's width, when an author places blocks for phones by hand. */
export const PHONE_WIDTH = 390;
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
export const BLOCK_KINDS = ['text', 'image', 'box', 'video', 'embed', 'replay', 'button', 'shape', 'svg'];
/** The shapes a `shape` block can be. Drawn as inline SVG scaled to the block (ui/canvas-view.jsx). */
export const SHAPES = ['rect', 'rounded', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star', 'arrow', 'chevron', 'blob', 'line', 'ring'];

/**
 * How a block moves. The first five are ENTRANCES — they run once, when the trigger fires.
 * `pulse` and `float` are ambient: they keep going. `custom` is the author's own keyframes.
 */
export const ANIM_KINDS = ['fade', 'rise', 'slide-left', 'slide-right', 'zoom', 'pulse', 'float', 'custom'];
/** When it starts: as it scrolls into view, on page load, after a delay, or while hovered. */
export const ANIM_TRIGGERS = ['show', 'load', 'delay', 'hover'];
/**
 * How it moves through its duration.
 *
 * A name, never a raw `cubic-bezier(...)` string from the author: the value is written into
 * `animation-timing-function` on a PUBLIC page, and a free-text CSS value there is an
 * injection point for the price of a comfort nobody asked for. The curve each name maps to
 * lives once, in `EASING_CURVES`, and the renderer reads it from here.
 */
export const ANIM_EASINGS = ['smooth', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'spring', 'snap'];
/** The one place a name becomes a curve. `smooth` is what every animation used before easing
 *  was a setting, so a page saved without one keeps moving exactly as it did. */
export const EASING_CURVES = {
  smooth: 'cubic-bezier(.2,.7,.2,1)',
  linear: 'linear',
  'ease-in': 'cubic-bezier(.4,0,1,1)',
  'ease-out': 'cubic-bezier(0,0,.2,1)',
  'ease-in-out': 'cubic-bezier(.4,0,.2,1)',
  spring: 'cubic-bezier(.34,1.56,.64,1)',
  snap: 'cubic-bezier(.85,0,.15,1)',
};
/** The steps a "stagger the selection" offers, in ms between one block and the next. */
export const STAGGER_STEPS = [40, 60, 80, 120, 200];
/** What a button block can look like. */
export const BUTTON_VARIANTS = ['button', 'card', 'dropdown-down', 'dropdown-up'];
/** What pressing it does — the choices the editor OFFERS.
 *
 *  `api` is gone from this list (PLAN-STUDIO-2026, S2 and decision D5). It fired any `/api`
 *  request with the CLICKING visitor's session, so a button on a public page could make an
 *  admin who looked at it do something authenticated. A page saved with it still loads: the
 *  button renders inert and the editor shows it in red with the reason (`LEGACY_ACTIONS`). */
export const BUTTON_ACTIONS = ['link', 'copy', 'scroll', 'download'];
/** Action types a stored page may carry that are no longer honoured, and why. */
export const LEGACY_ACTIONS = { api: 'api_removed' };
/** Drop shadows a block may carry. The CSS is `.cv-shadow-<name>` in index.css. */
export const SHADOWS = ['sm', 'md', 'lg', 'glow'];
/** What a block does under the pointer. The CSS is `.cv-hov-<name>` in index.css. */
export const HOVER_EFFECTS = ['lift', 'grow', 'glow', 'dim', 'tilt'];
/** The grid steps an author may pick. 8 is what every preset was drawn on. */
export const GRID_SIZES = [4, 8, 16, 24, 32];
/** Where a block's text sits. */
export const TEXT_ALIGNS = ['left', 'center', 'right', 'justify'];

/**
 * A link an entire block can carry. Same-site paths, anchors and http(s) only — a canvas is
 * authored by an editor, and an `<a href>` is a sink a `javascript:` string must never reach
 * (see check-url-schemas.mjs for the API side of the same rule).
 */
export function safeLink(raw) {
  // Read the URL the way the BROWSER does before judging it: tabs and newlines anywhere are
  // deleted, and C0 controls and spaces at either end are trimmed. `java\nscript:` and
  // `/\t/evil.example` are a script and another host to a browser, and neither looks like one
  // to a prefix test on the raw string.
  const s = typeof raw === 'string'
    ? raw.slice(0, 2000).replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '')
    : '';
  if (!s) return '';
  // A path, but not `//host` or `/\host`: a browser reads a backslash as a slash in an http
  // URL, so both are protocol-relative links to somebody else's site.
  if (s.startsWith('/')) return /^\/[/\\]/.test(s) ? '' : s;
  if (s.startsWith('#')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^mailto:[^\s]+$/i.test(s)) return s;
  return '';
}

/** An element id a `scroll` button may target: `#` and an id, never a CSS selector. */
const SCROLL_TARGET = /^#[A-Za-z][\w-]{0,79}$/;

/**
 * What a button does, decided once, from the stored action — for the renderer AND the editor.
 *
 *   link      a `safeLink` (path, anchor, http(s), mailto)
 *   download  a file: a same-site path or http(s), never an anchor or a mail address
 *   scroll    `#id` only (`#top` when empty); a selector is inert
 *   copy      the text; no URL at all
 *   api / anything else   inert, with the reason the editor shows in red
 *
 * `reason` is '' when the action works, else a key the editor turns into words.
 */
export function buttonTarget(action) {
  const a = action && typeof action === 'object' ? action : {};
  const type = typeof a.type === 'string' && a.type ? a.type : 'link';
  const inert = (reason) => ({ type: 'inert', href: '', external: false, reason });
  if (LEGACY_ACTIONS[type]) return inert(LEGACY_ACTIONS[type]);
  if (type === 'link' || type === 'download') {
    const href = safeLink(a.href);
    if (!href) return { type, href: '', external: false, reason: String(a.href || '').trim() ? 'unsafe_url' : '' };
    if (type === 'download' && !(href.startsWith('/') || /^https?:\/\//i.test(href))) return { type, href: '', external: false, reason: 'unsafe_url' };
    return { type, href, external: /^https?:\/\//i.test(href), reason: '' };
  }
  if (type === 'scroll') {
    const target = String(a.target || '').trim();
    if (!target) return { type, href: '#top', external: false, reason: '' };
    return SCROLL_TARGET.test(target) ? { type, href: target, external: false, reason: '' } : inert('bad_scroll_target');
  }
  if (type === 'copy') return { type, href: '', external: false, reason: '' };
  return inert('unknown_action');
}

/** A dropdown item's link: the same policy as every other link on a canvas. */
export const menuItemHref = (raw) => safeLink(raw);

/**
 * The shape a block or canvas id must have.
 *
 * An id is interpolated into selectors (`[data-anim="…"]`, `[data-cv="…"]`) inside a `<style>`
 * element. One that carries `"]{}` closes the selector and opens a rule for the whole site
 * (S3), so an id is a NAME, never free text. The API refuses anything else on save
 * (apps/api/src/lib/studio-doc.mjs); this rewrites it on read, for a page stored before.
 */
export const ID_SHAPE = /^[A-Za-z0-9_-]{1,60}$/;
function safeId(raw, fallback, taken) {
  let id = typeof raw === 'string' && ID_SHAPE.test(raw) ? raw : '';
  if (!id) {
    // Derived, not random: the editor selects by id, and a fresh one on every render would
    // make a legacy block impossible to keep selected.
    const base = String(raw ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    id = `${fallback}${base ? `-${base}` : ''}`.slice(0, 60);
  }
  if (taken) {
    let n = 1; const root = id.slice(0, 54);
    while (taken.has(id)) id = `${root}-${n++}`;
    taken.add(id);
  }
  return id;
}

/** Kinds whose height is theirs to keep in a stack — a media box with no intrinsic height in
 *  the column would collapse to nothing the way `box` did. */
const KEEPS_HEIGHT = new Set(['box', 'video', 'embed', 'replay']);
export const keepsHeightStacked = (kind) => KEEPS_HEIGHT.has(kind);

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Snap a design-space coordinate to the grid. */
export const snap = (v, grid = GRID) => Math.round(num(v) / grid) * grid;
/** A board coordinate: anywhere, within the guard rail, in whole pixels.
 *  NOT snapped here (v1 snapped at every read): the grid is a choice made while dragging, and
 *  re-snapping at read time undid every placement made with the snap off at the next render. */
const coord = (v, d = 0) => clamp(Math.round(num(v, d)), -BOUND, BOUND) + 0;
/** A board size: a whole pixel at least, the guard rail at most. */
const size = (v, d) => clamp(Math.round(num(v, d)), 1, BOUND);

// ── Props: an allow-list PER KIND (PLAN-STUDIO-2026, 3.2) ─────────────────────────────
// `props` used to be passed through as stored, so anything a hand edit, a paste or an import
// put there reached the page and the next save. Every field the renderer (ui/canvas-view.jsx)
// or the inspector (editor/canvas-studio.jsx) reads is named here, and nothing else survives
// normalisation. The API refuses the rest at save (`validateDoc`).
/** Props every kind may carry: they style the wrapper or the painted box. */
export const COMMON_PROPS = ['bg', 'border', 'color', 'radius', 'pad', 'cls', 'style', 'pattern', 'align'];
/** Props a kind adds to the common ones. */
export const KIND_PROPS = {
  text: ['md'],
  image: ['src', 'alt', 'fit'],
  box: [],
  video: ['src', 'poster', 'controls', 'muted', 'loop', 'autoplay', 'fit'],
  embed: ['url', 'title'],
  replay: ['src'],
  button: ['label', 'variant', 'size', 'outline', 'action', 'items', 'desc', 'doneLabel'],
  shape: ['shape', 'fill', 'fill2', 'stroke', 'strokeWidth', 'dash', 'corner', 'keepRatio', 'text', 'textColor', 'textSize', 'opacity'],
  svg: ['svg'],
};
/** Is `key` a prop this kind may carry? */
export const propAllowed = (kind, key) => COMMON_PROPS.includes(key) || (KIND_PROPS[kind] || []).includes(key);
/** The props, reduced to the allow-list of the kind. Values are filtered where they are USED. */
export function cleanProps(kind, raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const k of Object.keys(o)) if (propAllowed(kind, k) && o[k] !== undefined) out[k] = o[k];
  return out;
}

// ── Frames ────────────────────────────────────────────────────────────────────────────
/** The two frames a document has, with the width each is drawn at. */
export const FRAME_WIDTHS = { desktop: DESIGN_WIDTH, phone: PHONE_WIDTH };
/** How a frame's height is decided. */
export const FRAME_FITS = ['fixed', 'content'];
/** What a phone gets: the reading-order stack, or the hand-placed 390px board. */
export const PHONE_MODES = ['stack', 'board'];
/** The shortest a frame is drawn, so an empty page is still a place to put something. */
export const MIN_FRAME_H = 240;

/**
 * Does this box cross the frame? Area, not an edge: a block that only TOUCHES the frame's
 * edge shows nothing to a reader and is off it. `frame.h` may be Infinity (a frame whose
 * height is still being decided from its content).
 */
export function inFrame(b, frame) {
  const fw = num(frame?.w, DESIGN_WIDTH); const fh = frame?.h === Infinity ? Infinity : num(frame?.h, Infinity);
  const x = num(b?.x), y = num(b?.y), w = num(b?.w), h = num(b?.h);
  return x < fw && x + w > 0 && y < fh && y + h > 0;
}

/**
 * What a document may weigh and hold. The renderer cuts to these; `validateDoc` refuses a
 * document that passes them, so an author learns at Save rather than from a page that lost
 * its tail. `bytes` is the page serialised as JSON.
 */
export const LIMITS = {
  bytes: 300_000, blocks: 500, title: 200, name: 60, bg: 600, css: 40_000,
  svg: 200_000, items: 20, text: 2_000, custom: 4_000, id: 60,
};

/** One stored block, made sense of. `taken` keeps ids unique within the document. */
function normalizeBlock(b, i, taken) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const kind = BLOCK_KINDS.includes(b.kind) ? b.kind : 'text';
  return {
    // A stable id matters: it keys the React list and it is what the editor selects by.
    // Falling back to the index keeps an id-less legacy block editable instead of making
    // every one of them the "same" block.
    // A NAME, filtered (S3): see ID_SHAPE.
    id: safeId(b.id == null || b.id === '' ? `b${i}` : String(b.id), `b${i}`, taken),
    kind,
    // Board coordinates (v2): anywhere within ±BOUND. Being outside the frame is allowed and
    // meaningful (a block parked beside the page); the RENDERER decides what a reader sees.
    x: coord(b.x, 0),
    y: coord(b.y, 0),
    w: size(b.w, 320),
    h: size(b.h, 120),
    z: num(b.z, i),
    // Per-kind allow-list: a field the renderer never reads is not carried to the next save.
    props: cleanProps(kind, b.props),
    // Opacity lives on the BLOCK, not in props: it applies to the wrapper, so it works the
    // same for a picture, a video and a text block. In props it would have had to be
    // re-implemented per kind, and three of them would have been forgotten.
    opacity: clamp(num(b.opacity, 1), 0, 1),
    themes: themeOverlays(b.themes, kind),
    phone: phoneOverlay(b.phone),
    anim: animOverlay(b.anim),
    // The Layers panel's fields. A name so a page of twelve text blocks is navigable;
    // locked so a finished background stops catching drags meant for what sits on it;
    // hidden so a block can be kept without being shown.
    name: typeof b.name === 'string' ? b.name.slice(0, LIMITS.name) : '',
    locked: b.locked === true,
    hidden: b.hidden === true,
    // Presentation that applies to the wrapper, whatever the kind — like opacity.
    rotate: clamp(Math.round(num(b.rotate, 0)), -180, 180),
    shadow: SHADOWS.includes(b.shadow) ? b.shadow : '',
    hover: HOVER_EFFECTS.includes(b.hover) ? b.hover : '',
    link: safeLink(b.link),
    // Which saved component this block came from, if any: `{ id, inst }` — the component
    // and the particular copy of it, so "update every instance" can find the copies and
    // "detach" can forget one. Absent on a block placed by hand. Kept here because this
    // function is an allow-list: a field it does not name is a field the first save drops.
    component: componentTag(b.component),
  };
}

/**
 * v1 to v2, pure. A v2 document comes back as it is.
 *
 * The rule is that a migrated page RENDERS AS IT DID, which is checked on every stored page
 * by the non-regression harness (scripts/studio-v2-harness.mjs):
 *
 *   · v1 clamped at read time (x in [0, 1192], y >= 0, a width of at most 1200, the phone
 *     place inside 390px). Those clamps are applied ONCE, here, so a block a v1 reader saw at
 *     x = 0 stays at x = 0 instead of reappearing at the -40 that happened to be stored.
 *   · `height` (and `phoneHeight`) stored = a frame of fixed height, max(stored, content):
 *     decision D4, the height bug A.1 froze by accident never cuts a block again. Not
 *     stored = a frame that follows its content, which is what v1 did.
 *   · `phoneBoard`, or any block placed on the phone board, = `frames.phone.mode: 'board'`.
 *   · Ids that are not names are rewritten by normalisation (S3), as they were in v1.
 *
 * `bg`, `link` and a button's `props.action` are carried unchanged: the closed background
 * type is phase 4 and the action vocabulary phase 5 (PLAN-STUDIO-2026, section 4).
 */
export function migrate(raw) {
  const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (num(c.v, 1) >= DOC_VERSION) return c;
  const fin = (v) => v != null && v !== '' && Number.isFinite(Number(v));
  const blocks = (Array.isArray(c.blocks) ? c.blocks : []).map((b) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
    const out = { ...b };
    // Exactly what v1's normaliser did to a coordinate, so the page is where it was.
    out.x = clamp(snap(num(b.x, 0)), 0, DESIGN_WIDTH - GRID);
    out.y = Math.max(0, snap(num(b.y, 0)));
    out.w = clamp(snap(num(b.w, 320)), GRID, DESIGN_WIDTH);
    out.h = Math.max(GRID, snap(num(b.h, 120)));
    // v1 snapped the overlays too, and only the fields that were written.
    if (b.themes && typeof b.themes === 'object') {
      const th = { ...b.themes };
      for (const mode of ['light', 'dark']) {
        const o = th[mode];
        if (!o || typeof o !== 'object') continue;
        const t = { ...o };
        for (const k of ['x', 'y', 'w', 'h']) if (fin(o[k])) t[k] = snap(num(o[k]));
        th[mode] = t;
      }
      out.themes = th;
    }
    const p = b.phone && typeof b.phone === 'object' ? { ...b.phone } : null;
    if (p) {
      if (fin(p.h)) p.h = Math.max(GRID, snap(num(p.h)));
      if (fin(p.x)) p.x = clamp(snap(num(p.x)), 0, PHONE_WIDTH - GRID);
      if (fin(p.y)) p.y = Math.max(0, snap(num(p.y)));
      if (fin(p.w)) p.w = clamp(snap(num(p.w)), GRID, PHONE_WIDTH);
      out.phone = p;
    }
    return out;
  });
  // The heights v1 drew, measured on the blocks as v1 read them.
  const norm = blocks.map((b, i) => normalizeBlock(b, i, null)).filter(Boolean);
  const deskContent = Math.max(MIN_FRAME_H, contentHeight(norm));
  const phoneContent = Math.max(MIN_FRAME_H, phoneContentHeight(norm));
  const board = c.phoneBoard === true || norm.some((b) => b.phone?.x != null && b.phone?.y != null);
  const out = { ...c, v: DOC_VERSION, blocks };
  delete out.height; delete out.phoneHeight; delete out.phoneBoard;
  out.frames = {
    desktop: num(c.height, 0) > 0
      ? { w: DESIGN_WIDTH, h: Math.max(num(c.height), deskContent), fit: 'fixed' }
      : { w: DESIGN_WIDTH, fit: 'content' },
    phone: {
      ...(num(c.phoneHeight, 0) > 0
        ? { w: PHONE_WIDTH, h: Math.max(num(c.phoneHeight), phoneContent), fit: 'fixed' }
        : { w: PHONE_WIDTH, fit: 'content' }),
      mode: board ? 'board' : 'stack',
    },
  };
  return out;
}

/** A frame as stored, made sense of: `{ w, h, fit }` with the height decided. */
function frameOf(raw, w, contentH) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const fixed = f.fit === 'fixed' && num(f.h, 0) > 0;
  return fixed
    ? { w, h: clamp(Math.round(num(f.h)), 40, BOUND), fit: 'fixed' }
    : { w, h: Math.max(MIN_FRAME_H, contentH), fit: 'content' };
}

/**
 * Make sense of whatever is in the database.
 *
 * A canvas is author-written JSON that has been through an editor, a save, a migration and
 * possibly a hand edit. Anything can be missing or the wrong type, and the renderer must not
 * be the place that discovers it — a page that throws is worse than a page laid out badly.
 * Everything is coerced; a block that cannot be made sense of is dropped rather than drawn
 * at NaN,NaN where it would be invisible and unexplainable.
 *
 * v1 or v2 in, v2 out (`migrate` first). The result also carries `height`, `phoneHeight` and
 * `phoneBoard`, READ-ONLY conveniences derived from the frames for the code that predates
 * them; `serializeDoc` never writes them back.
 */
export function normalizeDoc(raw) {
  const c = migrate(raw);
  const taken = new Set();
  const blocks = (Array.isArray(c.blocks) ? c.blocks : []).slice(0, LIMITS.blocks)
    .map((b, i) => normalizeBlock(b, i, taken))
    .filter(Boolean);
  const fr = c.frames && typeof c.frames === 'object' ? c.frames : {};
  // The desktop frame first: which blocks the phone lays out depends on what is ON the page.
  const desktop = frameOf(fr.desktop, DESIGN_WIDTH, frameContentHeight(blocks, DESIGN_WIDTH));
  const mode = fr.phone?.mode === 'board' ? 'board' : 'stack';
  const phone = { ...frameOf(fr.phone, PHONE_WIDTH, phoneContentHeight(blocks, desktop)), mode };
  return {
    v: DOC_VERSION,
    id: safeId(c.id == null || c.id === '' ? 'canvas' : String(c.id), 'canvas'),
    title: String(c.title || '').slice(0, LIMITS.title),
    frames: { desktop, phone },
    // Derived, for readers written before frames. Never stored (serializeDoc).
    height: desktop.h,
    phoneHeight: phone.h,
    phoneBoard: mode === 'board',
    bg: typeof c.bg === 'string' ? c.bg.slice(0, LIMITS.bg) : '',
    blocks,
    // The snapping step. Stored positions are NOT re-snapped to it — a coarser grid is a
    // choice about the next drag, not a reflow of what is already placed.
    grid: GRID_SIZES.includes(num(c.grid, GRID)) ? num(c.grid, GRID) : GRID,
    // The author's own stylesheet for this page. Scoped and filtered where it is RENDERED
    // (css-scope.js), so what is stored is what was typed and the rule is in one place.
    css: typeof c.css === 'string' ? c.css.slice(0, LIMITS.css) : '',
  };
}
/** The name every caller used before documents had versions. Same function. */
export const normalizeCanvas = normalizeDoc;

/**
 * The bottom of what a reader would see in a frame of width `frameW`: the blocks that cross
 * it horizontally and are not entirely above it. A block parked beside the page does not
 * stretch the page (Inkscape's rule, not v1's, where there was no "beside").
 */
export function frameContentHeight(blocks, frameW = DESIGN_WIDTH) {
  let bottom = 0;
  for (const b of blocks || []) {
    if (!inFrame(b, { w: frameW, h: Infinity })) continue;
    bottom = Math.max(bottom, num(b.y) + num(b.h));
  }
  return bottom ? bottom + 40 : 0;
}

// ── Saving what was authored, not what was computed ─────────────────────────────────
/** The block to STORE: everything normalisation fills in with a default is left out. */
function serializeBlock(b) {
  const out = { id: b.id, kind: b.kind, x: num(b.x), y: num(b.y), w: num(b.w), h: num(b.h), z: num(b.z) };
  if (b.props && Object.keys(b.props).length) out.props = b.props;
  if (b.opacity != null && num(b.opacity, 1) !== 1) out.opacity = num(b.opacity, 1);
  if (b.themes && Object.keys(b.themes).length) out.themes = b.themes;
  if (b.phone && Object.keys(b.phone).length) out.phone = b.phone;
  if (b.anim) out.anim = b.anim;
  if (b.name) out.name = b.name;
  if (b.locked) out.locked = true;
  if (b.hidden) out.hidden = true;
  if (b.rotate) out.rotate = b.rotate;
  if (b.shadow) out.shadow = b.shadow;
  if (b.hover) out.hover = b.hover;
  if (b.link) out.link = b.link;
  if (b.component) out.component = b.component;
  return out;
}

/**
 * The document to STORE (v2), from a normalised one and what this change sets.
 *
 * The one way out to storage (PLAN-STUDIO-2026, 2.1 point 4). normalizeDoc COMPUTES a frame's
 * height when it follows its content; writing that number back is exactly how bug A.1 froze
 * every page at the height it had on its first edit. So a `content` frame is stored WITHOUT
 * a height, and a `fixed` one with the height the handle gave it.
 *
 * `extra` is what this change sets besides blocks:
 *   blocks, title, bg, css, grid        replace the document's
 *   height / phoneHeight (> 0)          the handle: that frame becomes fixed at that height
 *   phoneBoard (true/false)             the phone gets the board / the stack
 *   frames: { desktop|phone: {...} }    a frame's own fields, e.g. `{ fit: 'content' }`
 */
export function serializeDoc(canvas, extra = {}) {
  const n = canvas && canvas.v === DOC_VERSION && canvas.frames?.desktop && canvas.frames?.phone && Array.isArray(canvas.blocks)
    ? canvas : normalizeDoc(canvas);
  const e = extra && typeof extra === 'object' ? extra : {};
  let desk = { ...n.frames.desktop, ...(e.frames?.desktop || {}) };
  let phone = { ...n.frames.phone, ...(e.frames?.phone || {}) };
  if (num(e.height, 0) > 0) desk = { ...desk, h: num(e.height), fit: 'fixed' };
  if (num(e.phoneHeight, 0) > 0) phone = { ...phone, h: num(e.phoneHeight), fit: 'fixed' };
  if (e.phoneBoard === true) phone.mode = 'board';
  else if (e.phoneBoard === false) phone.mode = 'stack';
  const frame = (f, w) => (f.fit === 'fixed' && num(f.h, 0) > 0
    ? { w, h: clamp(Math.round(num(f.h)), 40, BOUND), fit: 'fixed' } : { w, fit: 'content' });
  const bg = e.bg !== undefined ? e.bg : n.bg;
  const css = e.css !== undefined ? e.css : n.css;
  const grid = e.grid !== undefined ? e.grid : n.grid;
  return {
    v: DOC_VERSION,
    id: n.id,
    title: e.title !== undefined ? String(e.title || '') : n.title,
    frames: {
      desktop: frame(desk, DESIGN_WIDTH),
      phone: { ...frame(phone, PHONE_WIDTH), mode: phone.mode === 'board' ? 'board' : 'stack' },
    },
    ...(bg ? { bg } : {}),
    ...(grid && grid !== GRID ? { grid } : {}),
    ...(css ? { css } : {}),
    blocks: (Array.isArray(e.blocks) ? e.blocks : n.blocks).filter((b) => b && typeof b === 'object').map(serializeBlock),
  };
}

/** The component tag, or null. Both halves are needed for it to mean anything. */
function componentTag(raw) {
  const o = raw && typeof raw === 'object' ? raw : null;
  if (!o || typeof o.id !== 'string' || !o.id || typeof o.inst !== 'string' || !o.inst) return null;
  return { id: o.id.slice(0, 60), inst: o.inst.slice(0, 60) };
}

/**
 * How a block moves, or null for "it does not". Only the fields that were written survive,
 * with the defaults applied where they are READ so the stored shape stays small.
 */
function animOverlay(raw) {
  const o = raw && typeof raw === 'object' ? raw : null;
  if (!o || !ANIM_KINDS.includes(o.kind)) return null;
  const out = { kind: o.kind };
  out.trigger = ANIM_TRIGGERS.includes(o.trigger) ? o.trigger : 'show';
  out.delay = clamp(Math.round(num(o.delay, 0)), 0, 60_000);
  out.duration = clamp(Math.round(num(o.duration, 700)), 50, 20_000);
  // Absent means `smooth`, which is the curve every animation ran on before this was a
  // setting — so the field stays out of the stored shape until somebody changes it.
  if (ANIM_EASINGS.includes(o.easing) && o.easing !== 'smooth') out.easing = o.easing;
  // The ambient kinds loop by nature; an entrance loops only if asked.
  out.loop = o.kind === 'pulse' || o.kind === 'float' ? o.loop !== false : o.loop === true;
  if (o.kind === 'custom') out.custom = typeof o.custom === 'string' ? o.custom.slice(0, 4000) : '';
  return out;
}

/**
 * A per-theme partial. Only the fields that were actually written survive — an overlay that
 * filled in defaults would freeze every coordinate the author never touched, so nudging a
 * hero 20px on the dark theme would silently pin its width and height there too.
 */
function themeOverlays(raw, kind = 'text') {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const mode of ['light', 'dark']) {
    const o = src[mode];
    if (!o || typeof o !== 'object') continue;
    const t = {};
    for (const k of ['x', 'y']) if (o[k] != null && Number.isFinite(Number(o[k]))) t[k] = coord(o[k]);
    for (const k of ['w', 'h']) if (o[k] != null && Number.isFinite(Number(o[k]))) t[k] = size(o[k]);
    if (o.opacity != null && Number.isFinite(Number(o.opacity))) t.opacity = clamp(num(o.opacity, 1), 0, 1);
    if (o.hidden === true) t.hidden = true;
    if (o.props && typeof o.props === 'object') { const p = cleanProps(kind, o.props); if (Object.keys(p).length) t.props = p; }
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
  if (o.h != null && Number.isFinite(Number(o.h))) out.h = size(o.h);
  // A place on the phone BOARD. Only the fields written: an x without a y is a block that
  // has not been placed, and it is laid under the placed ones like any other. On the board
  // like the desktop coordinates (v2): beside the 390px frame is a place too.
  if (o.x != null && Number.isFinite(Number(o.x))) out.x = coord(o.x);
  if (o.y != null && Number.isFinite(Number(o.y))) out.y = coord(o.y);
  if (o.w != null && Number.isFinite(Number(o.w))) out.w = size(o.w);
  return Object.keys(out).length ? out : null;
}

/**
 * The phone board: every block that is not hidden on phones, with a place on the 390px board.
 *
 * A block the author placed keeps its place. One they did not is laid BELOW everything
 * placed, full width with a margin, in reading order — so switching the board on never loses
 * a block, and a page with one hand-placed hero and six untouched cards is the hero followed
 * by the cards, not the hero alone.
 *
 * `desk` is the desktop frame. A block the author did not place on the phone and that is OFF
 * the desktop page (parked beside it on the board) is not laid into the phone column: it is
 * not on the page. It keeps its desktop coordinates, flagged `parked`, so the editor still
 * draws it where it was left. Without `desk` nothing is parked (the v1 reading).
 */
export function phoneBoardBlocks(blocks, band = 40, desk = null) {
  const shown = (blocks || []).filter((b) => !b.phone?.hidden);
  const isPlaced = (b) => b.phone?.x != null && b.phone?.y != null;
  const placed = shown.filter(isPlaced)
    .map((b) => ({ ...b, x: b.phone.x, y: b.phone.y, w: b.phone.w ?? Math.min(snap(PHONE_WIDTH - 32), num(b.w)), h: b.phone.h ?? num(b.h), placed: true }));
  let bottom = placed.filter((b) => inFrame(b, { w: PHONE_WIDTH, h: Infinity }))
    .reduce((m, b) => Math.max(m, num(b.y) + num(b.h)), 0);
  const loose = shown.filter((b) => !isPlaced(b));
  const onPage = desk ? loose.filter((b) => inFrame(b, desk)) : loose;
  const parked = desk ? loose.filter((b) => !inFrame(b, desk)).map((b) => ({ ...b, placed: false, parked: true })) : [];
  const rest = readingOrder(onPage, band).map((b) => {
    const h = b.phone?.h ?? num(b.h);
    const y = bottom ? bottom + 16 : 16;
    bottom = y + h;
    return { ...b, x: 16, y, w: b.phone?.w ?? snap(PHONE_WIDTH - 32), h, placed: false };
  });
  return [...placed, ...rest, ...parked];
}

/** The bottom edge of the phone board, plus a little air. Only what crosses the 390px frame
 *  counts, like the desktop frame's content height. */
export function phoneContentHeight(blocks, desk = null) {
  let bottom = 0;
  for (const b of phoneBoardBlocks(blocks, 40, desk)) {
    if (b.parked || !inFrame(b, { w: PHONE_WIDTH, h: Infinity })) continue;
    bottom = Math.max(bottom, num(b.y) + num(b.h));
  }
  return bottom ? bottom + 40 : 0;
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
  if (vw < STACK_BELOW) {
    // The hand-placed phone board, when there is one; the reading-order stack otherwise.
    // Scaled DOWN to a narrower phone, never up: 390 is a design width, not a minimum.
    if (canvas.phoneBoard) {
      const ps = clamp(Math.min(1, vw / PHONE_WIDTH), 0.5, 1);
      return { mode: 'phone', scale: ps, width: PHONE_WIDTH * ps, height: canvas.phoneHeight * ps };
    }
    return { mode: 'stack', scale: 1, width: vw, height: null };
  }
  const raw = vw / DESIGN_WIDTH;
  // Never magnify: a canvas designed at 1200 blown up to 2400 is a blurry poster, and text
  // that grows with the window is nobody's idea of a page.
  const scale = clamp(Math.min(1, raw), MIN_SCALE, 1);
  return { mode: 'scale', scale, width: DESIGN_WIDTH * scale, height: canvas.height * scale };
}

/**
 * The blocks a READER gets, for a layout mode and a theme, in paint order: what the public
 * page mounts, and nothing else.
 *
 * The frame is the page (v2). A block entirely outside it is on the author's board, not on
 * the page, and is not returned, so it is not MOUNTED: no image or video request for a
 * picture nobody can see, no iframe loading in the dark. One that crosses the edge is
 * returned and the renderer clips it. The stack is the desktop page read in order, so it
 * takes what is on the desktop frame; the phone board takes what is on the phone frame, and a
 * block never placed there that is off the desktop page is parked there too.
 *
 * @param {object} doc    a normalised document (normalizeDoc)
 * @param {'scale'|'phone'|'stack'} mode   layoutFor(...).mode
 * @param {'light'|'dark'} theme
 */
export function frameBlocks(doc, mode = 'scale', theme = 'light') {
  const blocks = Array.isArray(doc?.blocks) ? doc.blocks : [];
  const desk = doc?.frames?.desktop || { w: DESIGN_WIDTH, h: Infinity };
  const show = (b) => resolveBlock(b, theme);
  if (mode === 'stack') return phoneOrder(blocks).map(show).filter((b) => !b.hidden && inFrame(b, desk));
  if (mode === 'phone') {
    const pf = doc?.frames?.phone || { w: PHONE_WIDTH, h: Infinity };
    return phoneBoardBlocks(blocks.map(show).filter((b) => !b.hidden), 40, desk).filter((b) => !b.parked && inFrame(b, pf));
  }
  return paintOrder(blocks).map(show).filter((b) => !b.hidden && inFrame(b, desk));
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
  // No page edge any more (v2): off the frame is a place on the board, still drawn and still
  // grabbable in the editor, and simply not shown to a reader. `opts.width` is accepted and
  // ignored so a caller written for v1 keeps working. Only the guard rail remains; `+ 0`
  // turns the -0 that Math.round gives just left of zero into 0.
  return { x: clamp(x, -BOUND, BOUND) + 0, y: clamp(y, -BOUND, BOUND) + 0 };
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
  // No page edge (v2): a block may be resized across the frame or beyond it. The guard rail
  // only; `opts.width` is accepted and ignored, as in dragTo.
  x = clamp(x, -BOUND, BOUND) + 0;
  y = clamp(y, -BOUND, BOUND) + 0;
  w = clamp(w, min, BOUND);
  h = clamp(h, min, BOUND);
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

/**
 * One step up or down the paint order — the Layers panel's arrows. Every block gets a
 * distinct z equal to its paint position first, so a swap is a swap and not a tie between two
 * blocks that happened to share a z; ties are otherwise broken by array order, which the
 * author cannot see.
 */
export function reorder(blocks, id, dir) {
  const order = paintOrder(blocks);
  const i = order.findIndex((b) => b.id === id);
  const j = dir === 'up' ? i + 1 : i - 1;
  if (i < 0 || j < 0 || j >= order.length) return blocks;
  const zOf = new Map(order.map((b, k) => [b.id, k]));
  zOf.set(order[i].id, j);
  zOf.set(order[j].id, i);
  return blocks.map((b) => ({ ...b, z: zOf.get(b.id) }));
}

// ── The camera over the board ────────────────────────────────────────────────
// The editor draws the board through ONE transform, `translate(x, y) scale(s)`, on an element
// that does not scroll: the board has no edges to scroll to. `view = { x, y, s }` says where
// board point (0,0) is drawn in the host, and at what scale. Every conversion between a
// pointer and the board goes through the two functions below, so a drag at 37 % on a block at
// x = -600 lands under the finger like one at 100 % on the page does.

/** The zoom range (PLAN-STUDIO-2026, phase 3): 10 % to 400 %. */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const clampZoom = (s) => clamp(num(s, 1), ZOOM_MIN, ZOOM_MAX);

/** A point of the host (px from its top-left corner) on the board. */
export const toBoard = (view, sx, sy) => ({ x: (num(sx) - num(view.x)) / num(view.s, 1), y: (num(sy) - num(view.y)) / num(view.s, 1) });
/** A board point, in the host. */
export const toScreen = (view, bx, by) => ({ x: num(view.x) + num(bx) * num(view.s, 1), y: num(view.y) + num(by) * num(view.s, 1) });

/**
 * Zoom to `nextScale` about a point of the host: the board point under it stays under it.
 * That is the whole contract of "zoom centred on the pointer", and the one a naive zoom
 * (scale about the top-left corner) breaks: the page slides away from the cursor.
 */
export function zoomAt(view, sx, sy, nextScale) {
  const s = clampZoom(nextScale);
  const p = toBoard(view, sx, sy);
  return { x: num(sx) - p.x * s, y: num(sy) - p.y * s, s };
}

/**
 * One wheel event, as a zoom about the pointer. `deltaMode` 1 is lines and 2 pages (Firefox
 * with a mouse wheel); the factor is exponential so ten small trackpad events and one wheel
 * notch of the same total travel land on the same scale.
 */
export function wheelZoom(view, sx, sy, deltaY, deltaMode = 0) {
  const px = deltaMode === 1 ? num(deltaY) * 16 : deltaMode === 2 ? num(deltaY) * 400 : num(deltaY);
  return zoomAt(view, sx, sy, num(view.s, 1) * Math.exp(-clamp(px, -600, 600) * 0.0015));
}

/**
 * Two fingers: pan and pinch as ONE gesture, from where it started. The board point that was
 * under the midpoint of the two fingers at the start is under their midpoint now, and the
 * scale follows the distance between them. Computed from the START every time, never
 * accumulated per frame, for the same reason dragTo is: no drift.
 */
export function pinchView(start, a0, b0, a, b) {
  const d0 = Math.hypot(num(b0.x) - num(a0.x), num(b0.y) - num(a0.y)) || 1;
  const d1 = Math.hypot(num(b.x) - num(a.x), num(b.y) - num(a.y)) || d0;
  const m0 = { x: (num(a0.x) + num(b0.x)) / 2, y: (num(a0.y) + num(b0.y)) / 2 };
  const m1 = { x: (num(a.x) + num(b.x)) / 2, y: (num(a.y) + num(b.y)) / 2 };
  const p = toBoard(start, m0.x, m0.y);
  const s = clampZoom(num(start.s, 1) * (d1 / d0));
  return { x: m1.x - p.x * s, y: m1.y - p.y * s, s };
}

/**
 * "Fit the frame": the frame's WIDTH in the host, never magnified past 100 %, its top edge a
 * margin below the host's. The width and not the whole frame, because a page is tall and
 * fitting its height would draw a long page at a size nobody can place anything at.
 */
export function fitFrameView(frame, hostW, hostH, pad = 24) {
  const w = Math.max(1, num(frame?.w, DESIGN_WIDTH));
  const s = clampZoom(Math.min(1, (num(hostW) - 2 * pad) / w));
  return { x: (num(hostW) - w * s) / 2, y: pad, s };
}

/**
 * "Show everything": the frame and every block, whole, in the host. Blocks parked far from
 * the page are exactly what this is for, so they count as much as the frame does.
 */
export function showAllView(frame, blocks, hostW, hostH, pad = 24) {
  const box = boundsOf([{ x: 0, y: 0, w: num(frame?.w, DESIGN_WIDTH), h: num(frame?.h, MIN_FRAME_H) }, ...(blocks || [])]);
  const s = clampZoom(Math.min(1, (num(hostW) - 2 * pad) / Math.max(1, box.w), (num(hostH) - 2 * pad) / Math.max(1, box.h)));
  return { x: (num(hostW) - box.w * s) / 2 - box.x * s, y: (num(hostH) - box.h * s) / 2 - box.y * s, s };
}

/**
 * Pan so a board rectangle is in view, doing nothing when it already is. What "bring the
 * block just added into view" means on a board that has no scroll position to set.
 */
export function revealView(view, rect, hostW, hostH, pad = 24) {
  const a = toScreen(view, rect.x, rect.y);
  const b = toScreen(view, num(rect.x) + num(rect.w), num(rect.y) + num(rect.h));
  if (a.x >= 0 && a.y >= 0 && b.x <= num(hostW) && b.y <= num(hostH)) return view;
  let { x, y } = view;
  if (a.x < 0 || b.x > num(hostW)) x += (num(hostW) / 2) - (a.x + b.x) / 2;
  if (a.y < 0 || b.y > num(hostH)) y += (b.y - a.y) > num(hostH) - 2 * pad ? pad - a.y : (num(hostH) / 2) - (a.y + b.y) / 2;
  return { ...view, x, y };
}

/** The frame a board is edited against: the desktop page, or the phone's. */
export function boardFrame(canvas, board = 'light') {
  const f = board === 'phone' ? canvas?.frames?.phone : canvas?.frames?.desktop;
  return { w: num(f?.w, board === 'phone' ? PHONE_WIDTH : DESIGN_WIDTH), h: num(f?.h, MIN_FRAME_H), fit: f?.fit === 'fixed' ? 'fixed' : 'content' };
}

/** The ids of the blocks a reader would NOT see on this board: entirely outside its frame. */
export function offFrameIds(canvas, board = 'light') {
  const frame = boardFrame(canvas, board);
  return new Set(boardBlocks(canvas, board).filter((b) => b.parked || !inFrame(b, frame)).map((b) => b.id));
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
// Selecting several blocks is what turns a canvas from placing things into laying a page out:
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
 *
 * v2: the only wall left is the board's guard rail (±BOUND), not the page edge. A group may
 * be carried off the frame and back, like a single block. `opts.width` is ignored.
 */
export function moveMany(blocks, ids, dxScreen, dyScreen, scale, opts = {}) {
  const set = new Set(ids);
  const chosen = blocks.filter((b) => set.has(b.id));
  if (!chosen.length) return blocks;
  const bb = boundsOf(chosen);
  const s = Math.abs(num(scale, 1)) || 1;
  const grid = opts.snap === false ? 1 : (opts.grid || GRID);
  // Where the BOX wants to go, snapped, then clamped so the whole box stays on the board.
  const wantX = Math.round((num(opts.startX ?? bb.x) + num(dxScreen) / s) / grid) * grid;
  const wantY = Math.round((num(opts.startY ?? bb.y) + num(dyScreen) / s) / grid) * grid;
  const nx = clamp(wantX, -BOUND, Math.max(-BOUND, BOUND - bb.w)) + 0;
  const ny = clamp(wantY, -BOUND, Math.max(-BOUND, BOUND - bb.h)) + 0;
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

// ── Saving what was authored, not what was computed ─────────────────────────────────
/**
 * The canvas to STORE, from the normalised one the editor works on. The v1 name of
 * `serializeDoc`, kept for its callers: `raw` is no longer needed (whether a height was
 * pinned is now IN the document, `frames.*.fit`), and the output is a v2 document.
 */
export function serializeCanvas(canvas, raw, extra = {}) {
  return serializeDoc(canvas, extra);
}

// ── Operations on the board being EDITED ──────────────────────────────────────────
// The editor draws one of three boards: the desktop plane in the light theme (the base
// layout), the same plane in the dark theme (the `themes.dark` overlay), or the 390px phone
// board (the `phone` overlay). Every operation below READS the board it is given and WRITES
// that board's layer only. The editor used to run half of them on the desktop base whatever
// board was on screen, so aligning two blocks on the phone moved the desktop page
// (PLAN-STUDIO-2026, bug A.2). `board` is 'light' | 'dark' | 'phone'.

/** The blocks as the editor draws them on `board`: the same functions the public page uses. */
export function boardBlocks(canvas, board = 'light') {
  const blocks = Array.isArray(canvas?.blocks) ? canvas.blocks : [];
  if (board === 'phone') return phoneBoardBlocks(blocks.map((b) => resolveBlock(b, 'light')), 40, canvas?.frames?.desktop || null);
  return blocks.map((b) => resolveBlock(b, board === 'dark' ? 'dark' : 'light'));
}
const boardWidth = (board) => (board === 'phone' ? PHONE_WIDTH : DESIGN_WIDTH);
const geometry = (b) => ({ x: num(b.x), y: num(b.y), w: num(b.w), h: num(b.h) });

/**
 * Write geometry computed on a board back into the document, on that board's layer.
 * `before` and `after` are board views; only blocks whose geometry changed are written.
 * On the phone the WHOLE geometry is written, so a block laid there by reading order becomes
 * a placed block exactly where it was drawn, width included (bug A.3).
 * @returns {{ blocks: object[], extra: object }}
 */
export function commitGeometry(blocks, before, after, board = 'light') {
  const prev = new Map((before || []).map((b) => [b.id, b]));
  const changed = new Map();
  for (const b of after || []) {
    const p = prev.get(b.id); if (!p) continue;
    const d = {};
    for (const k of ['x', 'y', 'w', 'h']) if (num(b[k]) !== num(p[k])) d[k] = num(b[k]);
    if (Object.keys(d).length) changed.set(b.id, { d, full: geometry(b) });
  }
  const extra = {};
  const out = (blocks || []).map((b) => {
    const c = changed.get(b.id); if (!c) return b;
    if (board === 'phone') { extra.phoneBoard = true; return { ...b, phone: { ...(b.phone || {}), ...c.full } }; }
    if (board === 'dark') return { ...b, themes: { ...(b.themes || {}), dark: { ...(b.themes?.dark || {}), ...c.d } } };
    return { ...b, ...c.d };
  });
  return { blocks: out, extra };
}

const onBoard = (canvas, board, op) => {
  const view = boardBlocks(canvas, board);
  return commitGeometry(canvas.blocks, view, op(view), board);
};
/** alignMany, on the board being edited. */
export const alignOnBoard = (canvas, ids, how, board = 'light') => onBoard(canvas, board, (v) => alignMany(v, ids, how));
/** distributeMany, on the board being edited. */
export const distributeOnBoard = (canvas, ids, axis, board = 'light') => onBoard(canvas, board, (v) => distributeMany(v, ids, axis));
/**
 * Give every selected block the width (or height) of the FIRST one picked, the one the author
 * clicked deliberately; a widened block is pulled left so it stays on the board.
 */
export function matchSizeMany(blocks, ids, axis, width = DESIGN_WIDTH) {
  if (!Array.isArray(ids) || ids.length < 2 || (axis !== 'w' && axis !== 'h')) return blocks;
  const model = blocks.find((b) => b.id === ids[0]);
  if (!model) return blocks;
  return blocks.map((b) => (ids.includes(b.id) && !b.locked
    ? { ...b, [axis]: num(model[axis]), ...(axis === 'w' ? { x: Math.max(0, Math.min(num(b.x), width - num(model.w))) } : {}) }
    : b));
}
export const matchSizeOnBoard = (canvas, ids, axis, board = 'light') => onBoard(canvas, board, (v) => matchSizeMany(v, ids, axis, boardWidth(board)));

/** What a single-block drag writes: on the phone the size goes with the place (bug A.3). */
export function dragPatch(view, next, board = 'light') {
  return board === 'phone' ? { ...next, w: num(view.w), h: num(view.h) } : next;
}

/**
 * Duplicate the selection, offset on the board being edited. The desktop copy is offset on
 * the desktop plane (it used to be clamped into the phone's 390 when duplicated there), and
 * the phone copy is offset on the phone instead of landing exactly on its original. No page
 * edge (v2): a copy of a block at the right edge lands where the offset puts it.
 * @returns {{ blocks: object[], ids: string[], extra: object }}
 */
export function duplicateOnBoard(canvas, ids, board, newId) {
  const OFF = GRID * 3;
  const view = new Map(boardBlocks(canvas, board).map((b) => [b.id, b]));
  const out = []; const made = [];
  for (const b of canvas.blocks || []) {
    if (!ids.includes(b.id)) continue;
    const id = newId();
    const copy = { ...b, id, x: coord(num(b.x) + OFF), y: coord(num(b.y) + OFF) };
    if (b.themes?.dark && (b.themes.dark.x != null || b.themes.dark.y != null)) {
      const d = b.themes.dark;
      copy.themes = { ...b.themes, dark: { ...d, ...(d.x != null ? { x: coord(num(d.x) + OFF) } : {}), ...(d.y != null ? { y: coord(num(d.y) + OFF) } : {}) } };
    }
    const v = view.get(b.id);
    if (board === 'phone' && v) copy.phone = { ...(b.phone || {}), x: coord(num(v.x) + OFF), y: coord(num(v.y) + OFF), w: num(v.w), h: num(v.h) };
    else if (b.phone?.x != null && b.phone?.y != null) copy.phone = { ...b.phone, x: coord(num(b.phone.x) + OFF), y: coord(num(b.phone.y) + OFF) };
    out.push(copy); made.push(id);
  }
  return { blocks: [...(canvas.blocks || []), ...out], ids: made, extra: board === 'phone' && made.length ? { phoneBoard: true } : {} };
}

/**
 * New blocks (added, pasted, inserted from a component) placed on the board being edited.
 * They arrive with DESKTOP coordinates, which they keep; on the phone board they also get a
 * phone place, below everything already there, inside 390px, keeping their arrangement.
 * @returns {{ blocks: object[], extra: object }}
 */
export function placeOnBoard(canvas, fresh, board = 'light') {
  const list = Array.isArray(fresh) ? fresh : [];
  if (board !== 'phone' || !list.length) return { blocks: [...(canvas.blocks || []), ...list], extra: {} };
  const bottom = phoneBoardBlocks(canvas.blocks || []).reduce((m, b) => Math.max(m, num(b.y) + num(b.h)), 0);
  const top = bottom ? bottom + 16 : 16;
  const bb = boundsOf(list);
  const placed = list.map((b) => {
    const w = Math.min(snap(PHONE_WIDTH - 32), num(b.w, 320));
    const x = clamp(snap(16 + num(b.x) - bb.x), 0, PHONE_WIDTH - w);
    return { ...b, phone: { ...(b.phone || {}), x, y: snap(top + num(b.y) - bb.y), w, h: num(b.h, 120) } };
  });
  return { blocks: [...(canvas.blocks || []), ...placed], extra: { phoneBoard: true } };
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
    id: 'cta',
    name: 'Call to action',
    nameFr: 'Appel à l’action',
    blocks: () => [
      { ...P('box', 0, 0, 1200, 320, { bg: 'color-mix(in srgb, var(--primary) 12%, transparent)', radius: 24 }), shadow: 'md' },
      { ...P('text', 160, 56, 880, 136, { md: '# Ready when you are\n\nOne line on what happens next.', align: 'center' }), anim: { kind: 'rise', trigger: 'show' } },
      { ...P('button', 400, 216, 192, 56, { label: 'Get started', variant: 'button', size: 'lg', action: { type: 'link', href: '/' } }), anim: { kind: 'zoom', trigger: 'show', delay: 150 }, hover: 'lift' },
      { ...P('button', 608, 216, 192, 56, { label: 'Read the docs', variant: 'button', size: 'lg', outline: true, action: { type: 'link', href: '/docs' } }), anim: { kind: 'zoom', trigger: 'show', delay: 250 }, hover: 'lift' },
    ],
  },
  {
    id: 'gallery',
    name: 'Picture gallery',
    nameFr: 'Galerie d’images',
    blocks: () => {
      const out = [P('text', 64, 0, 720, 88, { md: '# Gallery\n\nA few pictures, hover to lift.' })];
      // Four across, two down — 256 wide with 32 between, inside 64px margins.
      for (let i = 0; i < 8; i++) {
        const col = i % 4, row = Math.floor(i / 4);
        out.push({ ...P('image', 64 + col * 288, 120 + row * 208, 256, 176, { src: '', alt: '', fit: 'cover', radius: 16 }),
          shadow: 'sm', hover: 'lift', anim: { kind: 'fade', trigger: 'show', delay: i * 60 } });
      }
      return out;
    },
  },
  {
    id: 'shapes',
    name: 'Shapes & pattern',
    nameFr: 'Formes & motif',
    blocks: () => [
      P('box', 0, 0, 1200, 360, { bg: 'color-mix(in srgb, var(--primary) 8%, transparent)', radius: 24, pattern: { id: 'dots', color: '#000000', size: 20, opacity: 0.12 } }),
      { ...P('shape', 64, 48, 160, 160, { shape: 'blob', fill: 'var(--primary)', opacity: 0.9 }), anim: { kind: 'float', trigger: 'load' } },
      { ...P('shape', 992, 40, 144, 144, { shape: 'ring', stroke: 'var(--primary-2)', strokeWidth: 10, fill: 'none' }), anim: { kind: 'pulse', trigger: 'load' } },
      P('text', 280, 72, 640, 216, { md: '# A page with shapes\n\nBlocks that are drawn, not uploaded, every colour follows the theme.', align: 'center' }),
      { ...P('shape', 64, 424, 344, 96, { shape: 'arrow', fill: 'var(--primary)', text: 'Next', textColor: '#fff' }), hover: 'grow' },
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
