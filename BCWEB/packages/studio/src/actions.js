// What a block does when it is pressed: a CLOSED vocabulary (PLAN-STUDIO-2026, 2.5 and phase 5).
//
// Every block of a studio page may carry `action`, a list of up to five STEPS. A step is data,
// interpreted by fixed code (the renderer, apps/web/src/ui/canvas-view.jsx): never a script,
// never a URL or a request the author wrote freely. "Entirely custom" means composing steps
// from this list, for example copy a code, then reveal a block that says "Copied".
//
//   navigate  { to }                an internal path: `/`, not `//`, not `/\`, no scheme, read the
//                                   way a browser reads it (new URL + origin compare), encoded
//                                   variants of `//` refused too
//   page      { canvasId }          another studio page of the same target (its tab `c-<id>`)
//   external  { url }               https: only, the host checked against the site's link policy
//                                   (an admin setting, see LINK POLICY below); opened in a new tab
//                                   with rel="noopener noreferrer", behind a "leaving" screen
//   mailto    { address }           an address and nothing else (no subject, no body, no cc)
//   scroll    { target }            a block id of this page, or `#top`. Never a CSS selector
//   reveal    { target, mode }      show / hide / toggle a block of this page
//   copy      { text }              up to 2 000 characters to the clipboard, with visible feedback
//   download  { file } | { asset }  a same-site upload (/uploads/..., /api/media/...) or a platform
//                                   asset key (/api/assets/<key>), never a URL from elsewhere
//   submit    { endpoint, fields }  `endpoint` is a KEY of SUBMIT_REGISTRY below: the registry,
//                                   not the author, fixes the method, the path and the body; the
//                                   author may only fill the fields the entry lets them fix
//   theme     { mode }              light / dark / toggle, the reader's theme
//
// Reserved, NOT live: `modal` and `tab` belong to phase 7 (containers). A page that carries one
// is refused at save (`reserved_action`) and rendered inert, so nobody ships a button that
// silently waits for a feature. The old `api` action (S2, decision D5) stays removed: read,
// shown in red in the editor, inert for visitors, refused if newly written.
//
// Composition rule: at most ONE step that leaves the block's hands (navigate, page, external,
// mailto, download, submit) and it must be the LAST step. Anything after a navigation would never
// run, and a navigation before a submit would abandon the form it just opened.
//
// One module, two readers, like the page background (background.js):
//   · `actionProblems` is STRICT (validateDoc, and so the API at save): every problem with the
//     path of the field, e.g. `blocks[3].action[1].url: host_not_allowed`.
//   · `normalizeAction` + `planAction` are TOLERANT (the renderer): whatever is stored becomes
//     either a runnable plan or an INERT one with the reason, never an exception and never a
//     half-checked href.
// Both call the same per-step check (`stepProblems`), so what the API refuses is exactly what
// the page would have rendered inert.

/** The live step types, in the order the editor offers them. */
export const ACTION_TYPES = ['navigate', 'page', 'external', 'mailto', 'scroll', 'reveal', 'copy', 'download', 'submit', 'theme'];
/** Named by the plan for phase 7, reserved now: refused at save, inert on the page. */
export const RESERVED_ACTIONS = ['modal', 'tab'];
/** Types a stored page may carry that are no longer honoured, and why. */
export const REMOVED_ACTIONS = { api: 'api_removed' };
/** A block does at most this many things in a row. */
export const MAX_STEPS = 5;
/** Steps that make the block a real link (`<a href>`). */
export const NAV_TYPES = ['navigate', 'page', 'external', 'mailto', 'download'];
/** Steps that end the sequence: the navigations, and a submit (it opens a form). */
export const TERMINAL_TYPES = [...NAV_TYPES, 'submit'];
/** The fields each step type may carry, besides `type`. */
export const STEP_FIELDS = {
  navigate: ['to'], page: ['canvasId'], external: ['url'], mailto: ['address'],
  scroll: ['target'], reveal: ['target', 'mode'], copy: ['text'], download: ['file', 'asset'],
  submit: ['endpoint', 'fields'], theme: ['mode'],
};
export const REVEAL_MODES = ['toggle', 'show', 'hide'];
export const THEME_MODES = ['toggle', 'light', 'dark'];
/** What `copy` may put on the clipboard. */
export const COPY_MAX = 2000;
/** Any URL-shaped field. */
export const URL_MAX = 2000;
/** Where a `download` file may live: this site's own uploads. */
export const DOWNLOAD_PREFIXES = ['/uploads/', '/api/media/'];
/** A platform asset key, the shape routes/platform-assets.mjs accepts. */
export const ASSET_KEY = /^[a-zA-Z0-9._-]{1,64}$/;
/** A block or page id. The same shape as canvas.js ID_SHAPE (a test asserts it): restated here
 *  because canvas.js imports this module, not the other way round. */
