// The studio's shared preset libraries (PLAN-STUDIO-2026 2.6, phase 6).
//
// A preset is a starting point an author picks in the studio's gallery: a whole PAGE, a
// SECTION (a group of blocks dropped as plain blocks), a BACKGROUND, or a COMPONENT (a group of
// blocks dropped as a linked copy). Three scopes:
//   · coded    the presets written in the studio package (CANVAS_PRESETS), read-only, not here;
//   · site     `studio.library:site`, official presets, written by manage_studio only, read by
//              whoever may open any studio;
//   · project  `studio.library:project:<key>` and `studio.library:sc:<showcaseId>`, shared by
//              every studio holder of THAT page (decision D9), read and written with
//              canUseStudio on it.
//
// Storage: ONE AdminSetting value per library, `{ entries, updatedAt }`, written whole, with a
// revision (a hash of the entries) the writer must send back: two authors saving presets at the
// same time get a 409 instead of one erasing the other's (the same rule as a page save).
//
// Every entry carries a StudioDoc and goes through the SAME validator as a page save
// (validateDoc, with the site's link policy): a preset is imported data that lands on public
// pages, so a `javascript:` button, a CSS value that fetches or an unknown field is refused here
// with its path. No legacy tolerance: a library is new in phase 6, nothing old is in it.
import { createHash } from 'node:crypto';
import { studioDocProblems, studioDocError, exposedProblems, ID_SHAPE, MAX_DOC_BYTES } from './studio-doc.mjs';

export const PRESET_SORTS = ['page', 'section', 'background', 'component'];
export const LIBRARY_LIMITS = { entries: 60, name: 60, bytes: 1_500_000 };

/** The AdminSetting key of a library. `ref` is the project key or the showcase row id. */
export function libraryKey(scope, ref) {
  if (scope === 'site') return 'studio.library:site';
  if (scope === 'project') return `studio.library:project:${ref}`;
  if (scope === 'showcase') return `studio.library:sc:${ref}`;
  return null;
}

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
/** The revision of a list of entries: '' for an empty or absent library. */
export function libraryRev(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return '';
  return createHash('sha256').update(stable(list)).digest('hex').slice(0, 24);
}

/** What is stored, as a list (anything unreadable is left out, never thrown on). */
export function readLibrary(value) {
  const list = Array.isArray(value?.entries) ? value.entries : [];
  return list.filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && PRESET_SORTS.includes(e.sort) && e.doc && typeof e.doc === 'object');
}

// `exposed` (phase 7b): the fields an instance of a COMPONENT may change (validate.js
// exposedProblems); no other sort has any.
const ENTRY_KEYS = ['id', 'name', 'sort', 'doc', 'createdAt', 'exposed'];

/**
 * Validate a PUT body `{ entries, base }`. Returns `{ ok: true, entries, base }` or
 * `{ ok: false, status, body }`. Each entry's `doc` is checked by validateDoc as a page with
 * the entry's id, so a problem's path reads `entries[2].doc.blocks[0].action[0].url`.
 */
export function parseLibrary(body, opts = {}) {
  const b = body && typeof body === 'object' ? body : {};
  let size = Infinity;
  try { size = Buffer.byteLength(JSON.stringify(b.entries ?? null), 'utf8'); } catch { /* cyclic: refused below */ }
  if (size > LIBRARY_LIMITS.bytes) return { ok: false, status: 413, body: { error: 'too_large' } };
  if (typeof b.base !== 'string') return { ok: false, status: 400, body: { error: 'base_required' } };
  if (!Array.isArray(b.entries) || b.entries.length > LIBRARY_LIMITS.entries) return { ok: false, status: 400, body: { error: 'invalid_input', path: 'entries' } };
  const seen = new Set();
  const out = [];
  const problems = [];
  b.entries.forEach((e, i) => {
    const at = `entries[${i}]`;
    const bad = (path, reason) => problems.push({ path: `${at}${path ? `.${path}` : ''}`, reason });
    if (!e || typeof e !== 'object' || Array.isArray(e)) return bad('', 'bad_type');
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.includes(k)) bad(k, 'unknown_field');
    if (typeof e.id !== 'string' || !ID_SHAPE.test(e.id)) bad('id', 'bad_id');
    else if (seen.has(e.id)) bad('id', 'duplicate');
    else seen.add(e.id);
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    if (!name || name.length > LIBRARY_LIMITS.name || /[\x00-\x1f\x7f]/.test(name)) bad('name', 'bad_value');
    if (!PRESET_SORTS.includes(e.sort)) bad('sort', 'bad_value');
    const doc = e.doc;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return bad('doc', 'bad_type');
    // The doc is checked as a page whose id is the entry's (a preset's doc has no page id). A
    // COMPONENT is checked as the definition of itself (phase 7b): an instance of it inside it,
    // directly or through the components it uses, is a loop (`component_cycle`, with the path).
    const selfId = typeof e.id === 'string' && ID_SHAPE.test(e.id) ? e.id : 'preset';
    for (const p of studioDocProblems({ ...doc, id: selfId }, `${at}.doc`, e.sort === 'component' ? { ...opts, selfComponent: selfId } : opts)) problems.push({ path: p.path, reason: p.reason });
    if (e.sort === 'component') exposedProblems(e.exposed, Array.isArray(doc.blocks) ? doc.blocks : [], (path, reason) => problems.push({ path: `${at}.${path}`, reason }), 'exposed');
    else if (e.exposed != null) bad('exposed', 'not_allowed');
    const blocks = Array.isArray(doc.blocks) ? doc.blocks.length : 0;
    if (e.sort === 'background' && blocks) bad('doc.blocks', 'not_allowed');
    if ((e.sort === 'section' || e.sort === 'component') && !blocks) bad('doc.blocks', 'required');
    if (e.sort === 'component' && blocks > 40) bad('doc.blocks', 'too_many');
    let bytes = Infinity;
    try { bytes = JSON.stringify(doc).length; } catch { /* refused */ }
    if (bytes > MAX_DOC_BYTES) bad('doc', 'too_large');
    if (e.createdAt != null && !(typeof e.createdAt === 'string' && e.createdAt.length <= 40)) bad('createdAt', 'bad_value');
    out.push({ id: e.id, name, sort: e.sort, doc: { ...doc, id: e.id }, ...(e.createdAt ? { createdAt: e.createdAt } : {}),
      ...(e.sort === 'component' && Array.isArray(e.exposed) ? { exposed: e.exposed } : {}) });
  });
  if (problems.length) return { ok: false, status: 400, body: studioDocError(problems) };
  return { ok: true, entries: out, base: b.base };
}

