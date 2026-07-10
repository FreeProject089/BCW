// Site-event visual effects. One active event (from GET /events/active, re-polled
// every 60 s so deleting/disabling an event stops it live) drives:
//   • a full-screen particle canvas — vector SVG-path icons, NOT emoji — drawn
//     BEHIND the page content by default so text stays perfectly readable
//     (fx.overlay=true puts it on top for admins who want that),
//   • theme overlays (halloween fog, valentine vignette, national flag bunting),
//   • a seasonal silhouette strip along the bottom of the page,
//   • a dismissible promo banner when the event carries a discount,
//   • a New-Year countdown chip and an opt-in spooky-sound toggle for Halloween.
// Every knob is tunable per-event from the admin Effects editor (event.fx), incl.
// fully custom themes (behavior + icon set + color palette). Everything is
// pointer-events-none, mobile-scaled, hidden during the intro, and killable in one
// click from Settings (localStorage `bcw_event_fx_off`).
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

/* ── Active-event store: fetch once, re-poll every 60 s while anyone listens.
     Deleting/disabling the event in the admin therefore stops the effects on every
     open tab within a minute (and instantly on the next page load). ─────────── */
let _ev; // undefined = not fetched yet
const _subs = new Set();
let _timer = null;
async function _refetch() {
  try { const r = await api.get('/events/active'); _ev = r.event || null; } catch { /* keep last */ }
  _subs.forEach((fn) => fn(_ev ?? null));
}
export function useActiveEvent() {
  const [event, setEvent] = useState(_ev ?? null);
  useEffect(() => {
    const fn = (v) => setEvent(v);
    _subs.add(fn);
    if (_subs.size === 1) { _refetch(); _timer = setInterval(_refetch, 60_000); }
    else if (_ev !== undefined) setEvent(_ev);
    return () => { _subs.delete(fn); if (!_subs.size && _timer) { clearInterval(_timer); _timer = null; } };
  }, []);
  return event;
}

/* ── Vector icon library (SVG paths, drawn on canvas via Path2D + previewable) ──
     paths: [{ d, color?, stroke?, lw? }] in a 24×24 box; `color` on the icon is the
     default tint (palette overrides apply to the FIRST path only, so accents like
     ghost eyes / pumpkin stems keep their own color). ───────────────────────── */
