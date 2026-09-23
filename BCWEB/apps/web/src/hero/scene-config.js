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

/**
 * The numeric settings: bounds, step and the unit the editor prints.
 *
 * `unit` is how the value READS, not a conversion table: `pct` prints 0.45 as 45 %, `x` is a
 * multiplier of the shipped behaviour (1 = as shipped), `fps` and `count` are plain integers.
 * Same bounds as the API's clamps and PUT schema.
 */
export const SCENE_BOUNDS = {
  detail: { min: 0, max: 5, step: 1, unit: 'level' },
  noise: { min: 0, max: 1.5, step: 0.05, unit: 'x' },
  speed: { min: 0, max: 3, step: 0.1, unit: 'x' },
  opacity: { min: 0.1, max: 1, step: 0.05, unit: 'pct' },
  scale: { min: 0.5, max: 1.8, step: 0.05, unit: 'pct' },
  glow: { min: 0, max: 1, step: 0.05, unit: 'pct' },
  twinkles: { min: 0, max: 240, step: 10, unit: 'count' },
  fps: { min: 15, max: 60, step: 5, unit: 'fps' },
};

/**
 * How much detail each shape can actually use.
 *
 * `buildGeometry` caps the flat solids lower than the API does: a tetrahedron or an octahedron
 * subdivided past 3 is a sphere with extra steps, and a dodecahedron past 2 the same. So on
 * those shapes the top of a 0–5 slider did NOTHING: 4 and 5 drew exactly what 3 drew. The
 * editor reads this to stop the slider where the shape stops.
 *
 * The second group (cube → vase) does not subdivide a solid, it drives SEGMENT COUNTS, so the
 * ceiling is set where the silhouette stops changing rather than where the topology does:
 * a cone at 36 radial segments is already round, and a lathe past 64 is a smooth revolve.
 */
export const SHAPE_DETAIL_MAX = {
  orb: 5, prism: 3, crystal: 3, gem: 2, ring: 5, halo: 5,
  cube: 4, spire: 5, capsule: 5, spiral: 5, vase: 5,
};
export const detailMaxFor = (shape) => SHAPE_DETAIL_MAX[shape] ?? 5;

/** A value held to its bounds (and to the shape's detail ceiling), for a reset or a paste. */
export function clampSetting(key, value, shape) {
  const b = SCENE_BOUNDS[key];
  if (!b) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return SCENE_DEFAULTS[key];
  const hi = key === 'detail' ? Math.min(b.max, detailMaxFor(shape)) : b.max;
  return Math.min(hi, Math.max(b.min, n));
}
