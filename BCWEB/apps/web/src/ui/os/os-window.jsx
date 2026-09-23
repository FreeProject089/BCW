// One window of the OS mode (M1): title bar, the three buttons, a window menu for the
// keyboard, eight resize handles, and the REAL section component as its body.
//
// Moving and resizing write the element's style directly while the pointer is down and
// dispatch ONE action at the end (wm.js 'rect' / 'snap'). Dispatching on every pointermove
// would re-render every open section sixty times a second for a drag.

import { memo, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Square, Copy, X, PanelLeft, PanelRight, Maximize2, Minimize2, CircleAlert } from 'lucide-react';
import { useI18n } from '../../i18n.jsx';
import { Badge, Spinner } from '../ui.jsx';
import { ErrorBoundary } from '../ErrorBoundary.jsx';
import { defaultSize, resizeRect, snapZoneAt, TITLE_H } from './wm.js';

const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// The section itself. Memoised on (render, leaf): moving or focusing another window re-renders
// the shell, and that must not re-render forty mounted admin screens.
const WindowBody = memo(function WindowBody({ render, leaf }) {
  return render(leaf);
});

function WindowMenu({ anchor, win, onClose, dispatch, onCloseWin }) {
  const { t } = useI18n();
  const ref = useRef(null);
  // The latest onClose, read from a ref: the caller passes an inline arrow, and with it in the
  // effect's deps every render of the window would re-run this and pull focus back to the
  // first item.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onClose = (v) => closeRef.current(v);
    ref.current?.querySelector('button')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(true); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...(ref.current?.querySelectorAll('button:not([disabled])') || [])];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    };
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(false); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, []);
  const r = anchor.getBoundingClientRect();
  const act = (fn) => () => { fn(); onClose(true); };
  const items = [
    { k: 'left', icon: PanelLeft, label: t('os.win.snapleft', 'Snap to the left half'), run: () => dispatch({ type: 'snap', id: win.id, zone: 'left' }) },
    { k: 'right', icon: PanelRight, label: t('os.win.snapright', 'Snap to the right half'), run: () => dispatch({ type: 'snap', id: win.id, zone: 'right' }) },
    win.mode === 'max' || win.snap
      ? { k: 'restore', icon: Minimize2, label: t('os.win.restore', 'Restore'), run: () => dispatch({ type: 'unsnap', id: win.id }) }
      : { k: 'max', icon: Maximize2, label: t('os.win.max', 'Maximise'), run: () => dispatch({ type: 'toggleMax', id: win.id }) },
    { k: 'min', icon: Minus, label: t('os.win.min', 'Minimise'), run: () => dispatch({ type: 'minimize', id: win.id }) },
    { k: 'close', icon: X, label: t('os.win.close', 'Close'), run: () => onCloseWin(win.id) },
  ];
  return createPortal(
    <div ref={ref} role="menu" className="os-menu" style={{ left: r.left, top: r.bottom + 4 }}>
      {items.map((it) => (
        <button key={it.k} type="button" role="menuitem" className="os-menu-item" onClick={act(it.run)}>
          <it.icon size={14} aria-hidden /> <span>{it.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

export default function OsWindow({ win, tab, leaf, active, mounted, vp, deskRef, dispatch, render, onLeaf, onClose, onSnapPreview, registerEl }) {
  const { t } = useI18n();
  const rootRef = useRef(null);
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef(null);
  const maxed = win.mode === 'max';
  const minimised = win.mode === 'min';

  useEffect(() => { registerEl(win.id, rootRef.current); return () => registerEl(win.id, null); }, [win.id, registerEl]);

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
    let detached = !(maxed || win.snap);
    let moved = false; let zone = null; let last = base;
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch { /* old browser: window listeners still work */ }
    const move = (ev) => {
      const dx = ev.clientX - sx; const dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!moved) { moved = true; el.classList.add('is-gesture'); }
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
      if (zone) dispatch({ type: 'snap', id: win.id, zone });
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

  // A minimised window that fell out of the mounted set is not rendered at all: its section
  // component is unmounted, which is the whole point of the cap.
  if (minimised && !mounted) return null;

  return (
    <section ref={rootRef} className={`os-win${active ? ' is-active' : ''}${maxed ? ' is-max' : ''}${win.snap ? ' is-snapped' : ''}`}
      aria-labelledby={titleId} hidden={minimised} tabIndex={-1} data-win={win.id}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
      onPointerDownCapture={() => { if (!active) dispatch({ type: 'focus', id: win.id }); }}>
      <header className="os-win-bar" onPointerDown={onTitleDown} onDoubleClick={(e) => { if (!e.target.closest('button')) dispatch({ type: 'toggleMax', id: win.id }); }}>
        <button ref={menuBtn} type="button" className="os-win-icon" aria-haspopup="menu" aria-expanded={menu}
          onClick={() => setMenu((m) => !m)} title={t('os.win.menu', 'Window menu')} aria-label={t('os.win.menu', 'Window menu')}>
          {Icon && <Icon size={15} aria-hidden />}
        </button>
        <h2 id={titleId} className="os-win-title" title={label}>{label}</h2>
        <div className="os-win-btns">
          <button type="button" className="os-win-btn" onClick={() => dispatch({ type: 'minimize', id: win.id })}
            title={t('os.win.min.tip', 'Minimise. Past six open windows, the oldest minimised ones are unloaded to save memory and lose what was not saved.')}
            aria-label={t('os.win.min', 'Minimise')}><Minus size={14} aria-hidden /></button>
          <button type="button" className="os-win-btn" onClick={() => dispatch({ type: maxed || win.snap ? 'unsnap' : 'toggleMax', id: win.id })}
            title={maxed || win.snap ? t('os.win.restore', 'Restore') : t('os.win.max', 'Maximise')}
            aria-label={maxed || win.snap ? t('os.win.restore', 'Restore') : t('os.win.max', 'Maximise')}>
            {maxed || win.snap ? <Copy size={13} aria-hidden /> : <Square size={12} aria-hidden />}
          </button>
          <button type="button" className="os-win-btn os-win-close" onClick={() => onClose(win.id)}
            title={t('os.win.close', 'Close')} aria-label={t('os.win.close', 'Close')}><X size={15} aria-hidden /></button>
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
      {menu && menuBtn.current && (
        <WindowMenu anchor={menuBtn.current} win={win} dispatch={dispatch} onCloseWin={onClose}
          onClose={(refocus) => { setMenu(false); if (refocus) menuBtn.current?.focus(); }} />
      )}
    </section>
  );
}
