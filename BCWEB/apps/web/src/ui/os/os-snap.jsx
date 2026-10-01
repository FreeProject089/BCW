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

const PER_ROW = 3;

export function SnapFlyout({ anchor, vp, viaKeyboard, onPick, onClose, onHover, onPreview }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: anchor.right - 320, top: anchor.bottom + 6 });
  const [hot, setHot] = useState(null); // `${layoutIndex}:${zoneIndex}` under the pointer or the focus
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const layouts = availableLayouts(vp);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Centred under the maximise button (Windows 11), kept on screen; above it when there is no room below.
    const left = Math.max(6, Math.min((anchor.left + anchor.right) / 2 - r.width / 2, window.innerWidth - r.width - 6));
    const top = anchor.bottom + r.height + 6 > window.innerHeight ? Math.max(6, anchor.top - r.height - 6) : anchor.bottom + 6;
    setPos({ left, top });
  }, [anchor.left, anchor.right, anchor.bottom, anchor.top]);

  // The zone under the pointer or the focus is drawn on the desktop, where the window would go.
  const light = (li, zi) => {
    const k = li === null ? null : `${li}:${zi}`;
    setHot(k);
    previewRef.current?.(li === null ? null : layouts[li]?.zones[zi] || null);
  };
  useEffect(() => () => previewRef.current?.(null), []);

  useEffect(() => {
    if (viaKeyboard) ref.current?.querySelector('button')?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(true); return; }
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || !ref.current?.contains(document.activeElement)) return;
      e.preventDefault();
      const all = [...ref.current.querySelectorAll('button[data-l]')];
      const cur = document.activeElement;
      const li = Number(cur?.dataset?.l ?? 0); const zi = Number(cur?.dataset?.z ?? 0);
      const i = all.indexOf(cur);
      let next = null;
      if (e.key === 'ArrowRight') next = all[(i + 1) % all.length];
      else if (e.key === 'ArrowLeft') next = all[(i - 1 + all.length) % all.length];
      else if (e.key === 'Home') next = all[0];
      else if (e.key === 'End') next = all[all.length - 1];
      else {
        // Up/Down: the layout above/below, the same zone when it has one.
        const nl = li + (e.key === 'ArrowDown' ? PER_ROW : -PER_ROW);
        const row = all.filter((b) => Number(b.dataset.l) === nl);
        next = row.length ? row[Math.min(zi, row.length - 1)] : null;
      }
      next?.focus();
    };
    const onDown = (e) => { if (!ref.current?.contains(e.target)) closeRef.current(false); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const zoneLabel = (l, li, zi) => t('os.snap.zone', 'Layout {n}, zone {i} of {c}').replace('{n}', String(li + 1)).replace('{i}', String(zi + 1)).replace('{c}', String(l.zones.length));
  return createPortal(
    <div ref={ref} className="os-snapfly" role="dialog" aria-label={t('os.snap.layouts', 'Snap layouts')} style={pos}
      onPointerEnter={() => onHover?.(true)} onPointerLeave={() => { onHover?.(false); light(null); }}>
      <div className="os-snapfly-grid" style={{ '--per-row': Math.min(PER_ROW, layouts.length) }}>
        {layouts.map((l, li) => (
          <div key={l.id} className={`os-snapfly-lay${hot?.startsWith(`${li}:`) ? ' is-hot' : ''}`} role="group" aria-label={t('os.snap.layout', 'Layout {n}').replace('{n}', String(li + 1))}>
            {l.zones.map((z, zi) => (
              <button key={targetKey(z)} type="button" data-l={li} data-z={zi}
                className={`os-snapfly-zone${hot === `${li}:${zi}` ? ' is-hot' : ''}`}
                style={{ left: `calc(${z.x * 100}% + 2px)`, top: `calc(${z.y * 100}% + 2px)`, width: `calc(${z.w * 100}% - 4px)`, height: `calc(${z.h * 100}% - 4px)` }}
                aria-label={zoneLabel(l, li, zi)}
                onPointerEnter={() => light(li, zi)} onFocus={() => light(li, zi)}
                onClick={() => onPick(z, l.id)} />
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
