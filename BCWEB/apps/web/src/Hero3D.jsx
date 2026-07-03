import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { useIntro, SKIP_KEY } from './IntroContext.jsx';
import { useI18n } from './i18n.jsx';

// v4 — the intro loader and the background are now literally the same canvas:
// the orb starts big and centered (the "loading" moment), then GSAP animates it
// down to its small, off-to-the-corner steady-state position as the real page
// fades in underneath — no separate splash screen, no hand-off flash. Once
// steady, the orb reacts to both the cursor (as before) and page scroll (a slow
// parallax drift, luxury-brand subtle, not a gimmick). No dust/particles — one
// clean shape.

function isLight() { return document.documentElement.getAttribute('data-theme') !== 'dark'; } // default theme is light
function palette() {
  return isLight()
    // light: soft peach → warm gold, bright cream rim — airy daylight glass
    ? { colorA: 0xffe0bf, colorB: 0xf3a869, rim: 0xfff7ec, opacity: 0.8, heroOp: 0.55, blending: THREE.NormalBlending }
    // dark: deep amber core → glowing gold, bright rim — molten metal at night
    : { colorA: 0x3a1c0d, colorB: 0xd9770a, rim: 0xffd27a, opacity: 0.8, heroOp: 0.55, blending: THREE.AdditiveBlending };
}

// Classic Ashima/Stefan Gustavson 3D simplex noise (public-domain-style, widely
// reused in countless shader projects) — lets the vertex shader displace the
// orb's surface organically without any texture lookup.
const NOISE_GLSL = `
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

const VERTEX_SHADER = `
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

