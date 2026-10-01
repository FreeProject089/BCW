// agent-bcw-nav: what kind of screen the page is on, for settings and hints that only make
// sense on one of them (a keyboard shortcut on a phone, a window manager on a 375px screen).
//
// Two independent facts, because they are not the same thing:
//   · touchOnly: no fine pointer and no hover anywhere (a phone, a tablet without a keyboard).
//     The same test ui/shortcuts.jsx uses for its hints.
//   · narrow:    under 768px, the width below which the OS mode cannot show.
// `desktop` is neither. Kept live: a tablet can gain a keyboard, a window can be resized.
//
// For a static element prefer the CSS classes `.only-desktop` / `.only-touch` (index.css);
// this hook is for lists that must not offer an entry the page then hides.
import { useSyncExternalStore } from 'react';

const Q_FINE = '(any-pointer: fine)';
const Q_HOVER = '(any-hover: hover)';
const Q_WIDE = '(min-width: 768px)';

function mm(q) {
  try { return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null; } catch { return null; }
}

/** Pure: the device kind from the three media facts (exported for the tests). */
export function deviceKind({ fine = true, hover = true, wide = true } = {}) {
  const touchOnly = !fine && !hover;
  const narrow = !wide;
  return { touchOnly, narrow, desktop: !touchOnly && !narrow };
}

let cache = null;
function read() {
  const next = deviceKind({ fine: mm(Q_FINE)?.matches ?? true, hover: mm(Q_HOVER)?.matches ?? true, wide: mm(Q_WIDE)?.matches ?? true });
  if (cache && cache.touchOnly === next.touchOnly && cache.narrow === next.narrow) return cache;
  cache = next;
  return cache;
}
function subscribe(cb) {
  const lists = [Q_FINE, Q_HOVER, Q_WIDE].map(mm).filter(Boolean);
  lists.forEach((l) => l.addEventListener?.('change', cb));
  return () => lists.forEach((l) => l.removeEventListener?.('change', cb));
}
const SERVER = deviceKind();

/** { touchOnly, narrow, desktop }, live. */
export function useDevice() {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}
