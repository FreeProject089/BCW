// What a studio document may carry, checked where it is SAVED.
//
// A studio page (`config.canvases[]` of a project or showcase page, `customSections[].canvas`
// of the home page) is written by a per-project editor and read by every visitor, the admins
// who review it included. The renderer filters every value on the way out
// (apps/web/src/ui/canvas-view.jsx); this refuses the same values on the way IN, so a hostile
// page is an error the author sees at Save rather than a quiet no-op a reviewer never learns
// about. PLAN-STUDIO-2026, phase 0 (S1 to S5) and phase 3.
//
// THE RULE IS NOT HERE. It is `validateDoc` in the studio package (BCWEB/packages/studio),
// the same module the web renders with. Up to phase 2 this file restated the web's rules
// because the API image did not carry the web's source, and a test compared the two copies
// over a corpus; two copies of a rule drift. The package is copied into the API image next to
// the app (apps/api/Dockerfile: `COPY packages/studio /packages/studio`), where this relative
// import resolves exactly as it does in the repo: /app/src/lib + ../../../../ is the root.
// test/studio-doc.test.mjs asserts that `studioDocProblems` IS the package's function.
//
// LEGACY VALUES. A page saved before these rules may already hold a refused value (an `api`
// button, above all: decision D5 keeps such a page loading, with the button inert). Refusing
// every later save of that config would lock its editor out of an unrelated typo fix, so a
// problem is only refused when it is NEW: the same value, at the same block of the same page,
// already stored, is tolerated (the renderer keeps it inert). Anything added or changed is
// checked.
import {
  validateDoc, safeLink, cssValueOk, pinsToViewport, ID_SHAPE, MAX_DOC_BYTES,
  migrateDocActions, normalizeLinkPolicy, linkPolicyProblems, DEFAULT_LINK_POLICY,
} from '../../../../packages/studio/src/index.js';

export { safeLink, cssValueOk, pinsToViewport, ID_SHAPE, MAX_DOC_BYTES, normalizeLinkPolicy, linkPolicyProblems };

// ── The link policy (PLAN-STUDIO-2026 decision D7, phase 5) ────────────────────────────
// Which hosts a studio `external` step may open: `{ mode: 'block' | 'allow', hosts }`, an
// admin site setting. Read FRESH at every studio save (saves are rare, a stale copy would let
// a host the admin just blocked through), and publicly by GET /site/studio-links, which the
// renderer uses to draw a now-blocked link inert without anybody re-saving the page.
export const LINK_POLICY_KEY = 'studio.links';

/** The stored policy, normalised; the default (every https host) when there is none. */
export async function studioLinkPolicy(p) {
  if (!p?.adminSetting) return normalizeLinkPolicy(DEFAULT_LINK_POLICY);
  const row = await p.adminSetting.findUnique({ where: { key: LINK_POLICY_KEY } }).catch(() => null);
  return normalizeLinkPolicy(row?.value || DEFAULT_LINK_POLICY);
}

/** What every studio validation below is given: `{ links }`. */
export async function studioValidateOpts(p) {
  return { links: await studioLinkPolicy(p) };
}

/**
 * Every problem in ONE studio document, as `{ path, reason, key }`: the package's validator
 * itself, not a wrapper, so nothing can be added or dropped between the two.
 *
 * `path` is for the author (`blocks[3].props.action.href`); `key` names the same problem
 * WITHOUT indexes (canvas id, block id, field, value), which is what lets a legacy value be
 * recognised after the blocks were reordered.
 */
export const studioDocProblems = validateDoc;

/** The studio documents inside a project or showcase config, with the path of each. */
function configDocs(config) {
  const c = config && typeof config === 'object' ? config : {};
  return (Array.isArray(c.canvases) ? c.canvases : []).map((doc, i) => [doc, `canvases[${i}]`]);
}
/** The studio documents inside the home page's custom sections. */
function sectionDocs(sections) {
  return (Array.isArray(sections) ? sections : []).map((s, i) => [s?.canvas, `customSections[${i}].canvas`]).filter(([d]) => d);
}

function newProblems(docs, currentDocs, opts = {}) {
  const known = new Set();
  for (const [doc] of currentDocs) {
    for (const p of studioDocProblems(doc, '', opts)) known.add(p.key);
    // The stored page as the studio will write it back: its legacy `link` / `props.action`
    // as `action` steps (phase 5). A value already stored the old way (an `api` button, D5, a
    // plain http link) is then recognised under its new path, and tolerated like any other
    // legacy value, instead of locking the page's editor out of its next save.
    for (const p of studioDocProblems(migrateDocActions(doc), '', opts)) known.add(p.key);
  }
  const out = [];
  for (const [doc, prefix] of docs) {
    for (const p of studioDocProblems(doc, prefix, opts)) if (!known.has(p.key)) out.push({ path: p.path, reason: p.reason });
  }
  return out;
}

