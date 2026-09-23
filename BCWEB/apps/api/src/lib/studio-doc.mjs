// What a studio document may carry, checked where it is SAVED.
//
// A studio page (`config.canvases[]` of a project or showcase page, `customSections[].canvas`
// of the home page) is written by a per-project editor and read by every visitor, the admins
// who review it included. The renderer filters every value on the way out
// (apps/web/src/ui/canvas-view.jsx); this refuses the same values on the way IN, so a hostile
// page is an error the author sees at Save rather than a quiet no-op a reviewer never learns
// about. PLAN-STUDIO-2026, phase 0, S1 to S5.
//
// It is a restatement of the web's rules (lib/canvas.js `safeLink` / `buttonTarget` / `ID_SHAPE`,
// lib/css-scope.js `safeCssValue` and the position refusal), because the API image does not
// carry the web's source. Two copies of a rule drift, so test/studio-doc.test.mjs imports the
// web's functions and asserts, over a corpus, that this one refuses at least everything the
// renderer refuses. Phase 3 of the plan replaces both with one package.
//
// LEGACY VALUES. A page saved before these rules may already hold a refused value (an `api`
// button, above all: decision D5 keeps such a page loading, with the button inert). Refusing
// every later save of that config would lock its editor out of an unrelated typo fix, so a
// problem is only refused when it is NEW: the same value, at the same block of the same page,
// already stored, is tolerated (the renderer keeps it inert). Anything added or changed is
// checked.

/** The shape of a block or canvas id: a NAME, because it is interpolated into selectors. */
export const ID_SHAPE = /^[A-Za-z0-9_-]{1,60}$/;
/** A studio page, serialised, may not be larger than this (the home route's old ceiling). */
export const MAX_DOC_BYTES = 300_000;
const ACTIONS = new Set(['link', 'copy', 'scroll', 'download']);
const LEGACY_ACTIONS = { api: 'api_removed' };
const SCROLL_TARGET = /^#[A-Za-z][\w-]{0,79}$/;

/** Same policy as the web's safeLink: path (not `//` or `/\`), anchor, http(s), mailto. */
export function safeLink(raw) {
  const s = typeof raw === 'string'
    ? raw.slice(0, 2000).replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '')
    : '';
  if (!s) return '';
  if (s.startsWith('/')) return /^\/[/\\]/.test(s) ? '' : s;
  if (s.startsWith('#')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^mailto:[^\s]+$/i.test(s)) return s;
  return '';
}

