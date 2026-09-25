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
import { studioDocError, libraryEntryProblems } from './studio-doc.mjs';

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

// An entry's fields (`exposed`, phase 7b: a COMPONENT's fields a copy may change) are checked by
// the studio package's libraryEntryProblems (io.js), below.

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
    // One entry's rule is the studio package's (io.js libraryEntryProblems), the SAME function
    // an imported component or preset is checked by before it is offered here (phase 7c): the
    // fields, the name, the sort, the doc through validateDoc (a COMPONENT as the definition of
    // itself, so an instance of it inside is `component_cycle`), the exposed fields, the blocks a
    // sort needs or may not have, the size. The list's own rule (ids unique) stays here.
    for (const p of libraryEntryProblems(e, at, opts)) problems.push({ path: p.path, reason: p.reason });
    if (!e || typeof e !== 'object' || Array.isArray(e)) return;
    if (typeof e.id === 'string' && seen.has(e.id)) problems.push({ path: `${at}.id`, reason: 'duplicate' });
    else if (typeof e.id === 'string') seen.add(e.id);
    const doc = e.doc;
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return;
    const name = typeof e.name === 'string' ? e.name.trim() : '';
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
