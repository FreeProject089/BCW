// The scene itself: what it is made of, and what it is made to look like.
//
// This module exists so that the admin screen showing a preview of the scene is showing THE
// scene. A preview with its own geometry and its own shader is a second renderer, and the one
// that is wrong is whichever nobody looked at last — the same reason the page builder drew the
// real page rather than an impression of it.
//
// So: no React, no GSAP, no intro. Geometry, shaders, palette and the defaults, importable by
// a 900-line hero and by a 60mm-wide canvas in a settings card alike.
import * as THREE from 'three';
import { mergeEventScene } from './scene-events.js';
import { SCENE_DEFAULTS, detailMaxFor } from './scene-config.js';

// The vocabulary lives in a three-free module so the admin screen can read it without pulling
// the renderer in. Re-exported, so every existing `from './scene-shapes.js'` keeps working.
export { SCENE_DEFAULTS, SCENE_BOUNDS, SHAPE_DETAIL_MAX, detailMaxFor, clampSetting } from './scene-config.js';

export function isLight() { return document.documentElement.getAttribute('data-theme') !== 'dark'; } // default theme is light
// The orb's colours are DERIVED from the site accent rather than hardcoded, so a superadmin
// who recolours the site recolours the hero with it. The shipped values were an orange-only
// hand-tune — beautiful against orange, and jarring the moment the accent became, say, Classic
// Blue, because the orb would have stayed amber while everything around it moved.
//
// Read from the live computed style, so this picks up whatever the theme layer resolved
// (including color-mix) without needing to know how the value was produced.
export function cssHex(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v) return fallback;
    const c = new THREE.Color(v);          // parses hex, rgb(), and named colours
    return c.getHex();
  } catch { return fallback; }
}
export function palette() {
  const light = isLight();
  const a = cssHex('--primary', 0xf97316);
  const b = cssHex('--primary-2', 0xf59e0b);
  const A = new THREE.Color(a), B = new THREE.Color(b);
  // Light: an airy tint of the accent, near-white rim — daylight glass.
  // Dark:  a deep core with the accent glowing through, bright rim — molten metal at night.
  // Same recipe, opposite direction, so any accent produces the same *character* of orb.
  const mix = (c, target, amt) => c.clone().lerp(new THREE.Color(target), amt).getHex();
  return light
    ? { colorA: mix(A, 0xffffff, 0.62), colorB: mix(B, 0xffffff, 0.18), rim: mix(A, 0xffffff, 0.9),
        opacity: 0.8, heroOp: 0.55, blending: THREE.NormalBlending }
    : { colorA: mix(A, 0x000000, 0.72), colorB: mix(B, 0x000000, 0.12), rim: mix(B, 0xffffff, 0.55),
        opacity: 0.8, heroOp: 0.55, blending: THREE.AdditiveBlending };
}

// Classic Ashima/Stefan Gustavson 3D simplex noise (public-domain-style, widely
// reused in countless shader projects) — lets the vertex shader displace the
// orb's surface organically without any texture lookup.
export const NOISE_GLSL = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

export const VERTEX_SHADER = `
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
varying float vNoise;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE_GLSL}
void main() {
  float n = snoise(position * uFreq + vec3(0.0, 0.0, uTime * 0.12));
  vNoise = n;
  vec3 displaced = position + normal * n * uAmp;
  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vPosW = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const FRAGMENT_SHADER = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorRim;
uniform float uOpacity;
uniform float uFracture; // 0 = solid, 1 = fully dissolved into the particle cloud
varying float vNoise;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 viewDir = normalize(cameraPosition - vPosW);
  float fresnel = pow(1.0 - clamp(dot(viewDir, vNormalW), 0.0, 1.0), 2.1);
  vec3 base = mix(uColorA, uColorB, smoothstep(-0.6, 0.6, vNoise));
  vec3 color = mix(base, uColorRim, fresnel * 0.85);
  gl_FragColor = vec4(color, uOpacity * (1.0 - uFracture));
}
`;

// The "fracture" layer: actual triangular SHARDS of the orb's own surface —
// a coarser non-indexed icosahedron whose faces fly apart along their centroid
// direction as uFracture goes 0→1, shrinking slightly so gaps open between
// pieces. Each shard is displaced by the SAME noise and colored by the SAME
// noise+fresnel mix as the solid orb, so what explodes is unmistakably the
// orb itself breaking into fragments, not a generic particle cloud.
export const FRACTURE_VERTEX_SHADER = `
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
uniform float uFracture;
attribute vec3 aCentroid;
attribute vec3 aRandom;
varying float vNoise;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE_GLSL}
void main() {
  float n = snoise(position * uFreq + vec3(0.0, 0.0, uTime * 0.12));
  vNoise = n;
  vec3 p = position + normal * n * uAmp;
  // shrink each face toward its centroid, then scatter it outward
  p = aCentroid + (p - aCentroid) * (1.0 - 0.35 * uFracture);
  vec3 dir = normalize(aCentroid + aRandom * 1.2);
  p += dir * uFracture * (1.6 + 2.6 * abs(aRandom.x));
  vec4 worldPos = modelMatrix * vec4(p, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vPosW = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;
export const FRACTURE_FRAGMENT_SHADER = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorRim;
uniform float uOpacity;
uniform float uFracture;
varying float vNoise;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 viewDir = normalize(cameraPosition - vPosW);
  float fresnel = pow(1.0 - clamp(dot(viewDir, vNormalW), 0.0, 1.0), 2.1);
  vec3 base = mix(uColorA, uColorB, smoothstep(-0.6, 0.6, vNoise));
  vec3 color = mix(base, uColorRim, fresnel * 0.85);
  gl_FragColor = vec4(color, uOpacity * uFracture);
}
`;

