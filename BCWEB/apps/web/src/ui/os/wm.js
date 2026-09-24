// The OS mode's window manager, as a pure reducer (M1, extended by N-os).
//
// No React, no DOM, no storage: a state and an action in, a new state out. That is what lets
// test/os-wm.test.mjs cover every rule here from plain node, and what keeps the shell
// (os-shell.jsx) a thin layer that draws the state and dispatches what the pointer did.
//
// ONE WINDOW PER SECTION
// A window is keyed by the SideDash tab it shows (`id` = the tab id, `leaf` = the sub-tab on
// screen). Opening a section that is already open focuses it, and opening one of its sub-tabs
// switches that window's leaf: the window is the section, like a sidebar row is. Two copies of
// the same admin screen would be two editors of the same record, which nothing on those
// screens expects.
//
// GEOMETRY
// Rects are in desktop pixels (the area above the taskbar), never viewport pixels, so a
// window's position means the same thing whatever the header's height is today. Every rect
// that enters the state goes through clampRect: a window can be pushed mostly off-screen,
// but its title bar always stays reachable, which is the one rule a window manager must keep.
//
// WHAT ELSE THE LAYOUT HOLDS (N-os)
// The taskbar's pinned screens, the start menu's pinned screens, the icons taken off the
// desktop and the recently opened screens. They are ids of tabs, never tabs: the shell draws
// only the ones present in the dashboard's tab list TODAY, so a pin never grants anything.

export const MIN_W = 360;
export const MIN_H = 220;
export const TITLE_H = 36;
/** How much of a window must stay on the desktop horizontally. */
export const MIN_VISIBLE = 120;
/** Mounted windows, at most. Visible windows always stay mounted; minimised ones beyond
 *  this are unmounted, oldest first (see mountedIds). */
export const MAX_MOUNTED = 6;
/** Persisted windows, at most (a corrupted or hostile storage value cannot blow up a render). */
export const MAX_SAVED = 40;
/** Pinned / hidden ids kept, at most, and recent screens remembered. */
export const MAX_PINS = 24;
export const MAX_RECENT = 6;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const rectOf = (w) => ({ x: w.x, y: w.y, w: w.w, h: w.h });

/** Size bounded by the desktop, title bar always reachable. */
export function clampRect(r, vp) {
  const vw = Math.max(1, num(vp?.w, 1)); const vh = Math.max(1, num(vp?.h, 1));
  const w = clamp(Math.round(num(r?.w, MIN_W)), Math.min(MIN_W, vw), vw);
  const h = clamp(Math.round(num(r?.h, MIN_H)), Math.min(MIN_H, vh), vh);
  const x = clamp(Math.round(num(r?.x)), -(w - Math.min(MIN_VISIBLE, w)), Math.max(0, vw - Math.min(MIN_VISIBLE, w)));
  const y = clamp(Math.round(num(r?.y)), 0, Math.max(0, vh - TITLE_H));
  return { x, y, w, h };
}

// ── Snap targets ──────────────────────────────────────────────────────────────
// A window can be snapped to a NAMED zone (the two halves, the four quarters, 'max') or to a
// zone of a snap layout, written as fractions of the desktop ({ x, y, w, h }, each 0..1).
// Fractions are what is stored, so a snapped window follows the desktop when it is resized
// (entering fullscreen, rotating a tablet) instead of keeping stale pixels.

export const ZONES = ['left', 'right', 'max', 'tl', 'tr', 'bl', 'br'];
const FRAC_EPS = 0.001;

export const isFrac = (f) => !!f && typeof f === 'object'
  && ['x', 'y', 'w', 'h'].every((k) => typeof f[k] === 'number' && Number.isFinite(f[k]) && f[k] >= 0 && f[k] <= 1)
  && f.w > 0 && f.h > 0 && f.x + f.w <= 1 + FRAC_EPS && f.y + f.h <= 1 + FRAC_EPS;
