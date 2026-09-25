// The studio as a page: what the route carries, where the draft lives, how zoom steps.
//
// Pure, tested in test/studio-page.test.mjs. pages/studio.jsx owns the fetch, the save and
// the navigation; this file is the arithmetic and the naming those lean on.

/** The three things a studio URL can point at.
 *
 *  `home` is the landing page, and it is shaped differently from the other two on purpose. A
 *  project keeps its drawn pages in `config.canvases`; the home page keeps a list of sections
 *  an admin wrote, `config.customSections`, of which any one can be drawn instead of written.
 *  So the index means "the nth custom section" there, and the canvas lives on that section
 *  rather than in a list of its own. Two shapes, one route, and the difference is confined to
 *  canvasAt/withCanvasAt below. */
export const STUDIO_KINDS = ['project', 'showcase', 'home'];

/** The shape of a page id in a URL: the studio package's ID_SHAPE. */
const PAGE_REF = /^[A-Za-z0-9_-]{1,60}$/;
const DIGITS = /^[0-9]+$/;

/**
 * `/studio/:kind/:id/:page` — built in one place so the editor and the page cannot disagree.
 *
 * Phase 6: `page` is the page's ID (a string), which stays right whatever happens to the order
 * of the pages. A NUMBER still builds the old index form, which is what links made before
 * phase 6 look like; the studio resolves one (resolvePageRef) and replaces the URL with the id.
 */
export function studioPath(kind, id, page) {
  const k = STUDIO_KINDS.includes(kind) ? kind : 'project';
  const base = `/studio/${k}/${encodeURIComponent(String(id))}`;
  if (page == null) return base;
  if (typeof page === 'string') return `${base}/${encodeURIComponent(page)}`;
  return `${base}/${Math.max(0, Number(page) || 0)}`;
}

// ── Component mode (PLAN-STUDIO-2026 phase 7b) ─────────────────────────────────────────
// `/studio/component/:scope/:id`: the studio on ONE component definition of a library. The
// scope segment names the library: `site`, `project.<key>` or `showcase.<id>` (a project key
// and a showcase id are names, so the dot cannot be part of either).
const COMPONENT_SEG = /^(site|project\.[a-z][a-z0-9-]{1,30}|showcase\.[A-Za-z0-9_-]{1,60})$/;

/** The component mode address of component `cid` in library (`scope`, `ref`). */
export function componentPath(scope, ref, cid) {
  const seg = scope === 'site' ? 'site' : `${scope === 'showcase' ? 'showcase' : 'project'}.${ref}`;
  return `/studio/component/${encodeURIComponent(seg)}/${encodeURIComponent(String(cid))}`;
}

/** The component mode parameters: `{ scope, ref, cid }`, or null when they name nothing. */
export function parseComponentParams(params = {}) {
  const seg = typeof params.scope === 'string' ? params.scope : '';
  const cid = typeof params.id === 'string' ? params.id : '';
  if (!COMPONENT_SEG.test(seg) || !PAGE_REF.test(cid)) return null;
  if (seg === 'site') return { scope: 'site', ref: '', cid };
  const dot = seg.indexOf('.');
  return { scope: seg.slice(0, dot), ref: seg.slice(dot + 1), cid };
}

/** Where component mode's Back goes: the studio page it was opened from, else the admin. A
 *  studio address only (never another site, never `//host`): the value comes from the URL. */
export function componentBack(from) {
  const f = typeof from === 'string' ? from : '';
  return /^\/studio\/(project|showcase)\/[A-Za-z0-9_%.-]+(\/[A-Za-z0-9_%-]+)?$/.test(f) ? f : '/admin';
}

/**
 * The URL parameters, made sense of. `page` is the raw last segment (a page id, or the digits
 * of an old index link), `index` its number when it is only digits, both null when the route
 * left it out; `bad` when the segment can be neither (the page says "not a studio address").
 * The route names the segment `page`; `index` is still read, for a caller from before phase 6.
 */
export function parseStudioParams(params = {}) {
  const kind = STUDIO_KINDS.includes(params.kind) ? params.kind : null;
  const id = typeof params.id === 'string' && params.id.trim() ? params.id.trim().slice(0, 80) : null;
  const raw = params.page != null ? params.page : params.index;
  const seg = raw == null || raw === '' ? null : String(raw);
  const bad = seg != null && !PAGE_REF.test(seg);
  const page = seg == null || bad ? null : seg;
  const index = page != null && DIGITS.test(page) ? Number(page) : null;
  return { kind, id, page, index, bad };
}

