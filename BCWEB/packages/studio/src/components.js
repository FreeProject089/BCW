// Components: a definition drawn once, instances that copy it (PLAN-STUDIO-2026 2.6, phase 7b).
//
// THE MODEL. A page keeps, in `doc.components`, the definitions its instances use (one flat
// map: `{ [id]: { name, scope, ref?, doc, exposed } }`, normalised by canvas.js). An instance is
// ONE block, `kind: 'instance'`, with `component: { id, overrides? }`: which definition, and the
// fields THIS copy changed. It never holds the definition's blocks, so:
//   · changing the page's copy of a definition changes every instance at once, except the
//     fields an instance overrode (they are the instance's own);
//   · "update the copies" is replacing that copy with the library's newer version: the
//     overrides stay, keyed by the exposed field's `key` (updateCopies below);
//   · an override can only name a field the definition EXPOSES (`exposed`, a closed list of
//     fields, canvas.js EXPOSABLE_FIELDS), and its value is checked by the rule of that field
//     (validate.js), so an instance cannot carry anything the definition does not offer.
//
// THE EXPANSION (render only, never stored): an instance becomes the definition's blocks, under
// ONE block that takes the instance's place: the definition's own container when the definition
// is a single group, tab card or dialog (a dialog component opens by the instance's id), a group
// drawn around them otherwise. Ids are derived from the instance's (a hash, so they are names),
// the steps inside that name a block of the definition are pointed at its copy. Nested
// instances expand in turn, MAX_INSTANCE_DEPTH levels at most; the whole page expands to
// MAX_EXPANDED_BLOCKS blocks at most. A loop (a component that contains itself, directly or
// through another) is refused at save (validate.js, `component_cycle`) and stops at the depth
// bound here, whatever is stored.
//
// Pure, no DOM.
import {
  PHONE_WIDTH, MAX_INSTANCE_DEPTH, MAX_DOC_COMPONENTS, MAX_COMPONENT_BLOCKS, DOC_VERSION,
  componentSize, phoneBoardBlocks, normalizeOneBlock, normalizeExposed, exposableFor, fieldValue, withFieldValue,
  boundsOf, usedComponentIds, serializeDoc, normalizeDoc,
} from './canvas.js';
import { annotateTree, parentOf, isContainer, descendantIds, treeProblems, MAX_DEPTH } from './tree.js';

/** The whole page, expanded, holds this many blocks at most (the rest is not drawn). */
export const MAX_EXPANDED_BLOCKS = 1000;

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** FNV-1a, base 36: a short name derived from a string. */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/** The definition's blocks with an instance's overrides applied (only on exposed fields). */
export function applyOverrides(blocks, exposed, overrides) {
  const list = Array.isArray(blocks) ? blocks : [];
  if (!isObj(overrides) || !Array.isArray(exposed) || !exposed.length) return list;
  const byBlock = new Map();
  for (const e of exposed) {
    if (!isObj(e) || !(e.key in overrides)) continue;
    if (!byBlock.has(e.block)) byBlock.set(e.block, []);
    byBlock.get(e.block).push(e);
  }
  if (!byBlock.size) return list;
  return list.map((b) => {
    const es = byBlock.get(b.id);
    if (!es) return b;
    let nb = b;
    for (const e of es) if (exposableFor(b.kind).includes(e.field)) nb = withFieldValue(nb, e.field, overrides[e.key]);
    // Through the normaliser again: an override is stored input, read like any other field.
    const clean = normalizeOneBlock(nb);
    return clean ? { ...clean, id: b.id, ...(b.parent ? { parent: b.parent } : {}), ...(b.slot ? { slot: b.slot } : {}) } : b;
  });
}

/** Point the steps that name a block of the definition at that block's copy. */
function remapSteps(steps, idMap) {
  if (!Array.isArray(steps)) return steps;
  return steps.map((s) => (isObj(s) && typeof s.target === 'string' && idMap.has(s.target) ? { ...s, target: idMap.get(s.target) } : s));
}

/** The instance fields that go to the block standing in its place. */
const PLACE_KEYS = ['x', 'y', 'z', 'parent', 'slot', 'name', 'locked'];

