// Containers: blocks that hold other blocks (PLAN-STUDIO-2026, 2.2 and phase 7a).
//
// A block may name a `parent`: the id of a CONTAINER block of the same page. Its x, y are then
// relative to the container's inner area, so a container moves (and hides, and is revealed) as
// one unit with everything in it. Three kinds of container:
//
//   group  a plain box of blocks: moved, hidden, revealed together (the `reveal` step)
//   tabs   a tab card: a strip of labels (`props.tabs`) above one panel; a child says which
//          panel it belongs to with `slot` (0 = the first tab). Children are relative to the
//          PANEL, which starts TAB_STRIP_H below the card's top edge
//   modal  a dialog: never part of the page's flow, shown over the page by a `modal` step. It
//          must be a top-level block (a dialog inside a box has nowhere sensible to open)
//
// The TREE RULES, one definition for the validator (strict, at save) and the normaliser
// (tolerant, at render):
//   · the parent exists on the page (`unknown_parent`), is not the block itself
//     (`self_parent`), and is a container (`not_container`);
//   · no loop (`cycle`) and at most MAX_DEPTH containers above any block (`too_deep`). The walk
//     up a chain is BOUNDED (MAX_DEPTH + 1 steps): a loop longer than that is reported as
//     `too_deep`, which refuses it just the same, and no stored document can make the walk
//     cost more than a few steps per block, whatever it holds;
//   · a modal is never inside anything (`modal_nested`);
//   · at most MAX_CHILDREN direct children per container (`too_many`);
//   · a child ENTIRELY outside its container's inner area is refused at save
//     (`outside_parent`). Decision (phase 7a): REFUSE, not clamp. The renderer clips a child
//     that crosses the container's edge (the same rule as the page frame) and does not mount one
//     entirely outside; the editor never writes one (a block dragged out is re-parented on drop,
//     a container shrunk over its children pulls them back in). Clamping silently on read would
//     have made the editor and the page disagree about where a hand-edited block is.
//
// A block whose chain breaks one of the rules is INERT for readers: it is not mounted at all,
// and neither is anything under it. The editor still shows it, at the top level and flagged,
// and the next save writes it as a top-level block (serializeDoc drops a broken `parent`).
//
// Pure, no imports: canvas.js, validate.js and actions.js all read it.

/** The kinds that hold other blocks. */
export const CONTAINER_KINDS = ['group', 'tabs', 'modal'];
/** At most this many containers above any block. */
export const MAX_DEPTH = 3;
/** At most this many direct children per container. */
export const MAX_CHILDREN = 100;
/** A tab card has at least one tab and at most this many. */
export const MAX_TABS = 12;
/** A tab's label, in characters. */
export const TAB_LABEL_MAX = 80;
/** The height of a tab card's strip of labels, in board px; its panel starts below it. */
export const TAB_STRIP_H = 48;

const ID = /^[A-Za-z0-9_-]{1,60}$/;
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Does this kind hold other blocks? */
export const isContainer = (kind) => CONTAINER_KINDS.includes(kind);

/** The parent a stored block names, or '' when it names none (or nothing id-shaped). */
export function parentOf(b) {
  return isObj(b) && typeof b.parent === 'string' && ID.test(b.parent) ? b.parent : '';
}

/**
 * The labels of a tab card, tolerant: whatever is stored becomes 1 to MAX_TABS strings. An empty
 * label stays empty (the renderer numbers it); a tab card with no labels has one tab.
 */
export function tabLabels(props) {
  const raw = isObj(props) && Array.isArray(props.tabs) ? props.tabs : [];
  const out = raw.slice(0, MAX_TABS).map((l) => (typeof l === 'string' ? l.slice(0, TAB_LABEL_MAX) : ''));
  return out.length ? out : [''];
}

/**
 * The inner area of a container, in its own coordinates: where its children's (0,0) is and how
 * much room they have. A tab card's panel starts below its strip.
 */
