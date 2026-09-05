// The SEO bits that have to reach the <head>, from the admin's runtime config.
//
// Two of these decide whether the site can be found at all, and neither could be set without
// a rebuild before:
//
//   · **Search Console verification.** Google hands you a token to prove the site is yours.
//     Until that meta tag is on the page the property cannot be verified — you cannot submit
//     the sitemap, cannot see what is indexed, and cannot ask for anything to be crawled. It
//     is the first step of being in Google, and it was not settable anywhere.
//   · **The description.** What the search result and every shared link actually say.
//
// Fetched once and cached in a module promise, the same shape the nav and footer configs use.
// An absent or failed config changes nothing: the page keeps whatever index.html shipped
// with, so this can only ever add.

let promise = null;

/** The public SEO config. Never throws — a site that cannot reach its own API still renders. */
export function getSeoConfig() {
  if (!promise) {
    promise = fetch('/api/seo')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return promise;
}

/** Set (or create) one meta tag, keyed by name or property. */
function setMeta(attr, key, content) {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/**
 * Apply the head tags.
 *
 * `lang` picks the description, because a French description on the English page is worse
 * than the built-in one — a search result is the first sentence anybody reads about the site.
 */
export async function applySeoHead(lang = 'en') {
  const c = await getSeoConfig();
  if (!c) return;

  // Ownership tokens. Google's tag is `google-site-verification`; Bing's is `msvalidate.01`.
  // Both are name= meta tags and both are inert to everyone else.
  setMeta('name', 'google-site-verification', c.googleVerify);
  setMeta('name', 'msvalidate.01', c.bingVerify);

  const desc = (lang === 'fr' && c.descriptionFr) || c.description;
  if (desc) {
    setMeta('name', 'description', desc);
    // The same text again for the two things that actually render a link preview. They do
    // NOT fall back to <meta name="description">, which is why setting one and assuming the
    // others follow leaves shared links blank.
    setMeta('property', 'og:description', desc);
    setMeta('name', 'twitter:description', desc);
  }
  if (c.ogImage) {
    setMeta('property', 'og:image', c.ogImage);
    setMeta('name', 'twitter:image', c.ogImage);
    // Without this a preview is a small thumbnail beside the text rather than a card.
    setMeta('name', 'twitter:card', 'summary_large_image');
  }
}

// ── Per-route head ────────────────────────────────────────────────────────────
// Title, description, og:*, twitter:*, robots and JSON-LD for the page being viewed, from
// GET /api/seo/meta — the SAME resolver that builds the unfurl card a crawler is served (the
// page's own data + the admin's per-page overrides in Admin → SEO). One source, so editing a
// row there changes the search snippet, the pasted-link card and the tab title together.
//
// Cached per (lang, path) for five minutes: navigating back and forth must not re-ask.
const routeMetaCache = new Map();
export function fetchRouteMeta(pathname, lang = 'en') {
  const key = `${lang}|${pathname}`;
  let p = routeMetaCache.get(key);
  if (!p) {
    p = fetch(`/api/seo/meta?path=${encodeURIComponent(pathname)}&lang=${encodeURIComponent(lang)}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    routeMetaCache.set(key, p);
    setTimeout(() => routeMetaCache.delete(key), 5 * 60_000);
  }
  return p;
}

/** Write a resolved route meta into the head. Idempotent; each tag is created once. */
export function applyRouteMeta(m) {
  if (!m || typeof document === 'undefined') return;
  if (m.title) document.title = m.title;
  setMeta('name', 'description', m.description);
  setMeta('property', 'og:title', m.title);
  setMeta('property', 'og:description', m.description);
  setMeta('property', 'og:url', m.url);
  setMeta('property', 'og:type', m.type || 'website');
  setMeta('property', 'og:locale', m.lang === 'fr' ? 'fr_FR' : 'en_GB');
  setMeta('name', 'twitter:title', m.title);
  setMeta('name', 'twitter:description', m.description);
  if (m.image) {
    setMeta('property', 'og:image', m.image);
    setMeta('name', 'twitter:image', m.image);
    setMeta('property', 'og:image:alt', m.title);
  }
  // Private and per-account screens must not be indexed even though the SPA serves them.
  setMeta('name', 'robots', m.noindex ? 'noindex, nofollow' : 'index, follow');
  // Structured data: one script, replaced per route (never appended — a page would otherwise
  // accumulate every previous route's schema as you navigate).
  let ld = document.head.querySelector('script#seo-jsonld');
  if (!ld) { ld = document.createElement('script'); ld.id = 'seo-jsonld'; ld.type = 'application/ld+json'; document.head.appendChild(ld); }
  ld.textContent = Array.isArray(m.jsonLd) && m.jsonLd.length ? JSON.stringify(m.jsonLd.length === 1 ? m.jsonLd[0] : m.jsonLd) : '';
}

/**
 * The canonical URL for the page being viewed.
 *
 * A single-page app serves the same HTML at every path, so without this every route claims
 * to be the same document — and duplicate content is the one SEO problem that quietly caps a
 * whole site. Called on navigation, not once at boot.
 */
export function setCanonical(pathname) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', window.location.origin + (pathname || window.location.pathname));
}
