// Studio files: export and import (PLAN-STUDIO-2026 2.6, 3.2, phase 7c).
//
// THE FORMAT. One JSON file, `<name>.bcwstudio.json`:
//
//   {
//     format: 'bcw-studio',          what the file is
//     version: 1,                     the FILE format's version (the document inside has its own `v`)
//     kind: 'page' | 'component' | 'preset:page' | 'preset:section' | 'preset:background' | 'preset:component',
//     id?: string,                    the id it had where it was exported (never reused: see FRESH IDS)
//     name?: string,                  a component's or a preset's name (a page's is its doc.title)
//     origin?: 'https://host',        the site it was exported from
//     exportedAt?: ISO string,
//     doc: StudioDoc v2,              STORED shape (serializeDoc), without `id`, `hidden` or `components`
//     components?: { [id]: definition },   the component definitions the doc's instances use
//     exposed?: [...],                the fields a copy may change (component kinds only)
//     assets: ['/uploads/...', '/api/media/...'],   every picture, video or file the doc names
//   }
//
// ASSETS travel BY ADDRESS, never as bytes, and only as this site's own upload paths
// (`/uploads/...`, `/api/media/...`, the rule of a `download` step, actions.js downloadPath). An
// address from another host is refused at export AND at import (`asset_off_site`), so a file
// can never make a page fetch a third party's pixel. Nothing is fetched while importing. What
// happens to the addresses where the file lands:
//   · the same site, any page or project: they are this site's uploads, they show as long as the
//     upload exists (an upload is site-wide, not per project);
//   · another site: a path means THAT site's `/uploads/...`, which does not hold these files. The
//     import says so (`origin` differs) and the pictures are to be uploaded again there.
//
// ONE VALIDATOR. Everything a file brings is untrusted (3.2). `parseStudioFile` runs, in order:
//   1. a size cap on the text, before anything is parsed (MAX_FILE_BYTES);
//   2. JSON.parse, then ONE iterative walk that refuses a key named __proto__, constructor or
//      prototype anywhere, and a nesting deeper than MAX_JSON_DEPTH (nothing recursive has run
//      yet, so a depth bomb cannot overflow a stack);
//   3. the envelope, field by field (unknown fields refused);
//   4. the document through `validateDoc`, the function the API runs at every save (actions,
//      tree, background, components: not_exposed, cycles, depth, expansion caps), with the
//      library's own rules for a component or a preset (`libraryEntryProblems`, which the API's
//      library route calls too), plus the asset rule above.
// Every refusal is `{ path, reason }`, the path being the field IN THE FILE (`doc.blocks[3].props.src`).
// The clipboard paste of blocks (`{ bcwBlocks }`) goes through the same function: it is read as
// a section file (`parseBlocksPaste`).
//
// FRESH IDS. An import never reuses an id from the file: every block, every component and the
// page or entry itself get new ones (`freshStudioFile`), with every reference rewritten (a
// container link, a step's target, an instance's component, an exposed field's block), so an
// imported file can never collide with, or overwrite, a block, a page or a component already
// here. Nothing is written by the import itself either: the result lands in the editor's draft
// or in a library through the normal save routes, which validate it again.
//
// Pure, no DOM.
import { DOC_VERSION, ID_SHAPE, MAX_COMPONENT_BLOCKS, LIMITS, usedComponentIds } from './canvas.js';
import { validateDoc, exposedProblems, RESERVED_NAMES, MAX_DOC_BYTES } from './validate.js';
import { downloadPath } from './actions.js';

export const STUDIO_FILE_FORMAT = 'bcw-studio';
export const STUDIO_FILE_VERSION = 1;
export const STUDIO_FILE_EXT = '.bcwstudio.json';
export const STUDIO_FILE_KINDS = ['page', 'component', 'preset:page', 'preset:section', 'preset:background', 'preset:component'];

