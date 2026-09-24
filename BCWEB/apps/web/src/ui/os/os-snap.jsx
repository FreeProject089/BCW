// Snap layouts and snap assist (N-os), the two halves of "put windows side by side".
//
// SnapFlyout: the grid of layouts that opens from a window's maximise button (hover it, press
// ArrowDown on it, right-click it, or Alt+Z). Each layout is a miniature desktop whose zones
// are buttons: picking one snaps the window there. Layouts that would squeeze a window under
// its minimum size on this desktop are not offered (wm.js availableLayouts).
//
// SnapAssist: once a window took a zone, the other zones of the same layout are offered, one
// at a time, to the other windows: a list of them drawn IN the free zone. Picking one snaps it
// there and moves on to the next free zone; Escape or a click elsewhere ends it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n.jsx';
import { availableLayouts, targetKey } from './wm.js';

export function SnapFlyout({ anchor, vp, viaKeyboard, onPick, onClose, onHover }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: anchor.right - 300, top: anchor.bottom + 6 });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const layouts = availableLayouts(vp);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(6, Math.min(anchor.right - r.width, window.innerWidth - r.width - 6));
    const top = anchor.bottom + r.height + 6 > window.innerHeight ? Math.max(6, anchor.top - r.height - 6) : anchor.bottom + 6;
    setPos({ left, top });
  }, [anchor.right, anchor.bottom, anchor.top]);

  useEffect(() => {
    if (viaKeyboard) ref.current?.querySelector('button')?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(true); return; }
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key) || !ref.current?.contains(document.activeElement)) return;
      e.preventDefault();
      const all = [...ref.current.querySelectorAll('button')];
      const i = all.indexOf(document.activeElement);
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      all[(i + d + all.length) % all.length]?.focus();
    };
    const onDown = (e) => { if (!ref.current?.contains(e.target)) closeRef.current(false); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div ref={ref} className="os-snapfly" role="dialog" aria-label={t('os.snap.layouts', 'Snap layouts')} style={pos}
      onPointerEnter={() => onHover?.(true)} onPointerLeave={() => onHover?.(false)}>
      <div className="os-snapfly-t">{t('os.snap.layouts', 'Snap layouts')}</div>
      <div className="os-snapfly-grid">
        {layouts.map((l, li) => (
          <div key={l.id} className="os-snapfly-lay" role="group" aria-label={t('os.snap.layout', 'Layout {n}').replace('{n}', String(li + 1))}>
            {l.zones.map((z, zi) => (
              <button key={targetKey(z)} type="button" className="os-snapfly-zone"
                style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` }}
                aria-label={t('os.snap.zone', 'Layout {n}, zone {i} of {c}').replace('{n}', String(li + 1)).replace('{i}', String(zi + 1)).replace('{c}', String(l.zones.length))}
                title={t('os.snap.zone', 'Layout {n}, zone {i} of {c}').replace('{n}', String(li + 1)).replace('{i}', String(zi + 1)).replace('{c}', String(l.zones.length))}
                onClick={() => onPick(z)} />
            ))}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function SnapAssist({ rect, candidates, onPick, onClose }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    ref.current?.querySelector('button')?.focus({ preventScroll: true });
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); } };
    const onDown = (e) => { if (!ref.current?.contains(e.target)) closeRef.current(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, []);
  return (
    <div className="os-assist" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <div ref={ref} className="os-assist-panel" role="dialog" aria-label={t('os.assist.t', 'Choose a window for this space')}>
        <div className="os-assist-h">{t('os.assist.t', 'Choose a window for this space')}</div>
        <div className="os-assist-list">
          {candidates.map((c) => (
            <button key={c.id} type="button" className="os-assist-item" onClick={() => onPick(c.id)} title={c.label}>
              <span className="os-assist-ic">{c.icon ? <c.icon size={18} aria-hidden /> : null}</span>
              <span className="os-assist-l" title={c.label}>{c.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="os-assist-skip" onClick={() => closeRef.current()}>{t('os.assist.skip', 'Leave it empty')}</button>
      </div>
    </div>
  );
}
