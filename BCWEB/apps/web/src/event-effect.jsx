import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { X, Sparkles, PartyPopper, Flag, Gift, Star, Rocket, CalendarDays, Bell, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from './api.js';
import { useI18n } from './i18n.jsx';

// Announcement icon options (named lucide icons — never a unicode emoji).
const BADGE_ICONS = { sparkles: Sparkles, party: PartyPopper, flag: Flag, gift: Gift, star: Star, rocket: Rocket, calendar: CalendarDays, bell: Bell };

// ── Full-screen EVENT effect: fireworks. For a national holiday the finale burst
// forms the country's flag (particles tween to positions sampled from a procedurally
// drawn flag — no emoji, no image assets). Purely decorative: the canvas is
// pointer-events:none so it never blocks the UI. Reduce-motion → no canvas, just the
// announcement. Three.js Points pool + GSAP for the flag formation. ──

// Stripe-based flags (dir 'v'=vertical, 'h'=horizontal) + a couple of specials. Covers
// the common cases (incl. FR); unknown countries fall back to a generic colour finale.
const FLAG_SPECS = {
  // Vertical tricolours
  FR: ['v', '#0055A4', '#FFFFFF', '#EF4135'], IT: ['v', '#008C45', '#F4F5F0', '#CD212A'],
  IE: ['v', '#169B62', '#FFFFFF', '#FF883E'], BE: ['v', '#2D2926', '#FDDA24', '#EF3340'],
  RO: ['v', '#002B7F', '#FCD116', '#CE1126'], PT: ['v', '#046A38', '#DA020E'],
  // Horizontal tricolours / bands
  DE: ['h', '#000000', '#DD0000', '#FFCE00'], NL: ['h', '#AE1C28', '#FFFFFF', '#21468B'],
  RU: ['h', '#FFFFFF', '#0039A6', '#D52B1E'], UA: ['h', '#0057B7', '#FFD700'],
  PL: ['h', '#FFFFFF', '#DC143C'], ID: ['h', '#FF0000', '#FFFFFF'], MC: ['h', '#CE1126', '#FFFFFF'],
  AT: ['h', '#ED2939', '#FFFFFF', '#ED2939'], ES: ['h', '#AA151B', '#F1BF00', '#AA151B'],
  HU: ['h', '#CD2A3E', '#FFFFFF', '#436F4D'], BG: ['h', '#FFFFFF', '#00966E', '#D62612'],
  LT: ['h', '#FDB913', '#006A44', '#C1272D'], EE: ['h', '#0072CE', '#000000', '#FFFFFF'],
  LV: ['h', '#9E3039', '#FFFFFF', '#9E3039'], LU: ['h', '#ED2939', '#FFFFFF', '#00A1DE'],
  AM: ['h', '#D90012', '#0033A0', '#F2A800'], CO: ['h', '#FCD116', '#003893', '#CE1126'],
  GR: ['h', '#0D5EAF', '#FFFFFF', '#0D5EAF', '#FFFFFF', '#0D5EAF'],
  // Specials
  JP: ['jp'], CH: ['ch'], US: ['us'], GB: ['gb'], UK: ['gb'],
  SE: ['nordic', '#006AA7', '#FECC00'], NO: ['nordic', '#EF2B2D', '#FFFFFF', '#002868'],
  DK: ['nordic', '#C60C30', '#FFFFFF'], FI: ['nordic', '#FFFFFF', '#003580'],
  IS: ['nordic', '#02529C', '#FFFFFF', '#DC1E35'],
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
  } else if (dir === 'nordic') {
    // Offset Scandinavian cross: spec = ['nordic', bg, cross, (innerCross)]
    const bg = spec[1], cross = spec[2], inner = spec[3];
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const t = H * 0.2, cx = W * 0.36; // vertical bar offset toward the hoist
    g.fillStyle = cross; g.fillRect(cx - t / 2, 0, t, H); g.fillRect(0, H / 2 - t / 2, W, t);
    if (inner) { const it2 = t * 0.45; g.fillStyle = inner; g.fillRect(cx - it2 / 2, 0, it2, H); g.fillRect(0, H / 2 - it2 / 2, W, it2); }
  } else if (dir === 'us') {
    for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#FFFFFF' : '#B22234'; g.fillRect(0, Math.round(i * H / 13), W, Math.ceil(H / 13)); }
    g.fillStyle = '#3C3B6E'; g.fillRect(0, 0, W * 0.4, H * 7 / 13);
    g.fillStyle = '#FFFFFF'; for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) { g.fillRect(W * 0.4 * (0.1 + c * 0.16), H * (7 / 13) * (0.12 + r * 0.19), 1.4, 1.4); }
  } else if (dir === 'gb') {
    // Union Jack (approximate): blue field, white then red St George + diagonals.
    g.fillStyle = '#012169'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#FFFFFF'; g.lineWidth = H * 0.28; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H); g.moveTo(W, 0); g.lineTo(0, H); g.stroke();
    g.strokeStyle = '#C8102E'; g.lineWidth = H * 0.1; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H); g.moveTo(W, 0); g.lineTo(0, H); g.stroke();
    g.fillStyle = '#FFFFFF'; g.fillRect(0, H / 2 - H * 0.18, W, H * 0.36); g.fillRect(W / 2 - H * 0.18, 0, H * 0.36, H);
    g.fillStyle = '#C8102E'; g.fillRect(0, H / 2 - H * 0.1, W, H * 0.2); g.fillRect(W / 2 - H * 0.1, 0, H * 0.2, H);
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

