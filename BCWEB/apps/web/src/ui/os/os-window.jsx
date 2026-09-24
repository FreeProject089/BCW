// One window of the OS mode (M1, reworked by N-os): a Windows-style title bar (the icon that
// opens the system menu on the left, the title, then minimise / maximise / close flush in the
// top-right corner, close turning red), eight resize handles, and the REAL section component
// as its body.
//
// The maximise button is also the door to the snap layouts: hover it, press ArrowDown on it,
// or right-click it (the shell draws the grid, os-snap.jsx). Right-clicking the title bar, or
// Shift+F10 / the Menu key on the icon, opens the system menu (os-menu.jsx).
//
// Moving and resizing write the element's style directly while the pointer is down and
// dispatch ONE action at the end (wm.js 'rect' / 'snap'). Dispatching on every pointermove
// would re-render every open section sixty times a second for a drag.

import { memo, Suspense, useEffect, useRef, useState } from 'react';
import { Minus, Square, Copy, X, PanelLeft, PanelRight, Maximize2, Minimize2, CircleAlert, LayoutGrid, Scan, EyeOff, Pin, PinOff, PanelLeftOpen } from 'lucide-react';
import { useI18n } from '../../i18n.jsx';
import { Badge, Spinner } from '../ui.jsx';
import { ErrorBoundary } from '../ErrorBoundary.jsx';
import { defaultSize, resizeRect, snapZoneAt, TITLE_H } from './wm.js';
import OsMenu, { isMenuKey, menuPoint } from './os-menu.jsx';

const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
/** How long the pointer rests on maximise before the snap layouts open (Windows 11: ~0.4 s). */
const FLY_DELAY = 450;

// The section itself. Memoised on (render, leaf): moving or focusing another window re-renders
// the shell, and that must not re-render forty mounted admin screens.
const WindowBody = memo(function WindowBody({ render, leaf }) {
  return render(leaf);
});

