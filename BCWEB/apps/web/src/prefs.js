// Local UI preferences that aren't theme/lang/consent (those have their own
// modules): frosted-glass translucent surfaces (cards + dialogs). Stored in
// localStorage, applied as a CSS custom property + attribute on <html> so plain
// CSS rules can honour them.
//
// --glass-alpha (0..1): surface opacity when translucency is ON. When OFF, cards
// and dialogs stay fully solid (the default, readable look). A single
// applyGlassPrefs() at boot avoids a flash of the wrong style.

export const GLASS_ON_KEY = 'bcw_glass_surfaces';
export const GLASS_PCT_KEY = 'bcw_glass_opacity';   // stored as a whole percent (e.g. "85")

// Optional: on every page navigation, the hero orb shatters + the camera dives
// toward a random shard, then the orb recomposes — a cinematic route transition.
// OFF by default (it's a "flourish", and repeated on every nav it can be a lot).
export const ORB_TRANSITION_KEY = 'bcw_orb_page_transition';
export function getOrbTransitionPref() {
  try { return localStorage.getItem(ORB_TRANSITION_KEY) === '1'; } catch { return false; }
}
export function setOrbTransitionPref(on) {
  try { localStorage.setItem(ORB_TRANSITION_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}

export function getGlassPrefs() {
  let on = false, pct = 85;
  try {
    on = localStorage.getItem(GLASS_ON_KEY) === '1';
    const p = Number(localStorage.getItem(GLASS_PCT_KEY));
    if (Number.isFinite(p) && p >= 30 && p <= 100) pct = p;
  } catch { /* ignore */ }
  return { on, pct };
}

export function applyGlassPrefs(prefs = getGlassPrefs()) {
  const root = document.documentElement;
  if (prefs.on) {
    root.setAttribute('data-surface-glass', '1');
    root.style.setProperty('--glass-alpha', String(Math.max(0.3, Math.min(1, prefs.pct / 100))));
  } else {
    root.removeAttribute('data-surface-glass');
    root.style.removeProperty('--glass-alpha');
  }
}

export function setGlassPrefs({ on, pct }) {
  try {
    localStorage.setItem(GLASS_ON_KEY, on ? '1' : '0');
    if (pct != null) localStorage.setItem(GLASS_PCT_KEY, String(pct));
  } catch { /* ignore */ }
  applyGlassPrefs({ on, pct: pct ?? getGlassPrefs().pct });
}
