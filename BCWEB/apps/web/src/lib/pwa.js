// Installing, updating and stepping out of the way of the service worker.
//
// The worker itself is generated at build time (scripts/sw-source.js + the bcwebPwa plugin in
// vite.config.js); this file is everything the PAGE has to do about it.
//
// Three rules live here rather than in the worker, because they are about the reader:
//
//   1. Nothing is registered in dev. A worker caching Vite's dev assets serves yesterday's
//      module the moment the dev server restarts, and the report is always "my change does
//      not appear". Worse, a worker installed by a production build on localhost keeps
//      serving that build over the dev server; so in dev we do not merely skip registering,
//      we actively unregister whatever is there.
//   2. The new build never takes over silently. A worker that calls skipWaiting swaps the
//      asset cache under a page whose JavaScript is already running, and the next lazy route
//      that page asks for is a 404 from a build that no longer exists.
//   3. But nobody is left on an old build either. The waiting worker is re-announced on every
//      page load, and the registration is re-checked whenever the tab comes back to the
//      front, so an app left open for a week notices the deploy the next time it is looked at.

export const SW_UPDATE_EVENT = 'bcw:sw-update';

let waiting = null;          // the installed-but-waiting worker, if any
let askedToUpdate = false;   // the reader pressed Reload: a controller change is now expected

const announce = (worker) => {
  waiting = worker;
  try { window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT)); } catch { /* very old browser */ }
};

/** Is a newer build installed and waiting? Read once by the prompt when it mounts. */
export const updateWaiting = () => !!waiting;

/**
 * Take the update: tell the waiting worker to activate, then reload once it is in charge.
 *
 * The reload is hung off `controllerchange` rather than done immediately, because reloading
 * first would just re-run the OLD worker and show the same prompt again.
 */
export function applyUpdate() {
  if (!waiting) { window.location.reload(); return; }
  askedToUpdate = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** Drop every cache this site owns. Called on sign-out. */
export function purgeCaches() {
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'PURGE' }); } catch { /* no worker */ }
}

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  if (!import.meta.env.PROD) {
    // Rule 1. Not a no-op: this is what rescues a machine that once loaded a built preview.
    navigator.serviceWorker.getRegistrations?.()
      .then((rs) => rs.forEach((r) => r.unregister()))
      .catch(() => {});
    return;
  }

  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only when the reader asked for it. This event also fires on the very first install,
    // when the worker calls clients.claim(), and reloading there would bounce every new
    // visitor's first page view for no reason at all.
    if (!askedToUpdate || reloaded) return;
    reloaded = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          // `controller` is null on a first install; that is not an update, it is the
          // beginning, and there is nothing to tell anybody about.
          if (next.state === 'installed' && navigator.serviceWorker.controller) announce(next);
        });
      });
      // Rule 3: look again when the tab is looked at again. Cheap (a conditional request for
      // one small file) and it is the moment a long-lived tab can act on the answer.
      const recheck = () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); };
      document.addEventListener('visibilitychange', recheck);
      setInterval(recheck, 30 * 60 * 1000);
    }).catch(() => { /* http, private mode, or the file is not there: the site works without it */ });
  });
}
