// A taskbar group (agent-bcw-os): several screens behind ONE taskbar button, with a popover that
// lists them. The group stays on the taskbar whether its screens are open or not (a pinned
// group); the windows of its screens are not drawn as separate taskbar buttons.
//
// Made from a taskbar button's menu ("Add to a group"), from a pinned screen's menu, from the
// desktop's selection menu, or by dropping desktop icons on the group's button. The popover
// opens a screen (or brings it to the front), opens them all side by side, minimises the open
// ones, renames the group and ungroups it. Keyboard: Enter/Space opens the popover, arrows move
// in it, Escape closes it; the Menu key / Shift+F10 on the button opens its menu.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers, LayoutDashboard, Minus, Pencil, Ungroup, X } from 'lucide-react';
import { useI18n } from '../../i18n.jsx';
import { isMenuKey, menuPoint } from './os-menu.jsx';

function GroupPop({ anchor, group, members, openIds, activeId, top, onClose, onOpen, onOpenAll, onMinAll, onRename, onRemove, onUngroup }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: anchor.left, top: -9999 });
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const closeRef = useRef(onClose); closeRef.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(6, Math.min(anchor.left, window.innerWidth - r.width - 6));
    const y = top ? anchor.bottom + 8 : anchor.top - r.height - 8;
    setPos({ left, top: Math.max(6, y) });
  }, [anchor.left, anchor.top, anchor.bottom, top, members.length, renaming]);

  useEffect(() => {
    ref.current?.querySelector('.os-grp-item')?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(true); return; }
      if (!['ArrowDown', 'ArrowUp'].includes(e.key) || !ref.current?.contains(document.activeElement)) return;
      e.preventDefault();
      const all = [...ref.current.querySelectorAll('button:not([disabled])')];
      const i = all.indexOf(document.activeElement);
      all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
    };
    const onDown = (e) => { if (!ref.current?.contains(e.target) && !e.target.closest?.(`[data-group-btn="${group.id}"]`)) closeRef.current(false); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCount = members.filter((m) => openIds.has(m.id)).length;
  const commit = () => { setRenaming(false); onRename(name); };
  return createPortal(
    <div ref={ref} className="os-grp-pop" role="dialog" aria-label={group.name} style={pos}>
      <div className="os-grp-head">
        <Layers size={14} className="text-[var(--accent-ink)] shrink-0" aria-hidden />
        {renaming ? (
          <input className="os-grp-name-in" value={name} maxLength={40} autoFocus aria-label={t('os.grp.rename', 'Rename the group')}
            onChange={(e) => setName(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenaming(false); } }} />
        ) : <span className="os-grp-name" title={group.name}>{group.name}</span>}
        <button type="button" className="os-grp-ic" onClick={() => { setName(group.name); setRenaming(true); }} title={t('os.grp.rename', 'Rename the group')} aria-label={t('os.grp.rename', 'Rename the group')}><Pencil size={13} aria-hidden /></button>
      </div>
      <ul className="os-grp-list">
        {members.map((m) => {
          const open = openIds.has(m.id);
          return (
            <li key={m.id} className="os-grp-row">
              <button type="button" className={`os-grp-item${m.id === activeId ? ' is-on' : ''}`} onClick={() => onOpen(m)} title={m.label}>
                <m.icon size={15} aria-hidden className="shrink-0" />
                <span className="os-grp-l">{m.label}</span>
                {open && <span className="os-grp-dot" title={t('os.grp.isopen', 'Open')} />}
              </button>
              <button type="button" className="os-grp-x" onClick={() => onRemove(m)} title={t('os.grp.remove', 'Take out of the group')} aria-label={`${t('os.grp.remove', 'Take out of the group')}: ${m.label}`}><X size={13} aria-hidden /></button>
            </li>
          );
        })}
      </ul>
      <div className="os-grp-foot">
        <button type="button" className="os-grp-act" onClick={onOpenAll}><LayoutDashboard size={13} aria-hidden /> {t('os.grp.openall', 'Open side by side')}</button>
        <button type="button" className="os-grp-act" disabled={!openCount} onClick={onMinAll}><Minus size={13} aria-hidden /> {t('os.grp.minall', 'Minimise')}</button>
        <button type="button" className="os-grp-act" onClick={onUngroup}><Ungroup size={13} aria-hidden /> {t('os.grp.ungroup', 'Ungroup')}</button>
      </div>
    </div>,
    document.body,
  );
}

/** The taskbar button of a group, and its popover. */
export function TaskGroup({ group, members, openIds, activeId, top, onOpen, onOpenAll, onMinAll, onRename, onRemove, onUngroup, onMenu }) {
  const { t } = useI18n();
  const btn = useRef(null);
  const [pop, setPop] = useState(null); // null | anchor rect
  const openCount = members.filter((m) => openIds.has(m.id)).length;
  const on = members.some((m) => m.id === activeId);
  const close = (refocus) => { setPop(null); if (refocus) btn.current?.focus(); };
  const toggle = () => {
    if (pop) { setPop(null); return; }
    const r = btn.current.getBoundingClientRect();
    setPop({ left: r.left, top: r.top, bottom: r.bottom });
  };
  const label = `${group.name}, ${t('os.grp.count', '{n} screens, {o} open').replace('{n}', String(members.length)).replace('{o}', String(openCount))}`;
  const run = (fn) => (...a) => { close(false); fn(...a); };
  return (
    <>
      <button ref={btn} type="button" data-group-btn={group.id} data-drop-group={group.id}
        className={`os-task os-task-grp${on ? ' is-on' : ''}${openCount ? '' : ' is-min'}`}
        aria-haspopup="dialog" aria-expanded={!!pop} title={label} aria-label={label}
        onClick={toggle}
        onContextMenu={(e) => { e.preventDefault(); onMenu(menuPoint(e)); }}
        onKeyDown={(e) => { if (isMenuKey(e)) { e.preventDefault(); onMenu(menuPoint(e)); } }}>
        <span className="os-grp-stack" aria-hidden>
          {members.slice(0, 3).map((m) => <span key={m.id} className="os-grp-stack-i"><m.icon size={12} /></span>)}
        </span>
        <span className="os-task-l">{group.name}</span>
        {openCount > 0 && <span className="os-grp-n" aria-hidden>{openCount}</span>}
      </button>
      {pop && (
        <GroupPop anchor={pop} group={group} members={members} openIds={openIds} activeId={activeId} top={top} onClose={close}
          onOpen={run(onOpen)} onOpenAll={run(onOpenAll)} onMinAll={run(onMinAll)} onRename={onRename} onRemove={onRemove} onUngroup={run(onUngroup)} />
      )}
    </>
  );
}
