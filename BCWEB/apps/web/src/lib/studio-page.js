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

/** `/studio/:kind/:id/:index` — built in one place so the editor and the page cannot disagree. */
export function studioPath(kind, id, index) {
  const k = STUDIO_KINDS.includes(kind) ? kind : 'project';
  const base = `/studio/${k}/${encodeURIComponent(String(id))}`;
  return index == null ? base : `${base}/${Math.max(0, Number(index) || 0)}`;
}

/** The URL parameters, made sense of. `index` is null when the route left it out. */
export function parseStudioParams(params = {}) {
  const kind = STUDIO_KINDS.includes(params.kind) ? params.kind : null;
  const id = typeof params.id === 'string' && params.id.trim() ? params.id.trim().slice(0, 80) : null;
  const n = params.index == null || params.index === '' ? null : Number(params.index);
  const index = n == null ? null : (Number.isInteger(n) && n >= 0 ? n : NaN);
  return { kind, id, index };
}

/** Where the editor hands the page its in-memory config, and where the page keeps a draft. */
export const handoffKey = (kind, id) => `bcw_studio_handoff:${kind}:${id}`;
export const draftKey = (kind, id, index) => `bcw_studio_draft:${kind}:${id}:${index}`;

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
    list[index] = { ...list[index], canvas: { ...(list[index].canvas || {}), ...canvas } };
    return { ...c, customSections: list };
  }
  const list = Array.isArray(c.canvases) ? c.canvases.slice() : [];
  if (index < 0 || index >= list.length) return c;
  list[index] = { ...list[index], ...canvas };
  return { ...c, canvases: list };
}

/** The zoom levels the +/- buttons walk. 'fit' sits wherever the fit scale falls. */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];

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