// Small flag image (same CDN the rest of the app uses) — shown in the event badge.
const flagUrl = (cc) => `https://flagcdn.com/32x24/${String(cc).toLowerCase()}.png`;

export default function EventEffect() {
  const { t, lang } = useI18n();
  const [ev, setEv] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  // Ad-hoc preview config, fired from the admin Events page via a window event — plays
  // the fireworks on demand (ignoring reduce-motion / the live-event gate) so an admin
  // can actually SEE and tune density / flag drops / the country flag before going live.
  const [preview, setPreview] = useState(null);
  const mount = useRef(null);

  useEffect(() => {
    let alive = true;
    api.get('/events/active').then((r) => { if (alive) setEv(r?.event || null); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onPreview = (e) => setPreview({ effect: 'fireworks', kind: 'custom', ...(e.detail || {}) });
    window.addEventListener('bcw:fx-preview', onPreview);
    return () => window.removeEventListener('bcw:fx-preview', onPreview);
  }, []);

  // Respect prefers-reduced-motion (no canvas, announcement only). A localStorage
  // override (`bcw_fx_preview=1`) forces the effect on — a preview hook for admins
  // (and for testing in reduced-motion environments like headless browsers).
  const prefersReduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let forcePreview = false, fxOff = false;
  try { forcePreview = localStorage.getItem('bcw_fx_preview') === '1'; } catch {}
  // Device setting (Settings → Appearance): turn the fireworks canvas off entirely while
  // keeping the (informational) event badge. A preview still bypasses it for admins.
  try { fxOff = localStorage.getItem('bcw_fx_off') === '1'; } catch {}
  const reduced = (prefersReduced && !forcePreview) || fxOff;

  useEffect(() => {
    // A preview always plays (bypasses reduce-motion + the live gate); otherwise the
    // live event plays when it's a fireworks effect and motion is allowed.
    const fx = preview || (ev && ev.effect === 'fireworks' && !reduced && !dismissed ? ev : null);
    if (!fx) return;
    const el = mount.current; if (!el) return;
    const W = () => window.innerWidth, H = () => window.innerHeight;
    let renderer;
    // premultipliedAlpha:false — with the default (true), additive sprites over a
    // transparent canvas render with dark fringes / a black wash that lingers after each
    // burst ("le fond noir après chaque firework"). Disabling it + an explicit 0-alpha
    // clear keeps the canvas truly transparent between and around particles.
    // antialias:false — with alpha + premultipliedAlpha:false, the MSAA resolve blends
    // particle edges toward the transparent-BLACK clear, leaving faint dark outlines
    // ("ombres noires") around bright particles. The sprites are already soft radial
    // gradients, so multisampling adds nothing but that artifact — turn it off.
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, premultipliedAlpha: false }); } catch { return; }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    let aspect = W() / H();
    const cam = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 10);
    cam.position.z = 2;

    const MAX = 4000;
    const positions = new Float32Array(MAX * 3), colors = new Float32Array(MAX * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Particle size is admin-configurable (fxSize 1..10 → ~5..16 px).
    const sizePx = 5 + Math.max(1, Math.min(10, fx.fxSize || 5)) * 1.1;
    const mat = new THREE.PointsMaterial({ size: sizePx, sizeAttenuation: false, vertexColors: true, map: makeSprite(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    /** @type {{x:number,y:number,vx:number,vy:number,life:number,max:number,r:number,g:number,b:number,rocket?:boolean,hx?:number,frozen?:boolean}[]} */
    let ps = [];
    const rand = (a, b) => a + Math.random() * (b - a);
    const density = Math.max(1, Math.min(10, fx.fxDensity || 5));       // fireworks amount
    const flagDrops = Math.max(0, Math.min(20, fx.fxFlagDrops ?? 2));   // how many flag formations
    // Rockets launch fast enough to burst in the UPPER part of the screen (the "sky"),
    // then explode at their apex — so the show stays overhead and doesn't cover the
    // content the user is reading lower down.
    const launchRocket = () => {
      const x = rand(-aspect * 0.75, aspect * 0.75);
      ps.push({ x, y: -1.05, vx: rand(-0.04, 0.04), vy: rand(1.7, 2.05), life: 3, max: 3, r: 1, g: 0.9, b: 0.7, rocket: true });
    };
    // Burst size scales gently with density; tighter spread + shorter life so bursts read
    // as crisp overhead fireworks instead of a screen-filling wall that lingers.
    const explode = (x, y, col, count = 70) => {
      for (let i = 0; i < count && ps.length < MAX; i++) {
        const a = Math.random() * Math.PI * 2, sp = rand(0.15, 0.6);
        ps.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.9, 1.6), max: 1.6, r: col[0], g: col[1], b: col[2] });
      }
    };
    // Flag finale: particles rush to the sampled flag positions, hold, then fall.
    const flagCanvas = fx.kind === 'national_holiday' && fx.countryCode ? drawFlag(fx.countryCode) : null;
    // A "flag drop": particles rush to the flag shape at a RANDOM place + size, hold,
    // then fall. With no drawable flag it's a big multi-colour burst at that spot.
    const flagDrop = (cx, cy, worldW) => {
      if (!flagCanvas) {
        for (let k = 0; k < 4; k++) setTimeout(() => explode(cx + rand(-0.2, 0.2), cy + rand(-0.12, 0.12), PALETTE[(Math.random() * PALETTE.length) | 0], 110), k * 90);
        return;
      }
      const targets = sampleFlagTargets(flagCanvas, 460, worldW);
      for (const tg of targets) {
        if (ps.length >= MAX) break;
        const p = { x: cx, y: cy, vx: 0, vy: 0, life: 4.4, max: 4.4, r: tg.r, g: tg.g, b: tg.b, frozen: true };
        ps.push(p);
        gsap.to(p, { x: cx + tg.x, y: cy + tg.y, duration: rand(0.6, 0.95), ease: 'power3.out', onComplete: () => { gsap.delayedCall(rand(1.8, 2.6), () => { p.frozen = false; p.vy = rand(-0.05, 0.05); p.vx = rand(-0.1, 0.1); p.life = Math.min(p.life, 1.2); p.max = 1.2; }); } });
      }
    };

    let raf, last = performance.now(), t0 = last, stopped = false;
    const DURATION = 15000; // one festive show, then fade out
    // Amount is driven by density but kept CALM by default so it never overwhelms the
    // page: at most ~1..3 rockets per wave, with a gap that widens as density drops.
    const perWave = Math.max(1, Math.round(density / 3.5)); // ~1..3 rockets per wave
    const burst = () => 55 + density * 6; // ~60..115 particles per burst
    const timers = [];
    // A gentle opener (one rocket + one high burst) — enough to notice, not a wall.
    timers.push(setTimeout(() => launchRocket(), 80));
    timers.push(setTimeout(() => explode(rand(-aspect * 0.5, aspect * 0.5), rand(0.35, 0.6), PALETTE[(Math.random() * PALETTE.length) | 0], burst()), 260));
    let nextRocket = rand(500, 800);
    const rocketGap = () => rand(520, 900) + (10 - density) * 70; // calmer cadence
    const flagTimes = Array.from({ length: flagDrops }, () => rand(1200, DURATION - 2500)).sort((a, b) => a - b);
    let dropIdx = 0;
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const elapsed = now - t0;
      if (!stopped) {
        if (elapsed > nextRocket && elapsed < DURATION - 2000) { for (let i = 0; i < perWave; i++) launchRocket(); nextRocket = elapsed + rocketGap(); }
        while (dropIdx < flagTimes.length && elapsed > flagTimes[dropIdx]) {
          flagDrop(rand(-aspect * 0.5, aspect * 0.5), rand(0.2, 0.6), rand(aspect * 0.45, aspect * 0.85));
          dropIdx++;
        }
      }
      // physics + write buffers
      let n = 0;
      for (const p of ps) {
        if (!p.frozen) { p.vy -= 0.9 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
        // A rocket bursts at its APEX (vy crosses 0) — always high in the sky.
        if (p.rocket && !p.done && (p.vy <= 0 || p.y > 0.85)) { p.done = true; explode(p.x, p.y, PALETTE[(Math.random() * PALETTE.length) | 0], burst()); p.life = 0; }
        if (p.life <= 0) continue;
        if (n < MAX) {
          const k = p.frozen ? 1 : Math.max(0, p.life / p.max);
          positions[n * 3] = p.x; positions[n * 3 + 1] = p.y; positions[n * 3 + 2] = 0;
          colors[n * 3] = p.r * k; colors[n * 3 + 1] = p.g * k; colors[n * 3 + 2] = p.b * k;
          n++;
        }
      }
      ps = ps.filter((p) => p.life > 0);
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      // Draw ONLY the active particles — not the whole 4000-slot buffer. The stale
      // slots kept old positions (only their colour was zeroed); drawing them was wasted
      // work and one more chance for an edge artifact. Now they're simply not drawn.
      geo.setDrawRange(0, n);
      // fade the whole canvas out at the end of the show
      if (elapsed > DURATION) { stopped = true; el.style.transition = 'opacity 1.5s ease'; el.style.opacity = '0'; if (elapsed > DURATION + 1600) { cancelAnimationFrame(raf); if (preview) setPreview(null); return; } }
      renderer.render(scene, cam);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => { aspect = W() / H(); cam.left = -aspect; cam.right = aspect; cam.updateProjectionMatrix(); renderer.setSize(W(), H()); };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf); window.removeEventListener('resize', onResize);
      timers.forEach(clearTimeout);
      gsap.globalTimeline.getChildren().forEach((c) => c.kill());
      geo.dispose(); mat.dispose(); mat.map?.dispose(); renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      el.style.opacity = ''; el.style.transition = '';
    };
  }, [ev, reduced, dismissed, preview]);

  if ((!ev || dismissed) && !preview) return null;
  // `ev` can be null during a preview-only run — keep every access optional so a preview
  // fired before any event is live never crashes the app (that was the real "fireworks
  // don't work": the render threw on ev.titleEn and blanked the page).
  const title = (lang?.startsWith('fr') ? ev?.titleFr : ev?.titleEn) || '';
  const message = (lang?.startsWith('fr') ? ev?.messageFr : ev?.messageEn) || '';
  const BadgeIcon = BADGE_ICONS[ev?.badgeIcon] || Sparkles;
  if (!title && !message && reduced && !preview) return null;

  const isHoliday = ev?.kind === 'national_holiday' && ev?.countryCode;
  const link = ev?.linkUrl || null;
  const external = link && /^https?:\/\//.test(link);
  // Icon + text + (a "go" arrow when the badge links somewhere).
  const inner = (
    <>
      {isHoliday
        ? <img src={flagUrl(ev.countryCode)} alt="" width={32} height={24} className="shrink-0 rounded-[3px] object-cover ring-1 ring-[var(--line-strong)]" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        : <BadgeIcon size={24} className="shrink-0 text-[var(--primary-2)]" />}
      <div className="min-w-0 flex-1">
        {title && <div className="font-bold gradient-text text-base sm:text-lg leading-tight truncate">{title}</div>}
        {message && <div className="text-xs sm:text-sm text-[var(--muted)] truncate">{message}</div>}
      </div>
      {link && <ArrowRight size={16} className="shrink-0 text-[var(--faint)]" />}
    </>
  );
  const rowCls = `flex items-center gap-2.5 sm:gap-3 px-3.5 sm:px-5 py-2.5 sm:py-3 pr-9 ${link ? 'rounded-2xl transition hover:bg-[var(--surface-2)]/50' : ''}`;
  return (
    <>
      {(!reduced || preview) && <div ref={mount} aria-hidden className="fixed inset-0 z-[45]" style={{ pointerEvents: 'none' }} />}
      {(title || message) && (
        <div className="fixed left-1/2 -translate-x-1/2 top-16 md:top-20 z-[46] w-[min(94vw,26rem)] anim-fade" style={{ pointerEvents: 'auto' }}>
          <div className="relative rounded-2xl border border-[var(--line-strong)] shadow-2xl overflow-hidden" style={{ background: 'var(--bg-solid)' }}>
            {link
              ? (external
                ? <a href={link} target="_blank" rel="noopener noreferrer" className={rowCls}>{inner}</a>
                : <Link to={link} onClick={() => setDismissed(true)} className={rowCls}>{inner}</Link>)
              : <div className={rowCls}>{inner}</div>}
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDismissed(true); }} aria-label={t('promo.badge.dismiss', 'Dismiss')} className="absolute right-1.5 top-1.5 rounded p-1 text-[var(--faint)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"><X size={15} /></button>
          </div>
        </div>
      )}
    </>
  );
}