/**
 * The page a URL segment names, as `{ pageId, legacy }`: `legacy` when it was an old index
 * link, which the studio then replaces with the id. `pageId` null = nothing there.
 *
 * An id wins over an index: every link the studio makes names an id. Digits that are not an id
 * are an index into the order the pages had when the link was made: `studioIndexIds`, the
 * order the API froze the first time the page list changed shape from the studio (phase 6),
 * or the current order when it never did. The home page: its sections, by index as before.
 */
export function resolvePageRef(config, ref, kind = 'project') {
  if (ref == null || ref === '') return { pageId: null, legacy: false };
  const c = config && typeof config === 'object' ? config : {};
  const ids = pageEntries(c, kind).map((x) => x.id);
  const r = String(ref);
  if (ids.includes(r)) return { pageId: r, legacy: false };
  if (!DIGITS.test(r)) return { pageId: null, legacy: false };
  const n = Number(r);
  if (kind !== 'home' && Array.isArray(c.studioIndexIds)) {
    const frozen = c.studioIndexIds[n];
    // The page the link was made for, if it still exists; deleted since, it opens nothing
    // rather than whichever page slid into its place.
    if (typeof frozen === 'string') return { pageId: ids.includes(frozen) ? frozen : null, legacy: true };
    if (n < c.studioIndexIds.length) return { pageId: null, legacy: true };
  }
  return { pageId: n < ids.length ? ids[n] : null, legacy: true };
}

/**
 * The pages of a target, in order, as `{ id, title, hidden, blocks, drawn }`: a project's or
 * showcase's `canvases`, or the home page's custom sections (whose id is the SECTION's).
 */
export function pageEntries(config, kind = 'project') {
  const c = config && typeof config === 'object' ? config : {};
  if (kind === 'home') {
    return (Array.isArray(c.customSections) ? c.customSections : []).map((sec, i) => ({
      id: typeof sec?.id === 'string' && sec.id ? sec.id : `s${i}`,
      title: String(sec?.title?.en || sec?.title?.fr || ''), hidden: sec?.enabled === false,
      blocks: Array.isArray(sec?.canvas?.blocks) ? sec.canvas.blocks.length : 0, drawn: sec?.mode === 'canvas',
    }));
  }
  return (Array.isArray(c.canvases) ? c.canvases : []).filter((cv) => cv && typeof cv.id === 'string' && cv.id).map((cv) => ({
    id: cv.id, title: String(cv.title || ''), hidden: cv.hidden === true,
    blocks: Array.isArray(cv.blocks) ? cv.blocks.length : 0, drawn: true,
  }));
}

/** The index of a page id in its target's list, or -1. */
export function pageIndexOf(config, pageId, kind = 'project') {
  return pageEntries(config, kind).findIndex((x) => x.id === pageId);
}

/** Where the editor hands the page its in-memory config, and where the page keeps a draft. */
export const handoffKey = (kind, id) => `bcw_studio_handoff:${kind}:${id}`;
// Phase 6: `page` is the page's id, so a draft follows its page when the pages are reordered.
export const draftKey = (kind, id, page) => `bcw_studio_draft:${kind}:${id}:${page}`;

/** The canvas a studio URL points at, or null when the index names nothing. */
export function canvasAt(config, index, kind = 'project') {
  const c = config && typeof config === 'object' ? config : {};
  if (kind === 'home') {
    const list = Array.isArray(c.customSections) ? c.customSections : [];
    const row = index >= 0 && index < list.length ? list[index] : null;
    return row?.canvas || null;
  }
  const list = Array.isArray(c.canvases) ? c.canvases : [];
  return index >= 0 && index < list.length ? list[index] : null;
}

/** The canvas a home section STARTS from when it has never been drawn.
 *
 *  `canvasAt` answers null for a section with no canvas, on purpose: nothing has been drawn
 *  there. But the studio page read that null as "no page at this position" and showed the
 *  chooser with a warning, so a section switched to Drawn could never be opened, and the
 *  only way to draw one was to already have drawn it. This is the page it opens on instead.
 *
 *  The id is derived from the section's, not random: the draft kept in sessionStorage is
 *  matched to the canvas by id, and a fresh random one on every open would throw that draft
 *  away each time. Null for anything that is not an existing home section. */
