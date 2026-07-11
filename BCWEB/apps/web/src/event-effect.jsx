import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { X } from 'lucide-react';
import { api } from './api.js';
import { useI18n } from './i18n.jsx';

// ── Full-screen EVENT effect: fireworks. For a national holiday the finale burst
// forms the country's flag (particles tween to positions sampled from a procedurally
// drawn flag — no emoji, no image assets). Purely decorative: the canvas is
// pointer-events:none so it never blocks the UI. Reduce-motion → no canvas, just the
// announcement. Three.js Points pool + GSAP for the flag formation. ──

// Stripe-based flags (dir 'v'=vertical, 'h'=horizontal) + a couple of specials. Covers
// the common cases (incl. FR); unknown countries fall back to a generic colour finale.
const FLAG_SPECS = {
  FR: ['v', '#0055A4', '#FFFFFF', '#EF4135'], IT: ['v', '#008C45', '#F4F5F0', '#CD212A'],
  IE: ['v', '#169B62', '#FFFFFF', '#FF883E'], BE: ['v', '#2D2926', '#FDDA24', '#EF3340'],
  RO: ['v', '#002B7F', '#FCD116', '#CE1126'], DE: ['h', '#000000', '#DD0000', '#FFCE00'],
  NL: ['h', '#AE1C28', '#FFFFFF', '#21468B'], RU: ['h', '#FFFFFF', '#0039A6', '#D52B1E'],
  UA: ['h', '#0057B7', '#FFD700'], PL: ['h', '#FFFFFF', '#DC143C'], ID: ['h', '#FF0000', '#FFFFFF'],
  AT: ['h', '#ED2939', '#FFFFFF', '#ED2939'], JP: ['jp'], CH: ['ch'],
};

// Draw the flag to a small offscreen canvas (3:2). Returns the canvas or null.
function drawFlag(cc) {
  const spec = FLAG_SPECS[cc]; if (!spec) return null;
  const W = 90, H = 60, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const dir = spec[0];
  if (dir === 'v' || dir === 'h') {
    const cols = spec.slice(1), n = cols.length;
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[i];
      if (dir === 'v') g.fillRect(Math.round(i * W / n), 0, Math.ceil(W / n), H);
      else g.fillRect(0, Math.round(i * H / n), W, Math.ceil(H / n));
    }
  } else if (dir === 'jp') {
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#BC002D'; g.beginPath(); g.arc(W / 2, H / 2, H * 0.3, 0, 7); g.fill();
  } else if (dir === 'ch') {
    g.fillStyle = '#D52B1E'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#FFFFFF'; const t = H * 0.13, cx = W / 2, cy = H / 2, a = H * 0.32;
    g.fillRect(cx - t / 2, cy - a / 2, t, a); g.fillRect(cx - a / 2, cy - t / 2, a, t);
  }
  return cv;
}

// Sample `n` (x,y,color) targets from the drawn flag, centred in world space.
function sampleFlagTargets(cv, n, worldW) {
  const W = cv.width, H = cv.height, img = cv.getContext('2d').getImageData(0, 0, W, H).data;
  const worldH = worldW * (H / W), out = [];
  for (let i = 0; i < n; i++) {
    const px = Math.floor(Math.random() * W), py = Math.floor(Math.random() * H), o = (py * W + px) * 4;
    out.push({
      x: (px / W - 0.5) * worldW,
      y: (0.5 - py / H) * worldH + 0.15,
      r: img[o] / 255, g: img[o + 1] / 255, b: img[o + 2] / 255,
    });
  }
  return out;
}

// Soft round sprite for the points.
function makeSprite() {
  const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d'), grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.3, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv); return tex;
}

const PALETTE = [[1, 0.32, 0.18], [1, 0.78, 0.2], [0.3, 0.7, 1], [0.7, 0.4, 1], [0.3, 1, 0.6], [1, 0.4, 0.7]];