/**
 * The largest file read, in UTF-8 bytes: 2 000 000.
 *
 * Not a round guess. The largest document any save accepts is LIMITS.bytes = 300 000 characters
 * of compact JSON (validateDoc `too_large`, the definitions of its components included). A
 * character is at most 3 UTF-8 bytes (a 4-byte character is 2 UTF-16 units), so the heaviest
 * valid page is 900 000 bytes compact; the export indents with 2 spaces, which adds at most 1.4
 * bytes per compact character (measured by the test at 2.4x on the worst shape, a page of many
 * small blocks with steps, all ASCII). Together: (3 + 1.4) x 300 000 = 1.32 MB, plus a few
 * fields of envelope. 2 000 000 bytes holds every file an export of a valid page can produce,
 * and anything larger cannot hold a page the save route would take, so it is refused before it
 * is read, never parsed for nothing.
 */
export const MAX_FILE_BYTES = 2_000_000;
/** The deepest JSON nesting read. A real file is about 12 levels deep (envelope, components, a
 *  definition, its blocks, a block, its steps, a submit mapping); 40 leaves room and stops a
 *  depth bomb before any recursive code sees it. */
export const MAX_JSON_DEPTH = 40;
/** At most this many asset addresses in a file (one per block and step at most, in practice). */
export const MAX_FILE_ASSETS = 1000;
/** A preset's library limits (the API's LIBRARY_LIMITS, apps/api/src/lib/studio-library.mjs). */
export const PRESET_ENTRY_SORTS = ['page', 'section', 'background', 'component'];
const NAME_MAX = 60;

const ENVELOPE_KEYS = ['format', 'version', 'kind', 'id', 'name', 'origin', 'exportedAt', 'doc', 'components', 'exposed', 'assets'];
const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]{1,190}(?::\d{1,5})?$/;

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const join = (at, path) => (at && path ? `${at}.${path}` : at || path);

/** The UTF-8 length of a string, without allocating a buffer. */
export function utf8Bytes(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i += 1; }
    else n += 3;
  }
  return n;
}

/** The kind of library entry a file kind makes: 'component', a preset sort, or '' for a page. */
export const entrySortOf = (kind) => (kind === 'component' ? 'component' : typeof kind === 'string' && kind.startsWith('preset:') ? kind.slice(7) : '');
/** Does this kind carry exposed fields? */
const exposes = (kind) => kind === 'component' || kind === 'preset:component';

// ── Assets ────────────────────────────────────────────────────────────────────────────────
/** An asset address this format carries: this site's upload path, or '' (actions.js downloadPath). */
export const assetPath = (raw) => downloadPath(raw);

const ASSET_PROPS = ['src', 'poster'];

/** Every asset a list of steps names: `[{ path, value }]`. */
function stepAssets(steps, at, out) {
  if (!Array.isArray(steps)) return;
  steps.forEach((s, j) => { if (isObj(s) && s.type === 'download' && typeof s.file === 'string' && s.file) out.push({ path: `${at}[${j}].file`, value: s.file }); });
}

/**
 * Every asset address a (raw, stored) document names, with its path: the pictures, videos and
 * recordings of its blocks (and of their dark overlays), a `download` step's file, the page
 * background's picture, an instance's override of an exposed picture or step, and the same in
 * every component definition of `components` (paths under `components.<id>.doc`).
 * `components` defaults to the doc's own map.
 */
