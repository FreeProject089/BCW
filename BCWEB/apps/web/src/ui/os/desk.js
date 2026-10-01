// The desktop of the OS mode (agent-bcw-os, Sept 30 2026): where the icons sit, which ones are
// selected, the folders, and the taskbar groups. Pure functions, like wm.js: no React, no DOM,
// no storage, so test/os-desk.test.mjs covers every rule from plain node.
//
// ICONS ON A GRID
// An icon's place is a CELL ({ c, r }), never pixels: the grid follows the icon size and the
// desktop's size, and a place saved on a wide screen still means something on a narrow one.
// placeIcons() is the one rule: a saved cell is kept when it is on the grid and nobody took it
// first; anything else goes to the first free cell, column by column (the Windows order).
//
// FOLDERS
// A folder holds tab ids. It never holds a tab (so it grants nothing: the shell draws only the
// ids present in the dashboard's tab list today) and never another folder. Deleting a folder
// puts its screens back on the desktop; no screen is ever deleted from here.
//
// GROUPS
// A taskbar group is a named list of tab ids drawn as ONE taskbar button with a popover. A
// screen is in one group at most. A group left with no screen is removed.

export const FOLDER_PREFIX = 'fold.';
export const GROUP_PREFIX = 'grp.';
export const MAX_FOLDERS = 24;
export const MAX_GROUPS = 12;
export const MAX_ITEMS = 60;
export const NAME_MAX = 40;
/** Padding of the icon grid inside the desktop, in px. */
export const GRID_PAD = 12;
/** One cell per icon size: the icon box plus its gap. */
export const CELLS = { sm: { w: 84, h: 94 }, md: { w: 100, h: 112 }, lg: { w: 120, h: 136 } };

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const int = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN);
export const isFolderId = (id) => typeof id === 'string' && id.startsWith(FOLDER_PREFIX);
/** A name as typed: control characters become spaces, runs of spaces one, capped. */
export const cleanName = (s) => [...String(s ?? '')].map((ch) => { const n = ch.charCodeAt(0); return n < 32 || n === 127 ? ' ' : ch; })
  .join('').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

// ── The grid ────────────────────────────────────────────────────────────────────

/** How many columns and rows of cells fit on a desktop of `vp` px (at least 1 × 1). */
export function gridDims(vp, cell) {
  const cols = Math.max(1, Math.floor((Math.max(0, (vp?.w || 0) - GRID_PAD * 2) + 1) / cell.w));
  const rows = Math.max(1, Math.floor((Math.max(0, (vp?.h || 0) - GRID_PAD * 2) + 1) / cell.h));
  return { cols, rows };
}

/** The cell under a point in desktop px, clamped to the grid. */
export function cellAt(x, y, cell, dims) {
  const c = Math.floor((x - GRID_PAD) / cell.w);
  const r = Math.floor((y - GRID_PAD) / cell.h);
  return { c: Math.min(dims.cols - 1, Math.max(0, c)), r: Math.min(dims.rows - 1, Math.max(0, r)) };
}

/** The top-left px of a cell. */
export const cellPx = (p, cell) => ({ x: GRID_PAD + p.c * cell.w, y: GRID_PAD + p.r * cell.h });

const key = (p) => `${p.c},${p.r}`;
const onGrid = (p, dims) => !!p && Number.isInteger(p.c) && Number.isInteger(p.r) && p.c >= 0 && p.r >= 0 && p.c < dims.cols && p.r < dims.rows;

/** The first free cell, column by column; past a full grid, cells below it (never lost). */
function firstFree(taken, dims) {
  for (let c = 0; c < dims.cols; c++) {
    for (let r = 0; r < dims.rows; r++) if (!taken.has(`${c},${r}`)) return { c, r };
  }
  // Every cell is taken: extra icons stack in the last column, below the grid (the desktop
  // clips them, the keyboard and the start menu still reach every screen).
  for (let r = dims.rows; ; r++) if (!taken.has(`${dims.cols - 1},${r}`)) return { c: dims.cols - 1, r };
}

