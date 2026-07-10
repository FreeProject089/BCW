// Site-event visual effects. One active event (from GET /events/active) drives:
//   • a full-screen particle canvas (snow, hearts, leaves, fireworks, flags…),
//   • theme overlays (halloween fog, valentine vignette),
//   • a seasonal silhouette strip along the bottom of the page,
//   • a dismissible promo banner when the event carries a discount,
//   • a New-Year countdown chip and an opt-in spooky-sound toggle for Halloween.
// Every knob is tunable per-event from the admin Effects editor (event.fx), with
// safe theme defaults. Everything is pointer-events-none (never blocks the UI),
// mobile-scaled (particle counts follow the viewport, DPR capped, paused when the
// tab is hidden), fully hidden during the intro, and killable in one click from
// Settings (localStorage `bcw_event_fx_off`).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Tag } from 'lucide-react';
import { api } from './api.js';
import { useI18n } from './i18n.jsx';
import { useIntro } from './IntroContext.jsx';

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

/* ── Fx config (admin Effects editor) ────────────────────────────────────────── */
export const FX_DEFAULTS = { density: 1, speed: 1, size: 1, opacity: 1, wind: 0, intensity: 1, glyphs: '', strip: true, fog: true, sound: true, countdown: true };
const fxOf = (fx) => ({ ...FX_DEFAULTS, ...(fx || {}) });
// Split a custom emoji string into glyphs — Intl.Segmenter keeps flags/ZWJ intact.
function splitGlyphs(s) {
  const str = String(s || '').replace(/[\s,;]+/g, '');
  if (!str) return null;
  try { return [...new Intl.Segmenter().segment(str)].map((x) => x.segment).filter(Boolean).slice(0, 12); }
  catch { return Array.from(str).slice(0, 12); }
}

/* ── Particle canvas ─────────────────────────────────────────────────────────── */
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Theme base configs. kinds: snow | fall | rise | float | fireworks
const THEME_PARTICLES = {
  christmas: { kind: 'snow' },
  winter: { kind: 'snow' },
  valentine: { kind: 'rise', glyphs: ['💗', '❤️', '💘', '💕'], density: 26 },
  autumn: { kind: 'fall', glyphs: ['🍂', '🍁'], density: 22, tumble: true },
  spring: { kind: 'fall', glyphs: ['🌸', '🌷', '🌼'], density: 18, tumble: true },
  summer: { kind: 'fall', glyphs: ['✨', '☀️'], density: 8, slow: true },
  easter: { kind: 'fall', glyphs: ['🥚', '🐣', '🌼'], density: 12, tumble: true },
  blackfriday: { kind: 'fall', glyphs: ['%', '🏷️'], density: 12, color: '#f59e0b' },
  halloween: { kind: 'float', glyphs: ['🎃', '👻', '🦇'], density: 10, pulse: true },
  newyear: { kind: 'fireworks', confetti: true, glitter: true },
  national: { kind: 'fireworks', flagRain: true },
};

