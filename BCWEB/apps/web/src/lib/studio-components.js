// Saved components for the studio: a named group of blocks an author keeps and drops onto
// other pages.
//
// Pure functions, tested in test/studio-components.test.mjs. The studio owns the pointer work
// and the API calls; nothing here knows about React or the network.
//
// A component stores its blocks with the group's top-left at 0,0 and without ids, so a copy
// can be placed anywhere and never collides with what is already on the page. Every block a
// copy produces carries `component: { id, inst }` — the component it came from and the
// particular copy — which is what lets "update every instance" find the copies later and
// "detach" forget one of them.
import { boundsOf, GRID, DESIGN_WIDTH, BOUND, normalizeDoc, serializeDoc, CANVAS_PRESETS, presetBlocks } from './canvas.js';

/** Hard limits, shared with the API's validation (lib/studio-components.mjs there). */
export const COMPONENT_LIMITS = { count: 60, blocks: 40, name: 60 };

const fallbackUid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Fields a component keeps per block: everything the renderer reads, minus identity. */
function stripIdentity(b) {
  // eslint-disable-next-line no-unused-vars
  const { id, component, ...rest } = b;
  return rest;
}

/**
 * Turn the selection into a component definition.
 * Positions are made relative to the group's bounding box; the paint order is kept as
 * relative z so a caption stays over its hero when the copy lands.
 */
export function componentFromBlocks(name, blocks, uid = fallbackUid) {
  const list = (Array.isArray(blocks) ? blocks : []).filter(Boolean).slice(0, COMPONENT_LIMITS.blocks);
  if (!list.length) return null;
  const bb = boundsOf(list);
  const zs = list.map((b) => Number(b.z) || 0);
  const zMin = Math.min(...zs);
  return {
    id: `cmp${uid().slice(1)}`,
    name: String(name || '').trim().slice(0, COMPONENT_LIMITS.name) || 'Component',
    w: bb.w,
    h: bb.h,
    blocks: list.map((b) => ({ ...stripIdentity(b), x: b.x - bb.x, y: b.y - bb.y, z: (Number(b.z) || 0) - zMin })),
    createdAt: new Date().toISOString(),
  };
}

/**
 * A fresh copy of a component, placed with its top-left at `at`, above everything already on
 * the page. Each block gets a new id and the component tag; the copy's `inst` is one value
 * shared by all of its blocks.
 */
export function instantiateComponent(comp, at = { x: 64, y: 64 }, zBase = 0, uid = fallbackUid, boardWidth = DESIGN_WIDTH) {
  if (!comp || !Array.isArray(comp.blocks) || !comp.blocks.length) return [];
  const inst = `i${uid().slice(1)}`;
  // Placed where asked (studio phase 3): there is no page edge to pull a wide component back
  // inside any more, only the board's guard rail. `boardWidth` is accepted and ignored.
  void boardWidth;
  const x0 = Math.max(-BOUND, Math.min(Number(at.x) || 0, BOUND - (comp.w || GRID)));
  const y0 = Math.max(-BOUND, Math.min(Number(at.y) || 0, BOUND - (comp.h || GRID)));
  return comp.blocks.map((b) => ({
    ...b,
    id: uid(),
    x: x0 + (Number(b.x) || 0),
    y: y0 + (Number(b.y) || 0),
    z: zBase + (Number(b.z) || 0),
    component: { id: comp.id, inst },
  }));
}

/** Forget the component link on the given blocks — they become ordinary blocks. */
export function detachBlocks(blocks, ids) {
  const set = new Set(ids || []);
  return blocks.map((b) => (set.has(b.id) && b.component ? { ...b, component: null } : b));
}

/** Every instance of a component on the page: `inst` → its blocks. */
export function instancesOf(blocks, compId) {
  const out = new Map();
  for (const b of blocks) {
    if (!b.component || b.component.id !== compId) continue;
    if (!out.has(b.component.inst)) out.set(b.component.inst, []);
    out.get(b.component.inst).push(b);
  }
  return out;
}

/** The component ids the selection touches, in one pass. */
export function componentIdsIn(blocks, ids) {
  const set = new Set(ids || []);
  return [...new Set(blocks.filter((b) => set.has(b.id) && b.component).map((b) => b.component.id))];
}

/**
 * Rebuild every copy of a component from its current definition, in place.
 *
 * Each instance keeps its top-left corner and its `inst`, gets the definition's blocks with
 * fresh ids, and loses whatever its old blocks were — an instance is a copy of the
 * definition, and one that kept a block the definition dropped would no longer be one.
 * Blocks that do not belong to this component are untouched, in their original order.
 */
