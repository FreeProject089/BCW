// Site-event visual effects. One active event (from GET /events/active) drives:
//   • a full-screen particle canvas (snow, hearts, leaves, fireworks, flags…),
//   • theme overlays (halloween fog, valentine vignette),
//   • a seasonal silhouette strip along the bottom of the page,
//   • a dismissible promo banner when the event carries a discount,
//   • a New-Year countdown chip and an opt-in spooky-sound toggle for Halloween.
// Everything is pointer-events-none (never blocks the UI), mobile-scaled (particle
// count follows viewport, DPR capped, paused when the tab is hidden), and the whole
// layer can be killed in one click from Settings (localStorage `bcw_event_fx_off`).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Tag } from 'lucide-react';
import { api } from './api.js';
import { useI18n } from './i18n.jsx';

export const FX_OFF_KEY = 'bcw_event_fx_off';
export const FX_EVENT = 'bcw-event-fx-changed';
export const fxDisabled = () => { try { return localStorage.getItem(FX_OFF_KEY) === '1'; } catch { return false; } };
export const setFxDisabled = (off) => {
  try { localStorage.setItem(FX_OFF_KEY, off ? '1' : '0'); } catch { /* ignore */ }
  try { window.dispatchEvent(new Event(FX_EVENT)); } catch { /* ignore */ }
};

// Fetch the active event once per page load (server caches it 30 s anyway).
let _eventPromise = null;
export function fetchActiveEvent() {
  if (!_eventPromise) _eventPromise = api.get('/events/active').then((r) => r.event || null).catch(() => null);
  return _eventPromise;
}
export function useActiveEvent() {
  const [event, setEvent] = useState(null);
  useEffect(() => { let ok = true; fetchActiveEvent().then((e) => ok && setEvent(e)); return () => { ok = false; }; }, []);
  return event;
}

/* ── Particle canvas ─────────────────────────────────────────────────────────── */
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Falling/floating emoji or dot particles per theme. `null` = no particle layer.
const THEME_PARTICLES = {
  christmas: { kind: 'snow' },
  winter: { kind: 'snow' },
  valentine: { kind: 'rise', glyphs: ['💗', '❤️', '💘', '💕'], density: 26 },
  autumn: { kind: 'fall', glyphs: ['🍂', '🍁'], density: 22 },
  spring: { kind: 'fall', glyphs: ['🌸', '🌷', '🌼'], density: 18 },
  summer: { kind: 'fall', glyphs: ['✨', '☀️'], density: 8, slow: true },
  easter: { kind: 'fall', glyphs: ['🥚', '🐣', '🌼'], density: 12 },
  blackfriday: { kind: 'fall', glyphs: ['%', '🏷️'], density: 10, color: '#f59e0b' },
  halloween: { kind: 'float', glyphs: ['🎃', '👻', '🦇'], density: 10 },
  newyear: { kind: 'fireworks', confetti: true },
  national: { kind: 'fireworks', flagRain: true },
};

