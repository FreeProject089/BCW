// D4: transitions between scenes of the 3D backdrop.
//
// The scene was one shape for the whole visit. This lets the admin give it a short playlist of
// shapes and say WHEN it moves to the next one:
//   hover     the pointer lands on the shape (instead of, or on top of, the hover reaction)
//   interval  every N seconds
//   reload    each full page load starts on the next shape (no animation: it is the first frame)
//   route     each change of page inside the site
// and HOW it moves: `fade` (the surface dims out and back in as the next shape) or `burst`
// (it breaks into its own faces, and the faces that come back are the next shape).
//
// Not the renderer's rules: those are in apps/web/src/hero/Hero3D.jsx, which also honours
// prefers-reduced-motion (no animated trigger then; `reload` still rotates, since the first
// frame of a page is not a movement) and runs at full frame rate only while a transition is
// actually playing, then goes back to the idle budget. This module is what is STORED and
// served: bounded, defaulted, and with every trigger OFF, so a site that never opens the
// setting draws exactly what it drew before.
import { z } from 'zod';

export const TRANSITION_TRIGGERS = ['hover', 'interval', 'reload', 'route'];
export const TRANSITION_STYLES = ['fade', 'burst'];
export const TRANSITION_MAX_SHAPES = 6;

/** The PUT body's `transitions` (zod). `shapes` is checked against the caller's shape list. */
export const transitionsBody = (shapes) => z.object({
  shapes: z.array(z.enum(shapes)).max(TRANSITION_MAX_SHAPES).optional(),
  triggers: z.object(Object.fromEntries(TRANSITION_TRIGGERS.map((k) => [k, z.boolean().optional()]))).optional(),
  intervalSec: z.number().int().min(5).max(600).optional(),
  style: z.enum(TRANSITION_STYLES).optional(),
  durationMs: z.number().int().min(300).max(3000).optional(),
}).optional();

/** What the browser is told: every field present, bounded, deduplicated. */
export function sceneTransitions(v, shapes) {
  const src = v && typeof v === 'object' ? v : {};
  const num = (x, lo, hi, d) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d);
  const list = Array.isArray(src.shapes) ? [...new Set(src.shapes.filter((s) => shapes.includes(s)))].slice(0, TRANSITION_MAX_SHAPES) : [];
  const trg = src.triggers && typeof src.triggers === 'object' ? src.triggers : {};
  return {
    shapes: list,
    triggers: Object.fromEntries(TRANSITION_TRIGGERS.map((k) => [k, trg[k] === true])),
    intervalSec: num(src.intervalSec, 5, 600, 30),
    style: TRANSITION_STYLES.includes(src.style) ? src.style : 'fade',
    durationMs: num(src.durationMs, 300, 3000, 900),
  };
}