function expandOne(inst, map, ctx, depth, from) {
  const cid = inst?.component?.id;
  const snap = cid && isObj(map) ? map[cid] : null;
  const own = { ...inst };
  delete own.component;
  if (!snap || depth > MAX_INSTANCE_DEPTH) {
    // Unknown, or past the depth bound: an empty box where the instance is, never a throw.
    return { root: { ...own, kind: 'group', props: { ...(inst.props || {}) }, instanceError: snap ? 'too_deep' : 'unknown_component', instOf: from }, blocks: [] };
  }
  const def = snap.doc || { blocks: [] };
  const blocks = applyOverrides((def.blocks || []).filter((b) => b && !b.treeError), snap.exposed, inst.component.overrides);
  const tops = blocks.filter((b) => !parentOf(b));
  const single = tops.length === 1 && isContainer(tops[0].kind) ? tops[0] : null;
  const size = componentSize(def, map, depth);
  const idMap = new Map();
  const prefix = String(inst.id).slice(0, 40);
  const mint = (defId) => {
    let id = `${prefix}_${hash(`${inst.id}/${defId}`)}`;
    let n = 0;
    while (ctx.taken.has(id)) id = `${prefix}_${hash(`${inst.id}/${defId}/${n++}`)}`;
    ctx.taken.add(id);
    return id;
  };
  if (single) idMap.set(single.id, inst.id);
  for (const b of blocks) if (!idMap.has(b.id)) idMap.set(b.id, mint(b.id));
  const phoneMode = ctx.mode === 'phone';
  // On the phone board: the definition's own phone places, when it has any.
  const placedPhone = phoneMode && !single && tops.some((b) => b.phone?.x != null && b.phone?.y != null)
    ? new Map(phoneBoardBlocks(tops, 40, null).map((b) => [b.id, b])) : null;
  const W = placedPhone ? size.pw : size.w;
  const H = placedPhone ? size.ph : size.h;
  // Its place on a phone board: what the page's author set, else the component's phone box.
  const phoneW = inst.phone?.w ?? Math.min(PHONE_WIDTH - 32, W);
  const phone = { ...(inst.phone || {}), w: phoneW, h: inst.phone?.h ?? Math.max(1, Math.round(H * (phoneW / Math.max(1, W)))) };
  const place = {};
  for (const k of PLACE_KEYS) if (inst[k] !== undefined && inst[k] !== null && inst[k] !== '') place[k] = inst[k];
  let root;
  if (single) {
    root = {
      ...single, ...place, id: inst.id, w: size.w, h: size.h, phone,
      hidden: !!(inst.hidden || single.hidden),
      opacity: num(inst.opacity, 1) < 1 ? inst.opacity : single.opacity,
      anim: inst.anim || single.anim,
      rotate: inst.rotate || single.rotate, shadow: inst.shadow || single.shadow, hover: inst.hover || single.hover,
      action: Array.isArray(inst.action) && inst.action.length ? inst.action : remapSteps(single.action, idMap),
      themes: inst.themes && Object.keys(inst.themes).length ? inst.themes : single.themes,
      instOf: from,
    };
    if (!inst.parent) delete root.parent;
    if (!inst.slot) delete root.slot;
  } else {
    root = { ...own, kind: 'group', w: W, h: H, phone, props: { ...(inst.props || {}) }, instOf: from };
  }
  delete root.component;
  delete root.treeError;
  const out = [];
  for (const b of blocks) {
    if (single && b.id === single.id) continue;
    if (ctx.count >= ctx.max) { ctx.overflow = true; break; }
    ctx.count += 1;
    let nb = { ...b, id: idMap.get(b.id), action: remapSteps(b.action, idMap), instOf: from };
    const p = parentOf(b);
    if (p) nb.parent = idMap.get(p) || p;
    else {
      nb.parent = inst.id;
      delete nb.slot;
      const q = placedPhone ? placedPhone.get(b.id) : null;
      if (q) nb = { ...nb, x: q.x, y: q.y, w: q.w, h: q.h };
    }
    delete nb.treeError;
    if (b.kind === 'instance') {
      const sub = expandOne({ ...nb, component: b.component }, map, ctx, depth + 1, from);
      out.push(sub.root, ...sub.blocks);
    } else {
      delete nb.component;
      out.push(nb);
    }
  }
  return { root, blocks: out };
}