export const isTarget = (t) => ZONES.includes(t) || isFrac(t);
const r3 = (n) => Math.round(n * 1000) / 1000;
export const sameFrac = (a, b) => isFrac(a) && isFrac(b) && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < FRAC_EPS);
const isFullFrac = (f) => f.x <= FRAC_EPS && f.y <= FRAC_EPS && f.w >= 1 - FRAC_EPS && f.h >= 1 - FRAC_EPS;
// Copied, not rounded: 2/3 stored as 0.667 would land a pixel off on a wide desktop.
const cleanFrac = (f) => ({ x: f.x, y: f.y, w: f.w, h: f.h });
/** A target as a stable string (React keys, data-* attributes). */
export const targetKey = (t) => (typeof t === 'string' ? t : isFrac(t) ? [t.x, t.y, t.w, t.h].map(r3).join(',') : '');
/** The inverse of targetKey; null for anything that is not a target. */
export function parseTarget(key) {
  if (ZONES.includes(key)) return key;
  if (typeof key !== 'string') return null;
  const n = key.split(',').map(Number);
  if (n.length !== 4) return null;
  const f = { x: n[0], y: n[1], w: n[2], h: n[3] };
  return isFrac(f) ? f : null;
}

/** A fraction zone in desktop pixels. Each edge is rounded once, so adjacent zones touch. */
export function rectForFrac(f, vp) {
  const x = Math.round(f.x * vp.w); const y = Math.round(f.y * vp.h);
  const right = Math.round((f.x + f.w) * vp.w); const bottom = Math.round((f.y + f.h) * vp.h);
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}

/** The rect of a target: a half, a quarter, a layout zone, or the whole desktop. */
export function rectForZone(zone, vp) {
  if (isFrac(zone)) return rectForFrac(zone, vp);
  const hw = Math.floor(vp.w / 2); const hh = Math.floor(vp.h / 2);
  switch (zone) {
    case 'left': return { x: 0, y: 0, w: hw, h: vp.h };
    case 'right': return { x: hw, y: 0, w: vp.w - hw, h: vp.h };
    case 'tl': return { x: 0, y: 0, w: hw, h: hh };
    case 'tr': return { x: hw, y: 0, w: vp.w - hw, h: hh };
    case 'bl': return { x: 0, y: hh, w: hw, h: vp.h - hh };
    case 'br': return { x: hw, y: hh, w: vp.w - hw, h: vp.h - hh };
    default: return { x: 0, y: 0, w: vp.w, h: vp.h };
  }
}

/**
 * Which zone a drag is over: the left/right edge snaps to a half, the top edge maximises, and
 * near a corner (within `corner` px of it, along an edge) it is that quarter.
 */
export function snapZoneAt(px, py, vp, edge = 10, corner = 120) {
  const nearL = px <= edge; const nearR = px >= vp.w - edge;
  const nearT = py <= edge; const nearB = py >= vp.h - edge;
  const topBand = py <= corner; const botBand = py >= vp.h - corner;
  const leftBand = px <= corner; const rightBand = px >= vp.w - corner;
  if ((nearL && topBand) || (nearT && leftBand)) return 'tl';
  if ((nearR && topBand) || (nearT && rightBand)) return 'tr';
  if ((nearL && botBand) || (nearB && leftBand)) return 'bl';
  if ((nearR && botBand) || (nearB && rightBand)) return 'br';
  if (nearT) return 'max';
  if (nearL) return 'left';
  if (nearR) return 'right';
  return null;
}

