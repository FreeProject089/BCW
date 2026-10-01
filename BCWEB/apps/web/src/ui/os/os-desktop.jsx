// The desktop's icons (agent-bcw-os): select them, move them on a grid, drop them into folders
// or onto a taskbar group, and the folder window's contents.
//
// SELECT, THEN OPEN
// With a mouse, a click selects (Ctrl/Cmd toggles, Shift takes a range) and a double click opens,
// like every desktop; a press on the empty desktop draws a rubber band. A touch or a pen opens
// with one tap (there is no double tap to learn and no band to draw on a finger). The keyboard
// opens with Enter, selects with Space (Ctrl+Space adds), Ctrl+A selects all, Escape clears,
// F2 renames a folder, the arrows move between icons.
//
// MOVE
// Dragging moves the whole selection; it snaps to the grid on release (desk.js dropIcons) and
// the cells are saved with the rest of the layout, per account. The icons move by `transform`
// while the pointer is down and ONE action is dispatched at the end, like the windows do.
//
// DROP TARGETS
// Anything carrying `data-drop-folder="<id>"` (a folder icon, a folder window) or
// `data-drop-group="<id>"` (a taskbar group) takes the screens dropped on it. A folder never
// takes a folder.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Folder, FolderOpen, Pencil, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n.jsx';
import { isMenuKey, menuPoint, spatialFocus } from './os-menu.jsx';
import { cellAt, cellPx, dropIcons, idsInBand, bandRect, selectClick, isFolderId } from './desk.js';

/** What a folder window needs from the shell (its body is rendered far from the shell's state). */
export const DeskCtx = createContext(null);

const DRAG_START = 5;

/** The drop target under a point, ignoring the dragged elements (pointer-events are off on them). */
function dropTargetAt(x, y, skip) {
  const el = document.elementFromPoint(x, y);
  const t = el?.closest?.('[data-drop-folder], [data-drop-group]');
  if (!t) return { el, target: null };
  const fid = t.getAttribute('data-drop-folder');
  if (fid && skip.has(fid)) return { el, target: null };
  return { el, target: t };
}

/** Is a point on the bare desktop (not on a window, the taskbar or a popup)? */
function onBareDesk(el, desk) {
  return !!el && !!desk && desk.contains(el) && !el.closest('.os-win, .os-assist');
}

function Label({ item, renaming, onRename }) {
  const ref = useRef(null);
  const [v, setV] = useState(item.label);
  useEffect(() => { if (renaming) { setV(item.label); setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 0); } }, [renaming]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!renaming) return <span className="os-icon-label">{item.label}</span>;
  return (
    <input ref={ref} className="os-icon-rename" value={v} maxLength={40} aria-label={item.label}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); onRename(item.id, v); }
        if (e.key === 'Escape') { e.preventDefault(); onRename(item.id, null); }
      }}
      onBlur={() => onRename(item.id, v)} />
  );
}

/**
 * items: [{ id, label, icon, badge, open, folder, count }] in display order.
 * placed: Map id → { c, r }; cell: { w, h }; dims: { cols, rows }.
 */
