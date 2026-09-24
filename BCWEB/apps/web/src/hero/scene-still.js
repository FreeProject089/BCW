// The scene, drawn once in CSS, with no three.js in it.
//
// The still rendering is what a visitor gets when the live scene cannot or should not run: no
// WebGL, a lost context, a visitor who switched the 3D backdrop off, the second 3D background on
// a page that already has one (hero/scene-stage.js), and every thumbnail and editor board in the
// studio, which must never open a WebGL context of their own. It used to live inside Hero3D.jsx,
// which imports three.js, so nothing that wanted the drawing could have it without the 470 KB
// renderer. The outlines are here now; Hero3D paints its backdrop with the same ones.

/** The flat solids, as clip paths. Round solids are a disc; the two tori are a ring. */
export const STATIC_CLIP = {
  prism: 'polygon(50% 4%, 96% 86%, 4% 86%)',
  crystal: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  gem: 'polygon(50% 2%, 97% 36%, 79% 94%, 21% 94%, 3% 36%)',
};
/** The mask that turns the disc into a ring, for `ring` and `halo`. */
export const RING_MASK = 'radial-gradient(circle, transparent 0 38%, #000 40% 69%, transparent 71%)';
export const isRingShape = (shape) => shape === 'ring' || shape === 'halo';

/** Where the shape sits across the box, per `position`. */
const ACROSS = { left: 28, center: 50, right: 72 };

/**
 * The still scene for a studio page background, as the styles of its layers: a halo and the
 * shape. Theme-aware without JavaScript: the colours are the site accent mixed toward the page's
 * own background, so a light page gets the airy tint and a dark one the deep core, as the live
 * shader does.
 *
 * `bg` is a normalised `scene3d` background (packages/studio/src/background.js).
 */
export function sceneStillLayers(bg) {
  const scale = Number(bg?.scale) || 1;
  const x = ACROSS[bg?.position] ?? 50;
  // A share of the box's height, capped so a very tall page does not get a planet.
  const size = `min(${Math.round(56 * scale)}%, ${Math.round(460 * scale)}px)`;
  const at = { position: 'absolute', left: `${x}%`, top: '50%', transform: 'translate(-50%, -50%)', aspectRatio: '1 / 1', height: size };
  const glow = Math.max(0, Number(bg?.glow) || 0);
  const opacity = Math.min(1, ((Number(bg?.opacity) || 0.8) / 0.8) * 0.55);
  const clip = STATIC_CLIP[bg?.shape];
  const ring = isRingShape(bg?.shape);
  const body = 'radial-gradient(circle at 34% 30%, color-mix(in srgb, var(--primary-2) 30%, white) 0%, '
    + 'color-mix(in srgb, var(--primary) 34%, var(--bg)) 30%, color-mix(in srgb, var(--primary-2) 85%, var(--bg)) 78%, '
    + 'color-mix(in srgb, var(--primary-2) 50%, transparent) 100%)';
  const layers = [];
  if (glow > 0) {
    layers.push({ key: 'halo', style: { ...at, height: `calc(${size} * 1.9)`, borderRadius: '50%', opacity,
      background: `radial-gradient(circle, color-mix(in srgb, var(--primary-2) ${Math.round(glow * 70)}%, transparent) 0%, transparent 62%)` } });
  }
  layers.push({ key: 'shape', style: { ...at, opacity, filter: 'blur(0.6px)', background: body,
    borderRadius: clip ? 0 : '50%',
    ...(clip ? { clipPath: clip } : {}),
    ...(ring ? { WebkitMask: RING_MASK, mask: RING_MASK } : {}) } });
  return layers;
}