const ID = /^[A-Za-z0-9_-]{1,60}$/;

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

// ── URLs ──────────────────────────────────────────────────────────────────────────────
/** The characters a URL may be written with (RFC 3986): no space, no backslash, no control
 *  character, no quote or angle bracket. A value that needs the browser's cleaning to be a URL
 *  (a tab inside `java\tscript:`, a leading space, a `\` a browser reads as `/`) is refused
 *  instead of cleaned: an author has no reason to type one. */
const URL_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;
/** An origin nobody owns, to let the URL parser resolve a path the way a browser would. */
const PROBE_ORIGIN = 'https://studio.invalid';

/** Decode up to three times; null if a layer does not decode. */
function decodings(s) {
  const out = [];
  let cur = s;
  for (let i = 0; i < 3; i++) {
    let d;
    try { d = decodeURIComponent(cur); } catch { return null; }
    if (d === cur) break;
    out.push(d); cur = d;
  }
  return out;
}

/**
 * An internal path, or '' when the value is not one. Starts with `/`; not `//` or `/\`
 * (protocol-relative, somebody else's site) either as typed or once percent-decoded; only URL
 * characters; and the browser's own reading of it (`new URL(to, origin)`) stays on the origin.
 */
export function internalPath(raw) {
  const s = str(raw);
  if (!s || s.length > URL_MAX || !URL_CHARS.test(s)) return '';
  if (s[0] !== '/' || /^\/[/\\]/.test(s)) return '';
  const dec = decodings(s);
  if (!dec) return '';
  for (const d of dec) if (/^\/[/\\]/.test(d) || /[\x00-\x1f\x7f\\]/.test(d)) return '';
  let u;
  try { u = new URL(s, PROBE_ORIGIN); } catch { return ''; }
  return u.origin === PROBE_ORIGIN ? s : '';
}

const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
/** A host name as the policy stores it: lower case, no `*.`, no port, no trailing dot. '' if not one. */
export function normalizeHost(raw) {
  let s = str(raw).trim().toLowerCase();
  if (s.startsWith('*.')) s = s.slice(2);
  if (s.endsWith('.')) s = s.slice(0, -1);
  return HOST.test(s) ? s : '';
}

// ── LINK POLICY (decision D7) ──────────────────────────────────────────────────────────
// Which hosts an `external` step may open. An admin site setting (AdminSetting `studio.links`,
// edited at /admin?s=settings, read publicly at GET /api/site/studio-links):
//   mode 'block'  every https host except the listed ones (and their subdomains). DEFAULT, with
//                 an empty list: D7 decided "all https, behind a 'you are leaving' screen, plus
//                 a blocklist", because an empty allowlist would make the feature unusable.
//   mode 'allow'  only the listed hosts (and their subdomains).
// The API checks it at save; the renderer checks it again when it draws (a host blocked after
// the page was saved goes inert without anybody re-saving the page).
export const LINK_POLICY_MODES = ['block', 'allow'];
export const MAX_POLICY_HOSTS = 200;
export const DEFAULT_LINK_POLICY = Object.freeze({ mode: 'block', hosts: Object.freeze([]) });