export function DesktopIcons({ items, placed, cell, dims, sel, setSel, deskRef, listRef, renaming, onRename, onOpen, onMenu, onMove, onDropFolder, onDropGroup }) {
  const { t } = useI18n();
  const anchor = useRef(null);
  const [band, setBand] = useState(null);
  const order = items.map((it) => it.id);
  const itemsRef = useRef(items); itemsRef.current = items;

  // ── Rubber band on the empty desktop ──
  const onListDown = (e) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const desk = deskRef.current;
    if (!desk) return;
    const d = desk.getBoundingClientRect();
    const x0 = e.clientX - d.left; const y0 = e.clientY - d.top;
    const add = e.ctrlKey || e.metaKey || e.shiftKey;
    const base = add ? sel : [];
    let moved = false;
    const boxes = order.map((id) => { const p = cellPx(placed.get(id), cell); return { id, x: p.x, y: p.y, w: cell.w - 4, h: cell.h - 4 }; });
    const move = (ev) => {
      const x1 = ev.clientX - d.left; const y1 = ev.clientY - d.top;
      if (!moved && Math.abs(x1 - x0) + Math.abs(y1 - y0) < DRAG_START) return;
      moved = true;
      const r = bandRect(x0, y0, x1, y1);
      setBand(r);
      setSel([...new Set([...base, ...idsInBand(boxes, r)])]);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setBand(null);
      if (!moved && !add) setSel([]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // ── Press on an icon: select, drag, or (touch) open ──
  const onIconDown = (item) => (e) => {
    if (e.button !== 0) return;
    const ctrl = e.ctrlKey || e.metaKey; const shift = e.shiftKey;
    const touch = e.pointerType && e.pointerType !== 'mouse';
    if (!touch && !ctrl && !shift && !sel.includes(item.id)) { setSel([item.id]); anchor.current = item.id; }
    const sx = e.clientX; const sy = e.clientY;
    const list = listRef.current;
    let dragging = false; let ids = []; let els = []; let over = null;
    const move = (ev) => {
      const dx = ev.clientX - sx; const dy = ev.clientY - sy;
      if (!dragging) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_START) return;
        dragging = true;
        ids = sel.includes(item.id) ? order.filter((id) => sel.includes(id)) : [item.id];
        if (!sel.includes(item.id)) setSel([item.id]);
        els = ids.map((id) => list?.querySelector(`[data-icon="${CSS.escape(id)}"]`)).filter(Boolean);
        els.forEach((el) => el.classList.add('is-dragging'));
      }
      els.forEach((el) => { el.style.transform = `translate(${dx}px, ${dy}px)`; });
      const { target } = dropTargetAt(ev.clientX, ev.clientY, new Set(ids));
      if (target !== over) { over?.classList.remove('is-drop'); over = target; over?.classList.add('is-drop'); }
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      over?.classList.remove('is-drop');
      if (!dragging) {
        if (ev.type === 'pointercancel') return;
        if (touch) { onOpen(item.id); return; }
        const r = selectClick(sel, item.id, order, { ctrl, shift, anchor: anchor.current });
        if (!ctrl && !shift && sel.length > 1 && sel.includes(item.id)) { setSel([item.id]); anchor.current = item.id; return; }
        setSel(r.sel); anchor.current = r.anchor;
        return;
      }
      els.forEach((el) => { el.style.transform = ''; el.classList.remove('is-dragging'); });
      if (ev.type === 'pointercancel') return;
      const dx = ev.clientX - sx; const dy = ev.clientY - sy;
      const { el, target } = dropTargetAt(ev.clientX, ev.clientY, new Set(ids));
      const screens = ids.filter((id) => !isFolderId(id));
      if (target?.hasAttribute('data-drop-folder')) { if (screens.length) onDropFolder(target.getAttribute('data-drop-folder'), screens); return; }
      if (target?.hasAttribute('data-drop-group')) { if (screens.length) onDropGroup(target.getAttribute('data-drop-group'), screens); return; }
      if (!onBareDesk(el, deskRef.current)) return;
      const p = cellPx(placed.get(item.id), cell);
      const at = cellAt(p.x + dx + cell.w / 2, p.y + dy + cell.h / 2, cell, dims);
      onMove(dropIcons(placed, ids, item.id, at, dims));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const onKey = (e) => {
    const id = e.target?.closest?.('[data-icon]')?.getAttribute('data-icon');
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); setSel(order); return; }
    if (e.key === 'Escape' && sel.length) { e.preventDefault(); setSel([]); return; }
    if (!id) return;
    if (e.key === ' ') {
      e.preventDefault();
      const r = selectClick(sel, id, order, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, anchor: anchor.current });
      setSel(r.sel); anchor.current = r.anchor;
      return;
    }
    if (e.key === 'F2' && isFolderId(id)) { e.preventDefault(); onRename(id, undefined); return; }
    if (spatialFocus(e, listRef.current, '.os-icon') && e.shiftKey) {
      const to = document.activeElement?.closest?.('[data-icon]')?.getAttribute('data-icon');
      if (to) setSel((s) => [...new Set([...s, id, to])]);
    }
  };

  // Keep the selection to icons that still exist (a folder deleted, an icon hidden).
  useEffect(() => {
    const live = new Set(items.map((it) => it.id));
    if (sel.some((id) => !live.has(id))) setSel((s) => s.filter((id) => live.has(id)));
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const selSet = new Set(sel);
  return (
    <>
      <ul ref={listRef} className="os-icons" role="listbox" aria-multiselectable="true" aria-label={t('os.desktop', 'Desktop')}
        onPointerDown={onListDown} onKeyDown={onKey}>
        {items.map((it) => {
          const p = cellPx(placed.get(it.id) || { c: 0, r: 0 }, cell);
          const on = selSet.has(it.id);
          const Icon = it.folder ? (it.count ? FolderOpen : Folder) : it.icon;
          const isRen = renaming === it.id;
          return (
            <li key={it.id} className="os-icon-cell" style={{ left: p.x, top: p.y, width: cell.w - 4 }} data-icon={it.id}
              {...(it.folder ? { 'data-drop-folder': it.id } : {})}>
              <button type="button" role="option" aria-selected={on}
                className={`os-icon${it.open ? ' is-open' : ''}${on ? ' is-sel' : ''}${it.folder ? ' is-folder' : ''}`}
                onPointerDown={onIconDown(it)}
                onDoubleClick={(e) => { if (!e.ctrlKey && !e.shiftKey && !e.metaKey) onOpen(it.id); }}
                onClick={(e) => { if (e.detail === 0) onOpen(it.id); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!selSet.has(it.id)) setSel([it.id]); onMenu(it.id, menuPoint(e)); }}
                onKeyDown={(e) => { if (isMenuKey(e)) { e.preventDefault(); if (!selSet.has(it.id)) setSel([it.id]); onMenu(it.id, menuPoint(e)); } }}
                title={it.folder ? `${it.label} (${it.count})` : it.label}>
                <span className={`os-icon-tile${it.folder ? ' os-icon-folder' : ''}`}>
                  {Icon ? <Icon size={22} aria-hidden /> : null}
                  {it.badge ? <span className="os-icon-badge">{it.badge}</span> : null}
                </span>
                {!isRen && <span className="os-icon-label">{it.label}</span>}
              </button>
              {isRen && <Label item={it} renaming onRename={onRename} />}
            </li>
          );
        })}
      </ul>
      {band && <div className="os-band" aria-hidden style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
    </>
  );
}

// ── The folder window ─────────────────────────────────────────────────────────────

/** The body of a folder's window: its screens, one click opens, drag one out to the desktop. */
export function FolderView({ fid }) {
  const { t } = useI18n();
  const ctx = useContext(DeskCtx);
  const [ghost, setGhost] = useState(null); // { id, x, y }
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const folder = ctx?.folders.find((f) => f.id === fid);
  if (!ctx || !folder) return <p className="text-sm text-[var(--muted)]">{t('os.fold.gone', 'This folder no longer exists.')}</p>;
  const tabs = folder.items.map((id) => ctx.tabById.get(id)).filter(Boolean);

  const onDown = (tb) => (e) => {
    if (e.button !== 0) return;
    const sx = e.clientX; const sy = e.clientY;
    let dragging = false; let over = null;
    const skip = new Set([fid]);
    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < DRAG_START) return;
      dragging = true;
      setGhost({ id: tb.id, x: ev.clientX, y: ev.clientY });
      const { target } = dropTargetAt(ev.clientX, ev.clientY, skip);
      if (target !== over) { over?.classList.remove('is-drop'); over = target; over?.classList.add('is-drop'); }
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      over?.classList.remove('is-drop');
      setGhost(null);
      if (!dragging) { if (ev.type !== 'pointercancel') ctx.openTab(tb.id); return; }
      if (ev.type === 'pointercancel') return;
      const { el, target } = dropTargetAt(ev.clientX, ev.clientY, skip);
      if (target?.hasAttribute('data-drop-folder')) { ctx.moveToFolder(target.getAttribute('data-drop-folder'), [tb.id]); return; }
      if (target?.hasAttribute('data-drop-group')) { ctx.dropGroup(target.getAttribute('data-drop-group'), [tb.id]); return; }
      if (!onBareDesk(el, ctx.deskRef.current)) return;
      const d = ctx.deskRef.current.getBoundingClientRect();
      ctx.outOfFolder(fid, [tb.id], cellAt(ev.clientX - d.left, ev.clientY - d.top, ctx.cell, ctx.dims));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const commit = () => { setRenaming(false); ctx.renameFolder(fid, name); };
  const Ghost = ghost && ctx.tabById.get(ghost.id);

  return (
    <div className="os-fold" data-drop-folder={fid}>
      <div className="os-fold-bar">
        {renaming ? (
          <input className="os-fold-name-in" value={name} maxLength={40} autoFocus aria-label={t('os.fold.rename', 'Rename')}
            onChange={(e) => setName(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); } }} />
        ) : <span className="os-fold-name" aria-hidden />}
        <span className="os-fold-count">{tabs.length}</span>
        <button type="button" className="os-fold-act" onClick={() => { setName(folder.name); setRenaming(true); }} title={t('os.fold.rename', 'Rename')} aria-label={t('os.fold.rename', 'Rename')}><Pencil size={14} aria-hidden /></button>
        <button type="button" className="os-fold-act is-danger" onClick={() => ctx.deleteFolder(fid)} title={t('os.fold.delete', 'Delete the folder')} aria-label={t('os.fold.delete', 'Delete the folder')}><Trash2 size={14} aria-hidden /></button>
      </div>
      {tabs.length ? (
        <ul className="os-fold-grid" onKeyDown={(e) => spatialFocus(e, e.currentTarget, 'button')}>
          {tabs.map((tb) => (
            <li key={tb.id}>
              <button type="button" className="os-fold-item" onPointerDown={onDown(tb)} onClick={(e) => { if (e.detail === 0) ctx.openTab(tb.id); }}
                onContextMenu={(e) => { e.preventDefault(); ctx.itemMenu(fid, tb, menuPoint(e)); }}
                onKeyDown={(e) => { if (isMenuKey(e)) { e.preventDefault(); ctx.itemMenu(fid, tb, menuPoint(e)); } }}
                title={tb.label}>
                <span className="os-icon-tile"><tb.icon size={20} aria-hidden /></span>
                <span className="os-fold-l">{tb.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="os-fold-empty">{t('os.fold.empty', 'Empty. Drag icons here.')}</p>}
      {Ghost && createPortal(
        <div className="os-drag-ghost" aria-hidden style={{ left: ghost.x, top: ghost.y }}><Ghost.icon size={18} /><span>{Ghost.label}</span></div>,
        document.body,
      )}
    </div>
  );
}