export default function EventEffect() {
  const { t, lang } = useI18n();
  const [ev, setEv] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const mount = useRef(null);

  useEffect(() => {
    let alive = true;
    api.get('/events/active').then((r) => { if (alive) setEv(r?.event || null); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Respect prefers-reduced-motion (no canvas, announcement only). A localStorage
  // override (`bcw_fx_preview=1`) forces the effect on — a preview hook for admins
  // (and for testing in reduced-motion environments like headless browsers).
  const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let forcePreview = false;
  try { forcePreview = localStorage.getItem('bcw_fx_preview') === '1'; } catch {}
  const reduced = prefersReduced && !forcePreview;

  useEffect(() => {
    if (!ev || ev.effect !== 'fireworks' || reduced || dismissed) return;
    const el = mount.current; if (!el) return;
    const W = () => window.innerWidth, H = () => window.innerHeight;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    let aspect = W() / H();
    const cam = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 10);
    cam.position.z = 2;

    const MAX = 1600;
    const positions = new Float32Array(MAX * 3), colors = new Float32Array(MAX * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: 8, sizeAttenuation: false, vertexColors: true, map: makeSprite(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    /** @type {{x:number,y:number,vx:number,vy:number,life:number,max:number,r:number,g:number,b:number,rocket?:boolean,hx?:number,frozen?:boolean}[]} */
    let ps = [];
    const rand = (a, b) => a + Math.random() * (b - a);
    const launchRocket = () => {
      const x = rand(-aspect * 0.7, aspect * 0.7);
      ps.push({ x, y: -1.05, vx: rand(-0.04, 0.04), vy: rand(1.35, 1.7), life: rand(0.75, 0.95), max: 0.95, r: 1, g: 0.9, b: 0.7, rocket: true, hx: x });
    };
    const explode = (x, y, col, count = 90) => {
      for (let i = 0; i < count && ps.length < MAX; i++) {
        const a = Math.random() * Math.PI * 2, sp = rand(0.15, 0.75);
        ps.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(1.1, 1.9), max: 1.9, r: col[0], g: col[1], b: col[2] });
      }
    };
    // Flag finale: particles rush to the sampled flag positions, hold, then fall.
    const flagCanvas = ev.kind === 'national_holiday' && ev.countryCode ? drawFlag(ev.countryCode) : null;
    const flagFinale = () => {
      if (!flagCanvas) { // generic finale: a big multi-colour burst
        for (let k = 0; k < 3; k++) setTimeout(() => explode(rand(-0.6, 0.6), rand(0.2, 0.7), PALETTE[k % PALETTE.length], 120), k * 120);
        return;
      }
      const targets = sampleFlagTargets(flagCanvas, 750, aspect * 1.15);
      for (const tg of targets) {
        if (ps.length >= MAX) break;
        const p = { x: 0, y: 0.2, vx: 0, vy: 0, life: 4.2, max: 4.2, r: tg.r, g: tg.g, b: tg.b, frozen: true };
        ps.push(p);
        gsap.to(p, { x: tg.x, y: tg.y, duration: rand(0.7, 1.0), ease: 'power3.out', onComplete: () => { gsap.delayedCall(rand(2.2, 2.8), () => { p.frozen = false; p.vy = rand(-0.05, 0.05); p.vx = rand(-0.1, 0.1); p.life = Math.min(p.life, 1.2); p.max = 1.2; }); } });
      }
    };

    let raf, last = performance.now(), t0 = last, stopped = false;
    let nextRocket = 300, finaleAt = 3200, finaleDone = false;
    const DURATION = 15000; // one festive show, then fade out
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const elapsed = now - t0;
      if (!stopped) {
        if (elapsed > nextRocket && elapsed < DURATION - 2500) { launchRocket(); nextRocket = elapsed + rand(500, 1100); }
        if (!finaleDone && elapsed > finaleAt) { finaleDone = true; flagFinale(); if (flagCanvas) gsap.delayedCall(6.5, () => { finaleDone = false; finaleAt = (performance.now() - t0) + 400; }); }
      }
      // physics + write buffers
      let n = 0;
      for (const p of ps) {
        if (!p.frozen) { p.vy -= 0.9 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
        if (p.rocket && p.life <= 0) explode(p.x, p.y, PALETTE[(Math.random() * PALETTE.length) | 0], 80);
        if (p.life <= 0) continue;
        if (n < MAX) {
          const k = p.frozen ? 1 : Math.max(0, p.life / p.max);
          positions[n * 3] = p.x; positions[n * 3 + 1] = p.y; positions[n * 3 + 2] = 0;
          colors[n * 3] = p.r * k; colors[n * 3 + 1] = p.g * k; colors[n * 3 + 2] = p.b * k;
          n++;
        }
      }
      ps = ps.filter((p) => p.life > 0);
      for (let i = n; i < MAX; i++) { colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0; }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      geo.setDrawRange(0, MAX);
      // fade the whole canvas out at the end of the show
      if (elapsed > DURATION) { stopped = true; el.style.transition = 'opacity 1.5s ease'; el.style.opacity = '0'; if (elapsed > DURATION + 1600) { cancelAnimationFrame(raf); return; } }
      renderer.render(scene, cam);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => { aspect = W() / H(); cam.left = -aspect; cam.right = aspect; cam.updateProjectionMatrix(); renderer.setSize(W(), H()); };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf); window.removeEventListener('resize', onResize);
      gsap.globalTimeline.getChildren().forEach((c) => c.kill());
      geo.dispose(); mat.dispose(); mat.map?.dispose(); renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [ev, reduced, dismissed]);

  if (!ev || dismissed) return null;
  const title = (lang?.startsWith('fr') ? ev.titleFr : ev.titleEn) || '';
  const message = (lang?.startsWith('fr') ? ev.messageFr : ev.messageEn) || '';
  if (!title && !message && reduced) return null;

  return (
    <>
      {!reduced && <div ref={mount} aria-hidden className="fixed inset-0 z-[45]" style={{ pointerEvents: 'none' }} />}
      {(title || message) && (
        <div className="fixed left-1/2 -translate-x-1/2 top-20 z-[46] max-w-[92vw] anim-fade" style={{ pointerEvents: 'auto' }}>
          <div className="relative flex items-center gap-3 rounded-2xl border border-[var(--line-strong)] px-5 py-3 pr-10 shadow-2xl" style={{ background: 'var(--bg-solid)' }}>
            <span className="text-2xl leading-none">🎆</span>
            <div className="min-w-0">
              {title && <div className="font-bold gradient-text text-lg leading-tight">{title}</div>}
              {message && <div className="text-sm text-[var(--muted)] truncate">{message}</div>}
            </div>
            <button onClick={() => setDismissed(true)} aria-label={t('promo.badge.dismiss', 'Dismiss')} className="absolute right-2 top-2 rounded p-1 text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"><X size={15} /></button>
          </div>
        </div>
      )}
    </>
  );
}
