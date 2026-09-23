// The OS mode's window manager, as a pure reducer (M1).
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

export const MIN_W = 360;
export const MIN_H = 220;
export const TITLE_H = 34;
/** How much of a window must stay on the desktop horizontally. */
export const MIN_VISIBLE = 120;
/** Mounted windows, at most. Visible windows always stay mounted; minimised ones beyond
 *  this are unmounted, oldest first (see mountedIds). */
export const MAX_MOUNTED = 6;
/** Persisted windows, at most (a corrupted or hostile storage value cannot blow up a render). */
export const MAX_SAVED = 40;

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

/** The rect of a snap zone: the left or right half, or the whole desktop. */
export function rectForZone(zone, vp) {
  const hw = Math.floor(vp.w / 2);
  if (zone === 'left') return { x: 0, y: 0, w: hw, h: vp.h };
  if (zone === 'right') return { x: hw, y: 0, w: vp.w - hw, h: vp.h };
  return { x: 0, y: 0, w: vp.w, h: vp.h };
}

/** Which zone a drag is over: the left/right edge snaps to a half, the top edge maximises. */
export function snapZoneAt(px, py, vp, edge = 10) {
  if (py <= edge) return 'max';
  if (px <= edge) return 'left';
  if (px >= vp.w - edge) return 'right';
  return null;
}

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
  return { wins: [], active: null, seq: 0, vp: { w: Math.max(1, num(vp.w, 1280)), h: Math.max(1, num(vp.h, 720)) }, peek: null };
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

function maximiseIn(s, id) {
  const w = s.wins.find((x) => x.id === id);
  if (!w) return s;
  if (w.mode === 'max') {
    // Restore to the remembered geometry, or a sensible default when there is none.
    const r = clampRect(w.restore || { ...defaultSize(s.vp), ...cascade([], defaultSize(s.vp), s.vp) }, s.vp);
    return focusIn({ ...s, wins: s.wins.map((x) => (x.id === id ? { ...x, ...r, mode: 'normal', snap: null, restore: null } : x)) }, id);
  }
  const restore = w.snap ? (w.restore || rectOf(w)) : rectOf(w);
  return focusIn({ ...s, wins: s.wins.map((x) => (x.id === id ? { ...x, ...rectForZone('max', s.vp), mode: 'max', snap: null, restore } : x)) }, id);
}

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
      if (have) {
        const next = have.leaf === leaf ? s : { ...s, wins: s.wins.map((w) => (w.id === a.id ? { ...w, leaf } : w)) };
        return focusIn(next, a.id);
      }
      const size = { ...defaultSize(s.vp), ...(a.size || {}) };
      const r = clampRect({ ...cascade(s.wins, size, s.vp), ...size }, s.vp);
      const seq = s.seq + 1;
      const z = s.wins.reduce((m, w) => Math.max(m, w.z), 0) + 1;
      const win = { id: a.id, leaf, ...r, mode: 'normal', prev: 'normal', z, restore: null, snap: null, used: seq };
      return { ...s, wins: [...s.wins, win], active: a.id, seq, peek: null };
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
      const w = s.wins.find((x) => x.id === a.id);
      if (!w || !['left', 'right', 'max'].includes(a.zone)) return s;
      if (a.zone === 'max') return w.mode === 'max' ? focusIn(s, a.id) : maximiseIn(s, a.id);
      const restore = w.snap || w.mode === 'max' ? (w.restore || rectOf(w)) : rectOf(w);
      const next = { ...s, wins: s.wins.map((x) => (x.id === a.id ? { ...x, ...rectForZone(a.zone, s.vp), mode: 'normal', snap: a.zone, restore } : x)) };
      return focusIn(next, a.id);
    }
    case 'unsnap': {
      // Back to the geometry the window had before it was snapped or maximised.
      const w = s.wins.find((x) => x.id === a.id);
      if (!w || (!w.snap && w.mode !== 'max')) return s;
      const r = clampRect(w.restore || rectOf(w), s.vp);
      return focusIn({ ...s, wins: s.wins.map((x) => (x.id === a.id ? { ...x, ...r, mode: 'normal', snap: null, restore: null } : x)) }, a.id);
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
    case 'hydrate': {
      const wins = sanitise(a.saved, s.vp);
      const seq = wins.reduce((m, w) => Math.max(m, w.used), 0);
      const active = a.saved?.active && wins.some((w) => w.id === a.saved.active && w.mode !== 'min') ? a.saved.active : topId(wins);
      return { ...s, wins, active, seq, peek: null };
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

/** What is written to storage: ids, leaves and geometry. Nothing else about a window. */
export function serialize(s) {
  return {
    v: 1,
    active: s.active,
    wins: s.wins.slice(0, MAX_SAVED).map((w) => {
      const base = (w.mode === 'max' || w.snap) && w.restore ? w.restore : w;
      return {
        id: w.id, leaf: w.leaf,
        x: Math.round(base.x), y: Math.round(base.y), w: Math.round(base.w), h: Math.round(base.h),
        mode: w.mode, prev: w.prev === 'max' ? 'max' : 'normal', snap: w.snap || null, z: w.z, used: w.used,
      };
    }),
  };
}

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

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
    const snap = p.snap === 'left' || p.snap === 'right' ? p.snap : null;
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