export function innerBox(c) {
  const top = c && c.kind === 'tabs' ? TAB_STRIP_H : 0;
  const w = Math.max(1, num(c?.w, 1));
  return { x: 0, y: top, w, h: Math.max(1, num(c?.h, 1) - top) };
}

/** Does a child's box cross its container's inner area (area, not an edge)? */
export function insideParent(child, container) {
  const box = innerBox(container);
  const x = num(child?.x), y = num(child?.y), w = num(child?.w), h = num(child?.h);
  return x < box.w && x + w > 0 && y < box.h && y + h > 0;
}

/**
 * Every tree problem of a list of STORED blocks: `[{ index, field, reason }]`, `field` being
 * 'parent' or 'slot' or '' (the block itself, for `outside_parent`). Strict; the validator
 * turns each into a path. Ids are read as stored (the first block with an id owns it).
 */
export function treeProblems(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const byId = new Map();
  list.forEach((b) => { if (isObj(b) && typeof b.id === 'string' && ID.test(b.id) && !byId.has(b.id)) byId.set(b.id, b); });
  const out = [];
  const direct = directProblems(list, byId);
  const counts = new Map();
  list.forEach((b, index) => {
    if (!isObj(b)) return;
    const raw = b.parent;
    if (raw != null && raw !== '') {
      if (typeof raw !== 'string') { out.push({ index, field: 'parent', reason: 'bad_type' }); return; }
      if (!ID.test(raw)) { out.push({ index, field: 'parent', reason: 'bad_id' }); return; }
    }
    const reason = direct[index];
    if (reason) { out.push({ index, field: 'parent', reason }); return; }
    const p = parentOf(b);
    const parent = p ? byId.get(p) : null;
    // A slot means something only under a tab card, and only as one of its tabs.
    if (b.slot != null) {
      const n = parent && parent.kind === 'tabs' ? tabLabels(parent.props).length : 0;
      if (!(Number.isInteger(b.slot) && b.slot >= 0 && b.slot < n)) out.push({ index, field: 'slot', reason: 'bad_value' });
    }
    if (!parent) return;
    const c = (counts.get(p) || 0) + 1;
    counts.set(p, c);
    if (c > MAX_CHILDREN) { out.push({ index, field: 'parent', reason: 'too_many' }); return; }
    if (!insideParent(b, parent)) out.push({ index, field: '', reason: 'outside_parent' });
  });
  return out;
}

/** The problem of each block's OWN chain (index → reason), or nothing. Bounded walk. */
function directProblems(list, byId) {
  const out = {};
  list.forEach((b, index) => {
    if (!isObj(b)) return;
    const p = parentOf(b);
    if (!p) return;
    const self = typeof b.id === 'string' ? b.id : null;
    if (p === self) { out[index] = 'self_parent'; return; }
    const parent = byId.get(p);
    if (!parent) { out[index] = 'unknown_parent'; return; }
    if (!isContainer(parent.kind)) { out[index] = 'not_container'; return; }
    if (b.kind === 'modal') { out[index] = 'modal_nested'; return; }
    // Up the chain, at most MAX_DEPTH + 1 steps: a repeat is a loop, a chain still going after
    // MAX_DEPTH containers is too deep. Nothing a document holds makes this walk longer.
    const seen = new Set(self ? [self] : []);
    let cur = parent; let depth = 1;
    for (;;) {
      if (seen.has(cur.id)) { out[index] = 'cycle'; return; }
      seen.add(cur.id);
      const up = parentOf(cur);
      if (!up) return;
      if (up === self || seen.has(up)) { out[index] = 'cycle'; return; }
      depth += 1;
      if (depth > MAX_DEPTH) { out[index] = 'too_deep'; return; }
      const next = byId.get(up);
      if (!next) return;       // the ancestor's own problem, reported at the ancestor
      cur = next;
    }
  });
  return out;
}