/** Whatever is stored, as a policy. Unknown mode = 'block'; bad hosts dropped; deduplicated. */
export function normalizeLinkPolicy(raw) {
  const o = isObj(raw) ? raw : {};
  const mode = LINK_POLICY_MODES.includes(o.mode) ? o.mode : 'block';
  const hosts = [];
  for (const h of Array.isArray(o.hosts) ? o.hosts : []) {
    const n = normalizeHost(h);
    if (n && !hosts.includes(n)) hosts.push(n);
    if (hosts.length >= MAX_POLICY_HOSTS) break;
  }
  return { mode, hosts };
}

/** Every problem in a policy an admin is about to SAVE: `{ path, reason }`. [] = accept. */
export function linkPolicyProblems(raw) {
  const out = [];
  if (!isObj(raw)) return [{ path: '', reason: 'bad_type' }];
  for (const k of Object.keys(raw)) if (k !== 'mode' && k !== 'hosts') out.push({ path: k, reason: 'unknown_field' });
  if (!LINK_POLICY_MODES.includes(raw.mode)) out.push({ path: 'mode', reason: 'bad_value' });
  if (!Array.isArray(raw.hosts)) out.push({ path: 'hosts', reason: 'bad_type' });
  else {
    if (raw.hosts.length > MAX_POLICY_HOSTS) out.push({ path: 'hosts', reason: 'too_many' });
    raw.hosts.forEach((h, i) => { if (!normalizeHost(h)) out.push({ path: `hosts[${i}]`, reason: 'bad_value' }); });
  }
  return out;
}

/** May an `external` step open this host under this policy? `host` already normalised. */
export function hostAllowed(host, policy) {
  const p = policy && LINK_POLICY_MODES.includes(policy.mode) && Array.isArray(policy.hosts) ? policy : normalizeLinkPolicy(policy);
  const listed = p.hosts.some((h) => host === h || host.endsWith(`.${h}`));
  return p.mode === 'allow' ? listed : !listed;
}

/**
 * An external URL: `{ href, host, reason }`, reason '' when it may be opened. https only, a real
 * host name (no IP literal, no credentials in the URL), within the site's link policy.
 */
