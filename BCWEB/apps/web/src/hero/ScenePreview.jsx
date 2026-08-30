// The scene, small, in a settings card.
//
// It imports its geometry, its shaders and its palette from `scene-shapes.js` — the same
// module the real backdrop imports. That is the whole reason this file is short: there is
// nothing here to keep in step with the hero, because there is nothing here that the hero
// does not also use. A preview that redrew "something like the orb" would be a second
// renderer, and the one that is wrong is whichever nobody looked at last.
//
// What it deliberately does NOT reproduce: the intro choreography, the cursor parallax, the
// scroll drift and the fracture. Those are the hero's behaviour on a page, not the scene's
// appearance — and an admin dragging a slider wants to see the shape change, not sit through
// a loading animation each time.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  palette, isLight, VERTEX_SHADER, FRAGMENT_SHADER, buildGeometry, SCENE_DEFAULTS,
} from './scene-shapes.js';

export default function ScenePreview({ cfg, className = '' }) {
  const mount = useRef(null);
  // Read inside the frame loop rather than closed over, so moving a slider does not tear the
  // WebGL context down and build a new one sixty times on the way across.
  const live = useRef(cfg);
  live.current = { ...SCENE_DEFAULTS, ...(cfg || {}) };

  useEffect(() => {
    const el = mount.current;
    if (!el) return undefined;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // No WebGL2 here. The card says so in words; this just leaves the box empty rather
      // than throwing inside a settings screen.
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

    // The pieces that depend on a setting are rebuilt when that setting changes, and only
    // then. `shape`, `detail` and `surface` change the geometry or the material; everything
    // else is a number the frame loop reads.
    let built = null;
    const dispose = () => {
      if (!built) return;
      stage.remove(built.root);
      built.geo.dispose();
      built.mat.dispose();
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
      let twGeo = null; let twMat = null;
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
      }

      stage.add(root);
      built = { root, mesh, geo, mat, wire, glowTex, glowMat, twGeo, twMat };
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
          built.twMat.color.setHex(isLight() ? q.colorB : 0xffffff);
          built.twMat.blending = isLight() ? THREE.NormalBlending : THREE.AdditiveBlending;
          built.twMat.needsUpdate = true;
        }
      }
    };

    // What the last build was made from. A frame compares against it and rebuilds only when
    // one of the three structural settings actually moved.
    let key = '';
    let raf = 0;
    let time = 0;
    const themeObserver = new MutationObserver(applyPalette);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const c = live.current;
      const k = `${c.shape}|${c.detail}|${c.surface}|${c.glow > 0}|${Math.round(c.twinkles)}`;
      if (k !== key) { key = k; build(c); applyPalette(); }
      if (!built) return;

      time += 0.01 * c.speed;
      uniforms.uTime.value = time;
      uniforms.uAmp.value = 0.45 * c.noise;
      uniforms.uOpacity.value = palette().opacity * (c.opacity / SCENE_DEFAULTS.opacity);
      built.root.scale.setScalar(c.scale);
      built.mesh.rotation.y += 0.004 * c.speed;
      built.mesh.rotation.x = 0.25;
      renderer.render(stage, camera);
    };
    raf = requestAnimationFrame(frame);

    const onResize = () => {
      const d = size();
      renderer.setSize(d.w, d.h);
      camera.aspect = d.w / d.h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      themeObserver.disconnect();
      dispose();
      try {
        renderer.dispose();
        if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      } catch { /* the node is already gone */ }
    };
  }, []);

  return <div ref={mount} className={className} aria-hidden />;
}