/**
 * NORMALISED blocks (ids already unique) with the tree decided: every block whose chain is
 * broken, or sits under one that is, gets `treeError` (the reason); a child of a tab card gets
 * its `slot` brought into range, anything else loses `slot`. Tolerant: never throws, bounded.
 */
export function annotateTree(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const byId = new Map(list.map((b) => [b.id, b]));
  const direct = directProblems(list, byId);
  const counts = new Map();
  const err = new Map();
  list.forEach((b, i) => {
    let reason = direct[i] || '';
    const p = parentOf(b);
    if (!reason && p) {
      const c = (counts.get(p) || 0) + 1;
      counts.set(p, c);
      if (c > MAX_CHILDREN) reason = 'too_many';
    }
    if (reason) err.set(b.id, reason);
  });
  // A block under a broken one is not drawn either. Chains are at most MAX_DEPTH long here
  // (anything longer is itself `too_deep`), so this settles in a few passes.
  for (let pass = 0; pass <= MAX_DEPTH + 1; pass++) {
    let changed = false;
    for (const b of list) {
      const p = parentOf(b);
      if (p && !err.has(b.id) && err.has(p)) { err.set(b.id, 'broken_parent'); changed = true; }
    }
    if (!changed) break;
  }
  return list.map((b) => {
    const p = parentOf(b);
    const parent = p ? byId.get(p) : null;
    const out = { ...b };
    if (!p) delete out.parent;
    if (err.has(b.id)) out.treeError = err.get(b.id);
    else delete out.treeError;
    if (parent && parent.kind === 'tabs' && !out.treeError) {
      const n = tabLabels(parent.props).length;
      const s = Math.round(num(b.slot, 0));
      const slot = Math.max(0, Math.min(n - 1, s));
      if (slot > 0) out.slot = slot; else delete out.slot;
    } else delete out.slot;
    return out;
  });
}

/** Is this normalised block on the page itself: top level, drawn in the flow, not a dialog? */
export const isPageRoot = (b) => !!b && !b.treeError && !parentOf(b) && b.kind !== 'modal';
/** The dialogs of a page: top-level modal containers with a sound chain. */
export const modalBlocks = (blocks) => (Array.isArray(blocks) ? blocks : []).filter((b) => b && b.kind === 'modal' && !b.treeError && !parentOf(b));

/**
 * The tree of normalised blocks: `kids` maps a container's id to its direct children (array
 * order), without broken blocks. `depthOf(id)` counts the containers above a block.
 */
export function treeIndex(blocks) {
  const list = (Array.isArray(blocks) ? blocks : []).filter((b) => b && !b.treeError);
  const byId = new Map(list.map((b) => [b.id, b]));
  const kids = new Map();
  for (const b of list) {
    const p = parentOf(b);
    if (!p || !byId.has(p)) continue;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(b);
  }
  const depthOf = (id) => {
    let d = 0; let cur = byId.get(id);
    while (cur && parentOf(cur) && d <= MAX_DEPTH) { d += 1; cur = byId.get(parentOf(cur)); }
    return d;
  };
  return { byId, kids, depthOf, childrenOf: (id) => kids.get(id) || [] };
}

/** Every id under `id` (not `id` itself), depth first. */
export function descendantIds(blocks, id) {
  const { kids } = treeIndex(blocks);
  const out = [];
  const walk = (at, guard) => {
    if (guard > MAX_DEPTH + 1) return;
    for (const c of kids.get(at) || []) { out.push(c.id); walk(c.id, guard + 1); }
  };
  walk(id, 0);
  return out;
}

/** How many container levels a block's subtree adds below it (0 for a leaf). */
export function subtreeHeight(blocks, id) {
  const { kids } = treeIndex(blocks);
  const walk = (at, guard) => {
    if (guard > MAX_DEPTH + 1) return 0;
    const cs = kids.get(at) || [];
    return cs.length ? 1 + Math.max(...cs.map((c) => walk(c.id, guard + 1))) : 0;
  };
  return walk(id, 0);
}

