// What you picked last, and the one hook the rest of the app uses to open ⌘K.
//
// RECENTS
// Per-viewer convenience, so localStorage is the right home for it — but only for ids. The
// old file stored `{to, label}` pairs and could therefore only remember DESTINATIONS: an
// action carries a closure, which does not survive a reload. Storing the id instead means the
// live command list rebuilds the closure at render time, so "Sign out" and "Toggle theme" are
// remembered too, and a command that no longer exists simply does not come back.
//
// Every read and write is wrapped: localStorage THROWS in a private window and in an iframe
// with site data blocked, and can come back empty for reasons that have nothing to do with
// this app. An empty list is a correct answer here, so there is nothing to report.

const KEY = 'bcw.cmdk.recent.v2';
const MAX = 8;

export function readRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX) : [];
  } catch { return []; }
}

export function pushRecent(id) {
  if (!id || typeof id !== 'string') return readRecent();
  let next = [id];
  try {
    next = [id, ...readRecent().filter((r) => r !== id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* private window, blocked storage: recents are a convenience, not state */ }
  return next;
}

// ── Opening the palette from elsewhere ────────────────────────────────────────
// The phone has no ⌘K. The mobile bar needs to open the same palette, and the palette owns
// its own `open` state, so the two talk through one window event rather than by lifting that
// state into App (which would re-render the whole shell on every keystroke).
const OPEN_EVENT = 'bcw:cmdk-open';

// `scope: 'docs'` opens it narrowed to the documentation: the docs page's own search button
// and its Alt shortcut use that, since the docs page no longer has a palette of its own.
export function openPalette(opts = {}) {
  try { window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { scope: opts.scope || null } })); } catch { /* no window */ }
}

export function onOpenPalette(fn) {
  const h = (e) => fn(e?.detail || {});
  window.addEventListener(OPEN_EVENT, h);
  return () => window.removeEventListener(OPEN_EVENT, h);
}

// ── Recent documentation hits ─────────────────────────────────────────────────
// The docs page's palette kept its own list of the sections you opened; it moved in here with
// the merge, under the SAME key, so nobody's list was lost with it.
const DOC_KEY = 'doc-search-recent';
const DOC_MAX = 6;

export function readDocRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(DOC_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.slug === 'string').slice(0, DOC_MAX) : [];
  } catch { return []; }
}

export function pushDocRecent(r) {
  const entry = { slug: r.slug, title: r.title, category: r.category, section: r.section || undefined, anchor: r.anchor || undefined };
  const next = [entry, ...readDocRecent().filter((x) => !(x.slug === entry.slug && (x.anchor || '') === (entry.anchor || '')))].slice(0, DOC_MAX);
  try { localStorage.setItem(DOC_KEY, JSON.stringify(next)); } catch { /* a convenience, not state */ }
  return next;
}

export function clearDocRecent() {
  try { localStorage.removeItem(DOC_KEY); } catch { /* ignore */ }
  return [];
}