export function blankCanvasAt(config, index, kind = 'project') {
  if (kind !== 'home') return null;
  const c = config && typeof config === 'object' ? config : {};
  const list = Array.isArray(c.customSections) ? c.customSections : [];
  const row = index >= 0 && index < list.length ? list[index] : null;
  if (!row) return null;
  const title = String(row.title?.en || row.title?.fr || '').slice(0, 80);
  return { id: `cv-${String(row.id || index)}`.slice(0, 60), title, blocks: [] };
}

/** The config with one canvas replaced. Everything else is untouched — this is the same write
 *  the modal made through `patch(studioAt, next)`, moved out of the editor.
 *
 *  Out-of-range returns the config unchanged rather than appending: an index that names
 *  nothing is a stale bookmark, and the answer to a stale bookmark is not to create a page. */
export function withCanvasAt(config, index, canvas, kind = 'project') {
  const c = config && typeof config === 'object' ? config : {};
  if (kind === 'home') {
    const list = Array.isArray(c.customSections) ? c.customSections.slice() : [];
    if (index < 0 || index >= list.length) return c;
    // The section keeps everything else it carries: its title, its written body, whether it
    // is on, where it sits. Drawing a section does not throw away the words in it, so an
    // admin can switch back.
    // `mode: 'canvas'` as well: saving a drawing from the studio means the drawing is what
    // the page shows. Without it a section opened by URL (no handoff from the form) stayed
    // `md`, the save succeeded, and the home page went on rendering the Markdown.
    list[index] = { ...list[index], mode: 'canvas', canvas: over(list[index].canvas, canvas) };
    return { ...c, customSections: list };
  }
  const list = Array.isArray(c.canvases) ? c.canvases.slice() : [];
  if (index < 0 || index >= list.length) return c;
  list[index] = over(list[index], canvas);
  return { ...c, canvases: list };
}

/** One canvas written over another. A v2 document (studio phase 3) REPLACES the stored one,
 *  keeping only its id: merged, the v1 `height` / `phoneBoard` of the old page would ride
 *  along next to the v2 frames, and the API refuses a v2 page carrying v1 fields. A v1 one
 *  still merges, as before. */
function over(prev, canvas) {
  const p = prev && typeof prev === 'object' ? prev : {};
  return canvas && canvas.v === 2 ? { ...(p.id ? { id: p.id } : {}), ...canvas } : { ...p, ...canvas };
}

/** The zoom levels the +/- buttons walk. 'fit' sits wherever the fit scale falls. The range
 *  is the board camera's, 10 % to 400 % (studio phase 3, ZOOM_MIN / ZOOM_MAX in the package). */
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** The next step up or down from the current zoom ('fit' resolves to the fit scale first). */
export function stepZoom(current, dir, fitScale = 1) {
  const cur = current === 'fit' ? Number(fitScale) || 1 : Number(current) || 1;
  if (dir > 0) {
    const next = ZOOM_STEPS.find((z) => z > cur + 1e-6);
    return next == null ? ZOOM_STEPS[ZOOM_STEPS.length - 1] : next;
  }
  const below = ZOOM_STEPS.filter((z) => z < cur - 1e-6);
  return below.length ? below[below.length - 1] : ZOOM_STEPS[0];
}

/** "Saved", "Unsaved changes", … — one word for the top bar, from the two facts it has. */
export function saveState({ dirty, saving, error }) {
  if (saving) return 'saving';
  if (error) return 'error';
  return dirty ? 'dirty' : 'saved';
}

// ── Loading for editing, saving one page ────────────────────────────────────────────────
// The studio used to read a project through the PUBLIC `GET /projects/:key`: a grantee of
// project A could open, and edit, project B's studio, and only the save said no. It loads
// through the admin routes now, which ask exactly what saving asks. And it saves ONE page, by
// id, from the revision it opened (the server answers 409 when that page moved meanwhile),
// instead of the whole config it read at open time, put back at an index.

/** Where the studio reads a target FOR EDITING. Never the public route. */
export function studioLoadPath(kind, id) {
  // The home page is ONE setting; the studio reads it through its own door, which asks for
  // manage_studio (not the ADMIN role) and carries `studioRevs`.
  if (kind === 'home') return '/admin/studio/home';
  const ref = encodeURIComponent(String(id));
  return kind === 'showcase' ? `/admin/showcase/${ref}/studio` : `/admin/projects/${ref}/studio`;
}