function FxCanvas({ theme, flag }) {
  const ref = useRef(null);
  useEffect(() => {
    const cfg = THEME_PARTICLES[theme];
    if (!cfg) return;
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let w = 0, h = 0, raf = 0, alive = true, last = performance.now();
    const resize = () => { w = window.innerWidth; h = window.innerHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    window.addEventListener('resize', resize);

    // Mobile-friendly counts: scale with viewport width.
    const scale = Math.min(1, w / 1200);
    const parts = [];   // ambient particles
    const sparks = [];  // firework sparks
    const rockets = [];
    let lastRocket = 0;

    const spawnAmbient = () => {
      const n = Math.max(6, Math.round((cfg.density || 30) * scale * (cfg.kind === 'snow' ? 3 : 1)));
      for (let i = 0; i < n; i++) {
        parts.push({
          x: rnd(0, w), y: rnd(-h, h), size: cfg.kind === 'snow' ? rnd(1, 3.4) : rnd(14, 26),
          vy: (cfg.slow ? rnd(8, 18) : rnd(20, 55)) * (cfg.kind === 'rise' || cfg.kind === 'float' ? -0.6 : 1),
          drift: rnd(-14, 14), phase: rnd(0, Math.PI * 2), rot: rnd(-0.6, 0.6),
          glyph: cfg.glyphs ? pick(cfg.glyphs) : null, alpha: rnd(0.55, 0.95),
        });
      }
    };
    if (cfg.kind !== 'fireworks') spawnAmbient();
    if (cfg.confetti || cfg.flagRain) {
      const n = Math.round(24 * scale) + 6;
      for (let i = 0; i < n; i++) {
        parts.push(cfg.flagRain && flag
          ? { x: rnd(0, w), y: rnd(-h, 0), size: rnd(16, 26), vy: rnd(25, 55), drift: rnd(-12, 12), phase: rnd(0, 7), rot: rnd(-0.8, 0.8), glyph: flag, alpha: 0.9 }
          : { x: rnd(0, w), y: rnd(-h, 0), size: rnd(3, 6), vy: rnd(40, 90), drift: rnd(-20, 20), phase: rnd(0, 7), rot: rnd(-3, 3), glyph: null, alpha: 0.9, color: pick(['#f97316', '#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#eab308']) });
      }
    }

    const explode = (x, y) => {
      const n = Math.round(34 * Math.max(0.5, scale));
      const hue = Math.floor(rnd(0, 360));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, sp = rnd(40, 150);
        sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.8, 1.5), age: 0, color: `hsl(${hue + rnd(-20, 20)} 90% 65%)` });
      }
    };

    const tick = (now) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, w, h);

      // fireworks: launch a rocket every ~0.9–1.6 s (fewer on phones)
      if (cfg.kind === 'fireworks' && now - lastRocket > rnd(900, 1600) && rockets.length < (w < 640 ? 2 : 4)) {
        rockets.push({ x: rnd(w * 0.15, w * 0.85), y: h + 8, vy: -rnd(220, 320), targetY: rnd(h * 0.15, h * 0.45) });
        lastRocket = now;
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]; r.y += r.vy * dt;
        ctx.globalAlpha = 0.9; ctx.fillStyle = '#fde68a'; ctx.fillRect(r.x - 1, r.y, 2, 8);
        if (r.y <= r.targetY) { explode(r.x, r.y); rockets.splice(i, 1); }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]; s.age += dt;
        if (s.age >= s.life) { sparks.splice(i, 1); continue; }
        s.vy += 60 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
        ctx.globalAlpha = Math.max(0, 1 - s.age / s.life);
        ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, Math.PI * 2); ctx.fill();
      }

      // ambient particles
      for (const p of parts) {
        p.phase += dt; p.y += p.vy * dt; p.x += Math.sin(p.phase) * p.drift * dt; p.rot += dt * 0.4;
        if (p.vy > 0 && p.y > h + 30) { p.y = -30; p.x = rnd(0, w); }
        if (p.vy < 0 && p.y < -30) { p.y = h + 30; p.x = rnd(0, w); }
        ctx.globalAlpha = p.alpha;
        if (p.glyph) {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.phase) * 0.25);
          ctx.font = `${p.size}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          if (cfg.color && p.glyph === '%') { ctx.fillStyle = cfg.color; ctx.font = `bold ${p.size}px sans-serif`; }
          ctx.fillText(p.glyph, 0, 0); ctx.restore();
        } else if (p.color) { // confetti rects
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore();
        } else { // snow
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(tick); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis); };
  }, [theme, flag]);
  if (!THEME_PARTICLES[theme]) return null;
  return <canvas ref={ref} className="fixed inset-0 z-[2] pointer-events-none" aria-hidden="true" />;
}

/* ── Seasonal bottom silhouette strip ────────────────────────────────────────── */
// A decorative full-width illustration pinned to the bottom of the viewport,
// BEHIND all content (z sits between the Hero3D backdrop at -z-10 and the page).
function SeasonStrip({ theme }) {
  const strips = {
    winter: (
      <svg viewBox="0 0 1200 110" preserveAspectRatio="none" className="w-full h-full">
        <path d="M0 80 L140 34 L300 78 L470 22 L640 74 L820 38 L1000 82 L1200 40 V110 H0 Z" fill="#e2e8f0" opacity="0.5" />
        <path d="M0 96 L200 66 L420 96 L650 60 L900 96 L1200 70 V110 H0 Z" fill="#f8fafc" opacity="0.65" />
        {[100, 340, 560, 860, 1080].map((x, i) => <path key={i} d={`M${x} 96 l12 -26 l12 26 Z`} fill="#0f3d2e" opacity="0.75" />)}
      </svg>),
    christmas: (
      <svg viewBox="0 0 1200 110" preserveAspectRatio="none" className="w-full h-full">
        <path d="M0 92 L220 60 L460 94 L700 58 L950 94 L1200 66 V110 H0 Z" fill="#f8fafc" opacity="0.6" />
        {[80, 280, 500, 760, 1000, 1140].map((x, i) => (
          <g key={i} opacity="0.85"><path d={`M${x} 94 l14 -34 l14 34 Z`} fill="#14532d" /><circle cx={x + 14} cy={70} r="2.2" fill="#fbbf24" /><circle cx={x + 7} cy={84} r="2" fill="#ef4444" /></g>
        ))}
        {[380, 640, 900].map((x, i) => <g key={`g${i}`} opacity="0.8"><rect x={x} y={92} width="14" height="11" rx="2" fill="#dc2626" /><rect x={x + 5.5} y={92} width="3" height="11" fill="#fbbf24" /></g>)}
      </svg>),
    halloween: (
      <svg viewBox="0 0 1200 110" preserveAspectRatio="none" className="w-full h-full">
        <path d="M0 88 Q300 64 600 88 T1200 84 V110 H0 Z" fill="#1c1408" opacity="0.85" />
        {[120, 360, 620, 880, 1100].map((x, i) => (
          <g key={i} opacity="0.9"><ellipse cx={x} cy={94} rx="15" ry="11" fill="#ea580c" /><rect x={x - 2} y={80} width="4" height="6" rx="1" fill="#365314" /><circle cx={x - 5} cy={92} r="1.8" fill="#1c1408" /><circle cx={x + 5} cy={92} r="1.8" fill="#1c1408" /></g>
        ))}
        <path d="M0 110 Q600 92 1200 110 Z" fill="#a3a3a3" opacity="0.12" />
      </svg>),
    valentine: (
      <svg viewBox="0 0 1200 110" preserveAspectRatio="none" className="w-full h-full">
        <path d="M0 92 Q300 70 600 92 T1200 88 V110 H0 Z" fill="#be185d" opacity="0.35" />
        {[150, 420, 700, 980].map((x, i) => <text key={i} x={x} y={92} fontSize="22" opacity="0.7">💕</text>)}
      </svg>),
    spring: (
      <svg viewBox="0 0 1200 110" preserveAspectRatio="none" className="w-full h-full">
        <path d="M0 90 Q300 64 620 90 T1200 86 V110 H0 Z" fill="#4d7c0f" opacity="0.5" />
        {[90, 250, 430, 610, 800, 990, 1130].map((x, i) => (
          <g key={i} opacity="0.85"><line x1={x} y1={96} x2={x} y2={82} stroke="#65a30d" strokeWidth="2" /><circle cx={x} cy={79} r="4.5" fill={pick(['#f472b6', '#fbbf24', '#f87171', '#c084fc'])} /></g>
        ))}
      </svg>),
    summer: (
      <svg viewBox="0 0 1200 110" preserveAspectRatio="none" className="w-full h-full">
        <circle cx="1080" cy="30" r="26" fill="#fbbf24" opacity="0.7" />
        <path d="M0 92 Q200 78 400 92 T800 92 T1200 92 V110 H0 Z" fill="#0ea5e9" opacity="0.4" />
        <path d="M0 100 Q200 88 400 100 T800 100 T1200 100 V110 H0 Z" fill="#0284c7" opacity="0.45" />
      </svg>),
    autumn: (
      <svg viewBox="0 0 1200 110" preserveAspectRatio="none" className="w-full h-full">
        <path d="M0 88 L260 58 L540 90 L820 56 L1200 88 V110 H0 Z" fill="#7c2d12" opacity="0.45" />
        {[140, 400, 680, 960].map((x, i) => (
          <g key={i} opacity="0.85"><rect x={x - 2} y={76} width="4" height="20" fill="#57534e" /><circle cx={x} cy={70} r="12" fill={pick(['#ea580c', '#d97706', '#b91c1c'])} opacity="0.85" /></g>
        ))}
      </svg>),
    easter: (
      <svg viewBox="0 0 1200 110" preserveAspectRatio="none" className="w-full h-full">
        <path d="M0 90 Q300 68 620 90 T1200 86 V110 H0 Z" fill="#65a30d" opacity="0.45" />
        {[160, 380, 640, 900, 1100].map((x, i) => (
          <ellipse key={i} cx={x} cy={90} rx="9" ry="12" fill={pick(['#f472b6', '#60a5fa', '#fbbf24', '#a78bfa', '#34d399'])} opacity="0.85" />
        ))}
      </svg>),
  };
  const svg = strips[theme];
  if (!svg) return null;
  return (
    <div className="fixed bottom-0 inset-x-0 -z-[5] pointer-events-none h-16 sm:h-24 opacity-50" aria-hidden="true">
      {svg}
    </div>
  );
}

/* ── Halloween spooky sound (opt-in, WebAudio-generated wind — no asset) ─────── */
function SpookyAudio() {
  const [on, setOn] = useState(false);
  const nodes = useRef(null);
  const toggle = () => {
    if (on) { try { nodes.current?.ctx.close(); } catch { /* ignore */ } nodes.current = null; setOn(false); return; }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Brown-ish noise → lowpass → slow LFO on gain = an eerie wind.
      const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let lastV = 0;
      for (let i = 0; i < data.length; i++) { const white = Math.random() * 2 - 1; lastV = (lastV + 0.02 * white) / 1.02; data[i] = lastV * 3.5; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      const gain = ctx.createGain(); gain.gain.value = 0.05;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.035;
      lfo.connect(lfoGain); lfoGain.connect(gain.gain);
      src.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
      src.start(); lfo.start();
      nodes.current = { ctx };
      setOn(true);
    } catch { /* audio unavailable */ }
  };
  useEffect(() => () => { try { nodes.current?.ctx.close(); } catch { /* ignore */ } }, []);
  return (
    <button onClick={toggle} title={on ? 'Mute spooky sounds' : 'Spooky sounds'} aria-label="Spooky sounds"
      className="fixed left-3 bottom-24 md:bottom-5 z-30 w-9 h-9 grid place-items-center rounded-full border border-[var(--line-strong)] bg-[var(--bg-solid)]/90 backdrop-blur text-base shadow-lg hover:scale-110 transition">
      {on ? '🔊' : '👻'}
    </button>
  );
}

/* ── New-Year countdown chip (to the next local midnight inside the window) ──── */
function NYCountdown() {
  const [txt, setTxt] = useState('');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const mid = new Date(now); mid.setHours(24, 0, 0, 0);
      const d = mid - now;
      if (d < 1000 || d > 20 * 3600e3) { setTxt('🎉 Happy New Year!'); return; }
      const hh = String(Math.floor(d / 3600e3)).padStart(2, '0');
      const mm = String(Math.floor((d % 3600e3) / 60e3)).padStart(2, '0');
      const ss = String(Math.floor((d % 60e3) / 1000)).padStart(2, '0');
      setTxt(`🎆 ${hh}:${mm}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  if (!txt) return null;
  return (
    <div className="fixed top-[4.6rem] left-1/2 -translate-x-1/2 z-30 pointer-events-none px-3 py-1 rounded-full border border-[var(--line-strong)] bg-[var(--bg-solid)]/85 backdrop-blur text-sm font-bold tabular-nums shadow-lg" aria-hidden="true">
      {txt}
    </div>
  );
}

