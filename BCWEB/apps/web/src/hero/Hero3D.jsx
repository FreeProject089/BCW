import { Component, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { useIntro, SKIP_KEY } from '../ui/IntroContext.jsx';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';
import {
  isLight, palette, VERTEX_SHADER, FRAGMENT_SHADER,
  FRACTURE_VERTEX_SHADER, FRACTURE_FRAGMENT_SHADER,
  buildGeometry, SCENE_DEFAULTS, readSceneConfig,
  glowOpacity, twinkleLook, restingFrame, REST_POS,
} from './scene-shapes.js';
import { STATIC_CLIP, RING_MASK, isRingShape } from './scene-still.js';

// v4 — the intro loader and the background are now literally the same canvas:
// the orb starts big and centered (the "loading" moment), then GSAP animates it
// down to its small, off-to-the-corner steady-state position as the real page
// fades in underneath — no separate splash screen, no hand-off flash. Once
// steady, the orb reacts to both the cursor (as before) and page scroll (a slow
// parallax drift, luxury-brand subtle, not a gimmick). No dust/particles — one
// clean shape.

// Three r16x is WebGL2-only. Some environments block it (WebGL disabled, headless
// capture / screenshot services, "AllowWebgl2:false"). Probe once so we can skip the
// 3D orb cleanly instead of letting THREE.WebGLRenderer spam the console and throw.
function webglAvailable() {
  try {
    if (!window.WebGL2RenderingContext) return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    // A probe, not a context to keep. Released now rather than whenever the canvas happens to be
    // collected: a page holds ONE live WebGL context (hero/scene-stage.js), and a forgotten probe
    // was measured as a second one next to the scene.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

// Steady-state ("background") framing vs. the dramatic centered intro framing. The resting
// position is shared with the still CSS rendering (restingFrame), so both put it in one place.
const BG_POS = REST_POS;
const HERO_POS = { x: 0, y: 0.3, z: 2 };
const BG_SCALE = 1;
const HERO_SCALE = 1.5;

// ── the still rendering: the same scene, drawn once in CSS ───────────────────────────────
//
// What the page shows when WebGL cannot draw at all, and while a lost context comes back. It
// used to be a soft radial glow in a corner, which is nothing with a tint: the site's largest
// visual simply vanished on exactly the machines and moments where it failed. This is the
// scene's own shape at the scene's own resting place and size (restingFrame projects it
// through the hero's camera), shaded with the palette the shader uses, with its halo. A disc
// for the round solids, a clipped polygon for the flat ones, a ring for the two tori. The
// outlines are in scene-still.js (no three.js), shared with a studio page's 3D background.
const hex6 = (n) => `#${Number(n).toString(16).padStart(6, '0')}`;
export function paintStaticScene(el, cfg) {
  if (!el) return;
  const c = { ...SCENE_DEFAULTS, ...(cfg || {}) };
  let layer = el.querySelector(':scope > [data-scene-static]');
  if (!layer) {
    layer = document.createElement('div');
    layer.setAttribute('data-scene-static', '');
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    el.appendChild(layer);
  }
  const q = palette();
  const f = restingFrame(c.scale);
  const d = Math.max(40, f.radiusPx * 2);
  const at = `left:${f.xPct}%;top:${f.yPct}%;transform:translate(-50%,-50%);position:absolute;`;
  const ring = isRingShape(c.shape);
  const body = `radial-gradient(circle at 34% 30%, ${hex6(q.rim)} 0%, ${hex6(q.colorA)} 30%, ${hex6(q.colorB)} 78%, color-mix(in srgb, ${hex6(q.colorB)} 60%, transparent) 100%)`;
  const ringMask = RING_MASK;
  const glow = Math.max(0, Number(c.glow) || 0);
  layer.innerHTML = '';
  if (glow > 0) {
    const halo = document.createElement('div');
    halo.style.cssText = `${at}width:${d * 1.9}px;height:${d * 1.9}px;border-radius:50%;`
      + `background:radial-gradient(circle, color-mix(in srgb, ${hex6(q.colorB)} ${Math.round(glow * 70)}%, transparent) 0%, transparent 62%);`;
    layer.appendChild(halo);
  }
  const shape = document.createElement('div');
  shape.style.cssText = `${at}width:${d}px;height:${d}px;border-radius:${STATIC_CLIP[c.shape] ? '0' : '50%'};`
    + `background:${body};opacity:${Math.min(1, (c.opacity / SCENE_DEFAULTS.opacity) * 0.92)};filter:blur(0.6px);`
    + (STATIC_CLIP[c.shape] ? `clip-path:${STATIC_CLIP[c.shape]};` : '')
    + (ring ? `-webkit-mask:${ringMask};mask:${ringMask};` : '');
  layer.appendChild(shape);
  el.setAttribute('data-scene-state', el.getAttribute('data-scene-state') === 'lost' ? 'lost' : 'static');
}
export function clearStaticScene(el) {
  const layer = el?.querySelector(':scope > [data-scene-static]');
  if (layer) layer.remove();
}

// A decorative backdrop must not be able to take the site down. An exception in the scene's
// setup (a driver that throws inside a shader compile, a geometry that cannot be built) used to
// travel to the ROOT error boundary, which replaces the whole app with a crash card. Here it
// stops at the backdrop, and the backdrop falls back to its still rendering rather than to
// nothing.
class SceneBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; this.ref = { current: null }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.warn('[scene] the 3D backdrop failed, showing its still rendering instead:', err?.message || err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <StaticBackdrop />;
  }
}
function StaticBackdrop() {
  const ref = useRef(null);
  const { finish } = useIntro();
  // The intro overlay belonged to the scene that failed; the page it was holding back must
  // still be revealed, or a crashed backdrop would leave the site hidden behind a loader.
  useEffect(() => { finish(); }, [finish]);
  useEffect(() => {
    let cfg = null;
    let on = true;
    const paint = () => { if (ref.current) paintStaticScene(ref.current, cfg); };
    void readSceneConfig().then((c) => { if (on) { cfg = c; paint(); } });
    paint();
    window.addEventListener('resize', paint);
    return () => { on = false; window.removeEventListener('resize', paint); };
  }, []);
  return <div ref={ref} data-scene-state="static" className="fixed inset-0 -z-10 pointer-events-none" aria-hidden="true" style={{ opacity: 0.55 }} />;
}

export default function Hero3D() {
  return <SceneBoundary><Hero3DScene /></SceneBoundary>;
}

function Hero3DScene() {
  const { t } = useI18n();
  const { active, finish } = useIntro();
  // Unmounted while the intro still holds the site (a first page that brings its own 3D
  // background takes the stage from this component, hero/scene-stage.js): the overlay goes with
  // this component, so the site it was holding back must be revealed on the way out, or it
  // would stay hidden behind nothing. `finish` is idempotent and a new function every render,
  // hence the ref. Checked a tick later, not in the cleanup itself: StrictMode unmounts and
  // remounts every component once in development, and finishing there would skip the intro.
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      setTimeout(() => { if (!alive.current) finishRef.current(); }, 0);
    };
  }, []);
  const mount = useRef(null);
  const logoRef = useRef(null);
  const barRef = useRef(null);
  const [showOverlay, setShowOverlay] = useState(active);
  const [dontShow, setDontShow] = useState(false);
  const dontShowRef = useRef(false);
  const skipRef = useRef(() => {});
  const showOverlayRef = useRef(showOverlay);
  useEffect(() => { dontShowRef.current = dontShow; }, [dontShow]);
  useEffect(() => { showOverlayRef.current = showOverlay; }, [showOverlay]);

  // Which shape, from the site's own settings.
  //
  // Nothing here waits on the network. This component paints the whole backdrop and holds the
  // intro overlay on top of the site until it is ready, so a slow or failed /site/scene would
  // be a white page with a loader on it — the shape is a preference, and a preference must
  // never be able to do that. Defaults on failure, and after 1.2s regardless.
  // NOT `scene`. The effect below declares `const scene = new THREE.Scene()`, and a `const`
  // shadows its whole scope rather than the lines after it — so reading this one at the top
  // of that effect was a read inside the other one's temporal dead zone, and the page did
  // not render at all.
  const [sceneCfg, setSceneCfg] = useState(null);
  // Bumped to rebuild the renderer from scratch: a lost WebGL context that the browser does
  // not hand back within a few seconds gets a NEW canvas and a new context rather than
  // leaving the page on the still rendering for the rest of the visit. Capped per page load.
  const [gen, setGen] = useState(0);
  const rebuilds = useRef(0);
  useEffect(() => {
    let on = true;
    // The shared reader. It carries the deadline and the fallback that used to be here — the
    // scroll-reveal style comes out of the same response and is applied on every page, so a
    // second fetch would be two readers applying the same defaults in two places.
    void readSceneConfig().then((d) => { if (on) setSceneCfg(d); });
    return () => { on = false; };
  }, []);

  useEffect(() => {
    const el = mount.current;
    if (!el || !sceneCfg) return;

    const setState = (v) => { el.setAttribute('data-scene-state', v); };
    const reveal = () => { setShowOverlay(false); finish(); };
    // The still rendering of the SAME scene (see paintStaticScene) for a machine that cannot
    // run WebGL at all. Reveals the page immediately so the intro loader never hangs on top of
    // the site. Kept in step with a resize, because it is positioned in viewport terms.
    const goStatic = () => {
      el.style.background = '';
      el.style.opacity = String(palette().heroOp);
      paintStaticScene(el, sceneCfg);
      setState('static');
      reveal();
      const onR = () => paintStaticScene(el, sceneCfg);
      window.addEventListener('resize', onR);
      return () => { window.removeEventListener('resize', onR); clearStaticScene(el); };
    };
    // The soft page glow, for a scene an ADMIN switched off. Off means off: this is not a
    // fallback for a failure, so it does not draw the shape, only the atmosphere it sat in.
    const paintStaticGlow = () => {
      // From the palette, not two amber literals. This is the backdrop every machine that
      // cannot run the orb gets — and the one the adaptive watchdog bails to — so a site
      // whose accent is blue was getting an orange halo precisely on the machines where the
      // backdrop is all there is. `palette()` already answers "what colour is the orb" for
      // the shader; the same answer, as CSS.
      const q = palette();
      const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
      el.style.background = isLight()
        ? `radial-gradient(1100px 780px at 80% 16%, color-mix(in srgb, ${hex(q.colorB)} 34%, transparent), color-mix(in srgb, ${hex(q.colorA)} 12%, transparent) 42%, transparent 70%)`
        : `radial-gradient(1100px 780px at 80% 16%, color-mix(in srgb, ${hex(q.colorB)} 26%, transparent), color-mix(in srgb, ${hex(q.colorA)} 16%, transparent) 42%, transparent 70%)`;
      el.style.opacity = '1';
      setState('off');
      reveal();
      return () => { el.style.background = ''; };
    };
    // Switched off site-wide by an admin: the atmosphere only, by choice.
    if (sceneCfg.enabled === false) return paintStaticGlow();
    // No WebGL2 at all: the still rendering of the scene, never nothing.
    if (!webglAvailable()) return goStatic();

    const W = () => window.innerWidth, H = () => window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W() / H(), 0.1, 100);
    camera.position.set(0, 0, 11);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch { return goStatic(); }
    // Cap at 1.5 (not 2): on HiDPI/4K screens a ratio of 2 quadruples the fragment
    // count for a background element — the single biggest fill-rate cost of the orb.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(W(), H());
    el.appendChild(renderer.domElement);

    // A software renderer (e.g. Firefox with webgl.force-enabled but no working GPU
    // path, or a VM/RDP) would run the orb's shaders on the CPU and lag hard. It used to be
    // thrown away for the static glow; it can still draw ONE frame perfectly well, so it draws
    // the real scene once and holds it (the "still" mode below) instead of animating it.
    let softwareGpu = false;
    try {
      const gl = renderer.getContext();
      // Plain RENDERER first. WEBGL_debug_renderer_info is deprecated — Firefox logs
      // "…is deprecated in Firefox and will be removed. Please use RENDERER." the moment
      // the extension is REQUESTED, so the warning cannot be avoided by ignoring the
      // result; the call itself has to go. Modern browsers put the real renderer in
      // RENDERER, which is all this check needs.
      let rname = '';
      try { rname = String(gl.getParameter(gl.RENDERER) || ''); } catch { /* keep '' */ }
      // Only fall back to the extension when RENDERER is one of the legacy placeholders
      // that told you nothing — old engines that predate the change, and which therefore
      // do not warn about it either.
      if (!rname || /^(webkit webgl|mozilla|opera)$/i.test(rname.trim())) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) rname = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
      }
      if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|warp/i.test(rname)) softwareGpu = true;
    } catch { /* detection unavailable — proceed with the orb */ }

    // ── the orb: one smooth icosahedron, displaced by noise in the vertex shader ──
    // detail 4 = 2562 verts on the icosahedron — smooth enough for a blurred, displaced shape
    // at a fraction of the per-frame vertex-shader cost of detail 5 (10242). The admin can go
    // higher; the API caps it at 5 for exactly that reason.
    // ── D4: scene transitions ──
    // A playlist: the configured shape first, then the admin's extra shapes. With fewer than two
    // there is nothing to move between and none of this runs (the shipped default).
    const TR = sceneCfg.transitions || {};
    const TRG = TR.triggers || {};
    const playlist = [sceneCfg.shape, ...((TR.shapes || []).filter((x) => x && x !== sceneCfg.shape))];
    const canCycle = playlist.length > 1;
    // Reduced motion: no animated transition, ever. `reload` still rotates the shape, because
    // the first frame of a page is not a movement.
    const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let shapeIdx = 0;
    if (canCycle && TRG.reload) {
      try {
        const prev = Number(localStorage.getItem('bcw.scene.idx'));
        shapeIdx = (Number.isInteger(prev) && prev >= 0 ? prev + 1 : 0) % playlist.length;
        localStorage.setItem('bcw.scene.idx', String(shapeIdx));
      } catch { shapeIdx = 0; }
    }
    let geo = buildGeometry(playlist[shapeIdx], sceneCfg.detail);
    // Which shape is on screen, on the mount: what a test (or a curious admin) can read.
    el.setAttribute('data-scene-shape', playlist[shapeIdx]);

    // Fracture shards: a coarser icosahedron (detail 2 = 320 faces). Icosahedron
    // geometry is ALREADY non-indexed (every face owns its 3 vertices — calling
    // .toNonIndexed() was a no-op that logged a console warning), so each face
    // can fly apart as one rigid piece as-is. Each face gets its centroid + one
    // shared random vector.
    // `toNonIndexed()` is conditional, and that condition is the whole reason this line reads
    // oddly. The fracture works by giving every FACE its own three vertices so it can fly
    // apart as one rigid piece — icosahedron and tetrahedron geometry is already built that
    // way (calling it on those was a no-op that logged a warning), but a torus knot is
    // indexed and shares vertices between faces, so without this the ring tore into ribbons.
    // D4: a function, because a scene transition swaps the shape and the shards must be the
    // new shape's faces, not the old one's.
    const makeFracture = (shape) => {
      const rawFracture = buildGeometry(shape, Math.min(2, sceneCfg.detail));
      const g = rawFracture.index ? rawFracture.toNonIndexed() : rawFracture;
      if (g !== rawFracture) rawFracture.dispose();
      const fPos = g.attributes.position;
      const centroidArr = new Float32Array(fPos.count * 3);
      const randArr = new Float32Array(fPos.count * 3);
      for (let f = 0; f < fPos.count / 3; f++) {
        const i0 = f * 3;
        const cx = (fPos.getX(i0) + fPos.getX(i0 + 1) + fPos.getX(i0 + 2)) / 3;
        const cy = (fPos.getY(i0) + fPos.getY(i0 + 1) + fPos.getY(i0 + 2)) / 3;
        const cz = (fPos.getZ(i0) + fPos.getZ(i0 + 1) + fPos.getZ(i0 + 2)) / 3;
        const rx = Math.random() * 2 - 1, ry = Math.random() * 2 - 1, rz = Math.random() * 2 - 1;
        for (let v = 0; v < 3; v++) {
          centroidArr.set([cx, cy, cz], (i0 + v) * 3);
          randArr.set([rx, ry, rz], (i0 + v) * 3);
        }
      }
      g.setAttribute('aCentroid', new THREE.BufferAttribute(centroidArr, 3));
      g.setAttribute('aRandom', new THREE.BufferAttribute(randArr, 3));
      return g;
    };
    let fractureGeo = makeFracture(playlist[shapeIdx]);

    // One number, read in three places (the initial value, the intro tween and the skip
    // path). Three literal 0.45s were three chances for the shape to settle at a different
    // amplitude depending on whether the visitor watched the intro.
    const AMP = 0.45 * sceneCfg.noise;
    // The framing constants are the composition — where the shape sits and how big it reads
    // against the page. `scale` multiplies both rather than replacing either, so a scene made
    // larger keeps the intro's proportion to its resting size instead of flattening it.
    const bgScale = BG_SCALE * sceneCfg.scale;
    const heroScale = HERO_SCALE * sceneCfg.scale;
    const uniforms = {
      uTime: { value: 0 },
      uAmp: { value: active ? 0 : AMP }, // starts flat during the intro, then "comes alive"
      uFreq: { value: 0.55 },
      uColorA: { value: new THREE.Color(0xffe0bf) },
      uColorB: { value: new THREE.Color(0xf3a869) },
      uColorRim: { value: new THREE.Color(0xfff7ec) },
      uOpacity: { value: 0.8 },
      uFracture: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      // Wireframe is the same material with its faces drawn as lines: same displacement, same
      // colours, same fresnel. A separate line material would be a second thing to keep in
      // step with the palette, and the first recolour would have left it behind.
      wireframe: sceneCfg.surface === 'wire',
    });
    const orb = new THREE.Mesh(geo, mat);
    scene.add(orb);

    // "Both" is a second mesh over the first, not a mode: a solid needs a *slightly larger*
    // wireframe or the lines z-fight with the faces they trace, and one mesh cannot be two
    // sizes. It shares the uniform objects, so it moves, breathes and recolours with the
    // solid for free.
    let wireOverlay = null;
    if (sceneCfg.surface === 'both') {
      wireOverlay = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, wireframe: true,
      }));
      wireOverlay.scale.setScalar(1.012);
      orb.add(wireOverlay);
    }

    // The shard material shares the SAME uniform objects (by reference) as the
    // solid mesh — colors, time, amp, and uFracture all stay in lockstep with
    // no per-frame syncing, and the shards render with the orb's exact skin.
    const fractureMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: uniforms.uTime, uAmp: uniforms.uAmp, uFreq: uniforms.uFreq, uFracture: uniforms.uFracture,
        uColorA: uniforms.uColorA, uColorB: uniforms.uColorB, uColorRim: uniforms.uColorRim, uOpacity: uniforms.uOpacity,
      },
      vertexShader: FRACTURE_VERTEX_SHADER, fragmentShader: FRACTURE_FRAGMENT_SHADER,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const fracturePoints = new THREE.Mesh(fractureGeo, fractureMat);
    orb.add(fracturePoints); // child of the orb → inherits its position/rotation/scale automatically

    // ── permanent backdrop: a soft glow halo + slow twinkles BEHIND the orb —
    //    subtle ambience that lives with the orb everywhere, not just the intro ──
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 256;
    const gctx = glowCanvas.getContext('2d');
    const grad = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    gctx.fillStyle = grad; gctx.fillRect(0, 0, 256, 256);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: sceneCfg.glow });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(11);
    glow.position.z = -2; // behind the orb surface
    // At 0 the sprite is not added at all rather than added at zero opacity: an invisible
    // transparent sprite is still a draw call and still sorts, every frame, forever.
    if (sceneCfg.glow > 0) orb.add(glow);

    // The twinkles are a tilted BELT that genuinely orbits the orb (passing in
    // front and behind), not a static backdrop shell — a slow Saturn-ring drift.
    const twinkleCount = Math.round(sceneCfg.twinkles);
    const tArr = new Float32Array(twinkleCount * 3);
    for (let i = 0; i < twinkleCount; i++) {
      const r = 3.5 + Math.random() * 2.4;                 // ring radius band
      const theta = Math.random() * Math.PI * 2;           // position on the ring
      tArr[i * 3] = r * Math.cos(theta);
      tArr[i * 3 + 1] = (Math.random() - 0.5) * 1.7;       // belt thickness
      tArr[i * 3 + 2] = r * Math.sin(theta);
    }
    const twinkleGeo = new THREE.BufferGeometry();
    twinkleGeo.setAttribute('position', new THREE.BufferAttribute(tArr, 3));
    const twinkleMat = new THREE.PointsMaterial({ size: 0.07, transparent: true, opacity: 0.45, depthWrite: false, sizeAttenuation: true });
    const twinkles = new THREE.Points(twinkleGeo, twinkleMat);
    twinkles.rotation.z = 0.4; twinkles.rotation.x = 0.25; // tilt the ring plane
    if (twinkleCount > 0) orb.add(twinkles);

    const applyPalette = () => {
      const q = palette();
      uniforms.uColorA.value.setHex(q.colorA);
      uniforms.uColorB.value.setHex(q.colorB);
      uniforms.uColorRim.value.setHex(q.rim);
      // The theme decides the CHARACTER of the surface (a tint by day, a glow by night);
      // this decides how much of it there is. Multiplying keeps both: the admin's number is
      // read against the shipped one, so 0.8 is unchanged and 0.4 is half as present in
      // either theme rather than half as present in one and opaque in the other.
      opacityBase = q.opacity * (sceneCfg.opacity / SCENE_DEFAULTS.opacity);
      uniforms.uOpacity.value = opacityBase * (1 - transAmt.v);
      mat.blending = q.blending;
      mat.needsUpdate = true;
      fractureMat.blending = q.blending;
      fractureMat.needsUpdate = true;
      glowMat.color.setHex(q.colorB);
      // Light theme: the pale peach twinkles washed out against the cream page, so they
      // take the saturated accent, bigger points and normal blending; dark keeps the airy
      // additive glow. One answer shared with the preview (twinkleLook).
      const tw = twinkleLook(isLight(), q);
      twinkleMat.color.setHex(tw.color);
      twinkleMat.size = tw.size; twinkleMat.blending = tw.blending;
      twinkleBase = tw.base;
      twinkleMat.needsUpdate = true;
      if (mount.current) mount.current.style.opacity = String(q.heroOp);
      requestStill();
    };
    let twinkleBase = 0.32;
    // D4: declared before applyPalette's first call, which reads both.
    let opacityBase = 0.8;
    const transAmt = { v: 0 };
    // Declared before applyPalette's first call, which asks for a still frame. Replaced by the
    // real scheduler once the loop exists; until then there is nothing to draw.
    let requestStill = () => {};
    applyPalette();
    const themeObs = new MutationObserver(applyPalette);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // data-theme only moves on the light/dark switch. A superadmin changing the site palette
    // leaves it exactly where it was, so the observer above never fires — the orb would keep
    // the old accent until a reload. applySiteTheme announces itself for precisely this.
    document.addEventListener('bcw:site-theme', applyPalette);

    // ── mouse parallax: the orb tilts slightly toward the cursor, never a full
    //    drag/orbit — just enough to feel alive without being distracting ──
    const mouse = { x: 0, y: 0 };
    const camBase = { x: 0, y: 0 }; // smoothed parallax base; the page-transition dive rides on top
    // ── fracture trigger: raycast the cursor against the orb mesh (its screen
    //    footprint is tiny in background mode, but that's fine — hovering the
    //    small corner orb is the whole point). GSAP tweens a shared target that
    //    tick() reads every frame into uniforms.uFracture.value. ──
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const fractureState = { value: 0 };
    let hovering = false;
    let recomposeTimer = null;
    // Re-roll each shard's fly-out direction so no two shatters look alike — the
    // orb bursts a different way every time it's poked. Only re-seeded when the
    // orb is (near) whole, so a re-roll can't visibly teleport shards mid-air.
    const reseedFracture = () => {
      const ra = fractureGeo.attributes.aRandom;
      for (let f = 0; f < ra.count / 3; f++) {
        const i0 = f * 3;
        const rx = Math.random() * 2 - 1, ry = Math.random() * 2 - 1, rz = Math.random() * 2 - 1;
        for (let v = 0; v < 3; v++) ra.array.set([rx, ry, rz], (i0 + v) * 3);
      }
      ra.needsUpdate = true;
    };
    const setFracture = (target, duration) => {
      if (target && fractureState.value < 0.15) reseedFracture(); // fresh shatter → new pattern
      gsap.killTweensOf(fractureState);
      gsap.to(fractureState, { value: target, duration, ease: target ? 'power2.out' : 'power2.inOut' });
    };

    // ── what the pointer does, as chosen ──────────────────────────────────
    //
    // One entry point — "the pointer is on it" / "it is not" — and the setting decides what
    // that means. It matters that this is a single function: the hover path, the tap path and
    // the page-transition flourish all called `setFracture` directly, so any new reaction
    // added beside it would have been applied by one of the three and not the others.
    //
    // `hoverAmt` is read by the frame loop. Tweened rather than switched, because every one of
    // these is a movement and a movement that arrives instantly is a glitch.
    const hoverAmt = { v: 0 };
    const HOVER = sceneCfg.hover || 'fracture';
    const setHover = (on) => {
      if (HOVER === 'none') return;
      if (HOVER === 'fracture') { setFracture(on ? 1 : 0, on ? 0.7 : 0.9); return; }
      gsap.killTweensOf(hoverAmt);
      gsap.to(hoverAmt, { v: on ? 1 : 0, duration: on ? 0.45 : 0.7, ease: on ? 'power2.out' : 'power2.inOut' });
    };
    const raycastHits = (clientX, clientY) => {
      ndc.x = (clientX / W()) * 2 - 1;
      ndc.y = -(clientY / H()) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObject(orb, false).length > 0;
    };
    const onMove = (e) => {
      mouse.x = e.clientX / W() - 0.5;
      mouse.y = e.clientY / H() - 0.5;
      if (showOverlayRef.current) return; // ignore during intro — orb isn't in its resting spot yet
      const hit = raycastHits(e.clientX, e.clientY);
      if (hit && !hovering) { hovering = true; clearTimeout(recomposeTimer); setHover(true); if (TRG.hover) goNext(); }
      else if (!hit && hovering) { hovering = false; setHover(false); }
    };
    window.addEventListener('pointermove', onMove);
    const onClick = (e) => {
      if (showOverlayRef.current) return;
      if (!raycastHits(e.clientX, e.clientY)) return;
      // touch devices (no real hover): react on tap, settle back shortly after. Whatever
      // the reaction is — a phone has no pointer to hold it open, so it is timed.
      clearTimeout(recomposeTimer);
      setHover(true);
      recomposeTimer = setTimeout(() => { if (!hovering) setHover(false); }, 1100);
    };
    window.addEventListener('click', onClick);

    // ── optional page-transition flourish (OFF by default; the router dispatches
    //    this event on navigation only when the user enabled it in Settings). The
    //    orb bursts, the camera dives toward a RANDOM real shard, then the orb
    //    recomposes. The camera dive is applied additively in the render loop so
    //    it rides on top of the live mouse parallax instead of fighting it. ──
    const orbTransition = { amt: 0, dirX: 0, dirY: 0 };
    const onPageTransition = () => {
      if (showOverlayRef.current) return; // don't fight the intro timeline
      // aim the dive at a random shard's centroid — its XY is the on-screen direction
      const cen = fractureGeo.attributes.aCentroid;
      const idx = Math.floor(Math.random() * cen.count) * 3;
      const cx = cen.array[idx], cy = cen.array[idx + 1];
      const len = Math.hypot(cx, cy) || 1;
      orbTransition.dirX = cx / len; orbTransition.dirY = cy / len;
      clearTimeout(recomposeTimer);
      gsap.killTweensOf(orbTransition);
      setFracture(1, 0.4); // burst (setFracture reseeds the pattern when the orb is whole)
      gsap.to(orbTransition, { amt: 1, duration: 0.5, ease: 'power2.out', onComplete: () => {
        if (!hovering) setFracture(0, 0.95); // rebuild the orb — unless the cursor is holding it open
        gsap.to(orbTransition, { amt: 0, duration: 0.95, ease: 'power2.inOut' });
      } });
    };
    window.addEventListener('bcweb:orb-transition', onPageTransition);

    // ── D4: move to the next shape of the playlist ──
    // Two looks, both built from what the scene already has: `fade` dims the surface out
    // (uOpacity, scaled from the palette's own value) and brings the next shape in; `burst`
    // breaks it into its faces (the existing fracture), swaps the shape at the peak, and the
    // faces that come back together are the next shape. The geometry swap happens at the
    // invisible/scattered moment, so no frame ever shows a shape popping into another.
    // Full frame rate only while it plays (`busy` in tick), then back to the idle budget.
    let transitioning = false;
    const swapShape = (shape) => {
      const g = buildGeometry(shape, sceneCfg.detail);
      const old = geo;
      geo = g;
      orb.geometry = g;
      if (wireOverlay) wireOverlay.geometry = g;
      old.dispose();
      const fg = makeFracture(shape);
      const oldF = fractureGeo;
      fractureGeo = fg;
      fracturePoints.geometry = fg;
      oldF.dispose();
      el.setAttribute('data-scene-shape', shape);
    };
    const goNext = () => {
      if (!canCycle || transitioning || reduceMotion || still || introRunning || ctxLost) return;
      if (document.hidden || blurred) return;
      transitioning = true;
      const half = Math.max(0.15, (Number(TR.durationMs) || 900) / 2000);
      shapeIdx = (shapeIdx + 1) % playlist.length;
      const next = playlist[shapeIdx];
      const done = () => { transitioning = false; };
      if (TR.style === 'burst') {
        clearTimeout(recomposeTimer);
        setFracture(1, half);
        gsap.killTweensOf(transAmt);
        // transAmt stays at 0 for a burst: it only keeps the loop at full rate while it plays.
        gsap.to(transAmt, { v: 0.002, duration: half, onComplete: () => {
          swapShape(next);
          if (!hovering) setFracture(0, half * 1.4);
          gsap.to(transAmt, { v: 0, duration: half * 1.4, onComplete: done });
        } });
      } else {
        gsap.killTweensOf(transAmt);
        gsap.to(transAmt, { v: 1, duration: half, ease: 'power2.in', onComplete: () => {
          swapShape(next);
          gsap.to(transAmt, { v: 0, duration: half, ease: 'power2.out', onComplete: done });
        } });
      }
    };
    const onRouteChange = () => { if (TRG.route) goNext(); };
    window.addEventListener('bcw:route-change', onRouteChange);
    // The interval does nothing while the tab is hidden or the window is behind another:
    // goNext() checks, so a tab left open for an hour does not queue sixty transitions.
    const transTimer = canCycle && TRG.interval && !reduceMotion
      ? setInterval(goNext, Math.max(5, Number(TR.intervalSec) || 30) * 1000) : 0;
    const onResize = () => {
      camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H()); measurePage();
      requestStill();
      if (ctxLost) paintStaticScene(el, sceneCfg);
    };
    window.addEventListener('resize', onResize);

    // ── scroll reactivity ─────────────────────────────────────────────────────
    //
    // The scroll drives a DRIFT, never a spin. A spin reads as wrong the instant you flick
    // the wheel, because its speed *is* the scroll's speed: the orb looks thrown rather than
    // carried, and a direction that fast has an obvious right and wrong. A drift is a
    // position, not a rate. It only ever travels one way down the page, and arriving late
    // looks deliberate instead of broken.
    //
    // The input is damped twice over. An exponential follow gives the motion its shape, and
    // a hard ceiling on the follow's velocity means that however far the page jumps in one
    // frame — a flick, a hash link, a programmatic scrollTo to the bottom — the orb moves at
    // the same graceful rate and simply takes longer to get there.
    let scrollTarget = 0;
    const SCROLL_FOLLOW = 2.2;   // per second — how eagerly the orb chases the page
    const SCROLL_MAX_VEL = 0.5;  // page-fractions per second — the ceiling on that chase
    // The journey scales with the page: a tall page (many screens of content) gives the orb
    // a deeper descent and a wider drift, a short page a shorter one. ~3 screens is the
    // baseline (×1); clamped so it never gets flat or dizzying.
    let pageSpan = 1;
    const measurePage = () => {
      const screens = document.documentElement.scrollHeight / Math.max(1, window.innerHeight);
      pageSpan = Math.min(2.2, Math.max(0.6, screens / 3));
    };
    const onScroll = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      scrollTarget = Math.min(1, window.scrollY / max);
      measurePage();
      requestStill();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    let scrollNow = 0;
    // How much the orb is MOVING right now, 0..1. A magnitude with no sign, so it cannot
    // point the wrong way: it drives the breathing and the shard shimmer, which is a
    // reaction to being scrolled that has no direction to get backwards.
    let scrollEnergy = 0;

    // ── intro choreography: the orb IS the loading animation. It starts large
    //    and centered, "comes alive" (noise amplitude ramps up from a flat
    //    sphere), holds a beat, then glides to its small background position
    //    while the logo fades — all one continuous scene, no hard cut. ──
    let baseX = BG_POS.x, baseY = BG_POS.y, baseZ = BG_POS.z;
    // Live, unlike `active`, which is the intro state captured when this effect ran and stays
    // true for its whole lifetime — a frame budget keyed on it would never engage after an
    // intro. Cleared by finishIntro, which both the timeline's end and the skip go through.
    let introRunning = !!active;
    if (active) {
      orb.position.set(HERO_POS.x, HERO_POS.y, HERO_POS.z);
      orb.scale.setScalar(0.35);
      // The orb BUILDS itself: start as a cloud of scattered shards (fully
      // fractured) and assemble them into the whole orb as it scales up — a
      // "materialising from its own pieces" intro rather than a plain scale-in.
      reseedFracture();
      fractureState.value = 1;
      const finishIntro = () => { introRunning = false; setShowOverlay(false); finish(); };
      const tl = gsap.timeline({ onComplete: finishIntro });
      tl.to(orb.scale, { x: heroScale, y: heroScale, z: heroScale, duration: 1.35, ease: 'back.out(1.4)' });
      tl.to(fractureState, { value: 0, duration: 1.5, ease: 'power3.inOut' }, '<'); // shards fly in + fuse into the orb
      tl.to(uniforms.uAmp, { value: AMP, duration: 1.3, ease: 'power2.out' }, '<0.35');
      tl.to({}, { duration: 0.55 }); // hold beat — let it breathe before the move
      tl.to(orb.position, { x: BG_POS.x, y: BG_POS.y, z: BG_POS.z, duration: 1.3, ease: 'power3.inOut', onUpdate: () => { baseX = orb.position.x; baseY = orb.position.y; baseZ = orb.position.z; } }, '+=0');
      tl.to(orb.scale, { x: bgScale, y: bgScale, z: bgScale, duration: 1.3, ease: 'power3.inOut' }, '<');
      tl.to(logoRef.current, { autoAlpha: 0, y: -14, duration: 0.5, ease: 'power2.in' }, '<');
      if (barRef.current) tl.to(barRef.current, { opacity: 0, duration: 0.3 }, '<');
      skipRef.current = () => {
        if (dontShowRef.current) localStorage.setItem(SKIP_KEY, '1');
        tl.kill();
        gsap.killTweensOf(fractureState);
        fractureState.value = 0; // whole orb when the build is skipped
        orb.position.set(BG_POS.x, BG_POS.y, BG_POS.z);
        orb.scale.setScalar(bgScale);
        uniforms.uAmp.value = AMP;
        baseX = BG_POS.x; baseY = BG_POS.y; baseZ = BG_POS.z;
        finishIntro();
      };
    } else {
      orb.position.set(BG_POS.x, BG_POS.y, BG_POS.z);
      orb.scale.setScalar(bgScale);
    }

    let raf, t = 0, ctxLost = false;
    const rotTarget = { x: 0, y: 0 };
    const baseScale = new THREE.Vector3(1, 1, 1);
    // ── per-page-load drift personality: which way it leans, how far it travels and
    //    where its slow vertical sway starts are re-rolled every visit, so the orb never
    //    takes exactly the same path twice. What is NOT re-rolled is the SHAPE: every roll
    //    is a single monotonic glide, so no visit gets a version that loops back on itself.
    const drift = {
      side: Math.random() < 0.5 ? 1 : -1,   // which way it leans out of frame
      sway: 2.2 + Math.random() * 1.4,      // how far sideways, in world units
      depth: 1.6 + Math.random() * 1.0,     // how far it recedes from the camera
      drop: 3.0 + Math.random() * 0.9,      // total descent
      phase: Math.random() * Math.PI * 2,   // where the slow vertical sway starts
    };
    // Which side of the page the orb is currently on — exposed as a CSS custom
    // property so the homepage reveal animations slide IN FROM the orb's side
    // (the content feels pushed out of its wake). Only written when it changes.
    let lastSide = 0;
    const setRevealSide = (side) => {
      if (side === lastSide) return;
      lastSide = side;
      document.documentElement.style.setProperty('--reveal-x', `${side * 44}px`);
    };
    // ── keeping it on screen ─────────────────────────────────────────────────────────
    //
    // Three modes, and none of them is "nothing":
    //   live   the render loop, on its frame budget.
    //   still  the SAME renderer and scene, drawn once and held: redrawn only when something
    //          moves it (a scroll, a resize, a theme change). What a software GPU gets from the
    //          start, and what a machine that cannot hold the budget falls to.
    //   lost   the WebGL context was taken away (a driver reset, a GPU switch, too many
    //          contexts in the browser). The still CSS rendering covers it until the browser
    //          gives the context back; if it does not within a few seconds, the renderer is
    //          rebuilt on a new canvas.
    //
    // The watchdog used to dispose the renderer and paint a gradient the first time a one
    // second window came in under half the target. One long task (a big admin chunk parsing,
    // a GC pause) or a throttled window was enough, it happened once per page load at most
    // and it was permanent: the backdrop was gone until a reload.
    //
    // Now: a window that contains a stall (> 250 ms between two frames) says nothing about the
    // GPU and is thrown away; the target a window is judged against is what that window was
    // mostly asked for, not what the last frame happened to want; it takes TWO bad windows in a
    // row; the consequence is `still`, not gone; and a still scene tries live again after 30 s.
    let winStart = 0, winFrames = 0, winBusy = 0, stage = 0, badWindows = 0, lastRaf = 0;
    let still = false, stillTimer = 0, reprobe = 0, stillQueued = 0;
    // The frame budget. `sceneCfg.fps` while idle; the display's own rate while something
    // fast is on screen — the intro, a hover reaction, the page-transition dolly — because
    // those are the moments a dropped frame would read as a stutter. A slowly drifting
    // backdrop at 30 cannot be told from 60; the core it pins can.
    const idleFps = Math.max(15, Math.min(60, Number(sceneCfg.fps) || 30));
    let lastDraw = 0;
    // A window behind another one is a window nobody is looking at. Hiding the tab already
    // paused this; leaving the site open behind an editor did not, and that was the report.
    // Paused is not removed: the canvas keeps its last frame on screen.
    let blurred = typeof document.hasFocus === 'function' ? !document.hasFocus() : false;
    const onBlur = () => { blurred = true; };
    const onFocus = () => { blurred = false; };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    // One frame of the scene: every update the loop makes, then a render.
    const step = (dt) => {
      try {
        t += 0.01 * sceneCfg.speed;
        // What the intro/scroll left the scale at, before `swell` multiplies it. Captured
        // every frame BEFORE the multiply, so the two never compound.
        if (HOVER !== 'swell' || hoverAmt.v < 0.001) baseScale.copy(orb.scale);
        uniforms.uTime.value = t;
        uniforms.uFracture.value = fractureState.value;
        // D4: the fade of a scene transition (1 = invisible, at the swap).
        uniforms.uOpacity.value = opacityBase * (1 - transAmt.v);
        // ── the damped scroll input ──
        // An exponential follow whose velocity is clipped: `want` is where an undamped
        // follow would go this second, the clamp is the ceiling the eye is allowed to see,
        // and the final min() stops the step overshooting the target on a slow frame. No
        // allocation, four numbers.
        const gap = scrollTarget - scrollNow;
        let want = gap * SCROLL_FOLLOW;
        if (want > SCROLL_MAX_VEL) want = SCROLL_MAX_VEL;
        else if (want < -SCROLL_MAX_VEL) want = -SCROLL_MAX_VEL;
        const step = want * dt;
        scrollNow += Math.abs(step) > Math.abs(gap) ? gap : step;
        // …and its magnitude, eased so it swells and fades rather than flickering.
        const energyNow = Math.min(1, Math.abs(want) / SCROLL_MAX_VEL);
        scrollEnergy += (energyNow - scrollEnergy) * Math.min(1, dt * 3);
        // Slow CONSTANT auto-rotation, plus a small cursor-driven tilt on top. Constant is
        // the point: this used to be multiplied by the scroll position, which is what made a
        // fast scroll read as the orb being spun. Now the rotation is the orb's own pulse
        // and the scroll is only ever a drift.
        // `swell` and `spin` ride on top of everything else rather than replacing it: the
        // scroll drift, the cursor tilt and the intro all still own what they owned.
        const hv = hoverAmt.v;
        rotTarget.y += 0.096 * sceneCfg.speed * dt * (HOVER === 'spin' ? 1 + hv * 3.5 : 1);
        rotTarget.x += (mouse.y * 0.35 - rotTarget.x) * 0.02;
        orb.rotation.y = rotTarget.y;
        orb.rotation.x += (rotTarget.x - orb.rotation.x) * 0.06;
        orb.rotation.z += (mouse.x * 0.12 - orb.rotation.z) * 0.02;
        if (HOVER === 'swell') {
          // The surface breathes out and the distortion rises with it. Multiplying the base
          // scale rather than setting one: the intro tween owns `orb.scale` for its first
          // second and a half, and writing an absolute value here would fight it.
          const k = 1 + hv * 0.13;
          orb.scale.set(baseScale.x * k, baseScale.y * k, baseScale.z * k);
          uniforms.uAmp.value = AMP * (1 + hv * 0.55) * (1 + scrollEnergy * 0.3);
        } else if (HOVER === 'spin') {
          orb.rotation.x += hv * 0.004;
        }
        // background-mode-only parallax descent. One monotonic glide: the orb leans out to
        // its chosen side, sinks, and recedes — three curves that only ever go one way for
        // the whole page, so there is no orbit whose rate could betray the scroll and no
        // point at which the motion could be running "backwards". The vertical sway on top
        // is driven by TIME, not by the scroll, so it keeps its own unhurried rhythm at any
        // scroll speed. Skipped while the intro timeline still owns orb.position.
        if (!showOverlayRef.current) {
          // smoothstep: eases away from the top of the page and settles at the bottom
          // instead of stopping dead, and stays monotonic in between.
          const s = Math.min(1, Math.max(0, scrollNow));
          const ease = s * s * (3 - 2 * s);
          // pageSpan scales the journey with the page height (a deeper descent on a long
          // page, a shorter one on a short page).
          orb.position.x = baseX + drift.side * ease * drift.sway;
          orb.position.y = baseY - ease * drift.drop * pageSpan + Math.sin(t * 0.35 + drift.phase) * 0.4;
          orb.position.z = baseZ - ease * drift.depth;
          // a touch of lean in the direction of travel — a position, not a rate, so it
          // cannot spin however hard the page is flicked
          orb.rotation.z += (drift.side * ease * 0.22 - orb.rotation.z) * 0.05;
          // breathing: the displacement swells while the page is moving and settles the
          // moment it stops. Amplitude, not angle — there is no wrong way to breathe.
          if (HOVER !== 'swell') uniforms.uAmp.value = AMP * (1 + scrollEnergy * 0.3);
          // tell the page which side the orb is on, so reveals enter from there
          setRevealSide(orb.position.x >= 0 ? 1 : -1);
        }
        // ambience: the twinkle belt genuinely ORBITS the orb (its own spin on
        // top of the orb's rotation) + a gentle breathing shimmer on the glow.
        // Both catch a little extra light while the page is moving — the shards' answer
        // to a fast scroll, in place of the old spin.
        twinkles.rotation.y = t * 0.3;
        twinkleMat.opacity = twinkleBase + Math.sin(t * 0.8) * 0.16 + scrollEnergy * 0.22;
        // The setting is the level and the shimmer rides on it (glowOpacity). This line used to
        // be `0.4 + sin * 0.08` whatever the Halo slider said.
        glowMat.opacity = glowOpacity(sceneCfg.glow, t, scrollEnergy);
        // barely-there parallax on the camera itself too — smoothed into camBase
        // so the page-transition dive can be layered on top without the parallax
        // easing fighting/absorbing it frame to frame.
        camBase.x += (mouse.x * 1.2 - camBase.x) * 0.02;
        camBase.y += (-mouse.y * 0.8 - camBase.y) * 0.02;
        camera.position.x = camBase.x + orbTransition.dirX * orbTransition.amt * 2.4;
        camera.position.y = camBase.y + orbTransition.dirY * orbTransition.amt * 2.4;
        camera.position.z = 11 - orbTransition.amt * 5.5; // dolly in toward the shard
        camera.lookAt(orb.position.x * 0.3, orb.position.y * 0.3, 0);
        renderer.render(scene, camera);
      } catch { /* a frame that throws is skipped; the next one is already queued */ }
    };

    // Still mode's redraw: one frame, soon, and only one however many things ask for it.
    // The scroll follow is snapped to its target, since there is no loop to glide it there.
    requestStill = () => {
      if (!still || ctxLost || stillQueued) return;
      stillQueued = requestAnimationFrame(() => {
        stillQueued = 0;
        scrollNow = scrollTarget; scrollEnergy = 0;
        step(1 / 60);
      });
    };
    const goStill = (why) => {
      if (still) return;
      still = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      // A still scene cannot hold a pointer reaction open, so none starts.
      gsap.killTweensOf(hoverAmt); hoverAmt.v = 0;
      gsap.killTweensOf(fractureState); fractureState.value = 0;
      setState('still');
      el.setAttribute('data-scene-why', why);
      requestStill();
      // A weak moment is not a weak machine. Try live again later, on a doubling interval
      // (30 s, 60 s, 120 s…), so a machine that really cannot keep up is asked less and less.
      // A software GPU is not re-asked: that answer does not change during a visit.
      if (why !== 'software') {
        clearTimeout(stillTimer);
        stillTimer = setTimeout(() => {
          reprobe++;
          still = false; stage = 1; badWindows = 0; winStart = 0; winFrames = 0; winBusy = 0;
          setState('live');
          el.removeAttribute('data-scene-why');
          tick();
        }, 30000 * 2 ** Math.min(4, reprobe));
      }
    };

    const tick = () => {
      if (still) return;
      raf = requestAnimationFrame(tick);
      if (ctxLost) return;
      // Pause work while the tab/page is hidden or the window is behind another — no point
      // rendering what nobody sees.
      if (document.hidden || blurred) { winStart = 0; winFrames = 0; winBusy = 0; lastRaf = 0; return; }
      const now = performance.now();
      // A stall (a long task on the main thread, a throttled or backgrounded window) is not
      // a slow GPU. The window it lands in is discarded rather than judged.
      if (lastRaf && now - lastRaf > 250) { winStart = 0; winFrames = 0; winBusy = 0; }
      lastRaf = now;
      // Busy = full rate. Everything else waits for its slot in the budget. `- 2` so a
      // display at exactly the budget's rate is not skipped every other frame by jitter.
      // Scrolling counts as busy: it is one of the moments a dropped frame reads as a
      // stutter, and scrollEnergy decays to nothing about a second after the page stops,
      // so this cannot pin the core on an idle page.
      const busy = introRunning || hoverAmt.v > 0.001 || fractureState.value > 0.001 || orbTransition.amt > 0.001 || scrollEnergy > 0.02 || transAmt.v > 0.001;
      const target = busy ? 60 : idleFps;
      if (!busy && now - lastDraw < 1000 / target - 2) return;
      // Seconds since the frame we actually DREW, so the damping below runs at the same
      // real-world rate whatever the frame budget is — a 30 fps budget used to halve every
      // per-frame easing constant in this loop. Clamped: the first frame (lastDraw 0) and a
      // frame after a long pause would otherwise integrate a huge step in one go.
      const dt = Math.min(0.1, Math.max(0.001, (now - lastDraw) / 1000));
      lastDraw = now;
      if (!winStart) winStart = now;
      winFrames++;
      if (busy) winBusy++;
      if (now - winStart >= 1000) {
        const fps = winFrames / ((now - winStart) / 1000);
        // What this window was MOSTLY asked for. Judging a mostly idle window against 60
        // because its last frame was busy read a healthy 30 fps budget as a failing machine.
        const winTarget = winBusy * 2 > winFrames ? 60 : idleFps;
        winStart = now; winFrames = 0; winBusy = 0;
        if (stage === 0) stage = 1; // warm-up (shader compile), ignored
        else if (stage === 1) {
          // First lever: the pixel ratio, which is most of the fill cost.
          if (fps < winTarget * 0.8 && renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); renderer.setSize(W(), H()); }
          stage = 2;
        } else {
          badWindows = fps < winTarget * 0.45 ? badWindows + 1 : 0;
          if (badWindows >= 2) { goStill('budget'); return; }
        }
      }
      step(dt);
    };

    // ── a lost context ──
    // preventDefault is what tells the browser we want the context back. three.js listens
    // for the same two events and re-initialises its own state on restore; what is ours is
    // the cover while it is gone, and the rebuild if it never comes back.
    let lostTimer = 0;
    const onLost = (e) => {
      e.preventDefault();
      ctxLost = true;
      el.setAttribute('data-scene-state', 'lost');
      paintStaticScene(el, sceneCfg);
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (!ctxLost) return;
        // Three rebuilds per page load. Past that the machine is telling us something, and
        // the still rendering already on screen is the honest answer.
        if (rebuilds.current < 3) { rebuilds.current++; setGen((g) => g + 1); }
        else setState('static');
      }, 3000);
    };
    const onRestore = () => {
      ctxLost = false;
      clearTimeout(lostTimer);
      clearStaticScene(el);
      // Every GPU-side object is gone with the old context; three re-uploads what it knows
      // is dirty, so say so rather than trusting its bookkeeping across a restore.
      for (const m of [mat, fractureMat, glowMat, twinkleMat, wireOverlay?.material]) if (m) m.needsUpdate = true;
      glowTex.needsUpdate = true;
      setState(still ? 'still' : 'live');
      applyPalette();
      if (still) requestStill();
    };
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    renderer.domElement.addEventListener('webglcontextrestored', onRestore);

    const start = () => {
      if (W() === 0) { setTimeout(start, 120); return; }
      onResize();
      setState('live');
      if (softwareGpu) {
        // No intro on a software GPU: it would be the one animation this machine is not
        // going to run. The page is revealed and the scene drawn once where it rests.
        if (skipRef.current && introRunning) skipRef.current();
        goStill('software');
        return;
      }
      tick();
    };
    start();
    const onVisible = () => { if (!document.hidden && !still) { cancelAnimationFrame(raf); tick(); } };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(stillQueued);
      clearTimeout(stillTimer);
      clearTimeout(lostTimer);
      still = true; // stops a queued tick from re-arming after cleanup
      clearTimeout(recomposeTimer);
      gsap.killTweensOf(fractureState);
      gsap.killTweensOf(orbTransition);
      gsap.killTweensOf(hoverAmt);
      gsap.killTweensOf(transAmt);
      clearInterval(transTimer);
      window.removeEventListener('bcw:route-change', onRouteChange);
      themeObs.disconnect();
      document.removeEventListener('bcw:site-theme', applyPalette);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('click', onClick);
      window.removeEventListener('bcweb:orb-transition', onPageTransition);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestore);
      geo.dispose(); mat.dispose(); fractureGeo.dispose(); fractureMat.dispose();
      if (wireOverlay) wireOverlay.material.dispose();
      glowTex.dispose(); glowMat.dispose(); twinkleGeo.dispose(); twinkleMat.dispose();
      renderer.dispose();
      // Give the context BACK, not just the buffers. dispose() frees what three allocated and
      // leaves the context alive until the canvas is collected, whenever that is; a studio page
      // with its own 3D background takes the stage the moment this unmounts
      // (hero/scene-stage.js), and "one WebGL context per page" has to be true then, not later.
      try { renderer.forceContextLoss(); } catch { /* already lost */ }
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      clearStaticScene(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneCfg, gen]);

  return (
    <>
      <div ref={mount} className="fixed inset-0 -z-10 pointer-events-none" aria-hidden="true"
        style={{ opacity: 0.55, transition: 'opacity .4s ease', maskImage: 'linear-gradient(to bottom, transparent 0%, #000 18%, #000 90%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 18%, #000 90%, transparent 100%)' }} />
      {showOverlay && (
        <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center pointer-events-none">
          <div ref={logoRef} className="flex flex-col items-center gap-3 pointer-events-none">
            {/* The plated mark, not the white cut-out: that one only ever worked on dark. */}
            <img src="/logo.png" alt="BetterCommunity" className="logo-plate w-16 h-16 rounded-2xl shadow-lg" />
            <div className="font-extrabold text-lg tracking-tight text-[var(--text)]">{t('intro.brand', 'BetterCommunity')}</div>
            <div ref={barRef} className="w-32 h-[2px] rounded-full overflow-hidden bg-[var(--surface-2)] relative mt-1">
              <div className="absolute inset-y-0 w-1/3 rounded-full anim-intro-shimmer" style={{ background: 'linear-gradient(90deg, var(--primary), var(--primary-2))' }} />
            </div>
          </div>
          <div className="absolute bottom-6 right-6 flex items-center gap-3 text-xs text-[var(--faint)] pointer-events-auto">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} className="accent-[var(--primary)]" />
              {t('intro.dontshow', "Don't show again")}
            </label>
            <button onClick={() => skipRef.current()} className="px-2.5 py-1 rounded-lg border border-[var(--line)] hover:text-[var(--text)] transition">{t('intro.skip', 'Skip intro')}</button>
          </div>
        </div>
      )}
    </>
  );
}
