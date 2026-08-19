import { lazy } from 'react';

// Route-split chunks that survive a redeploy.
//
// A code-split chunk can go missing between this tab loading the page and the user
// navigating to it. A redeploy — or a dev-server rebuild — renames every hashed file, and
// the module graph this tab is holding still points at the old names. The import fails:
//
//     error loading dynamically imported module: /assets/project-C1A6SZy-.js
//
// and the root ErrorBoundary shows a crash card for something that is not a crash. The page
// is simply out of date and needs re-fetching. Nothing handled it, so every stale-chunk
// navigation looked like a bug in whichever page was being opened.
//
// Retry once after a short pause — a genuine network blip recovers there — and if it still
// fails, reload, which fetches a fresh index.html and a fresh module graph.
//
// The sessionStorage flag caps that at ONE reload per tab. Without it a chunk that is
// really gone (a deleted route, a broken build) would reload forever; with it, the second
// failure falls through to the error card, which is the honest outcome. A successful load
// clears the flag, because it proves this tab is now on a build that exists.
//
// This lives in its own module because App.jsx and dashboard.jsx both code-split, and a
// recovery rule written twice is a recovery rule that will diverge.

const FLAG = 'bcw_chunk_reload';

const read = () => { try { return sessionStorage.getItem(FLAG) === '1'; } catch { return true; } };
const arm = () => { try { sessionStorage.setItem(FLAG, '1'); } catch { /* ignore */ } };
const clear = (m) => { try { sessionStorage.removeItem(FLAG); } catch { /* ignore */ } return m; };

/** true when this tab has already spent its one reload — storage being unavailable
 *  (private mode) counts as spent, so we never reload blindly. */
function reloadSpent() {
  const already = read();
  arm();
  return already;
}

/** Wrap a dynamic import so a stale chunk reloads the page instead of crashing it. */
export function chunk(imp) {
  return () => imp().then(clear, () =>
    new Promise((r) => setTimeout(r, 400)).then(imp).then(clear, (err) => {
      if (reloadSpent()) throw err;
      location.reload();
      return new Promise(() => {});   // never settles; the reload takes over
    }));
}

/** React.lazy() for a route chunk. */
export const lazyChunk = (imp) => lazy(chunk(imp));

/** React.lazy() for a NAMED export out of a shared chunk. */
export const lazyNamed = (imp, key) => lazy(chunk(() => imp().then((m) => ({ default: m[key] }))));

/** Vite fires this when it cannot PRELOAD a chunk — same stale-build cause, a different
 *  moment, and it does not go through the lazy() paths above. Left unhandled it throws. */
export function installPreloadErrorHandler() {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadSpent()) return;   // let it throw and reach the error card
    e.preventDefault();
    location.reload();
  });
}