/** The free cell nearest to `want` (ties: the lower column, then the lower row). */
function nearestFree(want, taken, dims) {
  if (onGrid(want, dims) && !taken.has(key(want))) return want;
  let best = null; let score = Infinity;
  for (let c = 0; c < dims.cols; c++) {
    for (let r = 0; r < dims.rows; r++) {
      if (taken.has(`${c},${r}`)) continue;
      const s = Math.abs(c - want.c) + Math.abs(r - want.r);
      if (s < score) { score = s; best = { c, r }; }
    }
  }
  return best || firstFree(taken, dims);
}

/**
 * Where every icon goes: `ids` in display order, `pos` the saved cells. A Map id → { c, r }.
 */
export function placeIcons(ids, pos, dims) {
  const out = new Map();
  const taken = new Set();
  const rest = [];
  for (const id of ids) {
    const p = pos?.[id];
    if (onGrid(p, dims) && !taken.has(key(p))) { out.set(id, { c: p.c, r: p.r }); taken.add(key(p)); } else rest.push(id);
  }
  for (const id of rest) { const p = firstFree(taken, dims); out.set(id, p); taken.add(key(p)); }
  return out;
}

/**
 * Move `ids` by (dc, dr) cells. The moved icons keep their shape where they can; one that lands
 * on an icon that is not moving, or off the grid, takes the nearest free cell. Returns the new
 * saved positions of EVERY placed icon (an object, what the layout stores).
 */
export function moveIcons(placed, ids, dc, dr, dims) {
  const moving = new Set(ids.filter((id) => placed.has(id)));
  const out = {};
  const taken = new Set();
  for (const [id, p] of placed) if (!moving.has(id)) { out[id] = { c: p.c, r: p.r }; taken.add(key(p)); }
  // Moved in the order of their target cell, so a group keeps its order when it is squeezed.
  const order = [...moving].map((id) => ({ id, want: { c: placed.get(id).c + dc, r: placed.get(id).r + dr } }))
    .sort((a, b) => a.want.c - b.want.c || a.want.r - b.want.r);
  for (const { id, want } of order) {
    const p = nearestFree({ c: Math.min(dims.cols - 1, Math.max(0, want.c)), r: Math.min(dims.rows - 1, Math.max(0, want.r)) }, taken, dims);
    out[id] = p; taken.add(key(p));
  }
  return out;
}

/** Drop a dragged set so that `anchor` lands on `at` (a cell). */
export function dropIcons(placed, ids, anchor, at, dims) {
  const a = placed.get(anchor);
  if (!a) return Object.fromEntries([...placed].map(([id, p]) => [id, { ...p }]));
  return moveIcons(placed, ids, at.c - a.c, at.r - a.r, dims);
}

/** Saved cells from storage: ids of the id shape, integer cells, capped. */
export function sanitisePos(v, max = 200) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  let n = 0;
  for (const [id, p] of Object.entries(v)) {
    if (n >= max) break;
    if (!isId(id) || !p || typeof p !== 'object') continue;
    const c = int(p.c); const r = int(p.r);
    if (!(c >= 0 && c < 500 && r >= 0 && r < 500)) continue;
    out[id] = { c, r }; n++;
  }
  return out;
}

// ── Selection ───────────────────────────────────────────────────────────────────

/**
 * A click on an icon. Plain: that icon alone. Ctrl/Cmd: toggled in or out. Shift: the range
 * from the anchor to it, in display order (added to the selection with Ctrl+Shift).
 * Returns { sel: [ids], anchor }.
 */
export function selectClick(sel, id, order, { ctrl = false, shift = false, anchor = null } = {}) {
  const cur = Array.isArray(sel) ? sel : [];
  if (shift && anchor && order.includes(anchor) && order.includes(id)) {
    const i = order.indexOf(anchor); const j = order.indexOf(id);
    const range = order.slice(Math.min(i, j), Math.max(i, j) + 1);
    const next = ctrl ? [...new Set([...cur, ...range])] : range;
    return { sel: next, anchor };
  }
  if (ctrl) return { sel: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], anchor: id };
  return { sel: [id], anchor: id };
}

/** The rectangle a rubber band covers, whichever way it was dragged. */
export const bandRect = (x0, y0, x1, y1) => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });

/** The ids whose box the band touches. `boxes`: [{ id, x, y, w, h }]. */
export function idsInBand(boxes, band) {
  return boxes.filter((b) => b.x < band.x + band.w && band.x < b.x + b.w && b.y < band.y + band.h && band.y < b.y + b.h).map((b) => b.id);
}

