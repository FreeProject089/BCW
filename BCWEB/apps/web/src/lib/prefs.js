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

// Optional: turn OFF the undo window on destructive/save actions. Normally those actions are
// DEFERRED behind a countdown toast so they can be taken back; with this on, they fire
// immediately and the toast is a plain confirmation. OFF by default — the undo window is the
// safer behaviour, and this exists for people who find the delay slower than it is worth.
export const UNDO_OFF_KEY = 'bcw_undo_off';
export function getUndoDisabled() {
  try { return localStorage.getItem(UNDO_OFF_KEY) === '1'; } catch { return false; }
}
export function setUndoDisabled(off) {
  try { localStorage.setItem(UNDO_OFF_KEY, off ? '1' : '0'); } catch { /* ignore */ }
}

// Ask before signing out. OFF by default: a confirmation nobody asked for is friction on a
// path people take deliberately. It exists because the button is an icon in the topbar, one
// mis-click from the profile — and on an account with 2FA, getting back in is not one click.
export const LOGOUT_CONFIRM_KEY = 'bcw_logout_confirm';
export function getLogoutConfirm() {
  try { return localStorage.getItem(LOGOUT_CONFIRM_KEY) === '1'; } catch { return false; }
}
export function setLogoutConfirm(on) {
  try { localStorage.setItem(LOGOUT_CONFIRM_KEY, on ? '1' : '0'); } catch { /* ignore */ }
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

// ── Shift to skip a confirmation ─────────────────────────────────────────────
//
// Holding Shift while clicking answers the confirm dialog "yes" without showing it. For
// somebody clearing a moderation queue, confirming forty times is not forty decisions — it is
// one decision and thirty-nine reflexes, and a dialog answered by reflex protects nobody.
//
// Only `confirm`. A `prompt` collects something that has to be typed — the account's own
// address before an erasure — and there is nothing for a modifier key to supply.
//
// This setting turns the shortcut OFF: on a shared or supervised machine, "are you sure"
// should be unskippable. Default is that the shortcut works, because it is opt-out friction
// rather than opt-in danger.
export const FORCE_CONFIRM_KEY = 'bcw_force_confirm';
export function getForceConfirm() {
  try { return localStorage.getItem(FORCE_CONFIRM_KEY) === '1'; } catch { return false; }
}
export function setForceConfirm(on) {
  try { localStorage.setItem(FORCE_CONFIRM_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