/**
 * One instance, expanded: `{ root, blocks }` (the block standing in its place, then the rest).
 * `opts.mode` 'desktop' | 'phone' | 'stack'; `opts.taken` ids already used on the page.
 */
export function expandInstance(inst, map, opts = {}) {
  const ctx = { count: 0, max: MAX_EXPANDED_BLOCKS, taken: new Set(opts.taken || []), mode: opts.mode || 'desktop' };
  ctx.taken.add(inst?.id);
  return expandOne(inst, map, ctx, 1, inst?.id);
}

/**
 * A normalised document with every instance expanded, for READERS (the public page, a preview,
 * a thumbnail). The tree is decided again over the result, so an expansion that would be too
 * deep or put a dialog inside a box is not drawn (tree.js), exactly like a stored one.
 */
export function expandInstances(doc, opts = {}) {
  const blocks = Array.isArray(doc?.blocks) ? doc.blocks : [];
  if (!blocks.some((b) => b && b.kind === 'instance')) return doc;
  const map = isObj(doc.components) ? doc.components : {};
  const ctx = { count: blocks.length, max: MAX_EXPANDED_BLOCKS, taken: new Set(blocks.map((b) => b.id)), mode: opts.mode || 'desktop' };
  const out = [];
  for (const b of blocks) {
    if (b.kind !== 'instance') { out.push(b); continue; }
    const r = expandOne(b, map, ctx, 1, b.id);
    out.push(r.root, ...r.blocks);
  }
  return { ...doc, blocks: annotateTree(out) };
}

// ── What the validator asks (validate.js) ─────────────────────────────────────────────────

const refsOf = (blocks, prefix) => (Array.isArray(blocks) ? blocks : []).map((b, i) => (
  isObj(b) && b.kind === 'instance' && isObj(b.component) && typeof b.component.id === 'string'
    ? { cid: b.component.id, path: `${prefix}blocks[${i}].component.id` } : null)).filter(Boolean);

/**
 * The loops and the depth of a map of definitions, as `{ path, reason, value }`:
 * `component_cycle` (value: the chain, `a>b>a`) where an instance closes a loop, and
 * `instance_too_deep` where an instance sits more than MAX_INSTANCE_DEPTH levels down.
 * `blocks` are the document's own (the page, or the definition being saved as `selfId`), and
 * every definition of the map is walked too, used or not. Bounded: the walk stops at the depth
 * bound, and the map and the definitions are bounded in size.
 */
export function componentGraphProblems(blocks, map, selfId = '') {
  const out = [];
  const seen = new Set();
  const push = (path, reason, value) => { const k = `${path}|${reason}`; if (!seen.has(k)) { seen.add(k); out.push({ path, reason, value }); } };
  const m = isObj(map) ? map : {};
  const walk = (refs, chain, depth) => {
    for (const r of refs) {
      if (chain.includes(r.cid)) { push(r.path, 'component_cycle', [...chain, r.cid].join('>')); continue; }
      if (depth > MAX_INSTANCE_DEPTH) { push(r.path, 'instance_too_deep', depth); continue; }
      const s = m[r.cid];
      if (!isObj(s) || !isObj(s.doc)) continue;   // unknown: reported where it is named
      walk(refsOf(s.doc.blocks, `components.${r.cid}.doc.`), [...chain, r.cid], depth + 1);
    }
  };
  walk(refsOf(blocks, ''), selfId ? [selfId] : [], 1);
  for (const cid of Object.keys(m).slice(0, MAX_DOC_COMPONENTS + 1)) {
    const s = m[cid];
    if (isObj(s) && isObj(s.doc)) walk(refsOf(s.doc.blocks, `components.${cid}.doc.`), [cid], 2);
  }
  return out;
}

/** How many blocks the blocks come to once every instance is expanded (bounded walk). */
export function expandedCount(blocks, map) {
  const m = isObj(map) ? map : {};
  const count = (list, depth, chain) => {
    let n = 0;
    for (const b of Array.isArray(list) ? list : []) {
      n += 1;
      if (n > MAX_EXPANDED_BLOCKS * 4) return n;
      if (!isObj(b) || b.kind !== 'instance' || !isObj(b.component)) continue;
      const cid = b.component.id;
      const s = typeof cid === 'string' ? m[cid] : null;
      if (!isObj(s) || !isObj(s.doc) || depth > MAX_INSTANCE_DEPTH || chain.includes(cid)) continue;
      n += count(s.doc.blocks, depth + 1, [...chain, cid]);
    }
    return n;
  };
  return count(blocks, 1, []);
}

