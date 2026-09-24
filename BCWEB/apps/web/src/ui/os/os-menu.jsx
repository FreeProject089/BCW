// The OS mode's menus (N-os): the right-click menu of the desktop, of an icon, of a taskbar
// button and of the taskbar itself, and the window's system menu. One component, so every
// menu of the shell behaves the same way with a mouse and with a keyboard.
//
// Opening: a right click (contextmenu), the Menu key, or Shift+F10 on the focused element
// (isMenuKey), which is what makes every one of these menus reachable without a mouse.
// Inside: arrows move, Home/End jump, Enter/Space run, Escape closes and gives focus back to
// whatever opened it, a click outside closes. Typing a letter jumps to the next item that
// starts with it.
//
// Portalled to <body>, opaque (var(--bg-solid)): it is a popup. The shell is fullscreened
// through <html>, never through its own element, so a portal to <body> is still on screen in
// fullscreen (see os-shell.jsx, useFullscreen).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';

/** Is this keydown the keyboard's way of asking for a context menu? */
export const isMenuKey = (e) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');

/** Where to open a menu for an event: at the pointer, or under the element for a key. */
export function menuPoint(e) {
  if (e && typeof e.clientX === 'number' && (e.clientX || e.clientY) && e.type !== 'keydown') return { x: e.clientX, y: e.clientY };
  const r = e?.currentTarget?.getBoundingClientRect?.();
  return r ? { x: r.left + 4, y: r.bottom + 2 } : { x: 40, y: 40 };
}

/**
 * Arrow keys over a grid of buttons (the desktop icons, the start menu's tiles): move focus to
 * the nearest item in the arrow's direction, by geometry, so it works whatever the grid's
 * flow and column count. Returns true when it moved.
 */
export function spatialFocus(e, container, selector) {
  const dirs = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
  const d = dirs[e.key];
  if (!d || !container || e.altKey || e.ctrlKey || e.metaKey) return false;
  const items = [...container.querySelectorAll(selector)].filter((el) => el.offsetParent !== null);
  const cur = document.activeElement;
  if (!items.includes(cur)) return false;
  const c = cur.getBoundingClientRect();
  const cx = c.left + c.width / 2; const cy = c.top + c.height / 2;
  let best = null; let score = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx; const dy = r.top + r.height / 2 - cy;
    const along = dx * d[0] + dy * d[1];
    if (along <= 1) continue;
    const across = Math.abs(dx * d[1]) + Math.abs(dy * d[0]);
    const s = along + across * 2;
    if (s < score) { score = s; best = el; }
  }
  if (!best) return false;
  e.preventDefault();
  best.focus({ preventScroll: false });
  return true;
}

/**
 * items: [{ k, label, icon?, run?, disabled?, danger?, checked?, hint? } | { sep: true }]
 * `at` = { x, y } in viewport pixels. `onClose(refocus)`.
 */
export default function OsMenu({ at, items, label, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  const opener = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Keep it on screen: flip left of / above the point when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth; const vh = window.innerHeight;
    let left = at.x; let top = at.y;
    if (left + r.width > vw - 6) left = Math.max(6, Math.min(at.x - r.width, vw - r.width - 6));
    if (top + r.height > vh - 6) top = Math.max(6, at.y - r.height);
    setPos({ left, top });
  }, [at.x, at.y]);

  useEffect(() => {
    const done = (refocus) => {
      closeRef.current(refocus);
      if (refocus && opener.current?.focus && document.contains(opener.current)) opener.current.focus({ preventScroll: true });
    };
    const list = () => [...(ref.current?.querySelectorAll('[role^="menuitem"]:not([disabled])') || [])];
    // Directly, not in a requestAnimationFrame: a background tab never runs one.
    list()[0]?.focus({ preventScroll: true });
    const onKey = (e) => {
      const items = list();
      const i = items.indexOf(document.activeElement);
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); done(true); return; }
      let j = null;
      if (e.key === 'ArrowDown') j = (i + 1) % items.length;
      else if (e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = items.length - 1;
      else if (e.key.length === 1 && /\S/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const ch = e.key.toLowerCase();
        const order = [...items.slice(i + 1), ...items.slice(0, i + 1)];
        const hit = order.find((b) => (b.textContent || '').trim().toLowerCase().startsWith(ch));
        if (hit) j = items.indexOf(hit);
      }
      if (j !== null && items.length) { e.preventDefault(); e.stopPropagation(); items[j]?.focus(); }
    };
    // A press on the button that opened the menu is left to that button (it toggles it shut);
    // closing here as well would reopen it on the click that follows.
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (opener.current && opener.current !== document.body && opener.current.contains?.(e.target) && opener.current.getAttribute?.('aria-haspopup')) return;
      done(false);
    };
    const onBlur = () => done(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const run = (it) => {
    if (it.disabled) return;
    closeRef.current(false);
    // Focus back to the opener first, then the action (which may move focus itself, e.g. to a
    // window it just opened).
    if (opener.current?.focus && document.contains(opener.current)) opener.current.focus({ preventScroll: true });
    it.run?.();
  };

  return createPortal(
    <div ref={ref} role="menu" aria-label={label} className="os-menu" style={pos}
      onContextMenu={(e) => e.preventDefault()}>
      {items.filter(Boolean).map((it, i) => (it.sep
        ? <div key={`sep-${i}`} role="separator" className="os-menu-sep" />
        : (
          <button key={it.k} type="button" role={typeof it.checked === 'boolean' ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={typeof it.checked === 'boolean' ? it.checked : undefined}
            disabled={it.disabled} className={`os-menu-item${it.danger ? ' is-danger' : ''}`} onClick={() => run(it)}>
            <span className="os-menu-ic" aria-hidden>
              {typeof it.checked === 'boolean' ? (it.checked ? <Check size={14} /> : null) : (it.icon ? <it.icon size={14} /> : null)}
            </span>
            <span className="os-menu-label">{it.label}</span>
            {it.hint && <kbd className="os-menu-hint">{it.hint}</kbd>}
          </button>
        )))}
    </div>,
    document.body,
  );
}