function FxCanvas({ theme, flag, fx }) {
  const ref = useRef(null);
  useEffect(() => {
    const cfg = THEME_PARTICLES[theme];
    if (!cfg) return;
    const F = fxOf(fx);
    const custom = splitGlyphs(F.glyphs);
    const glyphs = custom || cfg.glyphs || null;
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let w = 0, h = 0, raf = 0, alive = true, last = performance.now();
    const resize = () => { w = window.innerWidth; h = window.innerHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    window.addEventListener('resize', resize);

    // Mobile-friendly counts: scale with viewport width, then the admin density knob.
    const scale = Math.min(1, w / 1200);
    const parts = [];   // ambient particles
    const sparks = [];  // firework sparks (with trails)
    const rockets = [];
    let lastRocket = 0;

    const spawnAmbient = () => {
      const base = (cfg.density || 30) * (cfg.kind === 'snow' ? 3.2 : 1);
      const n = Math.max(4, Math.round(base * scale * F.density));
      for (let i = 0; i < n; i++) {
        const depth = rnd(0.35, 1); // parallax: far = smaller, slower, fainter
        parts.push({
          x: rnd(0, w), y: rnd(-h, h), depth,
          size: (cfg.kind === 'snow' ? rnd(1.2, 3.6) : rnd(15, 27)) * F.size * (cfg.kind === 'snow' ? depth : rnd(0.8, 1.1)),
          vy: (cfg.slow ? rnd(8, 18) : rnd(22, 58)) * F.speed * depth * (cfg.kind === 'rise' || cfg.kind === 'float' ? -0.55 : 1),
          drift: rnd(-14, 14), phase: rnd(0, Math.PI * 2), spin: rnd(0.4, 1.4) * (Math.random() < 0.5 ? -1 : 1),
          glyph: glyphs ? pick(glyphs) : null, alpha: rnd(0.5, 0.95) * (cfg.kind === 'snow' ? (0.35 + 0.65 * depth) : 1) * F.opacity,
        });
      }
    };
    if (cfg.kind !== 'fireworks') spawnAmbient();
    if (cfg.confetti || cfg.flagRain || cfg.glitter) {
      const n = Math.round(26 * scale * F.density) + 6;
      for (let i = 0; i < n; i++) {
        if (cfg.flagRain && flag) {
          parts.push({ x: rnd(0, w), y: rnd(-h, 0), size: rnd(17, 27) * F.size, vy: rnd(28, 58) * F.speed, drift: rnd(-12, 12), phase: rnd(0, 7), spin: rnd(-1, 1), glyph: flag, alpha: 0.92 * F.opacity, depth: 1 });
        } else if (cfg.glitter && i % 3 === 0) {
          parts.push({ x: rnd(0, w), y: rnd(-h, 0), size: rnd(1.4, 2.6) * F.size, vy: rnd(30, 70) * F.speed, drift: rnd(-10, 10), phase: rnd(0, 7), spin: 0, glyph: null, glitter: true, alpha: 0.9 * F.opacity, depth: 1 });
        } else {
          parts.push({ x: rnd(0, w), y: rnd(-h, 0), size: rnd(3.5, 6.5) * F.size, vy: rnd(42, 95) * F.speed, drift: rnd(-20, 20), phase: rnd(0, 7), spin: rnd(-3, 3), glyph: null, alpha: 0.92 * F.opacity, depth: 1, color: pick(['#f97316', '#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#eab308', '#a78bfa']) });
        }
      }
    }

    const explode = (x, y) => {
      // Double burst: a dense core ring + a sparse wide halo, warm-shifted hues.
      const hue = Math.floor(rnd(0, 360));
      const rings = [[Math.round(30 * Math.max(0.5, scale) * F.intensity), 60, 170], [Math.round(14 * Math.max(0.5, scale) * F.intensity), 150, 260]];
      for (const [n, sMin, sMax] of rings) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + rnd(-0.08, 0.08), sp = rnd(sMin, sMax);
          sparks.push({ x, y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.8, 1.6), age: 0, hue: hue + rnd(-24, 24), flicker: rnd(4, 9) });
        }
      }
    };

    const tick = (now) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, w, h);

      // ── fireworks: launch a rocket every so often (rate follows the intensity knob)
      if (cfg.kind === 'fireworks' && now - lastRocket > rnd(900, 1700) / F.intensity && rockets.length < (w < 640 ? 2 : 4)) {
        rockets.push({ x: rnd(w * 0.15, w * 0.85), y: h + 8, vy: -rnd(230, 330) * Math.max(0.7, F.speed), targetY: rnd(h * 0.14, h * 0.45), wob: rnd(0, 7) });
        lastRocket = now;
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]; r.y += r.vy * dt; r.wob += dt * 9;
        const rx = r.x + Math.sin(r.wob) * 2.5;
        ctx.globalAlpha = 0.9; ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(rx, r.y + 14); ctx.lineTo(rx, r.y); ctx.stroke();
        if (r.y <= r.targetY) { explode(rx, r.y); rockets.splice(i, 1); }
      }
      // sparks: additive blending + motion trails + end-of-life flicker
      if (sparks.length) {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i]; s.age += dt;
          if (s.age >= s.life) { sparks.splice(i, 1); continue; }
          s.px = s.x; s.py = s.y;
          s.vy += 70 * dt; s.vx *= (1 - 0.5 * dt); s.x += s.vx * dt; s.y += s.vy * dt;
          const t = s.age / s.life;
          const flick = t > 0.6 ? (0.6 + 0.4 * Math.abs(Math.sin(s.age * s.flicker))) : 1;
          ctx.globalAlpha = Math.max(0, (1 - t)) * flick * F.opacity;
          ctx.strokeStyle = `hsl(${s.hue} 95% ${65 - t * 20}%)`; ctx.lineWidth = 2.2 * (1 - t) + 0.6;
          ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(s.x, s.y); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // ── ambient particles
      for (const p of parts) {
        p.phase += dt * p.spin || dt; p.y += p.vy * dt;
        p.x += (Math.sin(p.phase) * p.drift + F.wind * 26 * (p.depth || 1)) * dt;
        if (p.vy > 0 && p.y > h + 34) { p.y = -34; p.x = rnd(0, w); }
        if (p.vy < 0 && p.y < -34) { p.y = h + 34; p.x = rnd(0, w); }
        if (p.x > w + 40) p.x = -40; else if (p.x < -40) p.x = w + 40;
        const pulse = cfg.pulse ? (0.65 + 0.35 * Math.sin(p.phase * 0.8)) : 1; // ghosts fade in/out
        ctx.globalAlpha = p.alpha * pulse;
        if (p.glyph) {
          ctx.save(); ctx.translate(p.x, p.y);
          ctx.rotate(cfg.tumble ? p.phase : Math.sin(p.phase) * 0.3); // leaves tumble, others sway
          ctx.font = `${p.size}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          if (cfg.color && p.glyph === '%') { ctx.fillStyle = cfg.color; ctx.font = `bold ${p.size}px sans-serif`; }
          ctx.fillText(p.glyph, 0, 0); ctx.restore();
        } else if (p.color) { // confetti: spin on both axes
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.phase);
          ctx.scale(1, Math.max(0.15, Math.abs(Math.sin(p.phase * 2.3)))); // flip shimmer
          ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore();
        } else if (p.glitter) { // NY gold glitter
          ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.7 + 0.3 * Math.sin(p.phase * 5)), 0, Math.PI * 2); ctx.fill();
        } else { // snow: soft-edged flakes (radial glow)
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(tick); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis); };
  }, [theme, flag, JSON.stringify(fx || {})]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!THEME_PARTICLES[theme]) return null;
  return <canvas ref={ref} className="fixed inset-0 z-[2] pointer-events-none" aria-hidden="true" />;
}

/* ── Theme overlays ──────────────────────────────────────────────────────────── */
function FogLayer() {
  // Two drifting fog banks — CSS keyframes (bcwFogDrift in index.css), GPU-cheap.
  return (
    <div className="fixed inset-x-0 bottom-0 h-52 -z-[4] pointer-events-none overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 opacity-45" style={{ background: 'linear-gradient(to top, rgba(148,163,184,0.32), transparent 75%)', animation: 'bcwFogDrift 13s ease-in-out infinite alternate' }} />
      <div className="absolute inset-0 opacity-30" style={{ background: 'linear-gradient(to top, rgba(100,116,139,0.38), transparent 60%)', animation: 'bcwFogDrift 19s ease-in-out infinite alternate-reverse' }} />
    </div>
  );
}
const ValentineVignette = () => (
  <div className="fixed inset-0 -z-[4] pointer-events-none" aria-hidden="true"
    style={{ background: 'radial-gradient(ellipse at 50% 110%, rgba(236,72,153,0.15), transparent 60%)' }} />
);

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

/* ── Visual layer stack (shared by the live site AND the admin editor preview) ── */
export function EventFxLayers({ event, preview = false }) {
  if (!event || event.theme === 'none') return null;
  const F = fxOf(event.fx);
  const theme = event.theme;
  return (
    <>
      {F.strip && <SeasonStrip theme={theme} />}
      <FxCanvas theme={theme} flag={event.flag} fx={event.fx} />
      {theme === 'halloween' && F.fog && <FogLayer />}
      {theme === 'valentine' && <ValentineVignette />}
      {!preview && theme === 'halloween' && F.sound && <SpookyAudio />}
      {!preview && theme === 'newyear' && F.countdown && <NYCountdown />}
    </>
  );
}

/* ── Root ────────────────────────────────────────────────────────────────────── */
export default function EventEffects() {
  const event = useActiveEvent();
  const { active: introActive } = useIntro();
  const [off, setOff] = useState(fxDisabled());
  useEffect(() => {
    const onChange = () => setOff(fxDisabled());
    window.addEventListener(FX_EVENT, onChange);
    return () => window.removeEventListener(FX_EVENT, onChange);
  }, []);
  // NOTHING during the intro — only the intro's own skip/don't-show controls exist.
  if (!event || introActive) return null;
  return (
    <>
      {/* The promo banner stays even with effects off — it's pricing info, not decor. */}
      {event.discountPct > 0 && <PromoBanner event={event} />}
      {!off && <EventFxLayers event={event} />}
    </>
  );
}