export function assetRefs(doc, components = undefined) {
  const out = [];
  const map = components !== undefined ? components : own(doc, 'components');
  const walkDoc = (d, at, defs) => {
    if (!isObj(d)) return;
    const bg = own(d, 'background');
    if (isObj(bg) && bg.type === 'image' && typeof bg.src === 'string' && bg.src) out.push({ path: join(at, 'background.src'), value: bg.src });
    const blocks = Array.isArray(d.blocks) ? d.blocks : [];
    blocks.forEach((b, i) => {
      if (!isObj(b)) return;
      const bp = join(at, `blocks[${i}]`);
      const props = [[b.props, `${bp}.props`]];
      for (const theme of ['light', 'dark']) { const o = own(own(b, 'themes'), theme); if (isObj(o)) props.push([o.props, `${bp}.themes.${theme}.props`]); }
      for (const [p, pp] of props) {
        if (!isObj(p)) continue;
        for (const k of ASSET_PROPS) if (typeof p[k] === 'string' && p[k]) out.push({ path: `${pp}.${k}`, value: p[k] });
      }
      stepAssets(b.action, `${bp}.action`, out);
      // An instance's overrides of the fields its component exposes as a picture or a step.
      const ov = isObj(b.component) && isObj(b.component.overrides) ? b.component.overrides : null;
      const def = ov && typeof b.component.id === 'string' ? own(defs, b.component.id) : null;
      if (ov && isObj(def) && Array.isArray(def.exposed)) {
        for (const e of def.exposed) {
          if (!isObj(e) || typeof e.key !== 'string' || !Object.prototype.hasOwnProperty.call(ov, e.key)) continue;
          const v = ov[e.key];
          const op = `${bp}.component.overrides.${e.key}`;
          if ((e.field === 'props.src' || e.field === 'props.poster') && typeof v === 'string' && v) out.push({ path: op, value: v });
          if (e.field === 'action') stepAssets(v, op, out);
        }
      }
    });
  };
  walkDoc(doc, '', map);
  if (isObj(map)) for (const cid of Object.keys(map).slice(0, 64)) { const s = map[cid]; if (isObj(s)) walkDoc(s.doc, `components.${cid}.doc`, map); }
  return out;
}

/** The asset addresses of a document that are not this site's uploads: `[{ path, reason }]`. */
export function assetProblems(doc, components = undefined) {
  return assetRefs(doc, components).filter((r) => !assetPath(r.value)).map((r) => ({ path: r.path, reason: 'asset_off_site' }));
}

/** The distinct asset addresses of a document, in the order they appear. */
export const assetList = (doc, components = undefined) => [...new Set(assetRefs(doc, components).map((r) => r.value))];

// ── The library's rule for one entry (shared with the API) ──────────────────────────────────
/**
 * Every problem of ONE library entry `{ id, name, sort, doc, exposed?, createdAt? }`, as
 * `{ path, reason }` under `at` (e.g. `entries[2]`). THE rule of a library write: the API's
 * library route (apps/api/src/lib/studio-library.mjs parseLibrary) calls this function, and an
 * imported component or preset is checked by it before it is offered to that route. The list's
 * own rules (at most 60 entries, ids unique across the list) stay the route's.
 *
 * The doc is checked by validateDoc as a page whose id is the entry's; a COMPONENT as the
 * definition of itself (an instance of it inside, directly or through what it uses, is a loop).
 */