// ── Folders ─────────────────────────────────────────────────────────────────────

/** A name nobody else has: "New folder", then "New folder 2", "New folder 3"… */
export function uniqueName(base, taken) {
  const b = cleanName(base) || 'Folder';
  const names = new Set((taken || []).map((n) => String(n).toLowerCase()));
  if (!names.has(b.toLowerCase())) return b;
  for (let i = 2; i < 1000; i++) {
    const n = `${b.slice(0, NAME_MAX - String(i).length - 1)} ${i}`;
    if (!names.has(n.toLowerCase())) return n;
  }
  return b;
}

export const emptyIcons = () => ({ pos: {}, folders: [] });
export const folderOf = (icons, tabId) => (icons?.folders || []).find((f) => f.items.includes(tabId)) || null;
/** Every tab id that sits in a folder (so the desktop does not draw it). */
export const inFolders = (icons) => new Set((icons?.folders || []).flatMap((f) => f.items));

const onlyTabs = (ids) => [...new Set((Array.isArray(ids) ? ids : []).filter((id) => isId(id) && !isFolderId(id) && !id.startsWith(GROUP_PREFIX)))];

/**
 * The folder operations. Each returns the SAME object when nothing changes (so the reducer can
 * hand React the same state back).
 *   new     { id, name, items?, at? }   a folder, optionally holding `items`, at cell `at`
 *   add     { id, items }               screens into a folder (out of any other one)
 *   remove  { id, items, pos? }         screens out of a folder, back on the desktop (at `pos`)
 *   rename  { id, name }
 *   delete  { id }                      the folder goes, its screens come back to the desktop
 */
export function folderOp(icons, a) {
  const cur = icons || emptyIcons();
  const folders = cur.folders || [];
  const f = folders.find((x) => x.id === a?.id);
  switch (a?.op) {
    case 'new': {
      if (!isFolderId(a.id) || !isId(a.id) || f || folders.length >= MAX_FOLDERS) return cur;
      const name = uniqueName(a.name || 'New folder', folders.map((x) => x.name));
      const items = onlyTabs(a.items).slice(0, MAX_ITEMS);
      const pruned = folders.map((x) => (items.some((i) => x.items.includes(i)) ? { ...x, items: x.items.filter((i) => !items.includes(i)) } : x));
      const pos = { ...cur.pos };
      for (const i of items) delete pos[i];
      if (a.at && Number.isInteger(a.at.c) && Number.isInteger(a.at.r)) pos[a.id] = { c: a.at.c, r: a.at.r };
      return { ...cur, pos, folders: [...pruned, { id: a.id, name, items }] };
    }
    case 'add': {
      if (!f) return cur;
      const items = onlyTabs(a.items).filter((i) => !f.items.includes(i));
      if (!items.length) return cur;
      const room = MAX_ITEMS - f.items.length;
      const take = items.slice(0, Math.max(0, room));
      if (!take.length) return cur;
      const pos = { ...cur.pos };
      for (const i of take) delete pos[i];
      return {
        ...cur, pos,
        folders: folders.map((x) => (x.id === f.id ? { ...x, items: [...x.items, ...take] } : (take.some((i) => x.items.includes(i)) ? { ...x, items: x.items.filter((i) => !take.includes(i)) } : x))),
      };
    }
    case 'remove': {
      if (!f) return cur;
      const items = onlyTabs(a.items).filter((i) => f.items.includes(i));
      if (!items.length) return cur;
      const pos = { ...cur.pos, ...sanitisePos(a.pos) };
      return { ...cur, pos, folders: folders.map((x) => (x.id === f.id ? { ...x, items: x.items.filter((i) => !items.includes(i)) } : x)) };
    }
    case 'rename': {
      if (!f) return cur;
      const name = cleanName(a.name);
      if (!name || name === f.name) return cur;
      return { ...cur, folders: folders.map((x) => (x.id === f.id ? { ...x, name } : x)) };
    }
    case 'delete': {
      if (!f) return cur;
      const pos = { ...cur.pos };
      delete pos[f.id];
      return { ...cur, pos, folders: folders.filter((x) => x.id !== f.id) };
    }
    default:
      return cur;
  }
}