export function externalUrl(raw, policy = DEFAULT_LINK_POLICY) {
  const s = str(raw);
  const no = (reason) => ({ href: '', host: '', reason });
  if (!s) return no('bad_value');
  if (s.length > URL_MAX || !URL_CHARS.test(s)) return no('unsafe_url');
  if (/^http:\/\//i.test(s)) return no('https_only');
  if (!/^https:\/\//i.test(s)) return no('unsafe_url');
  let u;
  try { u = new URL(s); } catch { return no('unsafe_url'); }
  if (u.protocol !== 'https:' || u.username || u.password) return no('unsafe_url');
  const host = normalizeHost(u.hostname);
  if (!host || host !== u.hostname) return no('unsafe_url');
  if (!hostAllowed(host, policy)) return { href: '', host, reason: 'host_not_allowed' };
  return { href: u.href, host, reason: '' };
}

const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
/** A mail address, or ''. Nothing else rides in the `mailto:` it becomes. */
export function mailAddress(raw) {
  const s = str(raw);
  return s.length <= 254 && EMAIL.test(s) ? s : '';
}

/** A same-site upload path a `download` may point at, or ''. */
export function downloadPath(raw) {
  const s = str(raw);
  if (!s || s.length > URL_MAX) return '';
  if (!DOWNLOAD_PREFIXES.some((p) => s.startsWith(p))) return '';
  if (!/^[A-Za-z0-9._~\-/%]+$/.test(s)) return '';
  const dec = decodings(s);
  if (!dec) return '';
  for (const v of [s, ...dec]) if (/\/\/|\\|(^|\/)\.\.?(\/|$)|[\x00-\x1f\x7f]/.test(v)) return '';
  return s;
}

// ── SUBMIT: the registry ──────────────────────────────────────────────────────────────
// A `submit` step names one of these KEYS and nothing else. Each entry fixes the method, the
// path, the body and which fields the AUTHOR may fix (`author`) and which the VISITOR types in
// a small fixed form (`visitor`). Only public endpoints that already existed, each with its own
// server-side rate limit; no admin route and no `/me/*` route may ever be added here (a test
// asserts it). The renderer builds every request through `submitRequest`, so a click cannot
// reach any other URL.
const F = (kind, extra = {}) => Object.freeze({ kind, ...extra });
export const SUBMIT_REGISTRY = Object.freeze({
  // routes/newsletter.mjs: double opt-in, the address gets a confirmation mail and nothing else
  // until it is confirmed. Rate limit: 8 per 10 minutes per IP (phase 5) + the global limiter.
  'newsletter.subscribe': Object.freeze({
    method: 'POST', path: '/api/newsletter/subscribe', pow: null,
    author: Object.freeze({}),
    visitor: Object.freeze({ email: F('email', { required: true, max: 160 }) }),
    rateLimit: '8 / 10 min per IP',
  }),
  // routes/polls.mjs: votes for the options the AUTHOR fixed, as the visitor (session or voter
  // key), under the poll's own rules (open, audience, single/multiple). Rate limit 20 / 5 min.
  'poll.vote': Object.freeze({
    method: 'POST', path: '/api/polls/{pollId}/vote', pow: null,
    author: Object.freeze({ pollId: F('id', { required: true }), optionIds: F('ids', { required: true, min: 1, max: 20 }) }),
    visitor: Object.freeze({}),
    rateLimit: '20 / 5 min',
  }),
  // routes/threads.mjs: opens a conversation with the project's contact inbox, exactly what the
  // project page's own contact button does. Rate limit 12 / 10 min, plus a proof of work when
  // the visitor is signed out (the server decides; the executor always solves one).
  'project.contact': Object.freeze({
    method: 'POST', path: '/api/threads', pow: '/api/auth/pow',
    author: Object.freeze({ project: F('ref', { required: true }), topic: F('slug', { required: true }) }),
    visitor: Object.freeze({
      subject: F('text', { required: true, min: 2, max: 140 }),
      body: F('text', { required: true, min: 10, max: 4000, multiline: true }),
      email: F('email', { max: 254 }),
      name: F('text', { max: 80 }),
    }),
    rateLimit: '12 / 10 min + proof of work',
  }),
});
export const SUBMIT_KEYS = Object.keys(SUBMIT_REGISTRY);

const REF = /^(sc:)?[a-z0-9][a-z0-9-]{0,79}$/;
const SLUG = /^[A-Za-z0-9_-]{1,40}$/;
const ENDPOINT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** One registry field's value: '' when it is fine, else a reason. */
export function submitFieldProblem(spec, v) {
  const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
  if (empty) return spec.required ? 'required' : '';
  switch (spec.kind) {
    case 'email': return typeof v !== 'string' ? 'bad_type' : v.length > (spec.max || 254) || !mailAddress(v.trim()) ? 'bad_value' : '';
    case 'id': return typeof v !== 'string' ? 'bad_type' : ENDPOINT_ID.test(v) ? '' : 'bad_value';
    case 'ref': return typeof v !== 'string' ? 'bad_type' : REF.test(v) ? '' : 'bad_value';
    case 'slug': return typeof v !== 'string' ? 'bad_type' : SLUG.test(v) ? '' : 'bad_value';
    case 'ids': {
      if (!Array.isArray(v)) return 'bad_type';
      if (v.length < (spec.min || 0) || v.length > (spec.max || 20)) return 'too_many';
      return v.every((x) => typeof x === 'string' && ENDPOINT_ID.test(x)) ? '' : 'bad_value';
    }
    case 'text': {
      if (typeof v !== 'string') return 'bad_type';
      const n = v.trim().length;
      if (spec.max && v.length > spec.max) return 'too_long';
      if (spec.min && n < spec.min) return 'too_short';
      return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v) ? 'bad_value' : '';
    }
    default: return 'bad_value';
  }
}

/**
 * The ONE request a submit step may make: `{ ok: true, method, url, body, pow }`, or
 * `{ ok: false, field, reason }`. Pure: the renderer calls `fetch` with exactly this, and a
 * test runs every registry entry through it. `ctx.lang` picks the newsletter language; `ctx.pow`
 * is the solved proof of work, when the entry asks for one.
 */
export function submitRequest(key, authorFields, visitorFields, ctx = {}) {
  const entry = Object.prototype.hasOwnProperty.call(SUBMIT_REGISTRY, key) ? SUBMIT_REGISTRY[key] : null;
  if (!entry) return { ok: false, field: 'endpoint', reason: 'unknown_endpoint' };
  const a = isObj(authorFields) ? authorFields : {};
  const v = isObj(visitorFields) ? visitorFields : {};
  for (const [k, spec] of Object.entries(entry.author)) {
    const r = submitFieldProblem(spec, a[k]);
    if (r) return { ok: false, field: `fields.${k}`, reason: r };
  }
  for (const [k, spec] of Object.entries(entry.visitor)) {
    const r = submitFieldProblem(spec, typeof v[k] === 'string' ? v[k].trim() : v[k]);
    if (r) return { ok: false, field: k, reason: r };
  }
  const t = (k) => (typeof v[k] === 'string' ? v[k].trim() : '');
  let url = entry.path; let body;
  switch (key) {
    case 'newsletter.subscribe':
      body = { email: t('email').toLowerCase(), locale: ctx.lang === 'fr' ? 'fr' : 'en' };
      break;
    case 'poll.vote':
      url = entry.path.replace('{pollId}', encodeURIComponent(a.pollId));
      body = { optionIds: [...new Set(a.optionIds)] };
      break;
    case 'project.contact':
      body = {
        kind: 'project', targetId: a.project, topic: a.topic, subject: t('subject'), body: t('body'),
        ...(t('email') ? { email: t('email') } : {}), ...(t('name') ? { name: t('name') } : {}),
        ...(ctx.pow ? { pow: ctx.pow } : {}),
      };
      break;
    default: return { ok: false, field: 'endpoint', reason: 'unknown_endpoint' };
  }
  return { ok: true, method: entry.method, url, body, pow: entry.pow };
}

// ── One step, checked ─────────────────────────────────────────────────────────────────
/**
 * Every problem of ONE step, through `push(field, reason, value)` (`field` '' = the step itself).
 * `ctx.links` is the link policy; `ctx.blockIds`, when given, the ids of the page's blocks, which
 * a scroll or reveal must name. Used by the strict validator AND by the renderer's plan.
 */
export function stepProblems(step, ctx, push) {
  if (!isObj(step)) { push('', 'bad_type', null); return; }
  const type = step.type;
  if (typeof type !== 'string' || !type) { push('type', 'bad_value', type ?? null); return; }
  if (REMOVED_ACTIONS[type]) { push('type', REMOVED_ACTIONS[type], type); return; }
  if (RESERVED_ACTIONS.includes(type)) { push('type', 'reserved_action', type); return; }
  if (!ACTION_TYPES.includes(type)) { push('type', 'unknown_action', type); return; }
  for (const k of Object.keys(step)) if (k !== 'type' && !STEP_FIELDS[type].includes(k)) push(k, 'unknown_field', k);
  const ids = ctx?.blockIds || null;
  const needStr = (k) => {
    if (step[k] == null || step[k] === '') { push(k, 'bad_value', step[k] ?? null); return false; }
    if (typeof step[k] !== 'string') { push(k, 'bad_type', step[k]); return false; }
    return true;
  };
  switch (type) {
    case 'navigate':
      if (needStr('to') && !internalPath(step.to)) push('to', 'unsafe_url', step.to);
      break;
    case 'page':
      if (needStr('canvasId') && !ID.test(step.canvasId)) push('canvasId', 'bad_id', step.canvasId);
      break;
    case 'external':
      if (needStr('url')) { const r = externalUrl(step.url, ctx?.links || DEFAULT_LINK_POLICY).reason; if (r) push('url', r, step.url); }
      break;
    case 'mailto':
      if (needStr('address') && !mailAddress(step.address)) push('address', 'bad_value', step.address);
      break;
    case 'scroll':
      if (needStr('target') && step.target !== '#top' && !(ID.test(step.target) && (!ids || ids.has(step.target)))) push('target', 'bad_scroll_target', step.target);
      break;
    case 'reveal':
      if (needStr('target') && !(ID.test(step.target) && (!ids || ids.has(step.target)))) push('target', 'bad_target', step.target);
      if (step.mode != null && !REVEAL_MODES.includes(step.mode)) push('mode', 'bad_value', step.mode);
      break;
    case 'copy':
      if (needStr('text') && step.text.length > COPY_MAX) push('text', 'too_long', step.text.length);
      break;
    case 'download': {
      const hasFile = step.file != null && step.file !== '';
      const hasAsset = step.asset != null && step.asset !== '';
      if (hasFile === hasAsset) { push(hasFile ? 'asset' : 'file', hasFile ? 'unknown_field' : 'bad_value', null); break; }
      if (hasFile && !(typeof step.file === 'string' && downloadPath(step.file))) push('file', 'unsafe_url', step.file);
      if (hasAsset && !(typeof step.asset === 'string' && ASSET_KEY.test(step.asset))) push('asset', 'bad_value', step.asset);
      break;
    }
    case 'submit': {
      if (!needStr('endpoint')) break;
      const entry = Object.prototype.hasOwnProperty.call(SUBMIT_REGISTRY, step.endpoint) ? SUBMIT_REGISTRY[step.endpoint] : null;
      if (!entry) { push('endpoint', 'unknown_endpoint', step.endpoint); break; }
      const f = step.fields == null ? {} : step.fields;
      if (!isObj(f)) { push('fields', 'bad_type', null); break; }
      for (const k of Object.keys(f)) if (!Object.prototype.hasOwnProperty.call(entry.author, k)) push(`fields.${k}`, 'unknown_field', k);
      for (const [k, spec] of Object.entries(entry.author)) {
        const r = submitFieldProblem(spec, f[k]);
        if (r) push(`fields.${k}`, r === 'required' ? 'bad_value' : r, f[k] ?? null);
      }
      break;
    }
    case 'theme':
      if (!THEME_MODES.includes(step.mode)) push('mode', 'bad_value', step.mode ?? null);
      break;
    default: break;
  }
}

/**
 * Every problem of a block's `action`, through `push(path, reason, value)` with paths relative to
 * the block (`action`, `action[2].url`). Strict: this is what validateDoc (and so the API) runs.
 */
export function actionProblems(raw, ctx, push, at = 'action') {
  if (raw == null) return;
  if (!Array.isArray(raw)) { push(at, 'bad_type', null); return; }
  if (raw.length > MAX_STEPS) push(at, 'too_many', raw.length);
  const terminals = [];
  raw.forEach((step, i) => {
    stepProblems(step, ctx, (field, reason, value) => push(`${at}[${i}]${field ? `.${field}` : ''}`, reason, value));
    if (isObj(step) && TERMINAL_TYPES.includes(step.type)) terminals.push(i);
  });
  // Every terminal step that is not the last one: that covers "last" and "only one" at once.
  for (const i of terminals) if (i !== raw.length - 1) push(`${at}[${i}].type`, 'terminal_not_last', raw[i].type);
}

// ── Reading what is stored ─────────────────────────────────────────────────────────────
/** One step as stored, reduced to its type's own fields (strings, and the submit mapping).
 *  Tolerant: the plan decides whether it runs. */
function cleanStep(raw) {
  if (!isObj(raw)) return { type: '' };
  const type = typeof raw.type === 'string' ? raw.type.slice(0, 40) : '';
  const out = { type };
  const fields = STEP_FIELDS[type] || [];
  for (const k of fields) {
    if (raw[k] == null) continue;
    if (k === 'fields') { if (isObj(raw.fields)) out.fields = { ...raw.fields }; continue; }
    if (typeof raw[k] === 'string') out[k] = raw[k].slice(0, k === 'text' ? COPY_MAX + 1 : URL_MAX + 1);
  }
  return out;
}

/** A block's stored `action` as a list of steps (a single object is read as a list of one). */
export function normalizeAction(raw) {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.slice(0, MAX_STEPS + 1).map(cleanStep);
}

// ── The legacy fields (v1, phase 0 to 4) ────────────────────────────────────────────────
/** Strip what a browser strips before judging a legacy href (tabs and newlines anywhere, C0 and
 *  spaces at the ends): a legacy value is READ generously, then judged by the strict rules. */
const loose = (raw) => (typeof raw === 'string'
  ? raw.slice(0, URL_MAX).replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '') : '');