/**
 * The tree problems the EXPANSION of a (normalised) page would have, attributed to the page's
 * instance each came from: `[{ instance, reason }]`. A dialog component placed inside a box, or a
 * component that takes the page past three container levels, is refused where it is placed.
 */
export function expandedTreeProblems(normDoc) {
  const exp = expandInstances(normDoc);
  if (exp === normDoc) return [];
  const out = [];
  const seen = new Set();
  const plain = exp.blocks.map((b) => { const { treeError: _e, ...rest } = b; return rest; });
  for (const p of treeProblems(plain)) {
    const b = plain[p.index];
    if (!b || !b.instOf) continue;
    // The instance's own link (its container, its tab) is the stored block's, checked there.
    if (b.id === b.instOf && p.reason !== 'modal_nested' && p.reason !== 'too_deep') continue;
    const k = `${b.instOf}|${p.reason}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ instance: b.instOf, reason: p.reason });
  }
  return out;
}

// ── What the studio does with them (pure; editor/canvas-studio.jsx calls these) ────────────

/** An instance block's overrides (a plain object). */
export const overridesOf = (b) => (isObj(b?.component?.overrides) ? b.component.overrides : {});

/**
 * The fields an instance changed, as the exposed entries whose override DIFFERS from the
 * definition's value: what makes a copy diverge from its component.
 */
export function divergence(inst, snap) {
  const ov = overridesOf(inst);
  const exposed = Array.isArray(snap?.exposed) ? snap.exposed : [];
  const blocks = Array.isArray(snap?.doc?.blocks) ? snap.doc.blocks : [];
  return exposed.filter((e) => {
    if (!(e.key in ov)) return false;
    const b = blocks.find((x) => x.id === e.block);
    return JSON.stringify(ov[e.key] ?? null) !== JSON.stringify(fieldValue(b, e.field) ?? null);
  });
}

/** The instances of component `cid` among the blocks. */
export const instancesOfComponent = (blocks, cid) => (Array.isArray(blocks) ? blocks : []).filter((b) => b && b.kind === 'instance' && b.component?.id === cid);

const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]`
  : isObj(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));

/** A definition as the page STORES it, from a library entry or a page's map entry. */
export function snapshotOf(src, scope = 'site', ref = '') {
  const d = isObj(src?.doc) ? src.doc : {};
  // Normalised first: two copies of one definition compare equal whatever defaults they spell.
  const sd = serializeDoc(normalizeDoc({ ...d, components: undefined, id: 'c' }, true));
  return {
    name: String(src?.name || '').slice(0, 60),
    scope,
    ...(ref ? { ref: String(ref) } : {}),
    doc: { v: DOC_VERSION, frames: sd.frames, blocks: sd.blocks },
    exposed: normalizeExposed(src?.exposed, sd.blocks),
  };
}

/** Does the page's copy of a definition differ from the library's (what "update" would change)? */
export function snapshotDiffers(pageSnap, libSnap) {
  if (!pageSnap || !libSnap) return false;
  // An instance's size inside a definition is derived (its own component's): not a difference.
  const shape = (s) => {
    const o = snapshotOf(s, pageSnap.scope, pageSnap.ref);
    return stable({ d: { ...o.doc, blocks: o.doc.blocks.map((b) => (b.kind === 'instance' ? { ...b, w: 0, h: 0 } : b)) }, e: o.exposed });
  };
  return shape(pageSnap) !== shape(libSnap);
}

/**
 * The page's map with a definition put in (and the definitions IT uses, from its own map, when
 * the page has none of theirs yet). Returns the new map.
 */
export function withSnapshot(map, cid, snap, deps = null) {
  const out = { ...(isObj(map) ? map : {}) };
  out[cid] = snap;
  if (isObj(deps)) for (const k of Object.keys(deps)) if (!out[k] && k !== cid) out[k] = deps[k];
  return out;
}

/**
 * "Update the copies": the page's copy of `cid` replaced by `snap`. Every instance keeps its
 * place and its overrides; an override whose field the new version no longer exposes is
 * dropped (it would be refused at save), and counted. Returns `{ blocks, components, dropped }`.
 */
export function updateCopies(blocks, map, cid, snap, deps = null) {
  const keys = new Set((snap?.exposed || []).map((e) => e.key));
  let dropped = 0;
  const next = (Array.isArray(blocks) ? blocks : []).map((b) => {
    if (!b || b.kind !== 'instance' || b.component?.id !== cid) return b;
    const ov = overridesOf(b);
    const kept = {};
    for (const k of Object.keys(ov)) { if (keys.has(k)) kept[k] = ov[k]; else dropped += 1; }
    return { ...b, component: Object.keys(kept).length ? { id: cid, overrides: kept } : { id: cid } };
  });
  return { blocks: next, components: withSnapshot(map, cid, snap, deps), dropped };
}

/** An instance's override set (`value` undefined = back to the definition's). */
export function setOverride(blocks, instId, key, value) {
  return (Array.isArray(blocks) ? blocks : []).map((b) => {
    if (!b || b.id !== instId || b.kind !== 'instance' || !b.component) return b;
    const ov = { ...overridesOf(b) };
    if (value === undefined) delete ov[key]; else ov[key] = value;
    return { ...b, component: Object.keys(ov).length ? { id: b.component.id, overrides: ov } : { id: b.component.id } };
  });
}

/**
 * Detach an instance: its expansion becomes ordinary blocks of the page (fresh ids from `uid`),
 * in its place, with its overrides applied. The link is gone for good.
 */
export function detachInstance(blocks, map, instId, uid) {
  const list = Array.isArray(blocks) ? blocks : [];
  const inst = list.find((b) => b && b.id === instId && b.kind === 'instance');
  if (!inst) return list;
  const r = expandInstance(inst, map, { taken: list.map((b) => b.id) });
  const fresh = new Map([[inst.id, uid()]]);
  for (const b of r.blocks) fresh.set(b.id, uid());
  const clean = (b) => {
    const { instOf: _o, instanceError: _e, treeError: _t, ...rest } = b;
    const o = { ...rest, id: fresh.get(b.id) || b.id, action: remapSteps(b.action, fresh) };
    if (o.parent && fresh.has(o.parent)) o.parent = fresh.get(o.parent);
    return o;
  };
  const out = [];
  for (const b of list) {
    if (b.id !== instId) { out.push(b); continue; }
    // The block in the instance's place keeps the instance's own phone place, not the one the
    // expansion computed for drawing.
    out.push({ ...clean(r.root), phone: inst.phone || null }, ...r.blocks.map(clean));
  }
  return out;
}

/**
 * The fields a new component offers its copies at first: every text, picture and label of its
 * blocks that has a value (at most 12). The author trims or extends the list in component mode.
 */
export function defaultExposed(blocks) {
  const exposed = [];
  const used = new Set();
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (!b || typeof b !== 'object') continue;
    for (const f of exposableFor(b.kind)) {
      if (!['props.md', 'props.label', 'props.text', 'props.src', 'props.alt', 'props.title'].includes(f)) continue;
      if (fieldValue(b, f) == null || fieldValue(b, f) === '') continue;
      if (exposed.length >= 12) return exposed;
      let key = `${String(b.name || b.kind).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || b.kind}-${f.slice(f.indexOf('.') + 1)}`.slice(0, 40);
      let n = 2;
      while (used.has(key)) key = `${key.slice(0, 36)}-${n++}`;
      used.add(key);
      exposed.push({ key, block: b.id, field: f });
    }
  }
  return exposed;
}