// ── Snap layouts (the grid that opens from the maximise button) ────────────────
const T3 = 1 / 3;
export const SNAP_LAYOUTS = [
  { id: 'halves', zones: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }] },
  { id: 'two-thirds', zones: [{ x: 0, y: 0, w: 2 * T3, h: 1 }, { x: 2 * T3, y: 0, w: T3, h: 1 }] },
  { id: 'main-stack', zones: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
  { id: 'quarters', zones: [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
  { id: 'thirds', zones: [{ x: 0, y: 0, w: T3, h: 1 }, { x: T3, y: 0, w: T3, h: 1 }, { x: 2 * T3, y: 0, w: T3, h: 1 }], minWidth: 1100 },
  { id: 'wide-center', zones: [{ x: 0, y: 0, w: 0.25, h: 1 }, { x: 0.25, y: 0, w: 0.5, h: 1 }, { x: 0.75, y: 0, w: 0.25, h: 1 }], minWidth: 1500 },
];
/** The layouts whose every zone can hold a window of (almost) the minimum size. */
export function availableLayouts(vp) {
  return SNAP_LAYOUTS.filter((l) => (l.minWidth || 0) <= vp.w && l.zones.every((z) => z.w * vp.w >= MIN_W * 0.9 && z.h * vp.h >= MIN_H));
}
const NAMED_FRAC = {
  left: { x: 0, y: 0, w: 0.5, h: 1 }, right: { x: 0.5, y: 0, w: 0.5, h: 1 },
  tl: { x: 0, y: 0, w: 0.5, h: 0.5 }, tr: { x: 0.5, y: 0, w: 0.5, h: 0.5 }, bl: { x: 0, y: 0.5, w: 0.5, h: 0.5 }, br: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
};
/** A target as fractions of the desktop ('max' and non-targets: null). */
export const fracOf = (t) => (typeof t === 'string' ? NAMED_FRAC[t] || null : isFrac(t) ? t : null);
/**
 * Snap assist: once a window takes a zone, the OTHER zones of the same layout, in order, are
 * offered to the other windows. A half offers the other half; a quarter, the three others; a
 * layout zone, the rest of that layout. 'max' and a free zone (fill) offer nothing.
 */
export function assistZones(target) {
  const named = typeof target === 'string';
  const f = fracOf(target);
  if (!f) return [];
  const layout = named
    ? SNAP_LAYOUTS.find((l) => l.id === (target === 'left' || target === 'right' ? 'halves' : 'quarters'))
    : SNAP_LAYOUTS.find((l) => l.zones.some((z) => sameFrac(z, f)));
  if (!layout) return [];
  return layout.zones.filter((z) => !sameFrac(z, f));
}

// ── Fill the free space, tile ──────────────────────────────────────────────────
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The largest rect of the desktop that overlaps none of `obstacles` (the other visible
 * windows), or null when nothing of at least `min` is free. Candidates are built on the
 * obstacles' edges (twelve obstacles at most, so this stays cheap).
 */
export function largestFreeRect(obstacles, vp, min = { w: MIN_W, h: MIN_H }) {
  const obs = (obstacles || []).map((o) => {
    const x = Math.max(0, o.x); const y = Math.max(0, o.y);
    return { x, y, w: Math.min(vp.w, o.x + o.w) - x, h: Math.min(vp.h, o.y + o.h) - y };
  }).filter((o) => o.w > 0 && o.h > 0).slice(0, 12);
  const xs = [...new Set([0, vp.w, ...obs.flatMap((o) => [o.x, o.x + o.w])])].sort((a, b) => a - b);
  const ys = [...new Set([0, vp.h, ...obs.flatMap((o) => [o.y, o.y + o.h])])].sort((a, b) => a - b);
  let best = null; let area = 0;
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const w = xs[j] - xs[i];
      if (w < min.w) continue;
      for (let k = 0; k < ys.length; k++) {
        for (let l = k + 1; l < ys.length; l++) {
          const h = ys[l] - ys[k];
          const r = { x: xs[i], y: ys[k], w, h };
          if (obs.some((o) => intersects(r, o))) break; // taller ones contain this one: they overlap too
          if (h < min.h || w * h <= area) continue;
          best = r; area = w * h;
        }
      }
    }
  }
  return best;
}

/** n windows as a grid (columns = ceil(sqrt n)); the last row stretches over the full width. */
export function tileFracs(n) {
  if (!(n > 0)) return [];
  const cols = Math.ceil(Math.sqrt(n)); const rows = Math.ceil(n / cols);
  const out = [];
  for (let r = 0; r < rows; r++) {
    const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
    for (let c = 0; c < inRow; c++) out.push({ x: c / inRow, y: r / rows, w: 1 / inRow, h: 1 / rows });
  }
  return out;
}

