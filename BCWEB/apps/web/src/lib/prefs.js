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

// Optional: turn OFF kept drafts. Long forms and editors keep what is typed into them in
// this tab's sessionStorage (ui/draft-store.js) and offer it back on the next open, so a
// mis-click that closes a modal, a reload or a crash costs nothing.
//
// OFF by default, i.e. drafts are ON, and deliberately so: the mechanism exists because
// somebody lost a form they had filled in, and a safety net that has to be switched on first
// is a safety net nobody has the day they need it. The people who want it gone are the ones
// on a shared machine, and they are also the ones who will go and look for the switch.
//
// With this ON, nothing is written at all — not written and ignored. Turning it on also
// clears the drafts already kept, so "off" means the browser is holding none.
export const DRAFTS_OFF_KEY = 'bcw_drafts_off';
export function getDraftsDisabled() {
  try { return localStorage.getItem(DRAFTS_OFF_KEY) === '1'; } catch { return false; }
}
export function setDraftsDisabled(off) {
  try { localStorage.setItem(DRAFTS_OFF_KEY, off ? '1' : '0'); } catch { /* ignore */ }
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

// Grain: the noise recipes in index.css (`--grain-fine` / `--grain-medium`), carried only by
// the few hero cards marked `.grain-hero`, at half its first strength (M5: not the page
// background, not the footer, not the large quiet cards); nothing text-dense carries any. One switch, not a level: the grain only has
// to be there or not, and a slider for "how much dirt" is a question nobody wants asked.
//
// ON by default, earned by measurement: no speck on any carrier reaches 1.5:1 against its own
// surface (the table is at `--grain-fine` in index.css), so text keeps its contrast on all of
// them.
//
// Applied as `data-texture` on <html>; forced colours and reduced transparency turn it off in
// CSS whatever this says. Older values ('soft' / 'rich', from the first pass) read as on.
export const TEXTURE_KEY = 'bcw_texture';
export function getTexturePref() {
  try { return localStorage.getItem(TEXTURE_KEY) === 'off' ? 'off' : 'on'; } catch { return 'on'; }
}
export function applyTexturePref(level = getTexturePref()) {
  document.documentElement.setAttribute('data-texture', level === 'off' ? 'off' : 'on');
}
export function setTexturePref(level) {
  try { localStorage.setItem(TEXTURE_KEY, level === 'off' ? 'off' : 'on'); } catch { /* ignore */ }
  applyTexturePref(level);
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

// Turn the 3D hero orb off entirely.
//
// Distinct from the page-transition flourish above and from the intro skip: those keep the
// orb and drop an animation, this drops the WebGL scene. It is the heaviest thing on the
// site — three.js, a render loop, a GPU context — and on an older laptop or a phone that is
// felt as heat and battery rather than as a visual choice. OFF here means the component is never
// mounted: no WebGL context, no render loop, no per-frame work — which is the cost that is
// actually felt. The three.js chunk itself is still fetched, because index.html preloads it
// and event-effect.jsx imports it too. Measured, not assumed.
export const HERO_3D_KEY = 'bcw_hero_3d_off';
export function getHero3dDisabled() {
  try { return localStorage.getItem(HERO_3D_KEY) === '1'; } catch { return false; }
}
export function setHero3dDisabled(off) {
  try { localStorage.setItem(HERO_3D_KEY, off ? '1' : '0'); } catch { /* ignore */ }
}

/**
 * "This browser has opened the catalogue at least once."
 *
 * A browser fact, not an account fact — nothing on the server records that somebody looked at
 * a listing page, and adding something that did would be following people around to draw a
 * tick on a landing page. It reads as `false` in a private window, which is the correct answer
 * there: that visitor has not seen it, in this browser.
 */
export const CATALOG_SEEN = 'bcw_seen_catalog';

/** Remember that the catalogue has been opened. Silent when storage is refused. */
export function markCatalogSeen() {
  try { localStorage.setItem(CATALOG_SEEN, '1'); } catch { /* private window, or storage off */ }
}