/** The information an action step needs about the page's containers: id → { kind, tabs }. */
export function containerInfo(blocks) {
  const out = new Map();
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (isObj(b) && typeof b.id === 'string' && isContainer(b.kind) && !out.has(b.id)) {
      out.set(b.id, { kind: b.kind, tabs: b.kind === 'tabs' ? tabLabels(b.props).length : 0 });
    }
  }
  return out;
}

// ── The editor's board: absolute coordinates ─────────────────────────────────────────────

/**
 * Where a container's children's (0,0) is on the board, for a map of the blocks AS DRAWN
 * (absolute): the container's own place plus its inner offset. `null` for a top-level block.
 */
export function childOrigin(viewById, parentId) {
  const c = parentId ? viewById.get(parentId) : null;
  if (!c) return null;
  const box = innerBox(c);
  return { x: num(c.x) + box.x, y: num(c.y) + box.y };
}

/**
 * The blocks (already resolved for a theme) with every child placed in BOARD coordinates: its
 * container's place, plus the inner offset, plus its own. A broken block is drawn where its own
 * numbers put it, at the top level. Each keeps `rel` (its stored, relative x/y) and `depth`.
 */
export function absoluteBlocks(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const byId = new Map(list.map((b) => [b.id, b]));
  const done = new Map();
  const place = (b, guard) => {
    if (done.has(b.id)) return done.get(b.id);
    const p = b.treeError ? '' : parentOf(b);
    const parent = p ? byId.get(p) : null;
    let out;
    if (!parent || guard > MAX_DEPTH + 1) out = { ...b, depth: 0 };
    else {
      const pa = place(parent, guard + 1);
      const box = innerBox(pa);
      out = { ...b, x: num(pa.x) + box.x + num(b.x), y: num(pa.y) + box.y + num(b.y), rel: { x: num(b.x), y: num(b.y) }, depth: (pa.depth || 0) + 1 };
    }
    done.set(b.id, out);
    return out;
  };
  return list.map((b) => place(b, 0));
}

/**
 * Board geometry back to what is STORED for block `id`: x/y relative to its container. `view`
 * maps ids to the blocks as drawn (absoluteBlocks). Sizes pass through.
 */
export function toStored(viewById, id, geo) {
  const b = viewById.get(id);
  const o = b && !b.treeError ? childOrigin(viewById, parentOf(b)) : null;
  if (!o) return geo;
  const out = { ...geo };
  if (geo.x != null) out.x = num(geo.x) - o.x;
  if (geo.y != null) out.y = num(geo.y) - o.y;
  return out;
}

/**
 * Where a drop lands: the deepest container of `view` (absolute blocks) whose inner area holds
 * the board point `pt`, that may take the moving blocks. `exclude` are the moving ids and
 * everything under them; `slots` the tab each tab card is showing in the editor; `extra` the
 * container levels the moving blocks carry below themselves. '' = the page.
 */
export function dropTarget(view, pt, { exclude = new Set(), slots = {}, extra = 0, movingModal = false, visible = null } = {}) {
  if (movingModal) return '';
  const list = Array.isArray(view) ? view : [];
  let best = ''; let bestDepth = -1;
  for (const c of list) {
    // A hidden container is drawn dimmed on the board and takes a drop like any other; a locked
    // one does not (the lock says: leave it as it is).
    if (!isContainer(c.kind) || exclude.has(c.id) || c.treeError || c.locked) continue;
    if (visible && !visible.has(c.id)) continue;
    const box = innerBox(c);
    const x = num(c.x) + box.x; const y = num(c.y) + box.y;
    if (pt.x < x || pt.x > x + box.w || pt.y < y || pt.y > y + box.h) continue;
    const depth = c.depth || 0;
    if (depth + 1 + extra > MAX_DEPTH) continue;
    if (depth > bestDepth) { best = c.id; bestDepth = depth; }
  }
  void slots;
  return best;
}