export const ICON_LIB = {
  snowflake: { color: '#e8f1fb', paths: [{ d: 'M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1', stroke: true, lw: 2 }] },
  heart: { color: '#f472b6', paths: [{ d: 'M12 21S3.5 15.6 2.3 10.6C1.4 7 3.6 4 7 4c2.1 0 3.9 1.2 5 3 1.1-1.8 2.9-3 5-3 3.4 0 5.6 3 4.7 6.6C20.5 15.6 12 21 12 21z' }] },
  leaf: { color: '#ea580c', paths: [{ d: 'M18 3C9 4 4 9 4 15c0 3.3 2.2 6 2.2 6s.9-2.3 3.3-3.2C15.5 15.6 19 10 18 3z' }, { d: 'M6.5 20.5C10 14 13.5 10 17 6.5', stroke: true, lw: 1.6, color: '#7c2d12' }] },
  flower: { color: '#f472b6', paths: [{ d: 'M12 3c2.2 2.8 2.2 5.2 0 7.2-2.2-2-2.2-4.4 0-7.2zM21 12c-2.8 2.2-5.2 2.2-7.2 0 2-2.2 4.4-2.2 7.2 0zM12 21c-2.2-2.8-2.2-5.2 0-7.2 2.2 2 2.2 4.4 0 7.2zM3 12c2.8-2.2 5.2-2.2 7.2 0-2 2.2-4.4 2.2-7.2 0z' }, { d: 'M12 9.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z', color: '#fbbf24' }] },
  petal: { color: '#f9a8d4', paths: [{ d: 'M12 3c4 4 5 9 3 13-1.6 3.2-4.4 5-6 5 .4-2 .2-5-.5-8C7.6 9 9 5.5 12 3z' }] },
  butterfly: { color: '#c084fc', paths: [{ d: 'M12 12C10 6 3 4 3 9c0 2.6 3.6 4.4 7.5 4-3.9 1-7 3-6.4 5.4C4.8 21 10 19 12 15c2 4 7.2 6 7.9 3.4.6-2.4-2.5-4.4-6.4-5.4 3.9.4 7.5-1.4 7.5-4 0-5-7-3-9 3z' }, { d: 'M12 7v11', stroke: true, lw: 1.8, color: '#4c1d95' }] },
  egg: { color: '#a78bfa', paths: [{ d: 'M12 2C8.2 2 5 8.2 5 13.2 5 17.5 8.1 21 12 21s7-3.5 7-7.8C19 8.2 15.8 2 12 2z' }] },
  ghost: { color: '#e2e8f0', paths: [{ d: 'M12 3a7 7 0 0 0-7 7v11l2.4-2 2.3 2 2.3-2 2.3 2 2.3-2 2.4 2V10a7 7 0 0 0-7-7z' }, { d: 'M9.3 9a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zM14.7 9a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z', color: '#1e293b' }] },
  pumpkin: { color: '#ea580c', paths: [{ d: 'M12 6.5C6.5 6.5 3.5 9.6 3.5 13.6 3.5 17.9 7 21 12 21s8.5-3.1 8.5-7.4c0-4-3-7.1-8.5-7.1z' }, { d: 'M11 3h2.4c-.5 1.3-.5 2.4-.2 3.5h-2.4C11.1 5.3 11.2 4.2 11 3z', color: '#3f6212' }, { d: 'M12 7v13.5M8 7.6c-1.6 3.6-1.6 8 0 12M16 7.6c1.6 3.6 1.6 8 0 12', stroke: true, lw: 1.2, color: '#9a3412' }] },
  bat: { color: '#475569', paths: [{ d: 'M12 6c-1.2 1.8-3.2 2-4.6 1C6.5 9 4.5 10 1.5 9.4c2.3 1.6 3 4.4 6.8 4.3l1.4 3.3 2.3-2.6 2.3 2.6 1.4-3.3c3.8.1 4.5-2.7 6.8-4.3-3 .6-5-.4-5.9-2.4-1.4 1-3.4.8-4.6-1z' }] },
  star: { color: '#fbbf24', paths: [{ d: 'M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.7L12 16.9l-6.1 3.4 1.5-6.7L2.2 9l6.9-.7L12 2z' }] },
  sparkle: { color: '#fde68a', paths: [{ d: 'M12 2l1.8 8.2L22 12l-8.2 1.8L12 22l-1.8-8.2L2 12l8.2-1.8L12 2z' }] },
  percent: { color: '#f59e0b', paths: [{ d: 'M19 5L5 19', stroke: true, lw: 2.4 }, { d: 'M6.5 3.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM17.5 14.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', stroke: true, lw: 2 }] },
  tag: { color: '#f59e0b', paths: [{ d: 'M3 11.2L11.2 3H19a2 2 0 0 1 2 2v7.8L12.8 21a2 2 0 0 1-2.8 0L3 14a2 2 0 0 1 0-2.8z' }, { d: 'M16 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z', color: '#7c2d12' }] },
  gift: { color: '#dc2626', paths: [{ d: 'M3 9h18v4H3zM5 13h14v8H5z' }, { d: 'M11 9h2v12h-2z', color: '#fbbf24' }, { d: 'M12 9C9 9 6.5 7.5 7.5 5.5 8.5 3.5 11 5 12 9zM12 9c3 0 5.5-1.5 4.5-3.5C15.5 3.5 13 5 12 9z', color: '#fbbf24' }] },
  sun: { color: '#fbbf24', paths: [{ d: 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z' }, { d: 'M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.4 4.4l2.1 2.1M17.5 17.5l2.1 2.1M19.6 4.4l-2.1 2.1M6.5 17.5l-2.1 2.1', stroke: true, lw: 2 }] },
  bauble: { color: '#ef4444', paths: [{ d: 'M12 7a7 7 0 1 0 0 14 7 7 0 0 0 0-14z' }, { d: 'M10.5 4h3v3h-3z', color: '#fbbf24' }, { d: 'M7 12.5c2.5-1.6 7.5-1.6 10 0', stroke: true, lw: 1.4, color: '#fca5a5' }] },
  drop: { color: '#38bdf8', paths: [{ d: 'M12 2.5S5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5z' }] },
  clover: { color: '#22c55e', paths: [{ d: 'M12 12C10 7 4 7 5 11c.6 2.4 4 2.6 7 1-3 1.6-5.6 4-4.2 6 1.5 2.1 5-.5 4.2-6 .8 5.5 4.3 8.1 5.8 6 1.4-2-1.2-4.4-4.2-6 3 1.6 6.4 1.4 7-1 1-4-5-4-7 1z' }, { d: 'M12 13c0 3-.7 5.5-2 8', stroke: true, lw: 1.6, color: '#15803d' }] },
};
export const ICON_NAMES = Object.keys(ICON_LIB);

// Draw an icon centered at (0,0) with the current transform applied.
const _p2d = {};
function drawIcon(ctx, name, size, color) {
  const ic = ICON_LIB[name]; if (!ic) return;
  ctx.save();
  ctx.scale(size / 24, size / 24); ctx.translate(-12, -12);
  const cache = (_p2d[name] ||= ic.paths.map((p) => new Path2D(p.d)));
  ic.paths.forEach((p, i) => {
    const c = (i === 0 && color) ? color : (p.color || ic.color);
    if (p.stroke) { ctx.strokeStyle = c; ctx.lineWidth = p.lw || 2.2; ctx.lineCap = 'round'; ctx.stroke(cache[i]); }
    else { ctx.fillStyle = c; ctx.fill(cache[i]); }
  });
  ctx.restore();
}
// Inline SVG preview of a library icon (admin picker chips).
export function IconPreview({ name, size = 16 }) {
  const ic = ICON_LIB[name]; if (!ic) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {ic.paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.stroke ? 'none' : (p.color || ic.color)} stroke={p.stroke ? (p.color || ic.color) : 'none'} strokeWidth={p.lw || 2.2} strokeLinecap="round" />
      ))}
    </svg>
  );
}