// ── One component, edited in the studio's component mode (phase 7b) ──────────────────────
// `/studio/component/:scope/:id` edits ONE definition of a library. Its save is not the whole
// list: it is that entry, from the revision the author opened (`entryRev`), so two authors
// editing two components of the same library both land, and two saving the SAME one get a 409
// (the later one never erases the other silently). The entry is checked by parseLibrary, the
// same rule as a library write.

/** The revision of one entry ('' = no such entry). */
export function entryRev(entry) {
  return entry ? libraryRev([entry]) : '';
}

/**
 * The body of a component save: `{ entry: { name, doc, exposed }, base }`. The id and the sort
 * are the URL's. Returns `{ ok, entry, base }` or `{ ok: false, status, body }`.
 */
export function parseComponentSave(cid, body, opts = {}) {
  const b = body && typeof body === 'object' ? body : {};
  if (typeof b.base !== 'string') return { ok: false, status: 400, body: { error: 'base_required' } };
  const e = b.entry && typeof b.entry === 'object' && !Array.isArray(b.entry) ? b.entry : null;
  if (!e) return { ok: false, status: 400, body: { error: 'invalid_input', path: 'entry' } };
  for (const k of Object.keys(e)) if (!['name', 'doc', 'exposed'].includes(k)) return { ok: false, status: 400, body: studioDocError([{ path: `entry.${k}`, reason: 'unknown_field' }]) };
  const r = parseLibrary({ entries: [{ id: cid, name: e.name, sort: 'component', doc: e.doc, exposed: e.exposed ?? [] }], base: '' }, opts);
  if (!r.ok) {
    if (r.body?.error === 'invalid_studio_doc') {
      const fix = (p) => String(p || '').replace(/^entries\[0\]/, 'entry');
      return { ok: false, status: r.status, body: { ...r.body, path: fix(r.body.path), problems: (r.body.problems || []).map((p) => ({ ...p, path: fix(p.path) })) } };
    }
    return r;
  }
  return { ok: true, entry: r.entries[0], base: b.base };
}

/**
 * Put one component into a stored list, from `base`. Returns `{ status, body }` for a refusal
 * or `{ entries, entry }` for the list to store. A new id is added at the front (base '').
 */
export function replaceComponentEntry(stored, entry, base) {
  const list = Array.isArray(stored) ? stored : [];
  const at = list.findIndex((e) => e.id === entry.id);
  const cur = at >= 0 ? list[at] : null;
  if (cur && cur.sort !== 'component') return { status: 409, body: { error: 'not_a_component' } };
  const now = entryRev(cur);
  if (now !== base) return { status: 409, body: { error: 'conflict', rev: now, entry: cur } };
  const next = { ...entry, ...(cur?.createdAt ? { createdAt: cur.createdAt } : { createdAt: new Date().toISOString() }) };
  if (!cur && list.length >= LIBRARY_LIMITS.entries) return { status: 400, body: { error: 'too_many', max: LIBRARY_LIMITS.entries } };
  const entries = cur ? list.map((e, i) => (i === at ? next : e)) : [next, ...list];
  let size = Infinity;
  try { size = Buffer.byteLength(JSON.stringify(entries), 'utf8'); } catch { /* refused */ }
  if (size > LIBRARY_LIMITS.bytes) return { status: 413, body: { error: 'too_large' } };
  return { entries, entry: next };
}