/* ── Promo banner (any event carrying a discount) ────────────────────────────── */
function PromoBanner({ event }) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem('bcw_event_banner_hide') === event.id; } catch { return false; } });
  if (hidden) return null;
  const days = Math.max(0, Math.ceil((new Date(event.endsAt) - Date.now()) / 864e5));
  return (
    <div className="fixed top-[4.6rem] left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full text-white text-sm font-semibold shadow-xl max-w-[calc(100vw-1.5rem)]"
      style={{ background: 'linear-gradient(90deg,#f97316,#dc2626)' }}>
      <Tag size={14} className="shrink-0 animate-pulse" />
      <Link to="/hosting" className="truncate hover:underline">
        {event.name} — −{event.discountPct}% · {t('ev.endsin', 'ends in {n}d').replace('{n}', days)}
      </Link>
      <button onClick={() => { setHidden(true); try { sessionStorage.setItem('bcw_event_banner_hide', event.id); } catch { /* ignore */ } }}
        className="w-6 h-6 grid place-items-center rounded-full hover:bg-white/20 shrink-0" aria-label="Dismiss"><X size={13} /></button>
    </div>
  );
}

/* ── Root ────────────────────────────────────────────────────────────────────── */
export default function EventEffects() {
  const event = useActiveEvent();
  const [off, setOff] = useState(fxDisabled());
  useEffect(() => {
    const onChange = () => setOff(fxDisabled());
    window.addEventListener(FX_EVENT, onChange);
    return () => window.removeEventListener(FX_EVENT, onChange);
  }, []);
  if (!event) return null;
  const theme = event.theme;
  return (
    <>
      {/* The promo banner stays even with effects off — it's pricing info, not decor. */}
      {event.discountPct > 0 && <PromoBanner event={event} />}
      {!off && theme !== 'none' && (
        <>
          <SeasonStrip theme={theme} />
          <FxCanvas theme={theme} flag={event.flag} />
          {theme === 'halloween' && (
            <div className="fixed inset-x-0 bottom-0 h-44 -z-[4] pointer-events-none opacity-50" aria-hidden="true"
              style={{ background: 'linear-gradient(to top, rgba(148,163,184,0.28), transparent)', animation: 'fadeIn 2s ease' }} />
          )}
          {theme === 'valentine' && (
            <div className="fixed inset-0 -z-[4] pointer-events-none" aria-hidden="true"
              style={{ background: 'radial-gradient(ellipse at 50% 110%, rgba(236,72,153,0.14), transparent 60%)' }} />
          )}
          {theme === 'halloween' && <SpookyAudio />}
          {theme === 'newyear' && <NYCountdown />}
        </>
      )}
    </>
  );
}
