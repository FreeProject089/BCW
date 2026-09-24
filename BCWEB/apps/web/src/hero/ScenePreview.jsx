// The scene, small, in a settings card.
//
// It imports its geometry, its shaders and its palette from `scene-shapes.js` — the same
// module the real backdrop imports. That is the whole reason this file is short: there is
// nothing here to keep in step with the hero, because there is nothing here that the hero
// does not also use. A preview that redrew "something like the orb" would be a second
// renderer, and the one that is wrong is whichever nobody looked at last.
//
// What it deliberately does NOT reproduce: the intro choreography, the cursor parallax and
// the scroll drift. Those are the hero's behaviour on a page, not the scene's appearance —
// and an admin dragging a slider wants to see the shape change, not sit through a loading
// animation each time.
//
// It DOES reproduce the hover reaction, because that is a setting now and four words in a
// menu are four words to imagine. The gesture is hovering the CANVAS rather than the shape:
// raycasting a 200px silhouette would make it a game of aim, and aim is not the subject.
//
// The PUBLIC variant (PLAN-STUDIO-2026, phase 4). A studio page whose background is `scene3d`
// is drawn by this same component, lazily (ui/canvas-background.jsx), so the page's scene and
// the admin's preview of the site scene are one renderer too. The page form adds what a public
// page needs and a settings card does not: the shape placed left or right, a frame budget,
// a still frame for a reader who asked for reduced motion, a pause while it is off screen or
// the tab is hidden, and `onFail` so the page can fall back to the CSS drawing when WebGL is
// missing or its context is lost. Every one of those is off by default: the admin card is
// unchanged.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  palette, isLight, VERTEX_SHADER, FRAGMENT_SHADER,
  FRACTURE_VERTEX_SHADER, FRACTURE_FRAGMENT_SHADER,
  buildGeometry, SCENE_DEFAULTS, glowOpacity, twinkleLook,
} from './scene-shapes.js';

/**
 * @param {object} props
 * @param {object} props.cfg          the scene settings (hero/scene-config.js vocabulary)
 * @param {'center'|'left'|'right'} [props.position]  where the shape sits across the box
 * @param {number} [props.fps]        a frame budget; 0 = every frame (the admin card)
 * @param {boolean} [props.still]     draw one frame and hold it (reduced motion)
 * @param {boolean} [props.pauseOffscreen]  stop drawing while scrolled away or the tab is hidden
 * @param {Function} [props.onFail]   no WebGL here, or the context was lost
 */