/** The PUT that saves ONE page: `{ path, body }`. `saveId` is the showcase row id (the URL
 *  may carry its slug). A home section is saved through the studio's home door, by section id. */
export function studioSaveRequest(kind, saveId, pageId, canvas, base) {
  const pid = encodeURIComponent(String(pageId));
  if (kind === 'home') return { path: `/admin/studio/home/sections/${pid}`, body: { canvas, base } };
  const ref = encodeURIComponent(String(saveId));
  const path = kind === 'showcase' ? `/admin/showcase/${ref}/studio/pages/${pid}` : `/admin/projects/${ref}/studio/pages/${pid}`;
  return { path, body: { canvas, base } };
}

/** The stable id of the page at an index: the canvas id, or for the home page the SECTION id
 *  (a section that was never drawn has no canvas yet, and its id is what the route names). */
export function pageIdAt(config, index, kind = 'project') {
  const c = config && typeof config === 'object' ? config : {};
  const list = kind === 'home' ? c.customSections : c.canvases;
  const row = Array.isArray(list) && index >= 0 && index < list.length ? list[index] : null;
  return row && typeof row.id === 'string' && row.id ? row.id : null;
}

// ── Several pages (phase 6) ─────────────────────────────────────────────────────────────
// The page list's own requests: create, delete, reorder. The server answers each on the config
// as stored NOW (routes/projects.mjs, routes/showcase.mjs); nothing here sends a whole config.

/** Where a target's page list lives: `{ pages, order }`, or null for the home page, whose
 *  sections are made and ordered on the Home page screen, not in the studio. */
export function studioListPaths(kind, saveId) {
  if (kind !== 'project' && kind !== 'showcase') return null;
  const ref = encodeURIComponent(String(saveId));
  const base = kind === 'showcase' ? `/admin/showcase/${ref}/studio` : `/admin/projects/${ref}/studio`;
  return { pages: `${base}/pages`, order: `${base}/order` };
}

/** A fresh page id, in the package's ID_SHAPE. */
export function newPageId(now = Date.now(), rand = Math.random) {
  return `c${now.toString(36)}${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')}`.slice(0, 60);
}

/** The config with one page (by id) replaced; the home page's by section id. Unknown id: unchanged. */
export function withCanvasById(config, pageId, canvas, kind = 'project') {
  const at = pageIndexOf(config, pageId, kind);
  return at < 0 ? (config && typeof config === 'object' ? config : {}) : withCanvasAt(config, at, canvas, kind);
}
/** The stored page of an id, or for a home section never drawn, the blank it starts from. */
export function canvasById(config, pageId, kind = 'project') {
  const at = pageIndexOf(config, pageId, kind);
  if (at < 0) return null;
  return canvasAt(config, at, kind) || blankCanvasAt(config, at, kind);
}
/** The config with a page added after `after` ('' = at the end), as the server does it. */
export function withPageInserted(config, canvas, after = '') {
  const c = config && typeof config === 'object' ? config : {};
  const list = Array.isArray(c.canvases) ? c.canvases.slice() : [];
  const i = after ? list.findIndex((x) => x && x.id === after) : -1;
  list.splice(i < 0 ? list.length : i + 1, 0, canvas);
  return { ...c, canvases: list };
}
/** The config without a page. */
export function withPageRemoved(config, pageId) {
  const c = config && typeof config === 'object' ? config : {};
  return { ...c, canvases: (Array.isArray(c.canvases) ? c.canvases : []).filter((x) => !x || x.id !== pageId) };
}
/** The config with its pages in `order` (ids); pages the order does not name keep their place at the end. */
export function withPageOrder(config, order) {
  const c = config && typeof config === 'object' ? config : {};
  const list = Array.isArray(c.canvases) ? c.canvases : [];
  const byId = new Map(list.filter((x) => x && x.id).map((x) => [x.id, x]));
  const out = (Array.isArray(order) ? order : []).map((x) => byId.get(x)).filter(Boolean);
  for (const x of list) if (!out.includes(x)) out.push(x);
  return { ...c, canvases: out };
}
/** The order after moving one page up (-1) or down (+1); the same order when it cannot move. */
export function movedOrder(ids, pageId, dir) {
  const list = Array.isArray(ids) ? ids.slice() : [];
  const i = list.indexOf(pageId);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}