// ── Resize ─────────────────────────────────────────────────────────────────────

/**
 * Resize from a handle ('n', 's', 'e', 'w' and the four corners) by a pointer delta. The edge
 * opposite the handle stays put, the minimum size holds, and the window never grows past the
 * desktop's edges.
 */
export function resizeRect(start, handle, dx, dy, vp) {
  let { x, y, w, h } = start;
  const hd = String(handle || '');
  if (hd.includes('e')) w = start.w + dx;
  if (hd.includes('s')) h = start.h + dy;
  if (hd.includes('w')) { w = start.w - dx; x = start.x + dx; }
  if (hd.includes('n')) { h = start.h - dy; y = start.y + dy; }
  const minW = Math.min(MIN_W, vp.w); const minH = Math.min(MIN_H, vp.h);
  if (w < minW) { if (hd.includes('w')) x -= minW - w; w = minW; }
  if (h < minH) { if (hd.includes('n')) y -= minH - h; h = minH; }
  if (y < 0) { h += y; y = 0; }
  if (hd.includes('w') && x < 0) { w += x; x = 0; }
  if (hd.includes('e') && x + w > vp.w) w = Math.max(minW, vp.w - x);
  if (hd.includes('s') && y + h > vp.h) h = Math.max(minH, vp.h - y);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** The default size of a new window: generous, never bigger than the desktop. */
export function defaultSize(vp) {
  return { w: Math.round(Math.min(1040, vp.w * 0.78)), h: Math.round(Math.min(720, vp.h * 0.86)) };
}

/** Cascade: each new window 28/24 px lower-right than the previous one, wrapping after 8. */
export function cascade(wins, size, vp) {
  const n = wins.filter((w) => w.mode !== 'min').length % 8;
  const baseX = Math.max(0, Math.round((vp.w - size.w) / 2) - 3 * 28);
  const baseY = Math.max(0, Math.round((vp.h - size.h) / 2) - 3 * 24);
  let x = baseX + n * 28; let y = baseY + n * 24;
  if (x + size.w > vp.w) x = Math.max(0, vp.w - size.w);
  if (y + size.h > vp.h) y = Math.max(0, vp.h - size.h);
  return { x, y };
}

/** The highest visible window, or null. */
export function topId(wins, exclude = null) {
  let best = null;
  for (const w of wins) {
    if (w.id === exclude || w.mode === 'min') continue;
    if (!best || w.z > best.z) best = w;
  }
  return best ? best.id : null;
}

/** Compact z-indexes 1..n in the current order, `id` on top. */
function raise(wins, id) {
  const order = [...wins].sort((a, b) => a.z - b.z).map((w) => w.id).filter((x) => x !== id);
  if (wins.some((w) => w.id === id)) order.push(id);
  const rank = new Map(order.map((x, i) => [x, i + 1]));
  return wins.map((w) => (w.z === rank.get(w.id) ? w : { ...w, z: rank.get(w.id) }));
}

export function initialState(vp = { w: 1280, h: 720 }) {
  return {
    wins: [], active: null, seq: 0, vp: { w: Math.max(1, num(vp.w, 1280)), h: Math.max(1, num(vp.h, 720)) }, peek: null,
    pins: [], start: [], hidden: [], recent: [],
  };
}

// A window's geometry when it is re-laid out for a desktop of a new size.
function fit(w, vp) {
  if (w.mode === 'max') return { ...w, ...rectForZone('max', vp) };
  if (w.snap) return { ...w, ...rectForZone(w.snap, vp) };
  const r = clampRect(w, vp);
  return r.x === w.x && r.y === w.y && r.w === w.w && r.h === w.h ? w : { ...w, ...r };
}

function focusIn(s, id) {
  const w = s.wins.find((x) => x.id === id);
  if (!w) return s;
  const seq = s.seq + 1;
  const wins = raise(s.wins.map((x) => (x.id === id ? { ...x, mode: x.mode === 'min' ? (x.prev || 'normal') : x.mode, used: seq } : x)), id);
  return { ...s, wins, active: id, seq, peek: null };
}

function minimiseIn(s, id) {
  const w = s.wins.find((x) => x.id === id);
  if (!w || w.mode === 'min') return s;
  const wins = s.wins.map((x) => (x.id === id ? { ...x, mode: 'min', prev: x.mode } : x));
  return { ...s, wins, active: s.active === id ? topId(wins) : s.active };
}

// The free geometry to come back to when a window leaves a snapped or maximised state.
const restoreOf = (w) => (w.snap || w.mode === 'max' ? (w.restore || rectOf(w)) : rectOf(w));

function maximiseIn(s, id) {
  const w = s.wins.find((x) => x.id === id);
  if (!w) return s;
  if (w.mode === 'max') {
    // Restore to the remembered geometry, or a sensible default when there is none.
    const r = clampRect(w.restore || { ...defaultSize(s.vp), ...cascade([], defaultSize(s.vp), s.vp) }, s.vp);
    return focusIn({ ...s, wins: s.wins.map((x) => (x.id === id ? { ...x, ...r, mode: 'normal', snap: null, restore: null } : x)) }, id);
  }
  const restore = restoreOf(w);
  return focusIn({ ...s, wins: s.wins.map((x) => (x.id === id ? { ...x, ...rectForZone('max', s.vp), mode: 'max', snap: null, restore } : x)) }, id);
}

// Snap one window to a target (not 'max'), without focusing it.
function snapWin(w, target, vp) {
  const t = typeof target === 'string' ? target : cleanFrac(target);
  return { ...w, ...rectForZone(t, vp), mode: 'normal', snap: t, restore: restoreOf(w) };
}

const pushRecent = (list, id) => [id, ...(list || []).filter((x) => x !== id)].slice(0, MAX_RECENT);
const toggleIn = (list, id) => ((list || []).includes(id) ? list.filter((x) => x !== id) : [...(list || []), id].slice(-MAX_PINS));

/**
 * The reducer. Unknown actions and actions on unknown windows return the SAME state object,
 * so React skips the render.
 */
export function reduce(s, a) {
  if (!a || typeof a !== 'object') return s;
  switch (a.type) {
    case 'open': {
      if (!a.id) return s;
      const leaf = a.leaf || a.id;
      const have = s.wins.find((w) => w.id === a.id);
      const recent = s.recent?.[0] === a.id ? s.recent : pushRecent(s.recent, a.id);
      if (have) {
        const next = have.leaf === leaf && recent === s.recent ? s : { ...s, recent, wins: s.wins.map((w) => (w.id === a.id ? { ...w, leaf } : w)) };
        return focusIn(next, a.id);
      }
      const size = { ...defaultSize(s.vp), ...(a.size || {}) };
      const r = clampRect({ ...cascade(s.wins, size, s.vp), ...size }, s.vp);
      const seq = s.seq + 1;
      const z = s.wins.reduce((m, w) => Math.max(m, w.z), 0) + 1;
      const win = { id: a.id, leaf, ...r, mode: 'normal', prev: 'normal', z, restore: null, snap: null, used: seq };
      return { ...s, wins: [...s.wins, win], active: a.id, seq, peek: null, recent };
    }
    case 'leaf': {
      const w = s.wins.find((x) => x.id === a.id);
      if (!w || !a.leaf || w.leaf === a.leaf) return s;
      return { ...s, wins: s.wins.map((x) => (x.id === a.id ? { ...x, leaf: a.leaf } : x)) };
    }
    case 'focus': {
      const w = s.wins.find((x) => x.id === a.id);
      if (!w) return s;
      if (s.active === a.id && w.mode !== 'min' && w.z === Math.max(...s.wins.map((x) => x.z))) return s;
      return focusIn(s, a.id);
    }
    case 'close': {
      if (!s.wins.some((w) => w.id === a.id)) return s;
      const wins = s.wins.filter((w) => w.id !== a.id);
      return { ...s, wins, active: s.active === a.id ? topId(wins) : s.active, peek: null };
    }
    case 'closeMany': {
      const ids = new Set(Array.isArray(a.ids) ? a.ids : []);
      if (!s.wins.some((w) => ids.has(w.id))) return s;
      const wins = s.wins.filter((w) => !ids.has(w.id));
      return { ...s, wins, active: s.active && ids.has(s.active) ? topId(wins) : s.active, peek: null };
    }
    case 'closeAll':
      return s.wins.length ? { ...s, wins: [], active: null, peek: null } : s;
    case 'minimize':
      return minimiseIn(s, a.id);
    case 'toggleMax':
      return maximiseIn(s, a.id);
    case 'rect': {
      // The end of a drag or a resize: the window is free-floating from here on.
      const w = s.wins.find((x) => x.id === a.id);
      if (!w || !a.rect) return s;
      const r = clampRect(a.rect, s.vp);
      return { ...s, wins: s.wins.map((x) => (x.id === a.id ? { ...x, ...r, mode: 'normal', snap: null, restore: null } : x)) };
    }
    case 'snap': {
      // A half, a quarter, a layout zone (fractions) or 'max'. A zone covering the whole
      // desktop IS a maximise, so it restores like one.
      const w = s.wins.find((x) => x.id === a.id);
      if (!w || !isTarget(a.zone)) return s;
      if (a.zone === 'max' || (isFrac(a.zone) && isFullFrac(a.zone))) return w.mode === 'max' ? focusIn(s, a.id) : maximiseIn(s, a.id);
      return focusIn({ ...s, wins: s.wins.map((x) => (x.id === a.id ? snapWin(x, a.zone, s.vp) : x)) }, a.id);
    }
    case 'unsnap': {
      // Back to the geometry the window had before it was snapped or maximised.
      const w = s.wins.find((x) => x.id === a.id);
      if (!w || (!w.snap && w.mode !== 'max')) return s;
      const r = clampRect(w.restore || rectOf(w), s.vp);
      return focusIn({ ...s, wins: s.wins.map((x) => (x.id === a.id ? { ...x, ...r, mode: 'normal', snap: null, restore: null } : x)) }, a.id);
    }
    case 'fill': {
      // Take the largest free area the other visible windows leave. Stored as fractions, so it
      // follows the desktop like any snapped window. Nothing free: the same state.
      const w = s.wins.find((x) => x.id === a.id);
      if (!w) return s;
      const others = s.wins.filter((x) => x.id !== a.id && x.mode !== 'min');
      const r = largestFreeRect(others, s.vp);
      if (!r) return s;
      const f = { x: r.x / s.vp.w, y: r.y / s.vp.h, w: r.w / s.vp.w, h: r.h / s.vp.h };
      if (isFullFrac(f)) return w.mode === 'max' ? focusIn(s, a.id) : maximiseIn(s, a.id);
      return focusIn({ ...s, wins: s.wins.map((x) => (x.id === a.id ? { ...snapWin(x.mode === 'min' ? { ...x, mode: 'normal' } : x, f, s.vp), ...r } : x)) }, a.id);
    }
    case 'tile': {
      // Every visible window (or the given ones, in that order) as a grid; one alone maximises.
      const ids = Array.isArray(a.ids) && a.ids.length
        ? a.ids.filter((id) => s.wins.some((w) => w.id === id))
        : s.wins.filter((w) => w.mode !== 'min').map((w) => w.id);
      if (!ids.length) return s;
      if (ids.length === 1) {
        const w = s.wins.find((x) => x.id === ids[0]);
        return w.mode === 'max' ? focusIn(s, w.id) : maximiseIn(s, w.id);
      }
      const fr = tileFracs(ids.length);
      const at = new Map(ids.map((id, i) => [id, fr[i]]));
      const wins = s.wins.map((w) => {
        const f = at.get(w.id);
        if (!f) return w;
        const base = w.mode === 'min' ? { ...w, mode: w.prev === 'max' ? 'max' : 'normal' } : w;
        return snapWin(base, f, s.vp);
      });
      const top = ids[ids.length - 1];
      return focusIn({ ...s, wins }, s.active && at.has(s.active) ? s.active : top);
    }
    case 'viewport': {
      const vp = { w: Math.max(1, Math.round(num(a.w, s.vp.w))), h: Math.max(1, Math.round(num(a.h, s.vp.h))) };
      if (vp.w === s.vp.w && vp.h === s.vp.h) return s;
      return { ...s, vp, wins: s.wins.map((w) => fit(w, vp)) };
    }
    case 'taskbar': {
      // Taskbar click: the active window minimises, any other one comes to the front.
      const w = s.wins.find((x) => x.id === a.id);
      if (!w) return s;
      if (s.active === a.id && w.mode !== 'min') return minimiseIn(s, a.id);
      return focusIn(s, a.id);
    }
    case 'cycle': {
      // Next / previous window in taskbar order, minimised ones included (they come back).
      const list = Array.isArray(a.order) && a.order.length ? a.order.filter((id) => s.wins.some((w) => w.id === id)) : s.wins.map((w) => w.id);
      if (!list.length) return s;
      const dir = a.dir === -1 ? -1 : 1;
      const i = list.indexOf(s.active);
      const target = i === -1 ? list[dir === 1 ? 0 : list.length - 1] : list[(i + dir + list.length) % list.length];
      return focusIn(s, target);
    }
    case 'showDesktop': {
      // A toggle: minimise every visible window, and the second press brings back exactly
      // those (not the ones that were already minimised before).
      const visible = s.wins.filter((w) => w.mode !== 'min').map((w) => w.id);
      if (!visible.length && s.peek?.length) {
        const ids = new Set(s.peek);
        const wins = s.wins.map((w) => (ids.has(w.id) && w.mode === 'min' ? { ...w, mode: w.prev || 'normal' } : w));
        return { ...s, wins, active: topId(wins), peek: null };
      }
      if (!visible.length) return s;
      const ids = new Set(visible);
      return { ...s, wins: s.wins.map((w) => (ids.has(w.id) ? { ...w, mode: 'min', prev: w.mode } : w)), active: null, peek: visible };
    }
    case 'minimizeOthers': {
      const others = s.wins.filter((w) => w.id !== a.id && w.mode !== 'min');
      if (!others.length || !s.wins.some((w) => w.id === a.id)) return s;
      const ids = new Set(others.map((w) => w.id));
      return focusIn({ ...s, wins: s.wins.map((w) => (ids.has(w.id) ? { ...w, mode: 'min', prev: w.mode } : w)) }, a.id);
    }
    // ── What the taskbar, the start menu and the desktop keep (ids of tabs, never tabs) ──
    case 'pin': {
      // where: 'bar' (taskbar) | 'start' (start menu). A toggle unless `on` says which way.
      if (!ID_RE.test(String(a.id || ''))) return s;
      const key = a.where === 'start' ? 'start' : 'pins';
      const list = s[key] || [];
      const has = list.includes(a.id);
      if (typeof a.on === 'boolean' && a.on === has) return s;
      return { ...s, [key]: toggleIn(list, a.id) };
    }
    case 'movePin': {
      // Reorder a pin (keyboard: move left/right by one).
      const key = a.where === 'start' ? 'start' : 'pins';
      const list = s[key] || [];
      const i = list.indexOf(a.id);
      const j = i + (a.dir === -1 ? -1 : 1);
      if (i === -1 || j < 0 || j >= list.length) return s;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...s, [key]: next };
    }
    case 'desk': {
      // Show or hide one screen's icon on the desktop (`show` true / false).
      if (!ID_RE.test(String(a.id || ''))) return s;
      const hidden = s.hidden || [];
      const isHidden = hidden.includes(a.id);
      if (a.show === !isHidden) return s;
      return { ...s, hidden: a.show ? hidden.filter((x) => x !== a.id) : [...hidden, a.id].slice(-MAX_SAVED) };
    }
    case 'deskReset':
      return s.hidden?.length ? { ...s, hidden: [] } : s;
    case 'hydrate': {
      const wins = sanitise(a.saved, s.vp);
      const seq = wins.reduce((m, w) => Math.max(m, w.used), 0);
      const active = a.saved?.active && wins.some((w) => w.id === a.saved.active && w.mode !== 'min') ? a.saved.active : topId(wins);
      return {
        ...s, wins, active, seq, peek: null,
        pins: idList(a.saved?.pins, MAX_PINS), start: idList(a.saved?.start, MAX_PINS),
        hidden: idList(a.saved?.hidden, MAX_SAVED), recent: idList(a.saved?.recent, MAX_RECENT),
      };
    }
    case 'reset':
      return initialState(s.vp);
    default:
      return s;
  }
}