/** Problems a project/showcase config would ADD over what is stored. [] = accept.
 *  `opts` = studioValidateOpts(): the link policy an `external` step is checked against. */
export function configStudioProblems(incoming, current, opts = {}) {
  return newProblems(configDocs(incoming), configDocs(current), opts);
}

/** Problems a home `customSections` list would ADD over what is stored. [] = accept. */
export function sectionsStudioProblems(incoming, current, opts = {}) {
  return newProblems(sectionDocs(incoming), sectionDocs(current), opts);
}

// ── Saving ONE page (the studio's own save) ────────────────────────────────────────────
// The studio used to send back the WHOLE config it read when it opened, with its page put
// back at the INDEX it was opened at: anything saved meanwhile elsewhere (the config editor,
// another studio tab on another page) was erased, and a reorder made it write over the wrong
// page. Now it sends one page, addressed by id, with the revision it started from; the route
// replaces only that page, and refuses (409) when the stored page moved under it.

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
/** A page's revision: a hash of its content, key order ignored (JSONB reorders keys). '' = no page. */
export async function pageRev(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(stable(doc)).digest('hex').slice(0, 24);
}
/** `{ [pageId]: rev }` for every studio page of a project/showcase config. */
export async function configRevs(config) {
  const out = {};
  for (const [doc] of configDocs(config)) if (doc && typeof doc.id === 'string') out[doc.id] = await pageRev(doc);
  return out;
}
/** `{ [sectionId]: rev }` for the home page's sections (a section with no drawing yet: ''). */
export async function sectionRevs(sections) {
  const out = {};
  for (const s of Array.isArray(sections) ? sections : []) if (s && typeof s.id === 'string') out[s.id] = await pageRev(s.canvas);
  return out;
}

/** The body of a one-page save. The page itself is checked by studioDocProblems. */
export function parsePageSave(body) {
  const b = body && typeof body === 'object' ? body : {};
  const canvas = b.canvas && typeof b.canvas === 'object' && !Array.isArray(b.canvas) ? b.canvas : null;
  if (!canvas) return { ok: false, error: 'invalid_input' };
  const base = typeof b.base === 'string' ? b.base.slice(0, 64) : null;
  if (base === null) return { ok: false, error: 'base_required' };
  return { ok: true, canvas, base };
}

/**
 * Put one page back into a project/showcase config, by id. Returns
 * `{ status, body }` for a refusal, or `{ config, rev }` for the config to store.
 */
export async function replaceConfigPage(current, pageId, canvas, base, opts = {}) {
  const cur = current && typeof current === 'object' ? current : {};
  const list = Array.isArray(cur.canvases) ? cur.canvases : [];
  const at = list.findIndex((c) => c && c.id === pageId);
  if (at < 0) {
    // Not stored. From base '' it is a NEW page (added in the config editor and opened in the
    // studio before the form was saved): appended. From any other base it existed when the
    // studio opened and was deleted since: a stale tab must not bring it back.
    if (base !== '') return { status: 404, body: { error: 'page_gone' } };
    const next = { ...cur, canvases: [...list, { ...canvas, id: pageId }] };
    const problems = configStudioProblems(next, cur, opts);
    if (problems.length) return { status: 400, body: studioDocError(problems) };
    return { config: next, rev: await pageRev(next.canvases[next.canvases.length - 1]) };
  }
  const stored = list[at];
  const now = await pageRev(stored);
  if (now !== base) return { status: 409, body: { error: 'conflict', rev: now, current: stored } };
  // The page keeps its id: the URL named it, and a body that renamed it would orphan drafts.
  const next = { ...cur, canvases: list.map((c, i) => (i === at ? { ...canvas, id: pageId } : c)) };
  const problems = configStudioProblems(next, cur, opts);
  if (problems.length) return { status: 400, body: studioDocError(problems) };
  return { config: next, rev: await pageRev(next.canvases[at]) };
}

/** The same for a home section's drawing. The section is switched to drawn, as before. */
export async function replaceSectionCanvas(sections, sectionId, canvas, base, opts = {}) {
  const list = Array.isArray(sections) ? sections : [];
  const at = list.findIndex((s) => s && s.id === sectionId);
  if (at < 0) return { status: 404, body: { error: 'page_gone' } };
  const now = await pageRev(list[at].canvas);
  if (now !== base) return { status: 409, body: { error: 'conflict', rev: now, current: list[at].canvas || null } };
  const next = list.map((s, i) => (i === at ? { ...s, mode: 'canvas', canvas } : s));
  const problems = sectionsStudioProblems(next, list, opts);
  if (problems.length) return { status: 400, body: studioDocError(problems) };
  return { sections: next, rev: await pageRev(canvas) };
}

/** The 400 body every route answers with, so the web reads one shape. */
export function studioDocError(problems) {
  const first = problems[0] || {};
  return { error: 'invalid_studio_doc', path: first.path || '', reason: first.reason || '', problems: problems.slice(0, 20) };
}