export function libraryEntryProblems(e, at = '', opts = {}) {
  const problems = [];
  const bad = (path, reason) => problems.push({ path: join(at, path), reason });
  if (!isObj(e)) { bad('', 'bad_type'); return problems; }
  for (const k of Object.keys(e)) if (!['id', 'name', 'sort', 'doc', 'createdAt', 'exposed'].includes(k)) bad(k, 'unknown_field');
  if (typeof e.id !== 'string' || !ID_SHAPE.test(e.id)) bad('id', 'bad_id');
  const name = typeof e.name === 'string' ? e.name.trim() : '';
  if (!name || name.length > NAME_MAX || /[\x00-\x1f\x7f]/.test(name)) bad('name', 'bad_value');
  if (!PRESET_ENTRY_SORTS.includes(e.sort)) bad('sort', 'bad_value');
  const doc = e.doc;
  if (!isObj(doc)) { bad('doc', 'bad_type'); return problems; }
  const selfId = typeof e.id === 'string' && ID_SHAPE.test(e.id) ? e.id : 'preset';
  for (const p of validateDoc({ ...doc, id: selfId }, join(at, 'doc'), e.sort === 'component' ? { ...opts, selfComponent: selfId } : opts)) problems.push({ path: p.path, reason: p.reason });
  if (e.sort === 'component') exposedProblems(e.exposed, Array.isArray(doc.blocks) ? doc.blocks : [], (path, reason) => problems.push({ path: join(at, path), reason }), 'exposed');
  else if (e.exposed != null) bad('exposed', 'not_allowed');
  const blocks = Array.isArray(doc.blocks) ? doc.blocks.length : 0;
  if (e.sort === 'background' && blocks) bad('doc.blocks', 'not_allowed');
  if ((e.sort === 'section' || e.sort === 'component') && !blocks) bad('doc.blocks', 'required');
  if (e.sort === 'component' && blocks > MAX_COMPONENT_BLOCKS) bad('doc.blocks', 'too_many');
  let bytes = Infinity;
  try { bytes = JSON.stringify(doc).length; } catch { /* refused */ }
  if (bytes > MAX_DOC_BYTES) bad('doc', 'too_large');
  if (e.createdAt != null && !(typeof e.createdAt === 'string' && e.createdAt.length <= 40)) bad('createdAt', 'bad_value');
  return problems;
}

// ── Reading a file ────────────────────────────────────────────────────────────────────────
/**
 * JSON text, guarded: the size cap, the parse, then one ITERATIVE walk that refuses a reserved
 * key anywhere and a nesting deeper than MAX_JSON_DEPTH. `{ ok: true, value }` or
 * `{ ok: false, problems }`.
 */
export function parseGuardedJson(text, maxBytes = MAX_FILE_BYTES) {
  if (typeof text !== 'string') return { ok: false, problems: [{ path: '', reason: 'bad_json' }] };
  // Cheap bound first (a UTF-16 unit is at least one byte), then the exact UTF-8 length.
  if (text.length > maxBytes || utf8Bytes(text) > maxBytes) return { ok: false, problems: [{ path: '', reason: 'file_too_large' }] };
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, problems: [{ path: '', reason: 'bad_json' }] }; }
  const problems = [];
  const stack = [[value, '', 0]];
  let seen = 0;
  while (stack.length) {
    const [v, path, depth] = stack.pop();
    if (v == null || typeof v !== 'object') continue;
    if (depth > MAX_JSON_DEPTH) { problems.push({ path, reason: 'json_too_deep' }); break; }
    if (++seen > 400_000) { problems.push({ path, reason: 'file_too_large' }); break; }
    if (Array.isArray(v)) { for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], `${path}[${i}]`, depth + 1]); continue; }
    for (const k of Object.keys(v)) {
      const kp = path ? `${path}.${k}` : k;
      if (RESERVED_NAMES.includes(k)) { problems.push({ path: kp, reason: 'forbidden_key' }); if (problems.length >= 20) break; continue; }
      stack.push([v[k], kp, depth + 1]);
    }
    if (problems.length >= 20) break;
  }
  return problems.length ? { ok: false, problems } : { ok: true, value };
}

/** The legacy block fields an export never writes (`link`, a button's `props.action`): refused
 *  in a file, where they could only be hand-made, instead of converted. */
function legacyProblems(doc, at, out) {
  const blocks = isObj(doc) && Array.isArray(doc.blocks) ? doc.blocks : [];
  blocks.forEach((b, i) => {
    if (!isObj(b)) return;
    if (b.link != null) out.push({ path: join(at, `blocks[${i}].link`), reason: 'unknown_field' });
    if (isObj(b.props) && Object.prototype.hasOwnProperty.call(b.props, 'action')) out.push({ path: join(at, `blocks[${i}].props.action`), reason: 'unknown_field' });
  });
}

