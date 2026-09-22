/* eslint-disable */
/**
 * BetterCommunity service worker — SOURCE.
 *
 * This file is never served as it is. `bcwebPwa()` in vite.config.js reads it at build time,
 * substitutes the two placeholders below (the build id and the precache list) with the real
 * build id and the real hashed file names from the bundle, and emits the result as
 * `dist/sw.js`. Do not name those placeholders anywhere else in this file: the substitution
 * is textual, so a mention in a comment gets substituted too. That is the whole reason
 * it is not in `public/`: a precache list has to name files whose hashes only exist once
 * Rollup has run, and a hand-written list goes stale on the first build nobody re-edits it on.
 *
 * ── The caching policy, in one place ──────────────────────────────────────────────────
 *
 * There are exactly four behaviours, and everything not named here is left to the browser
 * (this worker does not call respondWith, so the request goes out exactly as it would with
 * no worker installed — same credentials, same keepalive, same redirect handling):
 *
 *   1. /api/*            NETWORK ONLY, never read from a cache, never written to one.
 *                        Every authenticated answer on this site comes through here, and a
 *                        cached one is a logged-in view waiting to be served to the next
 *                        person who opens the browser. It is also how analytics beacons and
 *                        the consent-gated pageviews leave, so passing them through
 *                        untouched keeps that behaviour exactly as it was.
 *   2. /hosting/*        NETWORK ONLY. Somebody else's repo content, served from our origin;
 *                        it is not ours to hold, and repo.json is the file BMM must see the
 *                        current version of.
 *   3. navigations       NETWORK FIRST, falling back to the precached app shell. The shell is
 *                        index.html, which contains no user data at all: this is a single-page
 *                        app and every name, avatar and permission on screen arrives later
 *                        from /api. That is what makes it safe to hand the same cached bytes
 *                        to a signed-out visitor.
 *   4. static assets     CACHE FIRST. /assets/* is content-hashed by Vite, so a hit can never
 *                        be stale; the handful of unhashed files (the logo, the manifest,
 *                        world.json) change rarely and are dropped wholesale on every build,
 *                        because the cache names carry the build id.
 *
 * Nothing survives a deploy: `activate` deletes every bcw-* cache that is not this build's.
 * So "stale build" is bounded by one navigation, and there is no partial mix of two builds.
 *
 * ── Updates ──────────────────────────────────────────────────────────────────────────
 *
 * install does NOT call skipWaiting. A worker that takes over mid-session swaps the asset
 * cache under a page whose JavaScript is already running, and the next lazy chunk it asks
 * for is a 404 from the new build. So the new worker waits, the page notices it waiting and
 * asks the reader (lib/pwa.js -> ui/pwa-update.jsx), and only a click sends SKIP_WAITING.
 * The reload happens on controllerchange, which is the moment the new worker is actually in
 * charge. Nobody is stranded on an old build: the prompt appears on every page load where a
 * newer worker is waiting, not once.
 */

const BUILD = '__BUILD_ID__';
const SHELL_CACHE = 'bcw-shell-' + BUILD;
const ASSET_CACHE = 'bcw-assets-' + BUILD;
const SHELL_URL = '/index.html';

// Written by the build: the app shell plus everything the offline destination needs to run.
const PRECACHE = __PRECACHE__;

const isOurs = (name) => name.startsWith('bcw-');
const mine = (name) => name === SHELL_CACHE || name === ASSET_CACHE;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    const assets = await caches.open(ASSET_CACHE);
    // The shell is the one file that MUST land: without it there is no offline page at all,
    // so a failure here fails the install and the old worker stays in charge.
    const res = await fetch(SHELL_URL, { cache: 'reload' });
    if (!res.ok) throw new Error('shell ' + res.status);
    await shell.put(SHELL_URL, res);
    // The rest is best-effort, one request at a time. `addAll` is atomic: one 404 on one
    // optional icon and the whole install fails, which would leave every visitor without a
    // worker because of a file nobody needs.
    //
    // No `cache: 'reload'` here, deliberately. Every file in this list is content-hashed or
    // effectively immutable, and the page that is installing this worker has just downloaded
    // most of them: the default cache mode lets the install read them back out of the HTTP
    // cache instead of pulling roughly a megabyte down a second time on every first visit.
    // The shell above is the exception and is forced, because index.html is NOT hashed and a
    // stale one is a stale offline page for as long as the build lives.
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const r = await fetch(url);
        if (r.ok) await assets.put(url, r);
      } catch (e) { /* offline at install time, or one asset missing: not fatal */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => isOurs(n) && !mine(n)).map((n) => caches.delete(n)));
    // Navigation preload would race our own network-first fetch for no gain here.
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) { /* not supported */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  // Belt and braces for a sign-out. Nothing here is personal by construction, but the cost
  // of proving that to somebody reading the code later is higher than the cost of the call.
  if (type === 'PURGE') {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.filter(isOurs).map((n) => caches.delete(n)))));
  }
});

const STATIC_EXT = /\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico|json|webmanifest|bmmreplay)$/i;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;          // storage, Discord, fonts: not ours
  if (url.pathname.startsWith('/api/')) return;             // rule 1
  if (url.pathname.startsWith('/hosting/')) return;         // rule 2
  if (url.pathname === '/sw.js') return;                    // never serve the worker from a cache

  if (req.mode === 'navigate') {                            // rule 3
    event.respondWith(navigateWithFallback(req));
    return;
  }
  if (url.pathname.startsWith('/assets/') || STATIC_EXT.test(url.pathname)) {  // rule 4
    event.respondWith(assetCacheFirst(req));
  }
  // Anything else falls through to the network untouched.
});

async function navigateWithFallback(req) {
  try {
    const net = await fetch(req);
    // Refresh the stored shell from a real answer, so the offline page is never older than
    // the last time this browser reached the site. `basic` excludes opaque and CORS answers;
    // a redirect to a login page or an error page is not worth keeping either.
    if (net && net.ok && net.type === 'basic') {
      const copy = net.clone();
      caches.open(SHELL_CACHE).then((c) => c.put(SHELL_URL, copy)).catch(() => {});
    }
    return net;
  } catch (e) {
    const cached = await caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
    // The shell boots, sees navigator.onLine === false and renders the 404 page with its
    // game (see App.jsx). That is the deliberate offline destination, not a browser error.
    if (cached) return cached;
    return Response.error();
  }
}

async function assetCacheFirst(req) {
  const hit = await caches.match(req, { cacheName: ASSET_CACHE });
  if (hit) return hit;
  try {
    const net = await fetch(req);
    if (net && net.ok && net.type === 'basic') {
      const copy = net.clone();
      caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return net;
  } catch (e) {
    return Response.error();
  }
}