export default function ScenePreview({ cfg, className = '', position = 'center', fps = 0, still = false, pauseOffscreen = false, onFail = null }) {
  const mount = useRef(null);
  // Read inside the frame loop rather than closed over, so moving a slider does not tear the
  // WebGL context down and build a new one sixty times on the way across.
  const live = useRef(cfg);
  live.current = { ...SCENE_DEFAULTS, ...(cfg || {}) };
  const opts = useRef(null);
  opts.current = { position, fps: Number(fps) || 0, still: !!still, pauseOffscreen: !!pauseOffscreen, onFail };

  useEffect(() => {
    const el = mount.current;
    if (!el) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // No WebGL2 here. The card says so in words; this just leaves the box empty rather
      // than throwing inside a settings screen. A page asks to be told, and draws in CSS.
      opts.current.onFail?.();
      return undefined;
    }
    const size = () => ({ w: el.clientWidth || 320, h: el.clientHeight || 180 });
    const { w, h } = size();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    el.appendChild(renderer.domElement);

    const stage = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, w / h, 0.1, 100);
    camera.position.set(0, 0, 11);

    const uniforms = {
      uTime: { value: 0 },
      uAmp: { value: 0.45 },
      uFreq: { value: 0.55 },
      uColorA: { value: new THREE.Color(0xffe0bf) },
      uColorB: { value: new THREE.Color(0xf3a869) },
      uColorRim: { value: new THREE.Color(0xfff7ec) },
      uOpacity: { value: 0.8 },
      uFracture: { value: 0 },
    };

    // Hover, eased by hand rather than with GSAP: this file has no other reason to pull in an
    // animation library, and one number moving towards another is four lines.
    let hoverTarget = 0;
    let hoverNow = 0;
    const onEnter = () => { hoverTarget = 1; };
    const onLeave = () => { hoverTarget = 0; };
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);

    // The pieces that depend on a setting are rebuilt when that setting changes, and only
    // then. `shape`, `detail` and `surface` change the geometry or the material; everything
    // else is a number the frame loop reads.
    let built = null;
    const dispose = () => {
      if (!built) return;
      stage.remove(built.root);
      built.geo.dispose();
      built.mat.dispose();
      if (built.fractureGeo) built.fractureGeo.dispose();
      if (built.fractureMat) built.fractureMat.dispose();
      if (built.wire) built.wire.material.dispose();
      if (built.glowTex) built.glowTex.dispose();
      if (built.glowMat) built.glowMat.dispose();
      if (built.twGeo) built.twGeo.dispose();
      if (built.twMat) built.twMat.dispose();
      built = null;
    };

    const build = (c) => {
      dispose();
      const root = new THREE.Group();
      const geo = buildGeometry(c.shape, c.detail);
      const mat = new THREE.ShaderMaterial({
        uniforms, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        wireframe: c.surface === 'wire',
      });
      const mesh = new THREE.Mesh(geo, mat);
      root.add(mesh);

      // The shards.
      //
      // `uFracture` does two things in the shaders: it fades the SOLID out
      // (`uOpacity * (1.0 - uFracture)`) and it flies the shards apart. The hero draws both
      // meshes. Without this one, previewing "Fracture" would show a shape quietly vanishing
      // — which is worse than no preview: it misdescribes the very setting being chosen.
      //
      // `toNonIndexed()` is conditional for the reason the hero explains: icosahedron and
      // tetrahedron geometry already gives every face its own vertices, but a torus shares
      // them, and without this a knot tears into ribbons instead of breaking into pieces.
      const rawFracture = buildGeometry(c.shape, Math.min(2, c.detail));
      const fractureGeo = rawFracture.index ? rawFracture.toNonIndexed() : rawFracture;
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
      // The same uniform OBJECTS as the solid, so colours, time and amplitude stay in
      // lockstep with no per-frame syncing — exactly as the hero does it.
      const fractureMat = new THREE.ShaderMaterial({
        uniforms, vertexShader: FRACTURE_VERTEX_SHADER, fragmentShader: FRACTURE_FRAGMENT_SHADER,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      mesh.add(new THREE.Mesh(fractureGeo, fractureMat));

      let wire = null;
      if (c.surface === 'both') {
        wire = new THREE.Mesh(geo, new THREE.ShaderMaterial({
          uniforms, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER,
          transparent: true, depthWrite: false, side: THREE.DoubleSide, wireframe: true,
        }));
        wire.scale.setScalar(1.012);
        mesh.add(wire);
      }

      // The halo, drawn the same way the hero draws it: a radial gradient on a canvas,
      // used as a sprite behind the surface.
      let glowTex = null; let glowMat = null;
      if (c.glow > 0) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 256;
        const g = cv.getContext('2d');
        const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        grad.addColorStop(0, 'rgba(255,255,255,0.55)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.16)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
        glowTex = new THREE.CanvasTexture(cv);
        glowMat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: c.glow });
        const sprite = new THREE.Sprite(glowMat);
        sprite.scale.setScalar(11);
        sprite.position.z = -2;
        mesh.add(sprite);
      }

      // The belt. Fewer than the hero draws at the same setting would misreport the setting,
      // so it is the number itself — this canvas is small, not cheap.
      let twGeo = null; let twMat = null; let twPts = null;
      if (c.twinkles > 0) {
        const n = Math.round(c.twinkles);
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const r = 3.5 + Math.random() * 2.4;
          const th = Math.random() * Math.PI * 2;
          arr[i * 3] = r * Math.cos(th);
          arr[i * 3 + 1] = (Math.random() - 0.5) * 1.7;
          arr[i * 3 + 2] = r * Math.sin(th);
        }
        twGeo = new THREE.BufferGeometry();
        twGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        twMat = new THREE.PointsMaterial({ size: 0.07, transparent: true, opacity: 0.45, depthWrite: false, sizeAttenuation: true });
        const pts = new THREE.Points(twGeo, twMat);
        pts.rotation.z = 0.4; pts.rotation.x = 0.25;
        mesh.add(pts);
        twPts = pts;
      }

      stage.add(root);
      built = { root, mesh, geo, mat, wire, glowTex, glowMat, twGeo, twMat, twPts, fractureGeo, fractureMat };
    };

    const applyPalette = () => {
      const q = palette();
      uniforms.uColorA.value.setHex(q.colorA);
      uniforms.uColorB.value.setHex(q.colorB);
      uniforms.uColorRim.value.setHex(q.rim);
      if (built) {
        built.mat.blending = q.blending;
        built.mat.needsUpdate = true;
        if (built.glowMat) built.glowMat.color.setHex(q.colorB);
        if (built.twMat) {
          // The hero's own answer (twinkleLook). This used to be white specks in dark and the
          // pale colour in light, which is not the belt the page draws behind the card.
          const tw = twinkleLook(isLight(), q);
          built.twMat.color.setHex(tw.color);
          built.twMat.size = tw.size;
          built.twMat.blending = tw.blending;
          built.twBase = tw.base;
          built.twMat.needsUpdate = true;
        }
      }
      // The page draws the scene at `heroOp` (55 %) behind everything. Drawn here at 100 %, the
      // card showed a brighter, bolder scene than the one a visitor gets.
      el.style.opacity = String(q.heroOp);
    };

    // What the last build was made from. A frame compares against it and rebuilds only when
    // one of the three structural settings actually moved.
    let key = '';
    let raf = 0;
    let time = 0;
    let last = 0;
    let lastDraw = 0;
    // Page form: drawing stops while the box is off screen or the tab is hidden.
    let onScreen = true;
    let lost = false;
    const themeObserver = new MutationObserver(applyPalette);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const running = () => !lost && !opts.current.still && (!opts.current.pauseOffscreen || (onScreen && !document.hidden));
    const frame = (now = performance.now()) => {
      raf = running() ? requestAnimationFrame(frame) : 0;
      // The frame budget: a background drifting at 30 cannot be told from one at 60, and the
      // GPU it costs can. Skipped frames do not advance the clock either, so speed is kept.
      const budget = opts.current.fps;
      if (budget && raf && lastDraw && now - lastDraw < 1000 / budget - 2) return;
      lastDraw = now;
      // Real seconds, like the hero: the rotation used to be a fixed step per frame, so the
      // card spun 2.5 times faster than the page on a 60 Hz screen and faster still on 144 Hz.
      const dt = Math.min(0.1, Math.max(0.001, last ? (now - last) / 1000 : 1 / 60));
      last = now;
      const c = live.current;
      const k = `${c.shape}|${c.detail}|${c.surface}|${c.glow > 0}|${Math.round(c.twinkles)}`;
      if (k !== key) { key = k; build(c); applyPalette(); }
      if (!built) return;

      // The same four reactions the hero applies, from the same setting.
      const mode = c.hover || 'fracture';
      hoverNow += ((mode === 'none' ? 0 : hoverTarget) - hoverNow) * 0.12;
      time += 0.01 * c.speed;
      uniforms.uTime.value = time;
      uniforms.uAmp.value = 0.45 * c.noise * (mode === 'swell' ? 1 + hoverNow * 0.55 : 1);
      uniforms.uOpacity.value = palette().opacity * (c.opacity / SCENE_DEFAULTS.opacity);
      uniforms.uFracture.value = mode === 'fracture' ? hoverNow : 0;
      built.root.scale.setScalar(c.scale * (mode === 'swell' ? 1 + hoverNow * 0.13 : 1));
      // Left or right of the box: a share of the half-width the camera sees at the shape's
      // depth, so it stays inside the box at any aspect.
      const side = opts.current.position === 'left' ? -1 : opts.current.position === 'right' ? 1 : 0;
      built.root.position.x = side * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z * camera.aspect * 0.45;
      built.mesh.rotation.y += 0.096 * c.speed * dt * (mode === 'spin' ? 1 + hoverNow * 3.5 : 1);
      built.mesh.rotation.x = 0.25;
      // The halo LEVEL follows the slider on every frame. It was fixed at build time and the
      // build only reran when the halo crossed zero, so dragging it did nothing visible.
      if (built.glowMat) built.glowMat.opacity = glowOpacity(c.glow, time);
      if (built.twMat) {
        built.twPts.rotation.y = time * 0.3;
        built.twMat.opacity = (built.twBase ?? 0.32) + Math.sin(time * 0.8) * 0.16;
      }
      renderer.render(stage, camera);
    };
    raf = requestAnimationFrame(frame);
    /** Draw again after something changed, when the loop is not running (a still or paused scene). */
    const redraw = () => { if (!raf && !lost) frame(); };
    /** Start the loop again, if it should be running and is not. */
    const resume = () => { if (!raf && running()) raf = requestAnimationFrame(frame); };

    const onResize = () => {
      const d = size();
      renderer.setSize(d.w, d.h);
      camera.aspect = d.w / d.h;
      camera.updateProjectionMatrix();
      redraw();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    // A theme change repaints a still scene too (applyPalette runs from the observer above).
    const themeRedraw = new MutationObserver(redraw);
    themeRedraw.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    let io = null;
    if (opts.current.pauseOffscreen && typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((es) => { onScreen = es.some((e) => e.isIntersecting); resume(); });
      io.observe(el);
    }
    const onVisibility = () => resume();
    document.addEventListener('visibilitychange', onVisibility);
    // A lost context: stop, and let the page draw its still instead. Not restored here: the
    // page swaps this component out for the CSS drawing, which is the honest answer.
    const onLost = (e) => {
      e.preventDefault();
      lost = true;
      cancelAnimationFrame(raf); raf = 0;
      opts.current.onFail?.();
    };
    renderer.domElement.addEventListener('webglcontextlost', onLost);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      ro.disconnect();
      themeObserver.disconnect();
      themeRedraw.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      dispose();
      try {
        renderer.dispose();
        // The context itself, not only three's buffers: a page has ONE (hero/scene-stage.js),
        // and the next one to be created must not find this one still alive.
        renderer.forceContextLoss();
        if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      } catch { /* the node is already gone */ }
    };
  }, []);

  return <div ref={mount} className={className} aria-hidden />;
}