export default function OsWindow({ win, tab, leaf, active, mounted, vp, deskRef, dispatch, render, onLeaf, onClose, onSnapPreview, registerEl, act, pinned }) {
  const { t } = useI18n();
  const rootRef = useRef(null);
  const maxBtn = useRef(null);
  const flyTimer = useRef(null);
  const [menu, setMenu] = useState(null); // null | { x, y }
  const maxed = win.mode === 'max';
  const minimised = win.mode === 'min';
  const freed = maxed || !!win.snap;

  useEffect(() => { registerEl(win.id, rootRef.current); return () => registerEl(win.id, null); }, [win.id, registerEl]);
  useEffect(() => () => clearTimeout(flyTimer.current), []);

  // Put the element back on the state's geometry. Called at the end of every gesture BEFORE
  // dispatching: React compares new props with old props, not with the DOM, so a drag that
  // clamps back to the same rect would otherwise leave the window where the pointer let go.
  const resetStyle = () => {
    const el = rootRef.current;
    if (!el) return;
    el.style.left = `${win.x}px`; el.style.top = `${win.y}px`; el.style.width = `${win.w}px`; el.style.height = `${win.h}px`;
    el.classList.remove('is-gesture');
  };

  const onTitleDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const el = rootRef.current; const desk = deskRef.current;
    if (!el || !desk) return;
    const d = desk.getBoundingClientRect();
    const sx = e.clientX; const sy = e.clientY;
    let base = { x: win.x, y: win.y, w: win.w, h: win.h };
    let detached = !freed;
    let moved = false; let zone = null; let last = base;
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch { /* old browser: window listeners still work */ }
    const move = (ev) => {
      const dx = ev.clientX - sx; const dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!moved) { moved = true; el.classList.add('is-gesture'); act.closeFly(); }
      if (!detached) {
        // Dragging a maximised or snapped window: it takes back its free size under the
        // pointer, holding the title bar at the same relative spot.
        const size = win.restore || defaultSize(vp);
        const ratio = clamp((sx - d.left - win.x) / Math.max(1, win.w), 0.1, 0.9);
        base = { x: Math.round(sx - d.left - size.w * ratio), y: Math.max(0, Math.round(sy - d.top - TITLE_H / 2)), w: size.w, h: size.h };
        el.style.width = `${base.w}px`; el.style.height = `${base.h}px`;
        el.dataset.detached = '1';
        detached = true;
      }
      last = { x: base.x + dx, y: clamp(base.y + dy, 0, Math.max(0, vp.h - TITLE_H)), w: base.w, h: base.h };
      el.style.left = `${last.x}px`; el.style.top = `${last.y}px`;
      const z = snapZoneAt(ev.clientX - d.left, ev.clientY - d.top, vp);
      if (z !== zone) { zone = z; onSnapPreview(z); }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!moved) return;
      onSnapPreview(null);
      delete el.dataset.detached;
      resetStyle();
      if (zone) act.snap(win.id, zone);
      else dispatch({ type: 'rect', id: win.id, rect: last });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onHandleDown = (handle) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const el = rootRef.current;
    if (!el) return;
    const sx = e.clientX; const sy = e.clientY;
    const start = { x: win.x, y: win.y, w: win.w, h: win.h };
    let last = start;
    el.classList.add('is-gesture');
    dispatch({ type: 'focus', id: win.id });
    const move = (ev) => {
      last = resizeRect(start, handle, ev.clientX - sx, ev.clientY - sy, vp);
      el.style.left = `${last.x}px`; el.style.top = `${last.y}px`; el.style.width = `${last.w}px`; el.style.height = `${last.h}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      resetStyle();
      if (last !== start) dispatch({ type: 'rect', id: win.id, rect: last });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const Icon = tab.icon;
  const subs = tab.sub?.length > 1 ? tab.sub : null;
  const titleId = `os-win-t-${win.id}`;
  const label = leaf && leaf.label !== tab.label ? `${tab.label} · ${leaf.label}` : tab.label;

  // Like Windows: the button restores a maximised window and maximises any other one, snapped
  // included (a snapped window comes back to its free size from the menu, Alt+Shift+Down, or by
  // dragging it off its zone).
  const maxLabel = maxed ? t('os.win.restore', 'Restore') : t('os.win.max', 'Maximise');
  const toggleMax = () => { act.closeFly(); dispatch({ type: maxed ? 'unsnap' : 'toggleMax', id: win.id }); };
  const openFly = (viaKeyboard) => { clearTimeout(flyTimer.current); if (maxBtn.current) act.openFly(win.id, maxBtn.current, viaKeyboard); };

  const menuItems = [
    freed
      ? { k: 'restore', icon: Minimize2, label: t('os.win.restore', 'Restore'), hint: 'Alt+Shift+↓', run: () => dispatch({ type: 'unsnap', id: win.id }) }
      : { k: 'max', icon: Maximize2, label: t('os.win.max', 'Maximise'), hint: 'Alt+Shift+↑', run: () => dispatch({ type: 'toggleMax', id: win.id }) },
    { k: 'min', icon: Minus, label: t('os.win.min', 'Minimise'), run: () => dispatch({ type: 'minimize', id: win.id }) },
    { sep: true },
    { k: 'left', icon: PanelLeft, label: t('os.win.snapleft', 'Snap to the left half'), hint: 'Alt+Shift+←', run: () => act.snap(win.id, 'left') },
    { k: 'right', icon: PanelRight, label: t('os.win.snapright', 'Snap to the right half'), hint: 'Alt+Shift+→', run: () => act.snap(win.id, 'right') },
    { k: 'layouts', icon: LayoutGrid, label: t('os.snap.layouts.m', 'Snap layouts…'), hint: 'Alt+Z', run: () => openFly(true) },
    { k: 'fill', icon: Scan, label: t('os.win.fill', 'Fill the free space'), run: () => act.fill(win.id) },
    { sep: true },
    { k: 'others', icon: EyeOff, label: t('os.win.others', 'Minimise the other windows'), run: () => dispatch({ type: 'minimizeOthers', id: win.id }) },
    { k: 'pin', icon: pinned ? PinOff : Pin, label: pinned ? t('os.pin.bar.off', 'Unpin from the taskbar') : t('os.pin.bar.on', 'Pin to the taskbar'), run: () => dispatch({ type: 'pin', id: win.id }) },
    { k: 'classic', icon: PanelLeftOpen, label: t('os.win.classic', 'Open in the classic mode'), run: () => act.classic(leaf?.id || win.leaf) },
    { sep: true },
    { k: 'close', icon: X, label: t('os.win.close', 'Close'), hint: 'Alt+W', danger: true, run: () => onClose(win.id) },
  ];

  // A minimised window that fell out of the mounted set is not rendered at all: its section
  // component is unmounted, which is the whole point of the cap.
  if (minimised && !mounted) return null;

  return (
    <section ref={rootRef} className={`os-win${active ? ' is-active' : ''}${maxed ? ' is-max' : ''}${win.snap ? ' is-snapped' : ''}`}
      aria-labelledby={titleId} hidden={minimised} tabIndex={-1} data-win={win.id}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
      onPointerDownCapture={() => { if (!active) dispatch({ type: 'focus', id: win.id }); }}>
      <header className="os-win-bar" onPointerDown={onTitleDown}
        onDoubleClick={(e) => { if (!e.target.closest('button')) toggleMax(); }}
        onContextMenu={(e) => { if (e.target.closest('.os-win-ctl')) return; e.preventDefault(); setMenu(menuPoint(e)); }}>
        <button type="button" className="os-win-icon" aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => setMenu(menu ? null : menuPoint({ currentTarget: e.currentTarget, type: 'keydown' }))}
          onKeyDown={(e) => { if (isMenuKey(e)) { e.preventDefault(); setMenu(menuPoint({ currentTarget: e.currentTarget, type: 'keydown' })); } }}
          title={t('os.win.menu', 'Window menu')} aria-label={t('os.win.menu', 'Window menu')}>
          {Icon && <Icon size={15} aria-hidden />}
        </button>
        <h2 id={titleId} className="os-win-title" title={label}>{label}</h2>
        <div className="os-win-ctl">
          <button type="button" className="os-win-btn" onClick={() => dispatch({ type: 'minimize', id: win.id })}
            title={t('os.win.min.tip', 'Minimise. Past six open windows, the oldest minimised ones are unloaded to save memory and lose what was not saved.')}
            aria-label={t('os.win.min', 'Minimise')}><Minus size={16} aria-hidden /></button>
          <button ref={maxBtn} type="button" className="os-win-btn" onClick={toggleMax} aria-haspopup="dialog"
            onPointerEnter={(e) => { if (e.pointerType === 'mouse') { clearTimeout(flyTimer.current); flyTimer.current = setTimeout(() => openFly(false), FLY_DELAY); } }}
            onPointerLeave={() => { clearTimeout(flyTimer.current); act.leaveFly(); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openFly(false); }}
            onKeyDown={(e) => { if (e.key === 'ArrowDown' || isMenuKey(e)) { e.preventDefault(); openFly(true); } }}
            title={`${maxLabel}. ${t('os.snap.hover', 'Rest the pointer here, or press the down arrow, for the snap layouts.')}`}
            aria-label={maxLabel}>
            {maxed ? <Copy size={14} aria-hidden /> : <Square size={13} aria-hidden />}
          </button>
          <button type="button" className="os-win-btn os-win-close" onClick={() => onClose(win.id)}
            title={`${t('os.win.close', 'Close')} (Alt+W)`} aria-label={t('os.win.close', 'Close')}><X size={17} aria-hidden /></button>
        </div>
      </header>
      {subs && (
        <div className="os-win-subs" role="tablist" aria-label={tab.label}>
          {subs.map((lf) => {
            const on = leaf?.id === lf.id;
            return (
              <button key={lf.id} type="button" role="tab" aria-selected={on} onClick={() => onLeaf(win.id, lf.id)}
                className={`os-win-sub${on ? ' is-on' : ''}`}>
                {lf.icon && <lf.icon size={13} aria-hidden className={on ? 'text-[var(--accent-ink)]' : ''} />}
                <span>{lf.label}</span>
                {lf.badge ? <Badge tone="primary">{lf.badge}</Badge> : null}
              </button>
            );
          })}
        </div>
      )}
      <div className="os-win-body">
        <ErrorBoundary fallback={(
          <div className="os-win-crash" role="alert">
            <CircleAlert size={18} aria-hidden className="text-[var(--error)] shrink-0" />
            <div>
              <div className="font-medium">{t('os.win.crash', 'This screen stopped with an error.')}</div>
              <div className="text-xs text-[var(--muted)] mt-0.5">{t('os.win.crash.d', 'The other windows are fine. Close this one and open it again, or switch to the classic mode.')}</div>
            </div>
          </div>
        )}>
          <Suspense fallback={<div className="grid place-items-center py-16 text-[var(--muted)]"><Spinner /></div>}>
            <WindowBody render={render} leaf={leaf?.id || win.leaf} />
          </Suspense>
        </ErrorBoundary>
      </div>
      {!maxed && HANDLES.map((h) => <div key={h} className={`os-rz os-rz-${h}`} onPointerDown={onHandleDown(h)} aria-hidden />)}
      {menu && <OsMenu at={menu} items={menuItems} label={t('os.win.menu', 'Window menu')} onClose={() => setMenu(null)} />}
    </section>
  );
}