/**
 * A definition from a selection of blocks (stored shape): the selected blocks and everything
 * inside them, the selection's top-left at (0,0), links inside kept. Refused (null) when the
 * selection is not one set of siblings, is empty, or is larger than a component may be.
 * `pageMap` gives the definitions the selection's own instances use (copied along).
 * The fields a copy can change start as every text, picture and link of the blocks (the author
 * trims the list in component mode).
 */
export function definitionFromBlocks(allBlocks, ids, pageMap = {}) {
  const list = Array.isArray(allBlocks) ? allBlocks : [];
  const set = new Set(ids || []);
  const chosen = list.filter((b) => set.has(b.id));
  if (!chosen.length) return null;
  const p = parentOf(chosen[0]);
  if (chosen.some((b) => parentOf(b) !== p)) return null;
  const under = new Set(chosen.flatMap((b) => descendantIds(list, b.id)));
  const picked = list.filter((b) => set.has(b.id) || under.has(b.id));
  if (picked.length > MAX_COMPONENT_BLOCKS) return null;
  const bb = boundsOf(chosen);
  const zs = chosen.map((b) => num(b.z));
  const z0 = Math.min(...zs);
  const blocks = picked.map((b) => {
    const { treeError: _t, instOf: _o, ...rest } = b;
    const o = { ...rest };
    if (set.has(b.id)) { o.x = num(b.x) - bb.x; o.y = num(b.y) - bb.y; o.z = num(b.z) - z0; delete o.parent; delete o.slot; }
    // A legacy copy tag (the personal components' links) means nothing inside a definition.
    if (o.kind !== 'instance') delete o.component;
    return o;
  });
  const exposed = defaultExposed(blocks);
  const deps = {};
  const needed = usedComponentIds(blocks, pageMap);
  for (const cid of needed) deps[cid] = pageMap[cid];
  const doc = { v: DOC_VERSION, frames: { desktop: { w: 1200, fit: 'content' }, phone: { w: PHONE_WIDTH, fit: 'content', mode: 'stack' } }, blocks, ...(needed.size ? { components: deps } : {}) };
  return { doc, exposed, at: { x: bb.x, y: bb.y }, parent: p, slot: num(chosen[0].slot, 0), z: Math.max(...zs), depth: 0 };
}

