// What you picked last, and the one hook the rest of the app uses to open ⌘K.
//
// RECENTS
// Per-viewer convenience, so localStorage is the right home for it — but only for ids. The
// old file stored `{to, label}` pairs and could therefore only remember DESTINATIONS: an
// action carries a closure, which does not survive a reload. Storing the id instead means the
// live command list rebuilds the closure at render time, so "Sign out" and "Toggle theme" are
// remembered too, and a command that no longer exists simply does not come back.
//
// Every read and write is wrapped: localStorage THROWS in a private window and in an iframe
// with site data blocked, and can come back empty for reasons that have nothing to do with
// this app. An empty list is a correct answer here, so there is nothing to report.

const KEY = 'bcw.cmdk.recent.v2';
const MAX = 8;

export function readRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX) : [];
  } catch { return []; }
}

export function pushRecent(id) {
  if (!id || typeof id !== 'string') return readRecent();
  let next = [id];
  try {
    next = [id, ...readRecent().filter((r) => r !== id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* private window, blocked storage: recents are a convenience, not state */ }
  return next;
}

// ── Opening the palette from elsewhere ────────────────────────────────────────
// The phone has no ⌘K. The mobile bar needs to open the same palette, and the palette owns
// its own `open` state, so the two talk through one window event rather than by lifting that
// state into App (which would re-render the whole shell on every keystroke).
const OPEN_EVENT = 'bcw:cmdk-open';

export function openPalette() {
  try { window.dispatchEvent(new CustomEvent(OPEN_EVENT)); } catch { /* no window */ }
}

export function onOpenPalette(fn) {
  window.addEventListener(OPEN_EVENT, fn);
  return () => window.removeEventListener(OPEN_EVENT, fn);
}
