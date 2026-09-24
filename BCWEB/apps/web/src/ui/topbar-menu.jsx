// N12 (agent-topbar-N): the grouped menus of the topbar.
//
// The right end of the bar was a row of loose buttons: Dashboard and Admin side by side, the
// avatar next to a bare log-out icon, and "Projects" as an icon that only led to the page of
// OTHER projects while the site's own projects lived somewhere else. Three menus now group what
// belongs together: the two dashboards, the account (profile + sign out), and the projects
// (the site's own, then the other projects). They are the same object on the desktop bar and
// on the phone bar.
//
// How it opens is the topbar's existing dropdown (NavDropdown in App.jsx): the panel is
// PORTALLED into the body of the document the bar lives in (the page's, or the admin Live
// preview frame's) with fixed coordinates under the trigger, so no `overflow` on the bar can
// clip it, and it is re-placed on scroll and resize. On top of that, a menu button's keyboard
// contract (WAI-ARIA APG "menu button"):
//   - Enter / Space / ArrowDown on the trigger opens and focuses the first item,
//     ArrowUp opens and focuses the last;
//   - ArrowDown / ArrowUp move (and wrap), Home / End jump, a letter jumps to the next item
//     starting with it;
//   - Escape closes and puts focus back on the trigger; Tab closes and lets focus move on from
//     the trigger, so the tab order stays the page's;
//   - a press outside, a route change or picking an item closes it.
// The panel is opaque (--bg-solid): the "Translucent surfaces" setting must never render menu
// text over the card behind it.
import { useEffect, useLayoutEffect, useRef, useState, useId } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import './topbar-menu.css';

const GAP = 8;     // between the bar and the panel, and between the panel and the screen edge
const EST_W = 288; // first-frame width guess, corrected before paint once the panel exists

/**
 * @param label        accessible name of the trigger (and the menu)
 * @param trigger      node drawn inside the trigger button
 * @param triggerClass class of the trigger button
 * @param chevron      draw a small chevron after the trigger content
 * @param header       optional node on top of the panel (the account card)
 * @param sections     [{ key, title?, items: [{ key, to?, onSelect?, icon, label, desc?, badge?, tone? }] }]
 * @param footer       optional node under the last section
 * @param title        tooltip of the trigger
 */