const FRAGMENT_SHADER = `
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
const FRACTURE_VERTEX_SHADER = `
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
const FRACTURE_FRAGMENT_SHADER = `
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

// Steady-state ("background") framing vs. the dramatic centered intro framing.
const BG_POS = { x: 5.3, y: 3.0, z: -4 };
const HERO_POS = { x: 0, y: 0.3, z: 2 };
const BG_SCALE = 1;
const HERO_SCALE = 1.5;

export default function Hero3D() {
  const { t } = useI18n();
  const { active, finish } = useIntro();
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

  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const W = () => window.innerWidth, H = () => window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W() / H(), 0.1, 100);
    camera.position.set(0, 0, 11);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    el.appendChild(renderer.domElement);

    // ── the orb: one smooth icosahedron, displaced by noise in the vertex shader ──
    const geo = new THREE.IcosahedronGeometry(2.9, 5); // detail 5 = 10242 verts, plenty smooth

    // Fracture shards: a coarser icosahedron (detail 2 = 320 faces). Icosahedron
    // geometry is ALREADY non-indexed (every face owns its 3 vertices — calling
    // .toNonIndexed() was a no-op that logged a console warning), so each face
    // can fly apart as one rigid piece as-is. Each face gets its centroid + one
    // shared random vector.
    const fractureGeo = new THREE.IcosahedronGeometry(2.9, 2);
    const fPos = fractureGeo.attributes.position;
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
    fractureGeo.setAttribute('aCentroid', new THREE.BufferAttribute(centroidArr, 3));
    fractureGeo.setAttribute('aRandom', new THREE.BufferAttribute(randArr, 3));

    const uniforms = {
      uTime: { value: 0 },
      uAmp: { value: active ? 0 : 0.45 }, // starts flat during the intro, then "comes alive"
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
    });
    const orb = new THREE.Mesh(geo, mat);
    scene.add(orb);

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
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.45 });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(11);
    glow.position.z = -2; // behind the orb surface
    orb.add(glow);

    // The twinkles are a tilted BELT that genuinely orbits the orb (passing in
    // front and behind), not a static backdrop shell — a slow Saturn-ring drift.
    const twinkleCount = 110;
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
    orb.add(twinkles);

    const applyPalette = () => {
      const q = palette();
      uniforms.uColorA.value.setHex(q.colorA);
      uniforms.uColorB.value.setHex(q.colorB);
      uniforms.uColorRim.value.setHex(q.rim);
      uniforms.uOpacity.value = q.opacity;
      mat.blending = q.blending;
      mat.needsUpdate = true;
      fractureMat.blending = q.blending;
      fractureMat.needsUpdate = true;
      glowMat.color.setHex(q.colorB);
      // Light theme: the pale peach twinkles washed out against the cream page —
      // use the SATURATED primary orange, bigger points, and normal blending so
      // they read as real specks; dark theme keeps the airy additive glow.
      if (isLight()) {
        twinkleMat.color.setHex(0xf97316);
        twinkleMat.size = 0.11; twinkleMat.opacity = 0.7; twinkleMat.blending = THREE.NormalBlending;
        twinkleBase = 0.55;
      } else {
        twinkleMat.color.setHex(q.colorB);
        twinkleMat.size = 0.07; twinkleMat.blending = THREE.AdditiveBlending;
        twinkleBase = 0.32;
      }
      twinkleMat.needsUpdate = true;
      if (mount.current) mount.current.style.opacity = String(q.heroOp);
    };
    let twinkleBase = 0.32;
    applyPalette();
    const themeObs = new MutationObserver(applyPalette);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

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
      for (let f = 0; f < fPos.count / 3; f++) {
        const i0 = f * 3;
        const rx = Math.random() * 2 - 1, ry = Math.random() * 2 - 1, rz = Math.random() * 2 - 1;
        for (let v = 0; v < 3; v++) randArr.set([rx, ry, rz], (i0 + v) * 3);
      }
      fractureGeo.attributes.aRandom.needsUpdate = true;
    };
    const setFracture = (target, duration) => {
      if (target && fractureState.value < 0.15) reseedFracture(); // fresh shatter → new pattern
      gsap.killTweensOf(fractureState);
      gsap.to(fractureState, { value: target, duration, ease: target ? 'power2.out' : 'power2.inOut' });
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
      if (hit && !hovering) { hovering = true; clearTimeout(recomposeTimer); setFracture(1, 0.7); }
      else if (!hit && hovering) { hovering = false; setFracture(0, 0.9); }
    };
    window.addEventListener('pointermove', onMove);
    const onClick = (e) => {
      if (showOverlayRef.current) return;
      if (!raycastHits(e.clientX, e.clientY)) return;
      // touch devices (no real hover): shatter on tap, auto-recompose shortly after
      clearTimeout(recomposeTimer);
      setFracture(1, 0.5);
      recomposeTimer = setTimeout(() => { if (!hovering) setFracture(0, 0.9); }, 1100);
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
    const onResize = () => { camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H()); measurePage(); };
    window.addEventListener('resize', onResize);

    // ── scroll reactivity: a slow, sober parallax drift + a gentle recede on
    //    deep scroll so the orb never competes with content further down ──
    let scrollTarget = 0;
    // The orb's spiral journey scales with the page: a tall page (many screens of
    // content) gives it MORE turns + a deeper descent, a short page a shorter arc,
    // so the length of the orb's animation tracks how much there is to scroll.
    // ~3 screens is the baseline (×1); clamped so it never gets flat or dizzying.
    let pageSpan = 1;
    const measurePage = () => {
      const screens = document.documentElement.scrollHeight / Math.max(1, window.innerHeight);
      pageSpan = Math.min(2.2, Math.max(0.6, screens / 3));
    };
    const onScroll = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      scrollTarget = Math.min(1, window.scrollY / max);
      measurePage();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    let scrollNow = 0;

    // ── intro choreography: the orb IS the loading animation. It starts large
    //    and centered, "comes alive" (noise amplitude ramps up from a flat
    //    sphere), holds a beat, then glides to its small background position
    //    while the logo fades — all one continuous scene, no hard cut. ──
    let baseX = BG_POS.x, baseY = BG_POS.y, baseZ = BG_POS.z;
    if (active) {
      orb.position.set(HERO_POS.x, HERO_POS.y, HERO_POS.z);
      orb.scale.setScalar(0.35);
      // The orb BUILDS itself: start as a cloud of scattered shards (fully
      // fractured) and assemble them into the whole orb as it scales up — a
      // "materialising from its own pieces" intro rather than a plain scale-in.
      reseedFracture();
      fractureState.value = 1;
      const finishIntro = () => { setShowOverlay(false); finish(); };
      const tl = gsap.timeline({ onComplete: finishIntro });
      tl.to(orb.scale, { x: HERO_SCALE, y: HERO_SCALE, z: HERO_SCALE, duration: 1.35, ease: 'back.out(1.4)' });
      tl.to(fractureState, { value: 0, duration: 1.5, ease: 'power3.inOut' }, '<'); // shards fly in + fuse into the orb
      tl.to(uniforms.uAmp, { value: 0.45, duration: 1.3, ease: 'power2.out' }, '<0.35');
      tl.to({}, { duration: 0.55 }); // hold beat — let it breathe before the move
      tl.to(orb.position, { x: BG_POS.x, y: BG_POS.y, z: BG_POS.z, duration: 1.3, ease: 'power3.inOut', onUpdate: () => { baseX = orb.position.x; baseY = orb.position.y; baseZ = orb.position.z; } }, '+=0');
      tl.to(orb.scale, { x: BG_SCALE, y: BG_SCALE, z: BG_SCALE, duration: 1.3, ease: 'power3.inOut' }, '<');
      tl.to(logoRef.current, { autoAlpha: 0, y: -14, duration: 0.5, ease: 'power2.in' }, '<');
      if (barRef.current) tl.to(barRef.current, { opacity: 0, duration: 0.3 }, '<');
      skipRef.current = () => {
        if (dontShowRef.current) localStorage.setItem(SKIP_KEY, '1');
        tl.kill();
        gsap.killTweensOf(fractureState);
        fractureState.value = 0; // whole orb when the build is skipped
        orb.position.set(BG_POS.x, BG_POS.y, BG_POS.z);
        orb.scale.setScalar(BG_SCALE);
        uniforms.uAmp.value = 0.45;
        baseX = BG_POS.x; baseY = BG_POS.y; baseZ = BG_POS.z;
        finishIntro();
      };
    } else {
      orb.position.set(BG_POS.x, BG_POS.y, BG_POS.z);
      orb.scale.setScalar(BG_SCALE);
    }

    let raf, t = 0, ctxLost = false;
    const rotTarget = { x: 0, y: 0 };
    // ── per-page-load spiral personality: direction, number of turns, width,
    //    vertical wobble and phase are all re-rolled every visit, so the orb
    //    never flies the same path twice ──
    const spiral = {
      dir: Math.random() < 0.5 ? 1 : -1,               // clockwise or counter-clockwise
      turns: Math.PI * (2.4 + Math.random() * 1.6),    // 1.2 – 2 full turns
      radius: 3.2 + Math.random() * 1.8,               // how wide the arc sweeps
      wobble: 0.9 + Math.random() * 0.9,               // vertical wave frequency
      phase: Math.random() * Math.PI * 2,              // where on the circle it starts
      drop: 3.0 + Math.random() * 0.9,                 // total descent depth
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
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (ctxLost) return;
      try {
        t += 0.01;
        uniforms.uTime.value = t;
        uniforms.uFracture.value = fractureState.value;
        scrollNow += (scrollTarget - scrollNow) * 0.04;
        // slow constant auto-rotation (noticeably livelier the deeper you scroll,
        // to sell the "spiraling down" read), plus a small cursor-driven tilt on top
        rotTarget.y += 0.0016 * (1 + scrollNow * 1.6);
        rotTarget.x += (mouse.y * 0.35 - rotTarget.x) * 0.02;
        orb.rotation.y = rotTarget.y;
        orb.rotation.x += (rotTarget.x - orb.rotation.x) * 0.06;
        orb.rotation.z += (mouse.x * 0.12 - orb.rotation.z) * 0.02;
        // background-mode-only spiral descent: the orb corkscrews down and inward
        // as you scroll — a wide, banking arc that sweeps across the page. The
        // radius eases in (sin ramp) so the orbit opens gracefully instead of
        // snapping wide at the first pixel of scroll, and the orb banks (subtle
        // roll) into the turn like something actually flying the curve. Skipped
        // while the intro timeline still owns orb.position.
        if (!showOverlayRef.current) {
          // pageSpan scales the journey with the page height (more turns + deeper
          // descent on a long page, a shorter arc on a short one).
          const spiralAngle = spiral.phase + scrollNow * spiral.turns * pageSpan * spiral.dir;
          // ease-in-out radius: gentle at the very top + bottom, widest mid-scroll
          const radiusEase = Math.sin(Math.min(1, scrollNow) * Math.PI) * 0.5 + scrollNow * 0.5;
          const spiralRadius = radiusEase * spiral.radius;
          orb.position.x = baseX + (Math.cos(spiralAngle) - Math.cos(spiral.phase)) * spiralRadius;
          orb.position.y = baseY - scrollNow * spiral.drop * pageSpan + Math.sin(spiralAngle * spiral.wobble) * 0.55;
          orb.position.z = baseZ + (Math.sin(spiralAngle) - Math.sin(spiral.phase)) * spiralRadius * 0.65;
          // bank into the curve — a touch of roll that follows the orbit tangent
          orb.rotation.z += (Math.sin(spiralAngle) * 0.35 * spiral.dir - orb.rotation.z) * 0.05;
          // tell the page which side the orb is on, so reveals enter from there
          setRevealSide(orb.position.x >= 0 ? 1 : -1);
        }
        // ambience: the twinkle belt genuinely ORBITS the orb (its own spin on
        // top of the orb's rotation) + a gentle breathing shimmer on the glow
        twinkles.rotation.y = t * 0.3;
        twinkleMat.opacity = twinkleBase + Math.sin(t * 0.8) * 0.16;
        glowMat.opacity = 0.4 + Math.sin(t * 0.5) * 0.08;
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
      } catch { /* keep looping — the next frame is already queued */ }
    };
    const start = () => { if (W() === 0) { setTimeout(start, 120); return; } onResize(); tick(); };
    start();
    const onLost = (e) => { e.preventDefault(); ctxLost = true; };
    const onRestore = () => { ctxLost = false; };
    renderer.domElement.addEventListener('webglcontextlost', onLost);
    renderer.domElement.addEventListener('webglcontextrestored', onRestore);
    const onVisible = () => { if (!document.hidden) { cancelAnimationFrame(raf); tick(); } };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(recomposeTimer);
      gsap.killTweensOf(fractureState);
      gsap.killTweensOf(orbTransition);
      themeObs.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('click', onClick);
      window.removeEventListener('bcweb:orb-transition', onPageTransition);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisible);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestore);
      geo.dispose(); mat.dispose(); fractureGeo.dispose(); fractureMat.dispose();
      glowTex.dispose(); glowMat.dispose(); twinkleGeo.dispose(); twinkleMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div ref={mount} className="fixed inset-0 -z-10 pointer-events-none" aria-hidden="true"
        style={{ opacity: 0.55, transition: 'opacity .4s ease', maskImage: 'linear-gradient(to bottom, transparent 0%, #000 18%, #000 90%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 18%, #000 90%, transparent 100%)' }} />
      {showOverlay && (
        <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center pointer-events-none">
          <div ref={logoRef} className="flex flex-col items-center gap-3 pointer-events-none">
            <img src="/logo.png" alt="BetterCommunity" className="w-14 h-14 rounded-2xl shadow-lg" />
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
