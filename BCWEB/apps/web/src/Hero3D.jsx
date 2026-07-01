import { useEffect, useRef } from 'react';
import * as THREE from 'three';

// Animated backdrop: a wireframe icosahedron spinning on itself + a continuous
// particle emission flowing outward from the core. On-brand orange, always visible,
// gentle mouse parallax. Robust mount (retries if sized to 0 / context lost).
export default function Hero3D() {
  const mount = useRef(null);
  useEffect(() => {
    const el = mount.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const W = () => window.innerWidth, H = () => window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, W() / H(), 0.1, 100);
    camera.position.z = 18;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    el.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    // ── spinning wireframe core ──
    const core = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(4.6, 1)),
      new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.5 }),
    );
    group.add(core);
    const coreFill = new THREE.Mesh(
      new THREE.IcosahedronGeometry(4.5, 1),
      new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.06 }),
    );
    group.add(coreFill);

    // ── particle emission (flow outward from the core, respawn at center) ──
    const N = 650;
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    const life = new Float32Array(N);
    const spawn = (i) => {
      const t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
      const dir = new THREE.Vector3(Math.sin(p) * Math.cos(t), Math.sin(p) * Math.sin(t), Math.cos(p));
      const r0 = 4.4 + Math.random() * 0.6;
      pos[i * 3] = dir.x * r0; pos[i * 3 + 1] = dir.y * r0; pos[i * 3 + 2] = dir.z * r0;
      const sp = 0.012 + Math.random() * 0.03;
      vel[i * 3] = dir.x * sp; vel[i * 3 + 1] = dir.y * sp; vel[i * 3 + 2] = dir.z * sp;
      life[i] = Math.random();
    };
    for (let i = 0; i < N; i++) spawn(i);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(pg, new THREE.PointsMaterial({
      color: 0xf97316, size: 0.16, transparent: true, opacity: 0.95, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    group.add(points);

    const mouse = { x: 0, y: 0 };
    const onMove = (e) => { mouse.x = e.clientX / W() - 0.5; mouse.y = e.clientY / H() - 0.5; };
    window.addEventListener('pointermove', onMove);
    const onResize = () => { camera.aspect = W() / H(); camera.updateProjectionMatrix(); renderer.setSize(W(), H()); };
    window.addEventListener('resize', onResize);

    let raf, t = 0;
    const tick = () => {
      t += 0.01;
      // spin on itself
      group.rotation.y += 0.0016;
      group.rotation.x = Math.sin(t * 0.2) * 0.12;
      core.rotation.y -= 0.004; core.rotation.x += 0.002;
      coreFill.rotation.copy(core.rotation);
      // emit
      for (let i = 0; i < N; i++) {
        pos[i * 3] += vel[i * 3]; pos[i * 3 + 1] += vel[i * 3 + 1]; pos[i * 3 + 2] += vel[i * 3 + 2];
        const d = Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
        if (d > 13) spawn(i);
      }
      pg.attributes.position.needsUpdate = true;
      camera.position.x += (mouse.x * 5 - camera.position.x) * 0.04;
      camera.position.y += (-mouse.y * 4 - camera.position.y) * 0.04;
      camera.lookAt(scene.position);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    // start once we actually have a size (avoids the "sometimes blank" race)
    const start = () => { if (W() === 0) { setTimeout(start, 120); return; } onResize(); reduce ? renderer.render(scene, camera) : tick(); };
    start();
    const onRestore = () => { if (!reduce) { cancelAnimationFrame(raf); tick(); } };
    renderer.domElement.addEventListener('webglcontextrestored', onRestore);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', onResize);
      pg.dispose(); points.material.dispose(); core.geometry.dispose(); core.material.dispose(); coreFill.geometry.dispose(); coreFill.material.dispose(); renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, []);
  return <div ref={mount} className="fixed inset-0 -z-10 pointer-events-none" aria-hidden="true"
    style={{ opacity: 0.65, maskImage: 'radial-gradient(78% 70% at 50% 42%, #000 50%, transparent 92%)', WebkitMaskImage: 'radial-gradient(78% 70% at 50% 42%, #000 50%, transparent 92%)' }} />;
}
