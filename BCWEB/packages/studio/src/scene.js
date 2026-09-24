// What the 3D scene can be, with no three.js in it.
//
// Two things draw the scene: the site's backdrop (apps/web/src/hero/Hero3D.jsx, configured by
// an admin) and, since phase 4 of PLAN-STUDIO-2026, a studio page whose background is a
// `scene3d`. The second is authored by a per-project editor and stored in a page, so the API
// has to check it, and the API cannot import the web's hero/ folder. The shape list and the
// bounds therefore live HERE, once: apps/web/src/hero/scene-config.js and scene-shapes.js
// re-export them, so the admin's sliders and a page's sliders cannot disagree about what a
// shape is or how far a value goes.
//
// (The API's own scene settings route, apps/api/src/routes/misc.mjs, still restates these for
// the SITE scene, as it did before this file existed. Same numbers; keep them in step.)

/** Every shape the renderer can build (hero/scene-shapes.js `buildGeometry`). */
export const SCENE_SHAPES = [
  // The six platonic/torus silhouettes the scene shipped with.
  'orb', 'prism', 'crystal', 'gem', 'ring', 'halo',
  // Five that are not a subdivided ball: cube, spire, capsule, spiral, vase. Why each was
  // chosen is written next to its geometry in hero/scene-shapes.js.
  'cube', 'spire', 'capsule', 'spiral', 'vase',
];

/** How the surface is drawn. */
export const SCENE_SURFACES = ['solid', 'wire', 'both'];

/**
 * The numeric settings: bounds, step and the unit the editor prints.
 *
 * `unit` is how the value READS, not a conversion table: `pct` prints 0.45 as 45 %, `x` is a
 * multiplier of the shipped behaviour (1 = as shipped), `fps` and `count` are plain integers.
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
 * How much detail each shape can actually use. The flat solids stop subdividing before 5 (a
 * tetrahedron past 3 draws what 3 drew), so a slider that went to 5 on them had positions that
 * did nothing. See hero/scene-shapes.js for the per-shape reasons.
 */
export const SHAPE_DETAIL_MAX = {
  orb: 5, prism: 3, crystal: 3, gem: 2, ring: 5, halo: 5,
  cube: 4, spire: 5, capsule: 5, spiral: 5, vase: 5,
};
export const detailMaxFor = (shape) => SHAPE_DETAIL_MAX[shape] ?? 5;

/** The look a scene has before anybody touches a slider: the site backdrop's defaults. */
export const SCENE_LOOK_DEFAULTS = {
  shape: 'orb', surface: 'solid', detail: 4, noise: 1, speed: 1, opacity: 0.8, scale: 1,
  glow: 0.45, twinkles: 110, fps: 30,
};

/** A number held to its bounds (and to the shape's detail ceiling). Not a number = `fallback`. */
export function clampSceneNumber(key, value, shape, fallback = SCENE_LOOK_DEFAULTS[key]) {
  const b = SCENE_BOUNDS[key];
  if (!b) return value;
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const hi = key === 'detail' ? Math.min(b.max, detailMaxFor(shape)) : b.max;
  const v = Math.min(hi, Math.max(b.min, n));
  // Whole numbers where the renderer counts things (subdivisions, points, frames).
  return b.step >= 1 ? Math.round(v) : v;
}