/** Icons from storage: positions and folders, every id checked, a screen in one folder at most. */
export function sanitiseIcons(v) {
  const out = emptyIcons();
  if (!v || typeof v !== 'object') return out;
  out.pos = sanitisePos(v.pos);
  const seen = new Set();
  const used = new Set();
  for (const f of (Array.isArray(v.folders) ? v.folders : []).slice(0, MAX_FOLDERS)) {
    if (!f || !isFolderId(f.id) || !isId(f.id) || seen.has(f.id)) continue;
    seen.add(f.id);
    const items = onlyTabs(f.items).filter((i) => !used.has(i)).slice(0, MAX_ITEMS);
    items.forEach((i) => used.add(i));
    out.folders.push({ id: f.id, name: cleanName(f.name) || 'Folder', items });
  }
  return out;
}

// ── Taskbar groups ──────────────────────────────────────────────────────────────

export const groupOf = (groups, tabId) => (groups || []).find((g) => g.items.includes(tabId)) || null;

/**
 * The group operations (same contract as folderOp).
 *   new     { id, name, items }    a group of these screens (taken out of any other group)
 *   add     { id, items }
 *   remove  { id, items }          a group left empty is removed
 *   rename  { id, name }
 *   delete  { id }                 ungroup: the screens are back as single taskbar buttons
 *   move    { id, dir }            one place left (-1) or right (1) on the taskbar
 */
export function groupOp(groups, a) {
  const cur = Array.isArray(groups) ? groups : [];
  const g = cur.find((x) => x.id === a?.id);
  const strip = (list, items) => list.map((x) => (items.some((i) => x.items.includes(i)) ? { ...x, items: x.items.filter((i) => !items.includes(i)) } : x)).filter((x) => x.items.length);
  switch (a?.op) {
    case 'new': {
      if (!isId(a.id) || !a.id.startsWith(GROUP_PREFIX) || g || cur.length >= MAX_GROUPS) return cur;
      const items = onlyTabs(a.items).slice(0, MAX_ITEMS);
      if (!items.length) return cur;
      const name = uniqueName(a.name || 'Group', cur.map((x) => x.name));
      return [...strip(cur, items), { id: a.id, name, items }];
    }
    case 'add': {
      if (!g) return cur;
      const items = onlyTabs(a.items).filter((i) => !g.items.includes(i)).slice(0, Math.max(0, MAX_ITEMS - g.items.length));
      if (!items.length) return cur;
      // `items` are not in g, so strip() leaves g alone; another group they empty goes.
      return strip(cur, items).map((x) => (x.id === g.id ? { ...x, items: [...x.items, ...items] } : x));
    }
    case 'remove': {
      if (!g) return cur;
      const items = onlyTabs(a.items).filter((i) => g.items.includes(i));
      if (!items.length) return cur;
      return cur.map((x) => (x.id === g.id ? { ...x, items: x.items.filter((i) => !items.includes(i)) } : x)).filter((x) => x.items.length);
    }
    case 'rename': {
      if (!g) return cur;
      const name = cleanName(a.name);
      if (!name || name === g.name) return cur;
      return cur.map((x) => (x.id === g.id ? { ...x, name } : x));
    }
    case 'delete':
      return g ? cur.filter((x) => x.id !== g.id) : cur;
    case 'move': {
      const i = cur.indexOf(g);
      const j = i + (a.dir === -1 ? -1 : 1);
      if (i === -1 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }
    default:
      return cur;
  }
}

export function sanitiseGroups(v) {
  const out = [];
  const used = new Set();
  for (const g of (Array.isArray(v) ? v : []).slice(0, MAX_GROUPS)) {
    if (!g || !isId(g.id) || !g.id.startsWith(GROUP_PREFIX) || out.some((x) => x.id === g.id)) continue;
    const items = onlyTabs(g.items).filter((i) => !used.has(i)).slice(0, MAX_ITEMS);
    if (!items.length) continue;
    items.forEach((i) => used.add(i));
    out.push({ id: g.id, name: cleanName(g.name) || 'Group', items });
  }
  return out;
}

/** A fresh id with a prefix, unique against `taken` (ids from Date.now, base 36). */
export function newId(prefix, taken = [], now = Date.now()) {
  const set = new Set(taken);
  let n = now;
  let id = `${prefix}${n.toString(36)}`;
  while (set.has(id)) { n += 1; id = `${prefix}${n.toString(36)}`; }
  return id;
}