export function TopMenu({ label, trigger, triggerClass = '', chevron = false, header = null, sections = [], footer = null, title, dataKey }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const focusOnOpen = useRef(null); // 'first' | 'last' | null
  const loc = useLocation();
  const id = useId();
  const menuId = `tmenu-${id.replace(/[^a-z0-9]/gi, '')}`;
  const doc = () => btnRef.current?.ownerDocument || document;
  const win = () => doc().defaultView || window;

  const items = () => Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') || []);
  const focusAt = (i) => { const list = items(); if (!list.length) return; list[(i + list.length) % list.length].focus(); };

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = win().innerWidth;
    const w = Math.min(menuRef.current?.offsetWidth || EST_W, vw - GAP * 2);
    // Aligned on the trigger's END edge (the menus live at the right of the bar), then kept on
    // screen: a trigger near the left edge pushes the panel right, never off the page.
    let left = r.right - w;
    left = Math.max(GAP, Math.min(left, vw - GAP - w));
    const next = { left: Math.round(left), top: Math.round(r.bottom + GAP) };
    setPos((p) => (p && p.left === next.left && p.top === next.top ? p : next));
  };

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  // Placed before paint, then again once the real panel width is known (same frame).
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    place();
    const want = focusOnOpen.current;
    focusOnOpen.current = null;
    if (want === 'first') focusAt(0);
    else if (want === 'last') focusAt(-1);
  }, [open, !!pos]);

  // Route change closes (the back button included, which no item's onClick sees).
  useEffect(() => { setOpen(false); }, [loc.pathname, loc.search]);

  useEffect(() => {
    if (!open) return undefined;
    const d = doc();
    const w = win();
    const onDown = (e) => {
      if (btnRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onMove = () => place();
    d.addEventListener('pointerdown', onDown, true);
    w.addEventListener('scroll', onMove, true);
    w.addEventListener('resize', onMove);
    return () => {
      d.removeEventListener('pointerdown', onDown, true);
      w.removeEventListener('scroll', onMove, true);
      w.removeEventListener('resize', onMove);
    };
  }, [open]);

  const onTriggerKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) { focusAt(e.key === 'ArrowDown' ? 0 : -1); return; }
      focusOnOpen.current = e.key === 'ArrowDown' ? 'first' : 'last';
      setOpen(true);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close(true);
    }
  };
  // A click from the keyboard (Enter / Space) has detail 0: that user wants to land IN the menu.
  const onTriggerClick = (e) => {
    if (open) { setOpen(false); return; }
    if (e.detail === 0) focusOnOpen.current = 'first';
    setOpen(true);
  };

  const onMenuKey = (e) => {
    const list = items();
    const at = list.indexOf(doc().activeElement);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(at + 1); break;
      case 'ArrowUp': e.preventDefault(); focusAt(at < 0 ? -1 : at - 1); break;
      case 'Home': e.preventDefault(); focusAt(0); break;
      case 'End': e.preventDefault(); focusAt(-1); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(true); break;
      // Focus goes back to the trigger WITHOUT preventing the default, so the browser then
      // moves it on from there: Tab lands on what follows the trigger, as it would closed.
      case 'Tab': close(true); break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const ch = e.key.toLowerCase();
          const n = list.length;
          for (let k = 1; k <= n; k++) {
            const el = list[(at + k + n) % n];
            if ((el.getAttribute('data-label') || el.textContent || '').trim().toLowerCase().startsWith(ch)) { el.focus(); break; }
          }
        }
    }
  };

  const itemNode = (it) => {
    const inner = (active) => (
      <>
        <span className={`tmenu-ic ${active ? 'is-active' : ''}`} aria-hidden>{it.icon}</span>
        <span className="tmenu-txt">
          <span className="tmenu-lbl">{it.label}</span>
          {it.desc && <span className="tmenu-desc">{it.desc}</span>}
        </span>
        {it.badge ? <span className="tmenu-badge" title={it.badgeTitle || undefined} aria-label={it.badgeTitle || undefined}>{it.badge > 9 ? '9+' : it.badge}</span> : null}
      </>
    );
    const common = { role: 'menuitem', tabIndex: -1, 'data-label': it.label };
    if (it.to) {
      return (
        <NavLink key={it.key} to={it.to} end={it.end} {...common} data-nav-idx={it.navIdx}
          className={({ isActive }) => `tmenu-item ${it.tone === 'danger' ? 'is-danger' : ''} ${isActive ? 'is-current' : ''}`}
          onClick={() => setOpen(false)}>
          {({ isActive }) => inner(isActive)}
        </NavLink>
      );
    }
    return (
      <button key={it.key} type="button" {...common} className={`tmenu-item ${it.tone === 'danger' ? 'is-danger' : ''}`}
        onClick={() => { setOpen(false); it.onSelect?.(); }}>
        {inner(false)}
      </button>
    );
  };

  const visible = sections.filter((s) => s.items.length > 0);
  return (
    <>
      <button ref={btnRef} type="button" className={`tmenu-trigger ${triggerClass} ${open ? 'is-open' : ''}`}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label={label} title={title || label} data-util={dataKey}
        onClick={onTriggerClick} onKeyDown={onTriggerKey}>
        {trigger}
        {chevron && <ChevronDown size={12} className="tmenu-chev" aria-hidden />}
      </button>
      {open && createPortal(
        <div ref={menuRef} id={menuId} role="menu" aria-label={label} className="tmenu"
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, background: 'var(--bg-solid)' }}
          onKeyDown={onMenuKey}>
          {header}
          {visible.map((s) => (
            <div key={s.key} role="group" aria-label={s.title || undefined} className="tmenu-sec">
              {s.title && <div className="tmenu-h" aria-hidden>{s.title}</div>}
              {s.items.map(itemNode)}
            </div>
          ))}
          {footer}
        </div>,
        doc().body,
      )}
    </>
  );
}

export default TopMenu;