export function updateInstances(blocks, comp, uid = fallbackUid) {
  if (!comp) return blocks;
  const groups = instancesOf(blocks, comp.id);
  if (!groups.size) return blocks;
  const out = blocks.filter((b) => !(b.component && b.component.id === comp.id));
  let zBase = out.reduce((m, b) => Math.max(m, Number(b.z) || 0), -1) + 1;
  for (const [inst, old] of groups) {
    const bb = boundsOf(old);
    for (const b of comp.blocks) {
      out.push({ ...b, id: uid(), x: bb.x + (Number(b.x) || 0), y: bb.y + (Number(b.y) || 0), z: zBase + (Number(b.z) || 0), component: { id: comp.id, inst } });
    }
    zBase += comp.blocks.length;
  }
  return out;
}

/**
 * A small SVG of the blocks as rectangles — the thumbnail a Components list shows. A string,
 * so it can be stored with the component and drawn with no rendering pass. Colours are theme
 * tokens, so it reads on both backgrounds.
 */
export function thumbnailSvg(blocks, size = 96) {
  const list = (Array.isArray(blocks) ? blocks : []).filter(Boolean);
  if (!list.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"></svg>`;
  const bb = boundsOf(list);
  const w = Math.max(1, bb.w), h = Math.max(1, bb.h);
  const s = Math.min(size / w, size / h);
  const ox = (size - w * s) / 2, oy = (size - h * s) / 2;
  const rects = list.slice().sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0)).map((b) => {
    const x = (ox + (b.x - bb.x) * s).toFixed(1), y = (oy + (b.y - bb.y) * s).toFixed(1);
    const rw = Math.max(1, b.w * s).toFixed(1), rh = Math.max(1, b.h * s).toFixed(1);
    const fill = b.kind === 'text' ? 'var(--muted)' : b.kind === 'image' || b.kind === 'video' ? 'var(--primary)' : 'var(--line-strong)';
    return `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="2" fill="${fill}" opacity="0.7"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${rects}</svg>`;
}

/** Whatever the API or storage returned, as a list the panel can show. */
export function normalizeComponents(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const c of list) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id || seen.has(c.id)) continue;
    if (!Array.isArray(c.blocks) || !c.blocks.length) continue;
    seen.add(c.id);
    out.push({
      id: c.id.slice(0, 60),
      name: String(c.name || 'Component').slice(0, COMPONENT_LIMITS.name),
      w: Number(c.w) || boundsOf(c.blocks).w,
      h: Number(c.h) || boundsOf(c.blocks).h,
      blocks: c.blocks.slice(0, COMPONENT_LIMITS.blocks),
      createdAt: typeof c.createdAt === 'string' ? c.createdAt : '',
    });
    if (out.length >= COMPONENT_LIMITS.count) break;
  }
  return out;
}

// ── Preset libraries (PLAN-STUDIO-2026 2.6, phase 6) ─────────────────────────────────────
// A preset is a starting point in the studio's gallery, of one of four sorts:
//   page        a whole page (the Pages panel's "New page" starts from one)
//   section     a group of blocks, dropped as plain blocks
//   background  a page background, applied to the page being edited
//   component   a group of blocks, dropped as a linked copy (the Components logic above)
// from one of three scopes: `coded` (written here, read-only), `site` (the site's library,
// written by manage_studio) and `project` (the library of the page being edited, shared by its
// studio holders, D9). Every entry carries a StudioDoc, STORED shape (serializeDoc), which is
// what the API validates (api/lib/studio-library.mjs) and what a thumbnail renders.

export const PRESET_SORTS = ['page', 'section', 'background', 'component'];
export const LIBRARY_LIMITS = { entries: 60, name: 60 };

/** The library door of a scope: `site` (ref ignored), `project` (key) or `showcase` (row id). */
export function libraryPath(scope, ref) {
  if (scope === 'site') return '/admin/studio/library/site/site';
  return `/admin/studio/library/${scope === 'showcase' ? 'showcase' : 'project'}/${encodeURIComponent(String(ref))}`;
}