/**
 * Which windows keep their component mounted. Every visible window does (it is on screen);
 * minimised ones fill what is left of `max`, most recently used first. The rest are unmounted
 * and lose their unsaved state, which the taskbar says in a tooltip.
 */
export function mountedIds(s, max = MAX_MOUNTED) {
  const out = new Set(s.wins.filter((w) => w.mode !== 'min').map((w) => w.id));
  const mins = s.wins.filter((w) => w.mode === 'min').sort((a, b) => b.used - a.used);
  for (const w of mins) {
    if (out.size >= max) break;
    out.add(w.id);
  }
  return out;
}

/** What is written to storage: ids, leaves and geometry, and the pinned / hidden / recent ids. */
export function serialize(s) {
  return {
    v: 2,
    active: s.active,
    wins: s.wins.slice(0, MAX_SAVED).map((w) => {
      const base = (w.mode === 'max' || w.snap) && w.restore ? w.restore : w;
      return {
        id: w.id, leaf: w.leaf,
        x: Math.round(base.x), y: Math.round(base.y), w: Math.round(base.w), h: Math.round(base.h),
        mode: w.mode, prev: w.prev === 'max' ? 'max' : 'normal', snap: w.snap || null, z: w.z, used: w.used,
      };
    }),
    pins: (s.pins || []).slice(0, MAX_PINS),
    start: (s.start || []).slice(0, MAX_PINS),
    hidden: (s.hidden || []).slice(0, MAX_SAVED),
    recent: (s.recent || []).slice(0, MAX_RECENT),
  };
}

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A list of tab ids from storage: strings of the id shape, unique, capped. */
function idList(v, max) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v.slice(0, max * 2)) {
    if (typeof x === 'string' && ID_RE.test(x) && !out.includes(x)) out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

/** Parse what storage handed back. Anything malformed is dropped, never trusted. */
export function sanitise(saved, vp) {
  const list = Array.isArray(saved?.wins) ? saved.wins.slice(0, MAX_SAVED) : [];
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object' || !ID_RE.test(String(p.id || '')) || seen.has(p.id)) continue;
    seen.add(p.id);
    const leaf = ID_RE.test(String(p.leaf || '')) ? p.leaf : p.id;
    const mode = ['normal', 'min', 'max'].includes(p.mode) ? p.mode : 'normal';
    const snap = p.snap !== 'max' && isTarget(p.snap) ? (typeof p.snap === 'string' ? p.snap : cleanFrac(p.snap)) : null;
    const base = clampRect(p, vp);
    let w = { id: p.id, leaf, ...base, mode, prev: p.prev === 'max' ? 'max' : 'normal', z: num(p.z, out.length + 1), restore: null, snap: null, used: Math.max(0, Math.round(num(p.used))) };
    // A maximised or snapped window stored its free geometry; lay it out again from that.
    if (mode === 'max') w = { ...w, ...rectForZone('max', vp), restore: base };
    else if (snap) w = { ...w, ...rectForZone(snap, vp), snap, restore: base };
    else if (mode === 'min' && p.prev === 'max') w = { ...w, restore: base };
    out.push(w);
  }
  // z back to 1..n in the stored order.
  const order = [...out].sort((a, b) => a.z - b.z).map((w) => w.id);
  const rank = new Map(order.map((id, i) => [id, i + 1]));
  return out.map((w) => ({ ...w, z: rank.get(w.id) }));
}
