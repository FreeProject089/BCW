import { createContext, useContext, useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

// White/orange (light) ↔ black/orange (dark). Persisted; applied on <html>.
const KEY = 'bcw_theme';
const ThemeCtx = createContext(null);
export const useTheme = () => useContext(ThemeCtx);

// ── Site-wide accent, set by a SUPERADMIN ─────────────────────────────────────────────
//
// Light and dark share their accent (the dark block never redefines --primary), so one
// colour pair recolours both modes. Applied as a <style> element rather than inline styles
// on <html> so it is one thing to inspect, and one thing to remove.

const srgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
// WCAG relative luminance — the same maths the contrast ratio is built on.
const luminance = (hex) => {
  const [r, g, b] = srgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
/** Ink that is actually readable on a given fill. Exported so the admin editor can SHOW the
 *  ratio instead of leaving a superadmin to discover a pastel accent broke every button. */
export function inkOn(hex) {
  const dark = '#17140f'; // the light theme's --text
  return contrast(hex, '#ffffff') >= contrast(hex, dark) ? '#ffffff' : dark;
}
export const contrastRatio = contrast;

const rgba = (hex, a) => `rgba(${srgb(hex).map((c) => Math.round(c * 255)).join(', ')}, ${a})`;

/** Build the CSS for an accent pair. Kept pure so the admin preview and the live site
 *  cannot drift — the preview applies the very same text. */
export function themeCss({ accent, accent2 }) {
  if (!accent) return '';
  const a2 = accent2 || accent;
  // --on-primary is derived from the MIDPOINT of the gradient, not from `accent` alone:
  // .btn-primary fills with a gradient of the two, and picking the ink from one end can be
  // wrong across the rest of the button.
  const mid = '#' + [0, 1, 2].map((i) => {
    const v = Math.round((srgb(accent)[i] + srgb(a2)[i]) / 2 * 255);
    return v.toString(16).padStart(2, '0');
  }).join('');
  return `:root{--primary:${accent};--primary-2:${a2};--on-primary:${inkOn(mid)};`
    + `--primary-glow:${rgba(accent, 0.4)};--ring:${rgba(accent, 0.55)};`
    + `--glow-a:${rgba(accent, 0.15)};--glow-b:${rgba(a2, 0.12)};}`;
}

// Applied unconditionally, including for the built-in orange — which does change how primary
// buttons have always looked, so the reasoning is worth recording.
//
// `.btn-primary` shipped white text on the brand orange. Measured, that is 2.90:1: below
// WCAG AA for normal text (4.5:1) and below even the large-text threshold (3:1). Deriving the
// ink flips it to near-black at 6.55:1. Gating the derivation to "only when someone picks a
// custom theme" would have preserved the familiar look, but it would also have meant shipping
// a known-unreadable default on purpose and applying the accessible rule only to other
// people's colours. One rule, applied everywhere.
export function applySiteTheme(theme) {
  const css = themeCss(theme || {});
  let el = document.getElementById('bcw-site-theme');
  if (!css) { el?.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = 'bcw-site-theme'; document.head.appendChild(el); }
  el.textContent = css;
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(KEY) || 'light'; } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch {}
  }, [theme]);

  // Pull the site theme once. A visitor who has never used the toggle follows the site
  // default; anyone who HAS chosen keeps their choice — an admin picking "dark" for the site
  // must not silently flip people who deliberately went light.
  useEffect(() => {
    let alive = true;
    fetch('/api/theme', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.theme) return;
        applySiteTheme(d.theme);
        let stored = null;
        try { stored = localStorage.getItem(KEY); } catch {}
        if (!stored && (d.theme.mode === 'light' || d.theme.mode === 'dark')) setTheme(d.theme.mode);
      })
      .catch(() => { /* the bundled default palette stands */ });
    return () => { alive = false; };
  }, []);

  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));
  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

// Clean sliding switch: a single high-contrast knob carrying the current mode's icon
// slides across a track that fills with the accent when dark. No overlapping icons.
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button onClick={toggle} title={dark ? 'Switch to light' : 'Switch to dark'} aria-label="Toggle theme" role="switch" aria-checked={dark}
      className="relative inline-block h-6 w-11 rounded-full transition-colors shrink-0 align-middle border"
      style={{ background: dark ? 'var(--primary)' : 'color-mix(in srgb, var(--text) 12%, transparent)', borderColor: 'var(--line-strong)' }}>
      <span className="absolute top-1/2 grid place-items-center w-[18px] h-[18px] rounded-full transition-transform duration-200 ease-out"
        style={{ left: 2, marginTop: -9, transform: dark ? 'translateX(20px)' : 'translateX(0)', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>
        {dark ? <Moon size={11} className="text-[var(--primary)] fill-[var(--primary)]" /> : <Sun size={11} className="text-amber-500" />}
      </span>
    </button>
  );
}
