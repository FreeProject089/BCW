// What the scene can be set to, with no three.js in it.
//
// The admin screen needs the defaults, the bounds and the per-shape detail ceiling to draw its
// sliders and its reset buttons. They used to live in `scene-shapes.js`, which imports three.js,
// so reading one number from there meant pulling the renderer into the admin bundle. This module
// is the vocabulary; `scene-shapes.js` re-exports it and stays the one that draws.
//
// The API (`apps/api/src/routes/misc.mjs`, `sceneConfig` + the PUT schema) is the authority on
// what is STORED and clamps to the same bounds. Keep the two in step: a slider that goes past
// what the API accepts is a Save that fails with `invalid_input`.

/** Every default, in one object. */
export const SCENE_DEFAULTS = {
  enabled: true,
  shape: 'orb',
  detail: 4,
  noise: 1,
  speed: 1,
  opacity: 0.8,
  scale: 1,
  surface: 'solid',
  // What the pointer does to it. `fracture` is what the hero has always done.
  hover: 'fracture',
  // How a section arrives when it scrolls into view. Applied by `applyReveal`.
  reveal: 'rise',
  glow: 0.45,
  twinkles: 110,
  // The frame budget while nothing fast is happening. A backdrop drifting at 30 cannot be told
  // from one drifting at 60; the CPU it costs can. Full rate only during the intro, a hover
  // reaction or a page transition.
  fps: 30,
  // D4: transitions between shapes (apps/api/src/lib/scene-transitions.mjs). No playlist and
  // every trigger off: the scene is one shape for the visit, as it always was.
  transitions: { shapes: [], triggers: { hover: false, interval: false, reload: false, route: false }, intervalSec: 30, style: 'fade', durationMs: 900 },
};

/** D4: the transition vocabulary, the same lists the API validates against. */
export const TRANSITION_TRIGGERS = ['hover', 'interval', 'reload', 'route'];
export const TRANSITION_STYLES = ['fade', 'burst'];
export const TRANSITION_MAX_SHAPES = 6;

// The shape list, the numeric bounds and the per-shape detail ceiling live in the studio
// package (packages/studio/src/scene.js) since phase 4 of PLAN-STUDIO-2026: a studio page can
// have a 3D background, the API validates it, and the API cannot import this folder. Same
// numbers, written once; re-exported here so every import of this file keeps working.
// A RELATIVE path, as in lib/canvas.js, so the web's node tests resolve it without an alias.
import { SCENE_BOUNDS, SHAPE_DETAIL_MAX, detailMaxFor } from '../../../../packages/studio/src/scene.js';
export { SCENE_BOUNDS, SHAPE_DETAIL_MAX, detailMaxFor };

/** A value held to its bounds (and to the shape's detail ceiling), for a reset or a paste. */
export function clampSetting(key, value, shape) {
  const b = SCENE_BOUNDS[key];
  if (!b) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return SCENE_DEFAULTS[key];
  const hi = key === 'detail' ? Math.min(b.max, detailMaxFor(shape)) : b.max;
  return Math.min(hi, Math.max(b.min, n));
}