/* ── Fx config (admin Effects editor) ────────────────────────────────────────── */
export const FX_DEFAULTS = { density: 1, speed: 1, size: 1, opacity: 1, wind: 0, intensity: 1, icons: [], colors: [], kind: '', overlay: false, strip: true, fog: true, sound: true, countdown: true };
const fxOf = (fx) => ({ ...FX_DEFAULTS, ...(fx || {}) });

/* ── Particle canvas ─────────────────────────────────────────────────────────── */
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Theme base configs. kinds: snow | fall | rise | float | fireworks
// Densities/opacities are deliberately modest — particles sit BEHIND the content by
// default, and even in overlay mode they must never fight the text.
const THEME_PARTICLES = {
  christmas: { kind: 'snow', icons: ['snowflake'], iconMix: 0.25 },
  winter: { kind: 'snow', icons: ['snowflake'], iconMix: 0.25 },
  valentine: { kind: 'rise', icons: ['heart'], colors: ['#f472b6', '#ef4444', '#fb7185', '#f9a8d4'], density: 16 },
  autumn: { kind: 'fall', icons: ['leaf'], colors: ['#ea580c', '#d97706', '#b91c1c', '#a16207'], density: 15, tumble: true },
  spring: { kind: 'fall', icons: ['petal', 'flower', 'butterfly'], colors: ['#f472b6', '#fbbf24', '#c084fc', '#f87171'], density: 12, tumble: true },
  summer: { kind: 'fall', icons: ['sun', 'sparkle'], colors: ['#fbbf24', '#fde68a'], density: 6, slow: true },
  easter: { kind: 'fall', icons: ['egg', 'flower'], colors: ['#f472b6', '#60a5fa', '#fbbf24', '#a78bfa', '#34d399'], density: 10, tumble: true },
  blackfriday: { kind: 'fall', icons: ['percent', 'tag'], colors: ['#f59e0b', '#fbbf24'], density: 9 },
  halloween: { kind: 'float', icons: ['pumpkin', 'ghost', 'bat'], density: 8, pulse: true },
  newyear: { kind: 'fireworks', confetti: true, glitter: true },
  national: { kind: 'fireworks', flagRain: true },
  custom: { kind: 'fall', icons: ['sparkle'], density: 14 },
};

