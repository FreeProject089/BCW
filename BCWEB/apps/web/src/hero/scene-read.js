// The scene SETTINGS, as opposed to the scene: the fetch of /api/site/scene and the reveal
// style it carries. No three.js import, on purpose.
//
// M18 (agent-perf-M18): these two used to live in scene-shapes.js, which imports three.js,
// and main.jsx imports them for EVERY page. That one static import put vendor-three
// (~122 KB gzip) in the modulepreload list of index.html, on pages where the orb is off
// or not drawn at all. Hero3D still gets them through scene-shapes.js (re-exported there),
// and the memoised promise below is the same one for both callers: one module, one fetch.
import { mergeEventScene } from './scene-events.js';
import { SCENE_DEFAULTS } from './scene-config.js';

/**
 * Put the reveal style on <html>, where the stylesheet reads it.
 *
 * Exported from here rather than done inside Hero3D because the two are not the same
 * lifetime: the scene is not drawn at all without WebGL, when a visitor has switched it off,
 * or on a page the orb does not cover — and the reveal applies to every page regardless. A
 * setting that only took effect when the 3D backdrop happened to be running would look like
 * it worked on the home page and nowhere else.
 *
 * `rise` writes no attribute: it is the bare-selector default in the stylesheet, so a site
 * that never touched this setting has exactly the CSS it had before the setting existed.
 */
export function applyReveal(style) {
  const el = document.documentElement;
  if (!style || style === 'rise') el.removeAttribute('data-reveal');
  else el.setAttribute('data-reveal', style);
}

/**
 * The scene settings, fetched once per page load.
 *
 * Memoised on the PROMISE, not on the result: two callers starting before the first response
 * arrives would otherwise both fetch. Never rejects — a settings endpoint that is down must
 * not decide whether the site renders, so it resolves to the defaults.
 *
 * The 1.2s deadline is Hero3D's and lives here now: it holds the intro overlay over the site
 * until it can build, so a slow answer would be a white page with a loader on it. A shape is
 * a preference, and a preference must never be able to do that.
 */
let _scenePromise = null;
export function readSceneConfig() {
  if (_scenePromise) return _scenePromise;
  _scenePromise = new Promise((resolve) => {
    let settled = false;
    // clearTimeout lives in done() so the 1.2s deadline is a hard ceiling over EVERYTHING
    // below, the live-event lookup included — a slow /events/active can never hold the intro
    // overlay open past it.
    const done = (v) => { if (!settled) { settled = true; clearTimeout(fall); resolve({ ...SCENE_DEFAULTS, ...(v || {}) }); } };
    const fall = setTimeout(() => done(null), 1200);
    fetch('/api/site/scene', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then(async (d) => {
        // A live event can swap the scene (B11) — but only when the base is on and any event
        // scenes are configured, so the common case pays for no second request. The lookup is
        // bounded by its own 600ms race as well, well inside the 1.2s ceiling above.
        if (d && d.enabled !== false && d.events && Object.keys(d.events).length) {
          const ev = await Promise.race([
            fetch('/api/events/active', { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
            new Promise((res) => { setTimeout(() => res(null), 600); }),
          ]);
          done(mergeEventScene({ ...SCENE_DEFAULTS, ...d }, ev?.event || null));
        } else {
          done(d);
        }
      })
      .catch(() => done(null));
  });
  return _scenePromise;
}