/**
 * The shapes on offer, and what each one is.
 *
 * Shapes rather than settings: a sphere, an angular solid and a knotted ring read as different
 * sites from across the room, which is the only reason to offer a choice at all. Every one of
 * them goes through the SAME displacement shader and the same material, so a change of shape
 * costs nothing at runtime and cannot make the page slower.
 *
 * The radii differ because these solids do not enclose the same volume at the same radius: a
 * tetrahedron at 2.9 reads as much smaller than a sphere at 2.9, so it is drawn larger to
 * occupy the same corner of the screen. Those numbers are hand-set per shape for that reason
 * and are not a scale the admin sets — the admin's `scale` multiplies whatever this produces.
 *
 * There used to be a fourth entry, "custom", described as "the same renderer with the numbers
 * exposed". It built an icosahedron: picking it changed nothing at all, because the numbers
 * were already exposed and already applied to every shape. A shape that is not a shape is
 * worse than no entry — it is the one a reader picks when they want the sliders to work.
 */
export const SCENE_SHAPES = [
  // The six platonic/torus silhouettes the scene shipped with.
  'orb', 'prism', 'crystal', 'gem', 'ring', 'halo',
  // Five that are not a subdivided ball. Each was chosen for a silhouette the first six cannot
  // reach at any slider setting, not for a different number of faces on the same ball:
  //   cube     right angles and flat squares — the only shape here with a corner you can name
  //   spire    one point and a wide base; the only vertically asymmetric solid
  //   capsule  tall, round-ended; the only one whose height is twice its width
  //   spiral   a coil — more negative space than solid, and it reads as motion when still
  //   vase     a revolved profile with a waist; a curve that goes in and back out
  'cube', 'spire', 'capsule', 'spiral', 'vase',
];

/**
 * The path the `spiral` shape is swept along: a helix whose radius swells in the middle, so
 * the coil reads as a barrel rather than a spring.
 *
 * Sampled into a CatmullRomCurve3 rather than written as a THREE.Curve subclass. A subclass is
 * the textbook way and it is one method — but that method has to be called `getPoint`, and the
 * repo's crash-at-render lint reads a method definition as a call to an undefined function and
 * fails the build on it. 96 samples through a smooth interpolation is visually identical here
 * (the tube takes 70-270 segments along it) and costs one array built once at module load.
 */
const HELIX = new THREE.CatmullRomCurve3(
  Array.from({ length: 97 }, (_, i) => {
    const t = i / 96;
    const a = t * Math.PI * 4.4;                              // 2.2 turns
    const r = 2.35 * (0.55 + 0.45 * Math.sin(t * Math.PI));   // fat at the middle, tight at the ends
    return new THREE.Vector3(Math.cos(a) * r, -2.9 + 5.8 * t, Math.sin(a) * r);
  }),
  false, 'catmullrom', 0.5,
);

/**
 * The `vase` profile, revolved by LatheGeometry. Points are (radius, height) in the XY plane;
 * the radius is floored at 0.15 because a lathe through radius 0 makes degenerate triangles
 * whose normals are NaN — and the displacement shader multiplies by `normal`, so one NaN
 * normal takes the whole vertex off screen.
 */
const VASE_PROFILE = (() => {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const r = 0.5 + 1.9 * Math.sin(Math.PI * (0.12 + 0.8 * t)) + 0.45 * Math.sin(t * 6);
    pts.push(new THREE.Vector2(Math.max(0.15, r), -3 + 6 * t));
  }
  return pts;
})();