function FxCanvas({ theme, flag, fx }) {
  const ref = useRef(null);
  const F = fxOf(fx);
  useEffect(() => {
    const base = THEME_PARTICLES[theme];
    if (!base) return;
    // Custom theme (or overrides): behavior + icon set + palette come from fx.
    const cfg = { ...base };
    if (theme === 'custom' && F.kind) cfg.kind = F.kind;
    if (F.kind && theme === 'custom' && F.kind === 'fireworks') { cfg.confetti = true; cfg.glitter = true; }
    const icons = (F.icons?.length ? F.icons : cfg.icons) || [];
    const palette = (F.colors?.length ? F.colors : cfg.colors) || null;
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(window.innerWidth < 640 ? 1.25 : 1.5, window.devicePixelRatio || 1);
    let w = 0, h = 0, raf = 0, alive = true, last = performance.now();
    const resize = () => { w = window.innerWidth; h = window.innerHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    window.addEventListener('resize', resize);

    const scale = Math.min(1, w / 1200);
    const parts = [];
    const sparks = [];
    const rockets = [];
    let lastRocket = 0;

    const iconColor = (name) => (palette ? pick(palette) : (ICON_LIB[name]?.color || '#fff'));
    const spawnAmbient = () => {
      const baseN = (cfg.density || 24) * (cfg.kind === 'snow' ? 3.2 : 1);
      const n = Math.max(4, Math.round(baseN * scale * F.density));
      for (let i = 0; i < n; i++) {
        const depth = rnd(0.35, 1);
        const useIcon = icons.length && (cfg.kind !== 'snow' || Math.random() < (cfg.iconMix ?? 1));
        const icon = useIcon ? pick(icons) : null;
        parts.push({
          x: rnd(0, w), y: rnd(-h, h), depth,
          size: (cfg.kind === 'snow' && !icon ? rnd(1.2, 3.4) : rnd(13, 23)) * F.size * (cfg.kind === 'snow' ? Math.max(0.55, depth) : rnd(0.8, 1.1)),
          vy: (cfg.slow ? rnd(8, 16) : rnd(20, 52)) * F.speed * depth * (cfg.kind === 'rise' || cfg.kind === 'float' ? -0.55 : 1),
          drift: rnd(-13, 13), phase: rnd(0, Math.PI * 2), spin: rnd(0.4, 1.4) * (Math.random() < 0.5 ? -1 : 1),
          icon, color: icon ? iconColor(icon) : null,
          alpha: rnd(0.4, 0.8) * (cfg.kind === 'snow' ? (0.35 + 0.65 * depth) : 1) * F.opacity,
        });
      }
    };
    if (cfg.kind !== 'fireworks') spawnAmbient();
    if (cfg.confetti || cfg.flagRain || cfg.glitter) {
      const n = Math.round(22 * scale * F.density) + 6;
      for (let i = 0; i < n; i++) {
        if (cfg.flagRain && flag) {
          parts.push({ x: rnd(0, w), y: rnd(-h, 0), size: rnd(16, 26) * F.size, vy: rnd(26, 55) * F.speed, drift: rnd(-12, 12), phase: rnd(0, 7), spin: rnd(-1, 1), emoji: flag, alpha: 0.85 * F.opacity, depth: 1 });
        } else if (cfg.glitter && i % 3 === 0) {
          parts.push({ x: rnd(0, w), y: rnd(-h, 0), size: rnd(1.4, 2.6) * F.size, vy: rnd(28, 66) * F.speed, drift: rnd(-10, 10), phase: rnd(0, 7), spin: 0, glitter: true, alpha: 0.85 * F.opacity, depth: 1 });
        } else {
          parts.push({ x: rnd(0, w), y: rnd(-h, 0), size: rnd(3.5, 6.5) * F.size, vy: rnd(40, 90) * F.speed, drift: rnd(-20, 20), phase: rnd(0, 7), spin: rnd(-3, 3), confetti: true, alpha: 0.85 * F.opacity, depth: 1, color: pick(palette || ['#f97316', '#f59e0b', '#22c55e', '#3b82f6', '#ec4899', '#eab308', '#a78bfa']) });
        }
      }
    }

    const explode = (x, y) => {
      const hue = Math.floor(rnd(0, 360));
      const rings = [[Math.round(28 * Math.max(0.5, scale) * F.intensity), 60, 165], [Math.round(13 * Math.max(0.5, scale) * F.intensity), 145, 250]];
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

      if (cfg.kind === 'fireworks' && now - lastRocket > rnd(900, 1700) / F.intensity && rockets.length < (w < 640 ? 2 : 4)) {
        rockets.push({ x: rnd(w * 0.15, w * 0.85), y: h + 8, vy: -rnd(230, 330) * Math.max(0.7, F.speed), targetY: rnd(h * 0.14, h * 0.45), wob: rnd(0, 7) });
        lastRocket = now;
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]; r.y += r.vy * dt; r.wob += dt * 9;
        const rx = r.x + Math.sin(r.wob) * 2.5;
        ctx.globalAlpha = 0.9 * F.opacity; ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(rx, r.y + 14); ctx.lineTo(rx, r.y); ctx.stroke();
        if (r.y <= r.targetY) { explode(rx, r.y); rockets.splice(i, 1); }
      }
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

      for (const p of parts) {
        p.phase += dt * (p.spin || 1); p.y += p.vy * dt;
        p.x += (Math.sin(p.phase) * p.drift + F.wind * 26 * (p.depth || 1)) * dt;
        if (p.vy > 0 && p.y > h + 34) { p.y = -34; p.x = rnd(0, w); }
        if (p.vy < 0 && p.y < -34) { p.y = h + 34; p.x = rnd(0, w); }
        if (p.x > w + 40) p.x = -40; else if (p.x < -40) p.x = w + 40;
        const pulse = cfg.pulse ? (0.65 + 0.35 * Math.sin(p.phase * 0.8)) : 1;
        ctx.globalAlpha = p.alpha * pulse;
        if (p.icon) {
          ctx.save(); ctx.translate(p.x, p.y);
          ctx.rotate(cfg.tumble ? p.phase : Math.sin(p.phase) * 0.3);
          drawIcon(ctx, p.icon, p.size, p.color);
          ctx.restore();
        } else if (p.emoji) { // national flags stay emoji — the only faithful rendering
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.phase) * 0.25);
          ctx.font = `${p.size}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(p.emoji, 0, 0); ctx.restore();
        } else if (p.confetti) {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.phase);
          ctx.scale(1, Math.max(0.15, Math.abs(Math.sin(p.phase * 2.3))));
          ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore();
        } else if (p.glitter) {
          ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.7 + 0.3 * Math.sin(p.phase * 5)), 0, Math.PI * 2); ctx.fill();
        } else { // soft snow dot
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
  // Readability first: particles live BEHIND the content by default (-z-[3], above the
  // Hero3D backdrop at -z-10, below every card/text). fx.overlay puts them on top.
  return <canvas ref={ref} className={`fixed inset-0 ${F.overlay ? 'z-[2]' : '-z-[3]'} pointer-events-none`} aria-hidden="true" />;
}

/* ── Theme overlays ──────────────────────────────────────────────────────────── */
function FogLayer() {
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
// National-day bunting: a garland of the configured flag strung under the topbar —
// makes the flag genuinely present instead of a rare falling particle.
function NationalBunting({ flag }) {
  if (!flag) return null;
  const n = 12;
  return (
    <div className="fixed top-[4.2rem] inset-x-0 h-10 sm:h-12 z-[1] pointer-events-none opacity-90" aria-hidden="true">
      <svg viewBox="0 0 1200 60" preserveAspectRatio="none" className="w-full h-full">
        <path d="M0 8 Q300 34 600 14 T1200 10" fill="none" stroke="#a8a29e" strokeWidth="2" opacity="0.6" />
        {Array.from({ length: n }, (_, i) => {
          const x = 50 + (i * 1100) / (n - 1);
          const y = 14 + Math.sin((i / (n - 1)) * Math.PI) * 16;
          return <text key={i} x={x} y={y + 22} fontSize="22" textAnchor="middle">{flag}</text>;
        })}
      </svg>
    </div>
  );
}

/* ── Seasonal bottom silhouette strips (richer, per theme) ───────────────────── */
function SeasonStrip({ theme }) {
  const strips = {
    winter: (
      <svg viewBox="0 0 1200 130" preserveAspectRatio="none" className="w-full h-full">
        <circle cx="1060" cy="26" r="15" fill="#f1f5f9" opacity="0.8" />
        <path d="M0 74 L120 30 L260 72 L410 18 L560 68 L720 34 L880 76 L1030 40 L1200 70 V130 H0 Z" fill="#cbd5e1" opacity="0.35" />
        <path d="M0 92 L170 52 L360 92 L560 46 L780 90 L980 56 L1200 88 V130 H0 Z" fill="#e2e8f0" opacity="0.5" />
        <path d="M0 108 L220 82 L460 110 L700 78 L950 110 L1200 86 V130 H0 Z" fill="#f8fafc" opacity="0.7" />
        {[90, 200, 330, 520, 660, 840, 1000, 1120].map((x, i) => (
          <g key={i} opacity="0.8"><path d={`M${x} 112 l9 -20 l9 20 Z`} fill="#0f3d2e" /><path d={`M${x + 2} 104 l7 -14 l7 14 Z`} fill="#14532d" /></g>
        ))}
        <g opacity="0.85" transform="translate(430 96)">
          <circle cy="14" r="9" fill="#fff" /><circle cy="0" r="6.5" fill="#fff" />
          <circle cx="-2" cy="-2" r="0.9" fill="#0f172a" /><circle cx="2" cy="-2" r="0.9" fill="#0f172a" />
          <path d="M0 0 l4 1.6 -4 1.4z" fill="#f97316" />
        </g>
      </svg>),
    christmas: (
      <svg viewBox="0 0 1200 130" preserveAspectRatio="none" className="w-full h-full">
        <circle cx="140" cy="22" r="13" fill="#fef9c3" opacity="0.7" />
        <path d="M0 106 L220 76 L460 108 L700 72 L950 108 L1200 80 V130 H0 Z" fill="#f8fafc" opacity="0.6" />
        {[80, 250, 430, 620, 800, 980, 1130].map((x, i) => (
          <g key={i} opacity="0.9">
            <path d={`M${x} 108 l13 -30 l13 30 Z`} fill="#14532d" /><path d={`M${x + 3} 96 l10 -22 l10 22 Z`} fill="#166534" />
            <circle cx={x + 8} cy={92} r="1.8" fill="#fbbf24" /><circle cx={x + 18} cy={100} r="1.8" fill="#ef4444" /><circle cx={x + 13} cy={84} r="1.6" fill="#60a5fa" />
          </g>
        ))}
        {[340, 540, 890].map((x, i) => <g key={`g${i}`} opacity="0.85"><rect x={x} y={106} width="15" height="12" rx="2" fill="#dc2626" /><rect x={x + 6} y={106} width="3" height="12" fill="#fbbf24" /><rect x={x + 3} y={103} width="9" height="4" rx="1.5" fill="#b91c1c" /></g>)}
      </svg>),
    halloween: (
      <svg viewBox="0 0 1200 130" preserveAspectRatio="none" className="w-full h-full">
        <circle cx="1030" cy="26" r="17" fill="#fde68a" opacity="0.55" />
        <path d="M0 104 Q300 82 600 104 T1200 100 V130 H0 Z" fill="#160f06" opacity="0.9" />
        <g opacity="0.9" transform="translate(760 40)">
          <rect x="0" y="20" width="52" height="46" fill="#1c1408" />
          <path d="M-6 22 L26 0 L58 22 Z" fill="#292013" />
          <rect x="8" y="30" width="9" height="10" fill="#f59e0b" opacity="0.9" /><rect x="34" y="30" width="9" height="10" fill="#f59e0b" opacity="0.75" />
          <rect x="21" y="48" width="10" height="18" fill="#0c0a06" />
          <rect x="40" y="4" width="7" height="14" fill="#1c1408" />
        </g>
        {[110, 320, 540, 950, 1120].map((x, i) => (
          <g key={i} opacity="0.92"><ellipse cx={x} cy={112} rx="14" ry="10" fill="#ea580c" /><ellipse cx={x} cy={112} rx="8" ry="9.4" fill="#c2410c" opacity="0.6" /><rect x={x - 2} y={99} width="4" height="6" rx="1" fill="#365314" /><circle cx={x - 5} cy={110} r="1.7" fill="#160f06" /><circle cx={x + 5} cy={110} r="1.7" fill="#160f06" /></g>
        ))}
        {[240, 460, 680].map((x, i) => <path key={`f${i}`} d={`M${x} 118 v-12 M${x - 8} 118 v-9 M${x + 8} 118 v-10 M${x - 10} 111 h20`} stroke="#292013" strokeWidth="2" opacity="0.8" fill="none" />)}
        <path d="M980 30 c4 -3 8 -3 10 0 c2 -3 6 -3 9 0 l-5 4 -4 -2 -4 2 z" fill="#334155" opacity="0.8" />
      </svg>),
    valentine: (
      <svg viewBox="0 0 1200 130" preserveAspectRatio="none" className="w-full h-full">
        <path d="M0 108 Q300 88 600 108 T1200 104 V130 H0 Z" fill="#9d174d" opacity="0.4" />
        <path d="M0 10 Q300 40 600 16 T1200 12" fill="none" stroke="#f9a8d4" strokeWidth="2" opacity="0.5" />
        {[120, 320, 520, 720, 920, 1100].map((x, i) => {
          const y = 16 + Math.sin((i / 5) * Math.PI) * 14;
          return <path key={i} d={`M${x} ${y + 12} c-5 -5 -8 -9 -4 -12 c3 -2 6 0 6 2 c0 -2 3 -4 6 -2 c4 3 1 7 -4 12 l-2 2 z`} fill={i % 2 ? '#f472b6' : '#ef4444'} opacity="0.85" />;
        })}
        {[210, 450, 700, 960].map((x, i) => (
          <g key={`r${i}`} opacity="0.85"><line x1={x} y1={118} x2={x} y2={100} stroke="#166534" strokeWidth="2" /><circle cx={x} cy={97} r="5" fill="#e11d48" /><circle cx={x} cy={97} r="2.6" fill="#be123c" /></g>
        ))}
      </svg>),
    spring: (
      <svg viewBox="0 0 1200 130" preserveAspectRatio="none" className="w-full h-full">
        <path d="M0 100 Q300 76 620 100 T1200 96 V130 H0 Z" fill="#65a30d" opacity="0.4" />
        <path d="M0 112 Q300 96 620 112 T1200 108 V130 H0 Z" fill="#4d7c0f" opacity="0.5" />
        {[70, 180, 300, 420, 540, 660, 790, 910, 1030, 1140].map((x, i) => {
          const c = ['#f472b6', '#fbbf24', '#f87171', '#c084fc', '#38bdf8'][i % 5];
          return (
            <g key={i} opacity="0.9">
              <line x1={x} y1={116} x2={x} y2={98} stroke="#65a30d" strokeWidth="2" />
              {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx={x + Math.cos((a * Math.PI) / 180) * 4.6} cy={95 + Math.sin((a * Math.PI) / 180) * 4.6} rx="3" ry="4.4" fill={c} transform={`rotate(${a} ${x} 95)`} />)}
              <circle cx={x} cy={95} r="2.6" fill="#fde047" />
            </g>
          );
        })}
        <g opacity="0.85" transform="translate(860 60)"><ellipse cx="-5" cy="0" rx="6" ry="4" fill="#c084fc" transform="rotate(-30)" /><ellipse cx="5" cy="0" rx="6" ry="4" fill="#a855f7" transform="rotate(30)" /><line x1="0" y1="-4" x2="0" y2="5" stroke="#4c1d95" strokeWidth="1.6" /></g>
      </svg>),
    summer: (
      <svg viewBox="0 0 1200 130" preserveAspectRatio="none" className="w-full h-full">
        <g opacity="0.85"><circle cx="1050" cy="28" r="20" fill="#fbbf24" />{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1={1050 + Math.cos((a * Math.PI) / 180) * 26} y1={28 + Math.sin((a * Math.PI) / 180) * 26} x2={1050 + Math.cos((a * Math.PI) / 180) * 34} y2={28 + Math.sin((a * Math.PI) / 180) * 34} stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" />)}</g>
        <ellipse cx="220" cy="30" rx="30" ry="10" fill="#f8fafc" opacity="0.5" /><ellipse cx="250" cy="24" rx="22" ry="8" fill="#f8fafc" opacity="0.4" />
        <path d="M0 96 Q200 84 400 96 T800 96 T1200 96 V130 H0 Z" fill="#0ea5e9" opacity="0.4" />
        <path d="M0 106 Q200 96 400 106 T800 106 T1200 106 V130 H0 Z" fill="#0284c7" opacity="0.45" />
        <path d="M0 118 Q300 110 600 118 T1200 116 V130 H0 Z" fill="#fcd34d" opacity="0.5" />
        <g opacity="0.9" transform="translate(400 84)"><line x1="0" y1="0" x2="0" y2="34" stroke="#78350f" strokeWidth="3" /><path d="M0 2 C-16 -8 -26 -2 -30 6 C-18 2 -6 4 0 2z M0 2 C16 -8 26 -2 30 6 C18 2 6 4 0 2z M0 2 C-6 -14 2 -22 10 -24 C2 -14 2 -6 0 2z" fill="#16a34a" /></g>
        <g opacity="0.9" transform="translate(640 96)"><path d="M0 22 V-6" stroke="#e11d48" strokeWidth="2.4" /><path d="M-20 -4 A20 20 0 0 1 20 -4 Z" fill="#ef4444" /><path d="M-20 -4 A20 20 0 0 1 -6 -22 L0 -4 Z" fill="#fca5a5" /><path d="M6 -22 A20 20 0 0 1 20 -4 L0 -4 Z" fill="#fca5a5" opacity="0.7" /></g>
      </svg>),
    autumn: (
      <svg viewBox="0 0 1200 130" preserveAspectRatio="none" className="w-full h-full">
        <path d="M0 96 L260 68 L540 100 L820 66 L1200 96 V130 H0 Z" fill="#7c2d12" opacity="0.35" />
        <path d="M0 112 L300 92 L640 114 L980 90 L1200 110 V130 H0 Z" fill="#92400e" opacity="0.4" />
        {[120, 350, 600, 850, 1080].map((x, i) => (
          <g key={i} opacity="0.9">
            <rect x={x - 2.5} y={82} width="5" height="30" fill="#57534e" />
            <circle cx={x - 8} cy={76} r="9" fill="#ea580c" opacity="0.9" /><circle cx={x + 8} cy={78} r="8" fill="#d97706" opacity="0.9" /><circle cx={x} cy={68} r="10" fill="#b91c1c" opacity="0.85" /><circle cx={x + 3} cy={82} r="7" fill="#a16207" opacity="0.85" />
          </g>
        ))}
        {[220, 470, 730, 960].map((x, i) => <g key={`p${i}`} opacity="0.8"><ellipse cx={x} cy={116} rx="12" ry="3.5" fill="#9a3412" /><ellipse cx={x + 6} cy={113} rx="8" ry="2.5" fill="#c2410c" /></g>)}
      </svg>),
    easter: (
      <svg viewBox="0 0 1200 130" preserveAspectRatio="none" className="w-full h-full">
        <path d="M0 102 Q300 82 620 102 T1200 98 V130 H0 Z" fill="#65a30d" opacity="0.45" />
        <path d="M0 116 Q300 104 620 116 T1200 112 V130 H0 Z" fill="#4d7c0f" opacity="0.5" />
        {[150, 360, 580, 800, 1020].map((x, i) => {
          const c = ['#f472b6', '#60a5fa', '#fbbf24', '#a78bfa', '#34d399'][i % 5];
          return (
            <g key={i} opacity="0.92">
              <ellipse cx={x} cy={104} rx="9" ry="12" fill={c} />
              <path d={`M${x - 9} 104 q4.5 -3.5 9 0 q4.5 3.5 9 0`} stroke="#fff" strokeWidth="1.6" fill="none" opacity="0.7" />
              <circle cx={x - 4} cy={98} r="1.3" fill="#fff" opacity="0.7" /><circle cx={x + 4} cy={100} r="1.3" fill="#fff" opacity="0.7" />
            </g>
          );
        })}
        <g opacity="0.85" transform="translate(920 88)">
          <ellipse cx="0" cy="14" rx="10" ry="11" fill="#f5f5f4" /><circle cx="0" cy="-2" r="7" fill="#f5f5f4" />
          <ellipse cx="-4" cy="-12" rx="2.6" ry="8" fill="#f5f5f4" /><ellipse cx="4" cy="-12" rx="2.6" ry="8" fill="#f5f5f4" />
          <ellipse cx="-4" cy="-12" rx="1.2" ry="5.5" fill="#fda4af" /><ellipse cx="4" cy="-12" rx="1.2" ry="5.5" fill="#fda4af" />
          <circle cx="-2.4" cy="-3" r="0.9" fill="#0f172a" /><circle cx="2.4" cy="-3" r="0.9" fill="#0f172a" />
        </g>
        {[260, 700].map((x, i) => <g key={`t${i}`} opacity="0.85"><line x1={x} y1={112} x2={x} y2={96} stroke="#166534" strokeWidth="2" /><path d={`M${x} 96 c-4 -2 -5 -7 -2 -9 c2 -1 4 1 2 4 c2 -3 5 -2 5 1 c0 3 -3 4 -5 4z`} fill="#f472b6" /></g>)}
      </svg>),
  };
  const svg = strips[theme];
  if (!svg) return null;
  return (
    <div className="fixed bottom-0 inset-x-0 -z-[5] pointer-events-none h-16 sm:h-28 opacity-55" aria-hidden="true">
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
      {theme === 'national' && <NationalBunting flag={event.flag} />}
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