/**
 * Move blocks `ids` (siblings) into container `target` ('' = the page), keeping where they are
 * on the board: stored coordinates become relative to the new container, pulled inside its
 * inner area when `target` is a container. On a tab card they join `slot`. Their paint order
 * goes above the new siblings. `view` are the absolute blocks the positions are read from.
 */
export function reparentBlocks(blocks, view, ids, target, slot = 0) {
  const set = new Set(ids || []);
  const byView = new Map((view || []).map((b) => [b.id, b]));
  const tgt = target ? byView.get(target) : null;
  if (target && !tgt) return blocks;
  const origin = tgt ? childOrigin(byView, target) : { x: 0, y: 0 };
  const box = tgt ? innerBox(tgt) : null;
  const siblings = (blocks || []).filter((b) => parentOf(b) === (target || '') && !set.has(b.id));
  let z = siblings.reduce((m, b) => Math.max(m, num(b.z)), -1) + 1;
  return (blocks || []).map((b) => {
    if (!set.has(b.id)) return b;
    const v = byView.get(b.id) || b;
    let x = Math.round(num(v.x) - origin.x); let y = Math.round(num(v.y) - origin.y);
    let w = num(b.w); let h = num(b.h);
    if (box) {
      w = Math.min(w, box.w); h = Math.min(h, box.h);
      x = Math.max(0, Math.min(x, box.w - w)); y = Math.max(0, Math.min(y, box.h - h));
    }
    const out = { ...b, x, y, w, h, z: z++ };
    if (target) out.parent = target; else delete out.parent;
    if (tgt && tgt.kind === 'tabs' && slot > 0) out.slot = slot; else delete out.slot;
    delete out.treeError;
    return out;
  });
}

/**
 * Put `ids` (siblings: same parent, same tab) in a new group `gid`, drawn around them. Null when
 * the selection is not one set of siblings, or the new level would pass MAX_DEPTH.
 * Stored coordinates are read: the group lives where its children are, in their container.
 */
export function groupBlocks(blocks, ids, gid) {
  const list = Array.isArray(blocks) ? blocks : [];
  const set = new Set(ids || []);
  const chosen = list.filter((b) => set.has(b.id));
  if (chosen.length < 1) return null;
  const p = parentOf(chosen[0]);
  const s = num(chosen[0].slot, 0);
  if (chosen.some((b) => parentOf(b) !== p || num(b.slot, 0) !== s || b.kind === 'modal' || b.treeError)) return null;
  const { depthOf } = treeIndex(list);
  const deepest = Math.max(...chosen.map((b) => depthOf(b.id) + 1 + subtreeHeight(list, b.id)));
  if (deepest > MAX_DEPTH) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of chosen) {
    x1 = Math.min(x1, num(b.x)); y1 = Math.min(y1, num(b.y));
    x2 = Math.max(x2, num(b.x) + num(b.w)); y2 = Math.max(y2, num(b.y) + num(b.h));
  }
  const z = Math.max(...chosen.map((b) => num(b.z)));
  const group = { id: gid, kind: 'group', x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1), z, props: {},
    ...(p ? { parent: p } : {}), ...(p && s > 0 ? { slot: s } : {}) };
  const out = [];
  let placed = false;
  for (const b of list) {
    if (!set.has(b.id)) { out.push(b); continue; }
    if (!placed) { out.push(group); placed = true; }
    const c = { ...b, x: num(b.x) - x1, y: num(b.y) - y1, parent: gid };
    delete c.slot;
    // A dark-theme place is relative to the same container: it moves by the same amount.
    const d = b.themes?.dark;
    if (d && (d.x != null || d.y != null)) {
      c.themes = { ...b.themes, dark: { ...d, ...(d.x != null ? { x: num(d.x) - x1 } : {}), ...(d.y != null ? { y: num(d.y) - y1 } : {}) } };
    }
    out.push(c);
  }
  return out;
}