export function buildGeometry(shape, detail) {
  // The per-shape ceiling comes from scene-config.js, which the editor reads too: the slider
  // stops where the shape stops instead of offering values that draw the same thing.
  const d = Math.max(0, Math.min(detailMaxFor(shape), Number(detail) || 0));
  switch (shape) {
    // Four faces. The flattest silhouette here, and the cheapest.
    case 'prism': return new THREE.TetrahedronGeometry(3.6, d);
    // Eight. Reads as a cut stone rather than a die, and takes the noise well because
    // its faces are large enough for the displacement to show inside one.
    case 'crystal': return new THREE.OctahedronGeometry(3.2, d);
    // Twelve pentagons. The most face detail before the silhouette becomes a sphere,
    // so it is the one to pick when the noise is turned down and the facets do the work.
    case 'gem': return new THREE.DodecahedronGeometry(2.95, d);
    // A knotted torus. Its two segment counts are derived from `detail` so the slider still
    // means "smoother" here rather than doing nothing.
    case 'ring': return new THREE.TorusKnotGeometry(1.85, 0.62, 60 + d * 30, 8 + d * 4);
    // A plain ring. The knot is busy; this is the same idea with one hole and a clean
    // silhouette, which is what a page with a lot of text in front of it wants.
    case 'halo': return new THREE.TorusGeometry(2.5, 0.78, 12 + d * 6, 60 + d * 30);
    // Six flat squares. `detail` is segments per edge here, not subdivisions of a solid: a cube
    // with one segment per face has nothing for the noise to push, so the surface would stay
    // dead flat at detail 0 while every other shape moved. 4.3 rather than 2.9 because a cube
    // reads by its inscribed sphere, which is half its edge.
    case 'cube': return new THREE.BoxGeometry(4.3, 4.3, 4.3, 1 + d * 2, 1 + d * 2, 1 + d * 2);
    // One point, one wide base. Drawn taller than wide on purpose — the shapes above are all
    // roughly as tall as they are broad, so this is the one that changes the page's balance.
    case 'spire': return new THREE.ConeGeometry(2.45, 6, 6 + d * 6, 1 + d * 2);
    // A pill. Round ends, straight sides: no facets at all, which is the opposite end of the
    // range from `prism` and the shape to pick when the noise is turned up.
    case 'capsule': return new THREE.CapsuleGeometry(1.7, 3.2, 3 + d * 3, 10 + d * 8);
    // A tube swept along the helix above. The heaviest shape here (14k triangles at 5, still
    // under `halo`'s 17.6k), and the only one that is mostly empty space.
    case 'spiral': return new THREE.TubeGeometry(HELIX, 70 + d * 40, 0.42, 6 + d * 4, false);
    // The profile above, revolved. `detail` is the number of segments around, so the slider
    // goes from a faceted 14-sided revolve to a smooth one rather than doing nothing.
    case 'vase': return new THREE.LatheGeometry(VASE_PROFILE, 14 + d * 10);
    default: return new THREE.IcosahedronGeometry(2.9, d);
  }
}

// SCENE_DEFAULTS moved to scene-config.js (re-exported above). The API is the authority on
// what is STORED; that module is the authority on what is DRAWN when a key is missing.

/**
 * The halo's opacity on a given frame.
 *
 * It used to be `0.4 + sin * 0.08` in the hero, whatever the setting said: the Halo slider only
 * decided whether the sprite existed, so 5 % and 100 % drew the same halo. Now the setting is
 * the level and the shimmer rides on it, scaled so the shipped 0.45 draws exactly what it
 * always drew (0.40 ± 0.08). Shared with the preview, which had its own third answer.
 */
export function glowOpacity(glow, t, scrollEnergy = 0) {
  const g = Math.max(0, Number(glow) || 0);
  if (!g) return 0;
  return g * (0.889 + Math.sin(t * 0.5) * 0.178) + scrollEnergy * 0.12 * Math.min(1, g / 0.45);
}

/**
 * How the dust belt is drawn in each theme. One answer for the hero and the preview: the
 * preview used white additive specks in dark and the hero the accent, so the card showed a
 * different belt from the one behind it.
 */
export function twinkleLook(light, q) {
  return light
    ? { color: cssHex('--primary', 0xf97316), size: 0.11, base: 0.55, blending: THREE.NormalBlending }
    : { color: q.colorB, size: 0.07, base: 0.32, blending: THREE.AdditiveBlending };
}

/**
 * Where the shape rests on screen, and how big it reads, for a still CSS rendering of it.
 *
 * The fallback for a machine that cannot run WebGL at all, and the cover while a lost context
 * comes back. It used to be a vague radial glow in the corner, which is "nothing" with a tint:
 * the page lost its scene and got an unrelated gradient. This projects the hero's own resting
 * position through the hero's own camera, so the still one sits where the live one sits, at
 * the size it draws, in the palette it uses. Percentages of the viewport, so it survives a
 * resize by being recomputed, not by guessing.
 */
export const REST_POS = { x: 5.3, y: 3.0, z: -4 };
export function restingFrame(scale = 1, w = window.innerWidth, h = window.innerHeight) {
  const cam = new THREE.PerspectiveCamera(50, Math.max(1, w) / Math.max(1, h), 0.1, 100);
  cam.position.set(0, 0, 11);
  cam.lookAt(REST_POS.x * 0.3, REST_POS.y * 0.3, 0);
  cam.updateMatrixWorld();
  const c = new THREE.Vector3(REST_POS.x, REST_POS.y, REST_POS.z).project(cam);
  const e = new THREE.Vector3(REST_POS.x, REST_POS.y + 2.9 * scale, REST_POS.z).project(cam);
  const x = (c.x + 1) / 2 * 100;
  const y = (1 - c.y) / 2 * 100;
  const rPx = Math.abs(e.y - c.y) / 2 * h;
  return { xPct: x, yPct: y, radiusPx: rPx };
}

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
