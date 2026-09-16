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
import { boundsOf, GRID, DESIGN_WIDTH } from './canvas.js';

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
  const x0 = Math.max(0, Math.min(Number(at.x) || 0, boardWidth - (comp.w || GRID)));
  const y0 = Math.max(0, Number(at.y) || 0);
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
