// Whether the celebration effects (the event fireworks canvas) may play on this device.
//
// This exists because the rule was wrong in a way that was invisible: the effect was
// vetoed by `prefers-reduced-motion` with no way to override it, while Settings showed a
// switch sitting proudly in the "on" position. On a machine with reduced motion enabled at
// the OS level — which is where this was found — the switch said yes, the admin preview
// (which bypassed the veto) played fine, and the live event did nothing. The UI reported a
// state the code did not honour.
//
// The same mistake had already been made once on the Hero3D intro, so it lives in one
// module now and both the renderer and the Settings screen read it from here.
//
// Three states, stored in `bcw_fx`:
//   absent / 'auto' → follow the OS. Reduced motion means no fireworks. This is the
//                     default, so the accessible behaviour is what an untouched browser gets.
//   'on'            → play them. An explicit choice by the person at the keyboard beats a
//                     system-wide default they may have set years ago for something else.
//   'off'           → never.
const KEY = 'bcw_fx';
const LEGACY_OFF = 'bcw_fx_off'; // the old boolean: '1' meant off

/** 'auto' | 'on' | 'off' */
export function fxPref() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'on' || v === 'off' || v === 'auto') return v;
    // Migrate the old boolean in place so an existing "off" is not quietly turned back on.
    if (localStorage.getItem(LEGACY_OFF) === '1') return 'off';
  } catch { /* storage unavailable — fall through to auto */ }
  return 'auto';
}

export function setFxPref(v) {
  try {
    if (v === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
    localStorage.removeItem(LEGACY_OFF); // the migration is one-way
  } catch { /* nothing we can do; the in-memory state still updates */ }
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The question the renderer actually asks. `force` is the admin preview hook
 * (`bcw_fx_preview=1`), which bypasses everything on purpose.
 */
export function fxAllowed({ force = false } = {}) {
  if (force) return true;
  const pref = fxPref();
  if (pref === 'off') return false;
  if (pref === 'on') return true;
  return !prefersReducedMotion();
}
