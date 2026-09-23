// "Install the app": everything the page has to know about it, and nothing about how it looks.
//
// Two very different mechanisms hide behind one button:
//
//   · Chromium (desktop Chrome/Edge, Android Chrome/Samsung) fires `beforeinstallprompt` once
//     the site qualifies. The event has to be CAUGHT and kept, because the browser only lets a
//     page call `prompt()` on the event it was handed. So the listener is attached when this
//     module is evaluated (App imports it eagerly), not when some component mounts later: a
//     listener attached after the event fired never hears it.
//   · iOS / iPadOS Safari has no event and no API at all. The only way in is Share, then
//     "Add to Home Screen", so the most a page can do is say so.
//
// Rules about the READER live here too, because both the corner card and the Settings row
// read them: never offer to install what is already installed (display-mode: standalone, or
// navigator.standalone on iOS), and never nag. The card waits for real engagement, a dismissal
// is remembered, and Settings is the permanent place to install later.
//
// Every storage access is wrapped: localStorage throws in a private window and in a sandboxed
// iframe, and an install card is a convenience, never state worth failing over.

const EVENT = 'bcw:pwa-install';
const DISMISS_KEY = 'bcw.pwa.install.dismissed';
const ENGAGE_KEY = 'bcw.pwa.engage';

let deferred = null;     // the kept beforeinstallprompt event
let installed = false;   // `appinstalled` fired during this visit

const emit = () => { try { window.dispatchEvent(new CustomEvent(EVENT)); } catch { /* no window */ } };

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Stop the browser's own mini-infobar: the site decides when to ask, and it asks later.
    e.preventDefault();
    deferred = e;
    emit();
  });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit(); });
}

/** Already running as the installed app (any platform)? Then there is nothing to offer. */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (window.matchMedia?.('(display-mode: minimal-ui)').matches) return true;
    if (window.matchMedia?.('(display-mode: window-controls-overlay)').matches) return true;
  } catch { /* old engine */ }
  return window.navigator?.standalone === true;
}

/** iPhone / iPad / iPod, including iPadOS which reports itself as a Mac with a touchscreen. */
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

/**
 * What this browser can do right now:
 *   'installed' — already the app, or installed during this visit
 *   'prompt'    — a kept beforeinstallprompt event, one click installs
 *   'ios'       — iOS: only the Share → Add to Home Screen route exists
 *   'none'      — nothing (Firefox desktop, an unqualified page, an in-app browser…)
 */
export function installState() {
  if (installed || isStandalone()) return 'installed';
  if (deferred) return 'prompt';
  if (isIOS()) return 'ios';
  return 'none';
}

/** Show the browser's install dialog. Resolves to 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  const ev = deferred;
  if (!ev) return 'unavailable';
  // The event is single-use: a second prompt() on it throws. Drop it before asking.
  deferred = null;
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    if (choice?.outcome === 'accepted') installed = true;
    emit();
    return choice?.outcome || 'dismissed';
  } catch {
    emit();
    return 'unavailable';
  }
}

/** Subscribe to any change of installState(). Returns the unsubscribe. */
export function onInstallChange(fn) {
  if (typeof window === 'undefined') return () => {};
  const mq = (() => { try { return window.matchMedia('(display-mode: standalone)'); } catch { return null; } })();
  window.addEventListener(EVENT, fn);
  mq?.addEventListener?.('change', fn);
  return () => { window.removeEventListener(EVENT, fn); mq?.removeEventListener?.('change', fn); };
}

// ── "Not pushy" ──────────────────────────────────────────────────────────────
// Engagement = page views across visits, plus a visit count. The card appears only once the
// reader has come back (a second visit) AND looked at a few pages, so a first-time visitor
// reading one blog post is never asked to install anything.
export const ENGAGE_MIN_VIEWS = 4;
export const ENGAGE_MIN_VISITS = 2;
const VISIT_GAP_MS = 30 * 60 * 1000; // a new "visit" after 30 minutes away

function readEngage() {
  try {
    const v = JSON.parse(localStorage.getItem(ENGAGE_KEY) || 'null');
    if (v && typeof v === 'object') return { views: Number(v.views) || 0, visits: Number(v.visits) || 0, last: Number(v.last) || 0 };
  } catch { /* unreadable */ }
  return { views: 0, visits: 0, last: 0 };
}

/** Count one page view. Returns the updated tally. */
export function recordView(now = Date.now()) {
  const e = readEngage();
  const next = { views: e.views + 1, visits: e.visits + (now - e.last > VISIT_GAP_MS ? 1 : 0), last: now };
  try { localStorage.setItem(ENGAGE_KEY, JSON.stringify(next)); } catch { /* not remembered, fine */ }
  return next;
}

export function engaged(e = readEngage()) {
  return e.views >= ENGAGE_MIN_VIEWS && e.visits >= ENGAGE_MIN_VISITS;
}

export function isDismissed() {
  try { return !!localStorage.getItem(DISMISS_KEY); } catch { return false; }
}

/** "Not now" is remembered for good; the Settings row stays the way back. */
export function dismissInstall() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* shown again next visit, harmless */ }
}