/** A path from validateDoc (page-relative) as the FILE spells it: the definitions are a
 *  top-level field of the file (`components.…`), everything else is inside `doc`. */
function pagePath(p) {
  const s = String(p || '');
  if (s === 'components' || s.startsWith('components.')) return s;
  return s ? `doc.${s}` : 'doc';
}
/** A path from libraryEntryProblems (entry-relative: `doc.…`, `exposed…`, `name`) as the file
 *  spells it: only the definitions move, from `doc.components` to the top level. */
const entryPath = (p) => (String(p || '').startsWith('doc.components') ? String(p).slice(4) : String(p || ''));

/**
 * Every problem of an already parsed file object, as `{ path, reason }` ([] = import it).
 * `opts.links`: the site's link policy (an `external` step is checked against it, as at save).
 */
export function studioFileProblems(file, opts = {}) {
  const out = [];
  const bad = (path, reason) => out.push({ path, reason });
  if (!isObj(file)) return [{ path: '', reason: 'bad_format' }];
  if (file.format !== STUDIO_FILE_FORMAT) return [{ path: 'format', reason: 'bad_format' }];
  if (file.version !== STUDIO_FILE_VERSION) return [{ path: 'version', reason: 'unsupported_version' }];
  for (const k of Object.keys(file)) if (!ENVELOPE_KEYS.includes(k)) bad(k, 'unknown_field');
  const kind = file.kind;
  if (!STUDIO_FILE_KINDS.includes(kind)) { bad('kind', 'bad_kind'); return out; }
  if (file.id != null && !(typeof file.id === 'string' && ID_SHAPE.test(file.id) && !RESERVED_NAMES.includes(file.id))) bad('id', 'bad_id');
  if (file.name != null && !(typeof file.name === 'string' && file.name.length <= NAME_MAX && !/[\x00-\x1f\x7f]/.test(file.name))) bad('name', 'bad_value');
  if (file.origin != null && !(typeof file.origin === 'string' && ORIGIN.test(file.origin))) bad('origin', 'bad_value');
  if (file.exportedAt != null && !(typeof file.exportedAt === 'string' && file.exportedAt.length <= 40)) bad('exportedAt', 'bad_value');
  if (file.assets != null) {
    if (!Array.isArray(file.assets)) bad('assets', 'bad_type');
    else {
      if (file.assets.length > MAX_FILE_ASSETS) bad('assets', 'too_many');
      file.assets.slice(0, MAX_FILE_ASSETS).forEach((a, i) => { if (!(typeof a === 'string' && assetPath(a))) bad(`assets[${i}]`, 'asset_off_site'); });
    }
  }
  if (!exposes(kind) && file.exposed != null) bad('exposed', 'not_allowed');
  if (file.components != null && !isObj(file.components)) bad('components', 'bad_type');
  const doc = file.doc;
  if (!isObj(doc)) { bad('doc', 'bad_type'); return out; }
  // The file carries the definitions beside the document; a map inside the document too would
  // be two maps for one page.
  if (Object.prototype.hasOwnProperty.call(doc, 'components')) bad('doc.components', 'not_allowed');
  if (doc.v !== DOC_VERSION) bad('doc.v', 'bad_value');
  if (Object.prototype.hasOwnProperty.call(doc, 'id')) bad('doc.id', 'not_allowed');
  if (Object.prototype.hasOwnProperty.call(doc, 'hidden')) bad('doc.hidden', 'not_allowed');
  if (out.length) return out;
  const components = isObj(file.components) ? file.components : null;
  const joined = components ? { ...doc, components } : { ...doc };
  legacyProblems(doc, 'doc', out);
  if (components) for (const cid of Object.keys(components).slice(0, 64)) legacyProblems(own(components[cid], 'doc'), `components.${cid}.doc`, out);
  const sort = entrySortOf(kind);
  if (sort) {
    // A component or a preset: the library's own rule, which a library write runs too.
    const entry = { id: typeof file.id === 'string' && ID_SHAPE.test(file.id) ? file.id : 'imported', name: typeof file.name === 'string' && file.name.trim() ? file.name : 'Imported', sort, doc: joined, ...(exposes(kind) ? { exposed: file.exposed ?? [] } : {}) };
    for (const p of libraryEntryProblems(entry, '', opts)) out.push({ path: entryPath(p.path), reason: p.reason });
  } else {
    for (const p of validateDoc({ ...joined, id: 'imported' }, '', opts)) out.push({ path: pagePath(p.path), reason: p.reason });
  }
  for (const p of assetProblems(doc, components)) out.push({ path: pagePath(p.path), reason: p.reason });
  // One problem per field is enough to read, and a hostile file can produce thousands.
  const seen = new Set();
  return out.filter((p) => { const k = `${p.path}|${p.reason}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 50);
}

/**
 * A file's TEXT, read and checked: `{ ok: true, file }` or `{ ok: false, problems }`, each
 * problem `{ path, reason }` with the path of the field in the file.
 */
export function parseStudioFile(text, opts = {}) {
  const j = parseGuardedJson(text, MAX_FILE_BYTES);
  if (!j.ok) return j;
  const problems = studioFileProblems(j.value, opts);
  return problems.length ? { ok: false, problems } : { ok: true, file: j.value };
}

// ── Fresh ids ─────────────────────────────────────────────────────────────────────────────
const TARGET_STEPS = ['scroll', 'reveal', 'modal', 'tab'];

/** Steps with their block targets pointed through `ids` (a scroll to `#top` is not a block). */
function remapSteps(steps, ids) {
  if (!Array.isArray(steps)) return steps;
  return steps.map((s) => (isObj(s) && TARGET_STEPS.includes(s.type) && typeof s.target === 'string' && ids.has(s.target) ? { ...s, target: ids.get(s.target) } : s));
}

/** A fallback id maker (tests, node): unique within the call, ID_SHAPE, never time-based alone. */
function counterUid(prefix = 'i') {
  let n = 0;
  const salt = Math.random().toString(36).slice(2, 7);
  return () => `${prefix}${salt}${(n++).toString(36)}`;
}

/**
 * The file's content with EVERY id new: `{ doc, exposed, idMap }`.
 *   · each block of the document and of every definition: a new id from `uid()`, never one of
 *     `taken` (the ids already on the page it lands on) nor one used twice;
 *   · every reference rewritten: `parent`, a step's `target` (scroll, reveal, modal, tab), an
 *     instance's override of an exposed step (its targets are the DEFINITION's blocks), an
 *     exposed field's `block`, an instance's `component.id`;
 *   · each definition of `components`: a new id (unless `keepComponents`: a paste of copies
 *     that stay linked to THIS page's definitions, which are not imported).
 * `doc` is the document with its definitions put back (`doc.components`), no page id (the
 * caller gives the one of the page or the entry it becomes). `idMap` = { blocks: Map (the
 * document's), components: Map, defs: { [newCid]: Map } }, for the round-trip test.
 */
export function freshStudioFile(file, opts = {}) {
  const uid = typeof opts.uid === 'function' ? opts.uid : counterUid('b');
  const cuid = typeof opts.componentUid === 'function' ? opts.componentUid : counterUid('c');
  const used = new Set(opts.taken || []);
  const next = (make) => { let id = ''; let guard = 0; do { id = String(make()); } while ((used.has(id) || !ID_SHAPE.test(id)) && guard++ < 1000); used.add(id); return id; };
  const src = isObj(file) ? file : {};
  const doc = isObj(src.doc) ? src.doc : { blocks: [] };
  const comps = isObj(src.components) ? src.components : {};
  const cmap = new Map(Object.keys(comps).map((cid) => [cid, opts.keepComponents ? cid : next(cuid)]));
  const blockIds = (blocks) => new Map((Array.isArray(blocks) ? blocks : []).filter((b) => isObj(b) && typeof b.id === 'string').map((b) => [b.id, next(uid)]));
  // Each definition's block ids, first: an instance's override of an exposed step names them.
  const defIds = new Map(Object.keys(comps).map((cid) => [cid, blockIds(comps[cid]?.doc?.blocks)]));
  const moveBlocks = (blocks, ids) => (Array.isArray(blocks) ? blocks : []).map((b) => {
    if (!isObj(b)) return b;
    const o = { ...b, id: ids.get(b.id) || b.id };
    if (typeof b.parent === 'string' && ids.has(b.parent)) o.parent = ids.get(b.parent);
    if (b.action != null) o.action = remapSteps(b.action, ids);
    if (b.kind === 'instance' && isObj(b.component)) {
      const cid = b.component.id;
      const tag = { ...b.component, id: cmap.get(cid) || cid };
      const def = own(comps, cid);
      const dIds = defIds.get(cid);
      if (isObj(b.component.overrides) && isObj(def) && Array.isArray(def.exposed) && dIds) {
        const ov = { ...b.component.overrides };
        for (const e of def.exposed) if (isObj(e) && e.field === 'action' && Object.prototype.hasOwnProperty.call(ov, e.key)) ov[e.key] = remapSteps(ov[e.key], dIds);
        tag.overrides = ov;
      }
      o.component = tag;
    }
    return o;
  });
  const moveExposed = (list, ids) => (Array.isArray(list) ? list.map((e) => (isObj(e) && ids.has(e.block) ? { ...e, block: ids.get(e.block) } : e)) : list);
  const outComps = {};
  const defs = {};
  for (const cid of Object.keys(comps)) {
    const s = comps[cid];
    const ncid = cmap.get(cid);
    const ids = defIds.get(cid);
    defs[ncid] = ids;
    outComps[ncid] = isObj(s) ? { ...s, doc: isObj(s.doc) ? { ...s.doc, blocks: moveBlocks(s.doc.blocks, ids) } : s.doc, exposed: moveExposed(s.exposed, ids) } : s;
  }
  const pageIds = blockIds(doc.blocks);
  const outDoc = { ...doc, blocks: moveBlocks(doc.blocks, pageIds) };
  if (Object.keys(outComps).length) outDoc.components = outComps;
  return {
    doc: outDoc,
    exposed: exposes(src.kind) ? moveExposed(src.exposed ?? [], pageIds) : undefined,
    idMap: { blocks: pageIds, components: cmap, defs },
  };
}

// ── Writing a file ────────────────────────────────────────────────────────────────────────
/**
 * The file for a document (STORED shape: what serializeDoc returns, or a library entry's doc):
 * `{ file, problems }`. The problems are those an import of the file would meet (the SAME
 * function), so what this site exports it also imports: a page that uses a picture from
 * another site is not exported, with the path of that picture, rather than exported into a
 * file nobody can read back.
 *   kind       one of STUDIO_FILE_KINDS
 *   doc        the document (its `components`, `id` and `hidden` are taken out of it)
 *   id, name, exposed, origin, exportedAt   see the format at the top
 */
export function exportStudioFile({ kind, doc, id = '', name = '', exposed = null, origin = '', exportedAt = '' } = {}, opts = {}) {
  const d = isObj(doc) ? doc : {};
  const { components, id: _id, hidden: _h, ...rest } = d;
  const file = {
    format: STUDIO_FILE_FORMAT,
    version: STUDIO_FILE_VERSION,
    kind,
    ...(typeof id === 'string' && ID_SHAPE.test(id) ? { id } : {}),
    ...(name ? { name: String(name).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, NAME_MAX) } : {}),
    ...(origin ? { origin } : {}),
    ...(exportedAt ? { exportedAt } : {}),
    doc: rest,
    ...(isObj(components) && Object.keys(components).length ? { components } : {}),
    ...(exposes(kind) ? { exposed: Array.isArray(exposed) ? exposed : [] } : {}),
    assets: assetList(rest, isObj(components) ? components : null).filter((a) => assetPath(a)),
  };
  return { file, problems: studioFileProblems(file, opts) };
}

/** The file as text: indented, one trailing newline (a file a person may read and diff). */
export const studioFileText = (file) => `${JSON.stringify(file, null, 2)}\n`;

/** A file name from a title: `hero-page.bcwstudio.json` (ASCII letters, digits and dashes). */
export function studioFileName(name, fallback = 'studio') {
  const base = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || fallback}${STUDIO_FILE_EXT}`;
}

// ── The clipboard ─────────────────────────────────────────────────────────────────────────
/**
 * A paste of blocks (`{ bcwBlocks: [...] }`, what the studio's Ctrl+C writes), read as a
 * SECTION file and checked by the same function as an imported one. `pageComponents`: the
 * definitions of the page being pasted on; a copy (instance) of one of them stays a linked copy,
 * a copy of anything else is left out (its definition is not on this page), which is what the
 * paste always did. Returns `{ ok, file, dropped }` or `{ ok: false, problems }`, a block's
 * path as `bcwBlocks[i]`, i counted in the clipboard's list.
 */
export function parseBlocksPaste(input, pageComponents = null, opts = {}) {
  let list;
  if (typeof input === 'string') {
    const j = parseGuardedJson(input, MAX_FILE_BYTES);
    if (!j.ok) return j;
    if (!isObj(j.value) || !Array.isArray(j.value.bcwBlocks)) return { ok: false, problems: [{ path: '', reason: 'bad_format' }] };
    list = j.value.bcwBlocks;
  } else if (Array.isArray(input)) {
    // Blocks this tab copied (the in-memory clipboard): the same guard, through their text.
    let text = '';
    try { text = JSON.stringify({ bcwBlocks: input }); } catch { return { ok: false, problems: [{ path: '', reason: 'bad_json' }] }; }
    return parseBlocksPaste(text, pageComponents, opts);
  } else return { ok: false, problems: [{ path: '', reason: 'bad_format' }] };
  if (list.length > LIMITS.blocks) return { ok: false, problems: [{ path: 'doc.blocks', reason: 'too_many' }] };
  const map = isObj(pageComponents) ? pageComponents : {};
  const kept = list.filter((b) => !(isObj(b) && b.kind === 'instance') || (isObj(b.component) && typeof b.component.id === 'string' && isObj(own(map, b.component.id))));
  // The definitions the kept copies use, and the ones THOSE use (a card holding a badge).
  const used = usedComponentIds(kept.filter((b) => isObj(b) && b.kind === 'instance'), map);
  const components = {};
  for (const cid of used) if (isObj(own(map, cid))) components[cid] = map[cid];
  const file = {
    format: STUDIO_FILE_FORMAT, version: STUDIO_FILE_VERSION, kind: 'preset:section', name: 'Clipboard',
    doc: { v: DOC_VERSION, frames: { desktop: { w: 1200, fit: 'content' }, phone: { w: 390, fit: 'content', mode: 'stack' } }, blocks: kept },
    ...(used.size ? { components } : {}),
  };
  const problems = kept.length ? studioFileProblems(file, opts) : [];
  if (problems.length) {
    // Said in the clipboard's own terms: `bcwBlocks[i]`, i counted in the list as copied.
    const at = [];
    list.forEach((b, i) => { if (kept.includes(b)) at.push(i); });
    const where = (path) => path.replace(/^doc\.blocks\[(\d+)\]/, (_m, k) => `bcwBlocks[${at[Number(k)] ?? k}]`);
    return { ok: false, problems: problems.map((p) => ({ ...p, path: where(p.path) })) };
  }
  return { ok: true, file, dropped: list.length - kept.length };
}
