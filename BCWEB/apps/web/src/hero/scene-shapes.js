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
export const SCENE_SHAPES = ['orb', 'prism', 'crystal', 'gem', 'ring', 'halo'];

export function buildGeometry(shape, detail) {
  const d = Math.max(0, Math.min(5, Number(detail) || 0));
  switch (shape) {
    // Four faces. The flattest silhouette here, and the cheapest.
    case 'prism': return new THREE.TetrahedronGeometry(3.6, Math.min(3, d));
    // Eight. Reads as a cut stone rather than a die, and takes the noise well because
    // its faces are large enough for the displacement to show inside one.
    case 'crystal': return new THREE.OctahedronGeometry(3.2, Math.min(3, d));
    // Twelve pentagons. The most face detail before the silhouette becomes a sphere,
    // so it is the one to pick when the noise is turned down and the facets do the work.
    case 'gem': return new THREE.DodecahedronGeometry(2.95, Math.min(2, d));
    // A knotted torus. Its two segment counts are derived from `detail` so the slider still
    // means "smoother" here rather than doing nothing.
    case 'ring': return new THREE.TorusKnotGeometry(1.85, 0.62, 60 + d * 30, 8 + d * 4);
    // A plain ring. The knot is busy; this is the same idea with one hole and a clean
    // silhouette, which is what a page with a lot of text in front of it wants.
    case 'halo': return new THREE.TorusGeometry(2.5, 0.78, 12 + d * 6, 60 + d * 30);
    default: return new THREE.IcosahedronGeometry(2.9, d);
  }
}

/**
 * Every default, in one object.
 *
 * These are the values the API applies when a row is missing a key, written here as well so a
 * scene can be built from nothing (the preview, a failed request, a first visit). The API is
 * the authority on what is STORED; this is the authority on what is DRAWN, and the check
 * `check-scene-contract.mjs` holds the two lists to each other.
 */
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
  // How a section arrives when it scrolls into view. Applied by `applyReveal` below.
  reveal: 'rise',
  glow: 0.45,
  twinkles: 110,
};

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
