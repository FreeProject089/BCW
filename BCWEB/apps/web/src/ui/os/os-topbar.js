// The site's topbar in OS mode (agent-bcw-os): hidden, and back when it is asked for.
//
// The shell is a desktop; the site's topbar above it was 70 px of a second taskbar. In OS mode
// (Personalise > Site bar > Auto-hide, the default) it slides out of sight and the desktop takes
// the whole height. It comes back, over the desktop:
//   · the pointer rests on the top edge (a 6 px zone, 180 ms, so crossing it does nothing);
//   · a swipe down from the top edge on a touch screen;
//   · Alt+Shift+H, which also keeps it shown until pressed again;
//   · Tab reaching it (focus inside it keeps it shown).
// It goes again 450 ms after the pointer leaves it, not while one of its menus is open or
// focus is in it, and at once on a press elsewhere.
//
// The header is found by its bar (.tbar), not by a class of its own: App.jsx is not this
// feature's file. Nothing here changes the header's markup; it only sets
// `data-os-topbar="hidden|shown"` on it and `data-os-autohide` on <html>, and os.css does the rest.

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const SHOW_DELAY = 180;
const HIDE_DELAY = 450;
const SWIPE = 40;

const findHeader = () => document.querySelector('.tbar')?.closest('header') || document.querySelector('body header');

/** `on`: auto-hide wanted and possible. Returns { shown, toggle } (toggle = the shortcut). */
export function useTopbarAutoHide(on) {
  const [shown, setShown] = useState(false);
  const pinned = useRef(false);
  const api = useRef({ show: () => {}, hide: () => {} });

  useLayoutEffect(() => {
    if (!on) return undefined;
    const header = findHeader();
    if (!header) return undefined;
    const root = document.documentElement;
    let showT = null; let hideT = null; let over = false; let touchY = null;
    const set = (v) => { header.setAttribute('data-os-topbar', v ? 'shown' : 'hidden'); setShown(v); };
    const busy = () => header.contains(document.activeElement) || !!header.querySelector('[aria-expanded="true"]');
    const show = () => { clearTimeout(hideT); clearTimeout(showT); set(true); };
    const hide = (force = false) => {
      clearTimeout(hideT);
      if (pinned.current && !force) return;
      // A menu of the bar is open, or focus is in it: look again a little later.
      if (!force && (over || busy())) { hideT = setTimeout(() => hide(), HIDE_DELAY); return; }
      set(false);
    };
    api.current = { show, hide };
    root.setAttribute('data-os-autohide', '');
    set(false);

    const zone = document.createElement('div');
    zone.className = 'os-topzone';
    zone.setAttribute('aria-hidden', 'true');
    document.body.appendChild(zone);
    // Not while a button is down: that is a window being dragged to the top edge to maximise.
    const zoneEnter = (e) => { if (!e.buttons && (e.pointerType === 'mouse' || e.pointerType === 'pen')) { clearTimeout(showT); showT = setTimeout(show, SHOW_DELAY); } };
    const zoneLeave = () => clearTimeout(showT);
    zone.addEventListener('pointerenter', zoneEnter);
    zone.addEventListener('pointerleave', zoneLeave);

    const hEnter = () => { over = true; clearTimeout(hideT); };
    const hLeave = () => { over = false; clearTimeout(hideT); hideT = setTimeout(() => hide(), HIDE_DELAY); };
    const focusIn = () => show();
    const focusOut = () => { setTimeout(() => { if (!header.contains(document.activeElement)) hide(); }, 0); };
    header.addEventListener('pointerenter', hEnter);
    header.addEventListener('pointerleave', hLeave);
    header.addEventListener('focusin', focusIn);
    header.addEventListener('focusout', focusOut);

    // A press anywhere else hides it (a menu of the bar portalled out of it counts as "in it"
    // while it is open: busy() sees its aria-expanded trigger).
    const down = (e) => {
      if (header.getAttribute('data-os-topbar') !== 'shown' || pinned.current) return;
      if (header.contains(e.target) || e.target === zone) return;
      if (header.querySelector('[aria-expanded="true"]')) return;
      hide(true);
    };
    const tStart = (e) => { const y = e.touches?.[0]?.clientY; touchY = typeof y === 'number' && y <= 24 ? y : null; };
    const tMove = (e) => { if (touchY === null) return; const y = e.touches?.[0]?.clientY; if (typeof y === 'number' && y - touchY > SWIPE) { touchY = null; show(); } };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('touchstart', tStart, { passive: true });
    window.addEventListener('touchmove', tMove, { passive: true });

    return () => {
      clearTimeout(showT); clearTimeout(hideT);
      zone.remove();
      header.removeEventListener('pointerenter', hEnter);
      header.removeEventListener('pointerleave', hLeave);
      header.removeEventListener('focusin', focusIn);
      header.removeEventListener('focusout', focusOut);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('touchstart', tStart);
      window.removeEventListener('touchmove', tMove);
      header.removeAttribute('data-os-topbar');
      root.removeAttribute('data-os-autohide');
      pinned.current = false;
      api.current = { show: () => {}, hide: () => {} };
      setShown(false);
    };
  }, [on]);

  const toggle = useCallback(() => {
    if (!on) return;
    const header = findHeader();
    const isShown = header?.getAttribute('data-os-topbar') === 'shown';
    if (isShown && pinned.current) { pinned.current = false; api.current.hide(true); return; }
    pinned.current = true;
    api.current.show();
  }, [on]);

  return { shown, toggle };
}