const presetUid = () => `pr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** A stored document from anything a preset is made of. */
const storedDoc = (id, raw, extra = {}) => serializeDoc(normalizeDoc({ ...raw, id }), extra);

/** Coded page backgrounds: a few of the Page panel's own ready-mades. */
const CODED_BACKGROUNDS = [
  { id: 'bg-accent', name: 'Accent gradient', nameFr: 'Dégradé accent', background: { type: 'gradient', angle: 135, stops: [{ color: 'var(--primary)', at: 0 }, { color: 'var(--primary-2)', at: 100 }] } },
  { id: 'bg-night', name: 'Night', nameFr: 'Nuit', background: { type: 'gradient', angle: 200, stops: [{ color: '#1e1b4b', at: 0 }, { color: '#4c1d95', at: 100 }] } },
  { id: 'bg-dots', name: 'Dots', nameFr: 'Points', background: { type: 'pattern', id: 'dots', color: '#000000', size: 24, opacity: 0.18 } },
  { id: 'bg-board', name: 'Drawing board', nameFr: 'Planche à dessin', background: { type: 'board', color: 'var(--surface-2)', grid: 24 } },
];

/** The coded presets, as library entries (scope `coded`, never written anywhere). */
export function codedPresets() {
  const pages = CANVAS_PRESETS.map((p) => ({
    id: `coded-${p.id}`, name: p.name, nameFr: p.nameFr, sort: 'page', scope: 'coded', coded: p.id,
    doc: storedDoc(`coded-${p.id}`, { title: '', blocks: presetBlocks(p.id) }),
  }));
  const bgs = CODED_BACKGROUNDS.map((b) => ({
    id: `coded-${b.id}`, name: b.name, nameFr: b.nameFr, sort: 'background', scope: 'coded',
    doc: storedDoc(`coded-${b.id}`, { blocks: [] }, { background: b.background }),
  }));
  return [...pages, ...bgs];
}

/** What a library GET returned, as entries the gallery can show, tagged with their scope. */
export function normalizeLibrary(raw, scope) {
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || seen.has(e.id)) continue;
    if (!PRESET_SORTS.includes(e.sort) || !e.doc || typeof e.doc !== 'object') continue;
    seen.add(e.id);
    out.push({ id: e.id, name: String(e.name || '').slice(0, LIBRARY_LIMITS.name) || 'Preset', sort: e.sort, doc: e.doc, createdAt: typeof e.createdAt === 'string' ? e.createdAt : '', scope });
    if (out.length >= LIBRARY_LIMITS.entries) break;
  }
  return out;
}

/** An entry as the API stores it (the gallery's `scope` and `coded` left out). */
export const storedEntry = (e) => ({ id: e.id, name: e.name, sort: e.sort, doc: e.doc, ...(e.createdAt ? { createdAt: e.createdAt } : {}) });

/**
 * A new preset from what the author has in front of them:
 *   page                  `canvas` (the whole page, its background and stylesheet included)
 *   section / component   `blocks` (moved so their group starts at 0,0; component links dropped)
 *   background            `background`
 * Null when there is nothing to keep or no name.
 */
export function presetEntry({ name, sort, canvas = null, blocks = [], background = null }, uid = presetUid) {
  const label = String(name || '').trim().slice(0, LIBRARY_LIMITS.name);
  if (!label || !PRESET_SORTS.includes(sort)) return null;
  const id = uid();
  let doc;
  if (sort === 'page') doc = storedDoc(id, { ...(canvas || {}), id });
  else if (sort === 'background') doc = storedDoc(id, { blocks: [] }, { background });
  else {
    const list = (Array.isArray(blocks) ? blocks : []).filter(Boolean).slice(0, sort === 'component' ? COMPONENT_LIMITS.blocks : 500);
    if (!list.length) return null;
    const bb = boundsOf(list);
    const moved = list.map((b, i) => {
      // eslint-disable-next-line no-unused-vars
      const { component, ...rest } = b;
      return { ...rest, id: `b${i}`, x: b.x - bb.x, y: b.y - bb.y };
    });
    doc = storedDoc(id, { blocks: moved });
  }
  return { id, name: label, sort, doc, createdAt: new Date().toISOString() };
}

/** A NEW page from a page preset: the preset's document with this page's id and title. */
export function pageFromPreset(entry, pageId, title = '') {
  // A coded preset is built afresh (fresh block ids each time), a library one is copied.
  const src = entry?.coded ? { title: '', blocks: presetBlocks(entry.coded) }
    : (entry?.doc && typeof entry.doc === 'object' ? entry.doc : { blocks: [] });
  return storedDoc(pageId, { ...src, id: pageId }, { title: String(title || '').slice(0, 120) });
}

/** A copy of a page, under a new id and title (what "Duplicate" creates). */
export function duplicatePage(canvas, pageId, title) {
  return storedDoc(pageId, { ...(canvas || {}), id: pageId }, { title: String(title || '').slice(0, 120) });
}

/**
 * The blocks a section or component preset drops on a page, at `at`, above `zBase`, with fresh
 * ids. A component's copy is linked (tagged with the preset's id, like a saved component).
 */
export function blocksFromPreset(entry, at = { x: 64, y: 64 }, zBase = 0, uid = fallbackUid) {
  const blocks = Array.isArray(entry?.doc?.blocks) ? entry.doc.blocks : [];
  if (!blocks.length) return [];
  const bb = boundsOf(blocks);
  if (entry.sort === 'component') return instantiateComponent({ id: entry.id, w: bb.w, h: bb.h, blocks }, at, zBase, uid);
  return blocks.map((b) => ({ ...b, id: uid(), x: (Number(at.x) || 0) + b.x - bb.x, y: (Number(at.y) || 0) + b.y - bb.y, z: zBase + (Number(b.z) || 0) }));
}