/**
 * Put an instance where a selection was: the selection and what is inside it removed, one
 * instance block of `cid` added in its place (same container, same tab), the definition in the
 * page's map. Returns `{ blocks, components, id }`.
 */
export function replaceWithInstance(allBlocks, ids, map, cid, snap, def, uid) {
  const list = Array.isArray(allBlocks) ? allBlocks : [];
  const set = new Set(ids || []);
  const gone = new Set(ids || []);
  for (const id of set) for (const d of descendantIds(list, id)) gone.add(d);
  const id = uid();
  const inst = { id, kind: 'instance', x: def.at.x, y: def.at.y, w: 8, h: 8, z: def.z, component: { id: cid },
    ...(def.parent ? { parent: def.parent } : {}), ...(def.parent && def.slot > 0 ? { slot: def.slot } : {}) };
  const out = [];
  let placed = false;
  for (const b of list) {
    if (gone.has(b.id)) { if (!placed && set.has(b.id)) { out.push(inst); placed = true; } continue; }
    out.push(b);
  }
  if (!placed) out.push(inst);
  return { blocks: out, components: withSnapshot(map, cid, snap, def.doc.components || null), id };
}

/** A new instance block of `cid` at `at` (stored shape). */
export function newInstance(cid, at, z, uid) {
  return { id: uid(), kind: 'instance', x: Math.round(num(at?.x, 64)), y: Math.round(num(at?.y, 64)), w: 8, h: 8, z: num(z), component: { id: cid } };
}

/**
 * Is the tree INSIDE a definition sound (tree.js), as its instances will draw it? For the
 * studio's "save as component", before anything is written: `[]` or the problems.
 */
export function definitionTreeProblems(doc) {
  const blocks = Array.isArray(doc?.blocks) ? doc.blocks : [];
  const out = treeProblems(blocks);
  // Its deepest chain plus the block standing in the instance's place must fit MAX_DEPTH.
  const norm = normalizeDoc({ v: DOC_VERSION, id: 'def', frames: doc?.frames, blocks });
  let deepest = 0;
  const byId = new Map(norm.blocks.map((b) => [b.id, b]));
  for (const b of norm.blocks) {
    let d = 0; let cur = b;
    while (cur && parentOf(cur) && d <= MAX_DEPTH + 1) { d += 1; cur = byId.get(parentOf(cur)); }
    deepest = Math.max(deepest, d);
  }
  return deepest >= MAX_DEPTH + 1 ? [...out, { index: -1, field: '', reason: 'too_deep' }] : out;
}