/** A legacy link (block `link`, a button's `link` action) as one step. */
function stepFromHref(raw) {
  const s = loose(raw);
  if (s.startsWith('#')) {
    const id = s.slice(1);
    return { type: 'scroll', target: !id || id === 'top' ? '#top' : id };
  }
  // http:// is upgraded: the rule is https only, and a site that still answers plain http
  // almost always redirects to https anyway. What the author meant is kept; the scheme is not.
  if (/^http:\/\//i.test(s)) return { type: 'external', url: `https://${s.slice(7)}` };
  if (/^https:\/\//i.test(s)) return { type: 'external', url: s };
  if (/^mailto:/i.test(s)) return { type: 'mailto', address: s.slice(7).split('?')[0] };
  // A path, or anything else: kept as a navigation so the strict rule judges it (a hostile
  // value stays visible, in red, rather than disappearing, decision D5).
  return { type: 'navigate', to: s || String(raw ?? '').slice(0, URL_MAX) };
}

/** A button's legacy `props.action` as one step. */
function stepFromButton(a) {
  const type = typeof a.type === 'string' && a.type ? a.type : 'link';
  // An empty link or download did nothing before phase 5 either: no step, not an inert one.
  if ((type === 'link' || type === 'download') && !loose(a.href)) return null;
  if (type === 'link') return stepFromHref(a.href);
  if (type === 'copy') return { type: 'copy', text: str(a.text) };
  if (type === 'scroll') {
    const tgt = loose(a.target);
    const id = tgt.startsWith('#') ? tgt.slice(1) : tgt;
    return { type: 'scroll', target: !id || id === 'top' ? '#top' : id };
  }
  if (type === 'download') {
    const s = loose(a.href);
    const asset = /^\/api\/assets\/([a-zA-Z0-9._-]{1,64})$/.exec(s);
    return asset ? { type: 'download', asset: asset[1] } : { type: 'download', file: s };
  }
  // `api` (removed, D5) and anything unknown: kept by name, so the editor shows it in red and
  // the page renders it inert with the reason.
  return { type: type.slice(0, 40) };
}

/**
 * The steps a block carried BEFORE `action` existed: a button's `props.action`, or any other
 * block's `link`. [] when it carried neither. `action`, when present, always wins.
 */
export function legacyAction(b) {
  if (!isObj(b)) return [];
  const p = isObj(b.props) ? b.props : {};
  if (b.kind === 'button') {
    if (isObj(p.action)) { const step = stepFromButton(p.action); return step ? [step] : []; }
    // A button with no action used to be a link to nowhere; it stays one (no step).
    return [];
  }
  if (typeof b.link === 'string' && loose(b.link)) return [stepFromHref(b.link)];
  return [];
}

/** A block's steps, whichever way they were stored. */
export function blockSteps(b) {
  if (!isObj(b)) return [];
  return b.action != null ? normalizeAction(b.action) : normalizeAction(legacyAction(b));
}

/**
 * A RAW document with every block's legacy `link` / `props.action` converted to `action`, and
 * nothing else touched. The API validates the STORED document this way too, so a legacy value
 * already stored (an `api` button, D5) is recognised under its new path and tolerated, while
 * anything new is refused.
 */
export function migrateDocActions(doc) {
  if (!isObj(doc) || !Array.isArray(doc.blocks)) return doc;
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (!isObj(b)) return b;
      const hasLegacy = b.link != null || (isObj(b.props) && b.props.action != null);
      if (!hasLegacy) return b;
      const out = { ...b };
      if (b.action == null) {
        const steps = legacyAction(b);
        if (steps.length) out.action = steps;
      }
      delete out.link;
      if (isObj(b.props) && 'action' in b.props) { const { action: _a, ...rest } = b.props; out.props = rest; }
      return out;
    }),
  };
}