/** Undo a group: its children go up to its own container, where they are; the group goes. */
export function ungroupBlocks(blocks, gid) {
  const list = Array.isArray(blocks) ? blocks : [];
  const g = list.find((b) => b.id === gid);
  if (!g || g.kind !== 'group') return null;
  const p = parentOf(g);
  const s = num(g.slot, 0);
  return list.filter((b) => b.id !== gid).map((b) => {
    if (parentOf(b) !== gid) return b;
    const c = { ...b, x: num(g.x) + num(b.x), y: num(g.y) + num(b.y), z: num(g.z) + num(b.z) / 1000 };
    if (p) c.parent = p; else delete c.parent;
    if (p && s > 0) c.slot = s; else delete c.slot;
    const d = b.themes?.dark;
    if (d && (d.x != null || d.y != null)) {
      c.themes = { ...b.themes, dark: { ...d, ...(d.x != null ? { x: num(d.x) + num(g.x) } : {}), ...(d.y != null ? { y: num(d.y) + num(g.y) } : {}) } };
    }
    return c;
  });
}

/**
 * A container was resized: its children that are now ENTIRELY outside its inner area come back
 * in (the save would refuse them otherwise, `outside_parent`). Stored coordinates.
 */
export function pullChildrenInside(blocks, cid) {
  const list = Array.isArray(blocks) ? blocks : [];
  const c = list.find((b) => b.id === cid);
  if (!c || !isContainer(c.kind)) return list;
  const box = innerBox(c);
  return list.map((b) => {
    if (parentOf(b) !== cid || insideParent(b, c)) return b;
    const w = Math.min(num(b.w), box.w); const h = Math.min(num(b.h), box.h);
    return { ...b, w, h, x: Math.max(0, Math.min(num(b.x), box.w - w)), y: Math.max(0, Math.min(num(b.y), box.h - h)) };
  });
}

/** One step up or down the paint order AMONG SIBLINGS (the Layers tree's arrows). */
export function reorderSiblings(blocks, id, dir) {
  const list = Array.isArray(blocks) ? blocks : [];
  const me = list.find((b) => b.id === id);
  if (!me) return list;
  const p = parentOf(me);
  const sib = list.map((b, i) => [b, i]).filter(([b]) => parentOf(b) === p)
    .sort((a, b) => (num(a[0].z) - num(b[0].z)) || (a[1] - b[1])).map(([b]) => b);
  const i = sib.findIndex((b) => b.id === id);
  const j = dir === 'up' ? i + 1 : i - 1;
  if (i < 0 || j < 0 || j >= sib.length) return list;
  const zOf = new Map(sib.map((b, k) => [b.id, k]));
  zOf.set(sib[i].id, j); zOf.set(sib[j].id, i);
  return list.map((b) => (zOf.has(b.id) ? { ...b, z: zOf.get(b.id) } : b));
}

/**
 * Remove a tab from a tab card: its label, and the blocks in it (and under them); the tabs after
 * it move down one. Stored blocks.
 */
export function removeTab(blocks, cid, index) {
  const list = Array.isArray(blocks) ? blocks : [];
  const c = list.find((b) => b.id === cid);
  if (!c || c.kind !== 'tabs') return list;
  const labels = tabLabels(c.props);
  if (labels.length <= 1 || index < 0 || index >= labels.length) return list;
  const gone = new Set();
  for (const b of list) if (parentOf(b) === cid && num(b.slot, 0) === index) { gone.add(b.id); for (const d of descendantIds(list, b.id)) gone.add(d); }
  return list.filter((b) => !gone.has(b.id)).map((b) => {
    if (b.id === cid) return { ...b, props: { ...(b.props || {}), tabs: labels.filter((_l, i) => i !== index) } };
    if (parentOf(b) === cid && num(b.slot, 0) > index) {
      const s = num(b.slot, 0) - 1;
      const out = { ...b };
      if (s > 0) out.slot = s; else delete out.slot;
      return out;
    }
    return b;
  });
}
