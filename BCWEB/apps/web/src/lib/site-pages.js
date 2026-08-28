// The custom-page config, resolved BEFORE the first paint.
//
// The old shape of this problem: home.jsx asked for `/site/home` with a hook, so the page
// mounted, rendered the default landing page, got the answer a moment later and swapped. On a
// site that has chosen a different one that is a visible flash of the wrong page — the exact
// thing you cannot fix by making the request faster, because the render happens first by
// construction.
//
// Two things fix it, and the site needs both:
//
//   · a LAST-KNOWN copy in localStorage, painted immediately. A returning visitor sees their
//     admin's page on the first frame, with no request in the way at all.
//   · a boot GATE for the first-ever visit, where there is nothing cached: `boot()` is awaited
//     before React mounts, so the first thing painted is already the right page.
//
// The gate has a deadline. A slow or dead API must not hold the whole site hostage — after it,
// boot resolves with whatever is cached (or with nothing) and the page renders the compiled-in
// default, which is the correct answer when the server cannot be reached.
const KEY = 'bcw_site_pages';
const DEADLINE_MS = 1200;

/** The empty answer: every buildable page off. Shape-compatible with a real one. */
const NONE = { pages: {} };

let _cache = null;

/** What was true last time this browser loaded the site. Painted on the first frame. */
function readCached() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && v.pages ? v : null;
  } catch {
    // A private window, cleared site data, or a browser refusing storage. Not an error —
    // it means "first visit" and the boot gate handles it.
    return null;
  }
}

function writeCached(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* see readCached */ }
}

/**
 * Fetch the config and remember it.
 *
 * Deliberately `fetch` and not the api helper: this runs before React, before the auth
 * provider, before anything that could want a token. It is a public, cacheable GET.
 */
async function load() {
  const res = await fetch('/api/site/pages', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const v = await res.json();
  if (!v || typeof v !== 'object' || !v.pages) throw new Error('bad_shape');
  return v;
}

/**
 * Resolve the config before mounting.
 *
 * Returns as soon as there is an answer to paint: instantly when something is cached, and
 * otherwise within the deadline. It never rejects — a landing page is not worth a white
 * screen.
 */
export async function bootSitePages() {
  _cache = readCached();
  const fresh = load().then((v) => { _cache = v; writeCached(v); return v; }).catch(() => null);
  // Cached: paint now, and let the request update the copy for the next load. Not for THIS
  // one — swapping the page under a visitor who is already reading it is the flash again,
  // one second later.
  if (_cache) return _cache;
  await Promise.race([fresh, new Promise((r) => { setTimeout(r, DEADLINE_MS); })]);
  return _cache || NONE;
}

/** The resolved config. Synchronous, because every caller runs after the gate. */
export function sitePages() {
  return _cache || NONE;
}

/** One page's config, or the off-by-default row for a page nobody built. */
export function sitePage(key) {
  return sitePages().pages?.[key] || { enabled: false, orb: 'default', desktop: [], mobile: null };
}

/** Is there a built page here? The one question home.jsx and dev.jsx ask. */
export function hasCustomPage(key) {
  const p = sitePage(key);
  return !!(p.enabled && p.desktop?.length);
}

/**
 * Replace the resolved config from the editor, so a preview and a save show the real thing.
 *
 * Without this the admin saves, navigates to `/`, and sees the copy this module resolved when
 * the tab opened — which is the page they just replaced.
 */
export function setSitePages(v) {
  if (!v || !v.pages) return;
  _cache = { pages: v.pages };
  writeCached(_cache);
}