// ── The plan the renderer draws from ────────────────────────────────────────────────────
/**
 * What pressing the block does, decided once from its steps, for the renderer and the editor.
 *
 *   kind 'none'    no action: the block is not interactive
 *   kind 'link'    the last step navigates: a real `<a href>` (middle click, screen readers).
 *                  `external` opens in a new tab with rel="noopener noreferrer"; `download`
 *                  carries the download attribute
 *   kind 'button'  anything else: a `<button>` (Enter / Space) that runs `steps` in order
 *   kind 'inert'   something is wrong: NOTHING runs, and `reason` says what (the editor shows it
 *                  in red; the page renders `aria-disabled` and `data-inert=<reason>`)
 *
 * `ctx` = { links: policy, blockIds: Set of the page's block ids }.
 */
export function planAction(stepsRaw, ctx = {}) {
  const steps = Array.isArray(stepsRaw) ? stepsRaw : normalizeAction(stepsRaw);
  if (!steps.length) return { kind: 'none', steps: [], href: '', reason: '' };
  const inert = (reason, at = -1) => ({ kind: 'inert', steps: [], href: '', reason, at });
  if (steps.length > MAX_STEPS) return inert('too_many');
  const links = ctx.links ? normalizeLinkPolicy(ctx.links) : DEFAULT_LINK_POLICY;
  for (let i = 0; i < steps.length; i++) {
    let first = '';
    stepProblems(steps[i], { links, blockIds: ctx.blockIds || null }, (_f, reason) => { if (!first) first = reason; });
    if (first) return inert(first, i);
    if (TERMINAL_TYPES.includes(steps[i].type) && i !== steps.length - 1) return inert('terminal_not_last', i);
  }
  const last = steps[steps.length - 1];
  const run = steps.slice(0, NAV_TYPES.includes(last.type) ? -1 : undefined);
  switch (last.type) {
    case 'navigate': return { kind: 'link', href: last.to, internal: true, steps: run, reason: '', last };
    case 'page': return { kind: 'link', href: `?tab=c-${last.canvasId}`, internal: true, steps: run, reason: '', last };
    case 'external': {
      const e = externalUrl(last.url, links);
      return { kind: 'link', href: e.href, host: e.host, external: true, steps: run, reason: '', last };
    }
    case 'mailto': return { kind: 'link', href: `mailto:${last.address}`, steps: run, reason: '', last };
    case 'download': return {
      kind: 'link', href: last.asset ? `/api/assets/${last.asset}` : last.file, download: true, steps: run, reason: '', last,
    };
    default: return { kind: 'button', href: '', steps: run, reason: '', last };
  }
}

/** The ids of the blocks a `reveal` step of this document names: they are mounted even when
 *  hidden at load, so there is something to reveal. */
export function revealTargets(blocks) {
  const out = new Set();
  for (const b of Array.isArray(blocks) ? blocks : []) {
    for (const s of blockSteps(b)) if (s.type === 'reveal' && typeof s.target === 'string') out.add(s.target);
  }
  return out;
}