function decodeCssEscapes(input) {
  return String(input)
    .replace(/\\(?:\r\n|[\n\r\f])/g, '')
    .replace(/\\([0-9a-fA-F]{1,6})(\r\n|[ \t\r\n\f])?/g, (all, hex) => {
      const cp = parseInt(hex, 16);
      if (!cp || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '�';
      return String.fromCodePoint(cp);
    })
    .replace(/\\([^\r\n\f0-9a-fA-F])/g, '$1');
}
const CSS_REFUSE = /@import\b|expression\s*\(|behavior\s*:|-moz-binding\s*:|javascript\s*:|vbscript\s*:|@namespace\b/i;
const URL_RE = /url\s*\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
const urlOk = (u) => /^(\/(?!\/)|#|data:image\/(?:png|jpeg|gif|webp|svg\+xml);)/i.test(u.trim());

/**
 * Is this one CSS value (a colour, a background) safe to put in a style attribute?
 * Stricter than the web's safeCssValue in one place, on purpose: any `image-set(` or `src(`
 * is refused here, where the web reads its arguments. Stricter is the safe direction.
 */
export function cssValueOk(input) {
  if (input == null || input === '') return true;
  if (typeof input !== 'string' || input.length > 600) return false;
  const read = decodeCssEscapes(input.trim());
  if (/[;{}<>]/.test(read) || /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(read)) return false;
  if (CSS_REFUSE.test(read)) return false;
  const urls = [...read.matchAll(URL_RE)];
  if (urls.some((m) => !urlOk(m[2]))) return false;
  if ((read.match(/url\s*\(/gi) || []).length !== urls.length) return false;
  if (/(?:^|[^\w-])(?:-webkit-|-ms-|-moz-)?(?:image-set|src)\s*\(/i.test(read)) return false;
  return true;
}

/** Does this stylesheet or inline style pin a box to the viewport (`position: fixed|sticky`)? */
export function pinsToViewport(css) {
  if (typeof css !== 'string' || !css) return false;
  return /position\s*:\s*(?:fixed|sticky)\b/i.test(decodeCssEscapes(css).replace(/\/\*[\s\S]*?\*\//g, ''));
}

/** The author colour fields a block's props may carry, all written into a style or a paint. */
const CSS_PROPS = ['bg', 'border', 'color', 'fill', 'fill2', 'stroke', 'textColor'];

function propsProblems(props, at, push) {
  const p = props && typeof props === 'object' ? props : {};
  for (const k of CSS_PROPS) if (!cssValueOk(p[k])) push(`${at}.${k}`, 'unsafe_css', p[k]);
  if (p.pattern && typeof p.pattern === 'object' && !cssValueOk(p.pattern.color)) push(`${at}.pattern.color`, 'unsafe_css', p.pattern.color);
  if (pinsToViewport(p.style)) push(`${at}.style`, 'position_fixed', p.style);
}

/**
 * Every problem in ONE studio document, as `{ path, reason, key }`.
 *
 * `path` is for the author (`blocks[3].props.action.href`); `key` names the same problem
 * WITHOUT indexes (canvas id, block id, field, value), which is what lets a legacy value be
 * recognised after the blocks were reordered.
 */
export function studioDocProblems(doc, prefix = '') {
  const out = [];
  const c = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : null;
  if (!c) return out;
  const cid = typeof c.id === 'string' ? c.id : '';
  const pre = prefix ? `${prefix}.` : '';
  const add = (path, reason, value, blockId = '') => out.push({
    path: `${pre}${path}`, reason,
    key: `${cid}|${blockId}|${path.replace(/^blocks\[\d+\]\.?/, '')}|${reason}|${JSON.stringify(value ?? null).slice(0, 500)}`,
  });
  let size = 0;
  try { size = JSON.stringify(c).length; } catch { size = Infinity; }
  if (size > MAX_DOC_BYTES) add('', 'too_large', size);
  if (c.id != null && c.id !== '' && !(typeof c.id === 'string' && ID_SHAPE.test(c.id))) add('id', 'bad_id', c.id);
  if (!cssValueOk(c.bg)) add('bg', 'unsafe_css', c.bg);
  if (pinsToViewport(c.css)) add('css', 'position_fixed', '');
  const blocks = Array.isArray(c.blocks) ? c.blocks : [];
  blocks.forEach((b, i) => {
    if (!b || typeof b !== 'object') return;
    const bid = typeof b.id === 'string' ? b.id : '';
    const push = (path, reason, value) => add(`blocks[${i}]${path ? `.${path}` : ''}`, reason, value, bid);
    if (b.id != null && b.id !== '' && !(typeof b.id === 'string' && ID_SHAPE.test(b.id))) push('id', 'bad_id', b.id);
    if (b.link && !safeLink(b.link)) push('link', 'unsafe_url', b.link);
    const p = b.props && typeof b.props === 'object' ? b.props : {};
    propsProblems(p, 'props', push);
    for (const theme of ['light', 'dark']) {
      const o = b.themes?.[theme];
      if (o && typeof o === 'object' && o.props) propsProblems(o.props, `themes.${theme}.props`, push);
    }
    const act = p.action;
    if (act && typeof act === 'object') {
      const type = typeof act.type === 'string' && act.type ? act.type : 'link';
      if (LEGACY_ACTIONS[type]) push('props.action.type', LEGACY_ACTIONS[type], type);
      else if (!ACTIONS.has(type)) push('props.action.type', 'unknown_action', type);
      else if ((type === 'link' || type === 'download') && act.href) {
        const h = safeLink(act.href);
        if (!h || (type === 'download' && !(h.startsWith('/') || /^https?:\/\//i.test(h)))) push('props.action.href', 'unsafe_url', act.href);
      } else if (type === 'scroll' && act.target && !SCROLL_TARGET.test(String(act.target).trim())) push('props.action.target', 'bad_scroll_target', act.target);
    }
    if (Array.isArray(p.items)) {
      p.items.forEach((it, j) => { if (it && it.href && !safeLink(it.href)) push(`props.items[${j}].href`, 'unsafe_url', it.href); });
    }
  });
  return out;
}

/** The studio documents inside a project or showcase config, with the path of each. */
function configDocs(config) {
  const c = config && typeof config === 'object' ? config : {};
  return (Array.isArray(c.canvases) ? c.canvases : []).map((doc, i) => [doc, `canvases[${i}]`]);
}
/** The studio documents inside the home page's custom sections. */
function sectionDocs(sections) {
  return (Array.isArray(sections) ? sections : []).map((s, i) => [s?.canvas, `customSections[${i}].canvas`]).filter(([d]) => d);
}

function newProblems(docs, currentDocs) {
  const known = new Set();
  for (const [doc] of currentDocs) for (const p of studioDocProblems(doc)) known.add(p.key);
  const out = [];
  for (const [doc, prefix] of docs) {
    for (const p of studioDocProblems(doc, prefix)) if (!known.has(p.key)) out.push({ path: p.path, reason: p.reason });
  }
  return out;
}

/** Problems a project/showcase config would ADD over what is stored. [] = accept. */
export function configStudioProblems(incoming, current) {
  return newProblems(configDocs(incoming), configDocs(current));
}

/** Problems a home `customSections` list would ADD over what is stored. [] = accept. */
export function sectionsStudioProblems(incoming, current) {
  return newProblems(sectionDocs(incoming), sectionDocs(current));
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
export async function replaceConfigPage(current, pageId, canvas, base) {
  const cur = current && typeof current === 'object' ? current : {};
  const list = Array.isArray(cur.canvases) ? cur.canvases : [];
  const at = list.findIndex((c) => c && c.id === pageId);
  if (at < 0) {
    // Not stored. From base '' it is a NEW page (added in the config editor and opened in the
    // studio before the form was saved): appended. From any other base it existed when the
    // studio opened and was deleted since: a stale tab must not bring it back.
    if (base !== '') return { status: 404, body: { error: 'page_gone' } };
    const next = { ...cur, canvases: [...list, { ...canvas, id: pageId }] };
    const problems = configStudioProblems(next, cur);
    if (problems.length) return { status: 400, body: studioDocError(problems) };
    return { config: next, rev: await pageRev(next.canvases[next.canvases.length - 1]) };
  }
  const stored = list[at];
  const now = await pageRev(stored);
  if (now !== base) return { status: 409, body: { error: 'conflict', rev: now, current: stored } };
  // The page keeps its id: the URL named it, and a body that renamed it would orphan drafts.
  const next = { ...cur, canvases: list.map((c, i) => (i === at ? { ...canvas, id: pageId } : c)) };
  const problems = configStudioProblems(next, cur);
  if (problems.length) return { status: 400, body: studioDocError(problems) };
  return { config: next, rev: await pageRev(next.canvases[at]) };
}

/** The same for a home section's drawing. The section is switched to drawn, as before. */
export async function replaceSectionCanvas(sections, sectionId, canvas, base) {
  const list = Array.isArray(sections) ? sections : [];
  const at = list.findIndex((s) => s && s.id === sectionId);
  if (at < 0) return { status: 404, body: { error: 'page_gone' } };
  const now = await pageRev(list[at].canvas);
  if (now !== base) return { status: 409, body: { error: 'conflict', rev: now, current: list[at].canvas || null } };
  const next = list.map((s, i) => (i === at ? { ...s, mode: 'canvas', canvas } : s));
  const problems = sectionsStudioProblems(next, list);
  if (problems.length) return { status: 400, body: studioDocError(problems) };
  return { sections: next, rev: await pageRev(canvas) };
}

/** The 400 body every route answers with, so the web reads one shape. */
export function studioDocError(problems) {
  const first = problems[0] || {};
  return { error: 'invalid_studio_doc', path: first.path || '', reason: first.reason || '', problems: problems.slice(0, 20) };
}
