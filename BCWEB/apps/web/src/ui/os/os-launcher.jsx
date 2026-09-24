// The start menu of the OS mode (M1, reworked by N-os), which is also its global search.
//
// WHAT IT LISTS
// Exactly the tabs SideDash was handed, grouped under the same headings. Nothing here decides
// who may see a screen: the dashboard built that list with its own permission rules, and a
// launcher that re-derived them would be the topbar-preview drift all over again. The pinned
// and recent rows are ids from the saved layout, drawn only when that tab is in the list today.
//
// One click opens (a screen is a button, not a file to select first). Right-click, the Menu
// key or Shift+F10 on a tile opens its menu: pin to start, pin to the taskbar, show or hide
// on the desktop. The arrow keys move between tiles.
//
// SEARCH
// Screens are ranked by the command palette's own matcher (ui/palette-search.js: synonyms,
// accents ignored, a typo forgiven), over the leaf label, its parent's label and the guide's
// keywords for that screen when the dashboard passes them. Below the screens, the dashboard's
// `remoteSearch` (the admin's /admin/search) finds the OBJECTS: accounts, repos, threads. A
// screen opens as a window; an object's link is followed, and when it points back into this
// dashboard (`?s=…`) the shell turns that into a window too.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, RotateCcw, XCircle, ChevronRight, Palette, Maximize, Minimize, PanelLeft, Pin, Clock3 } from 'lucide-react';
import { useI18n } from '../../i18n.jsx';
import { Badge } from '../ui.jsx';
import { buildIndex, searchIndex } from '../palette-search.js';
import { isMenuKey, menuPoint, spatialFocus } from './os-menu.jsx';

export const badgeOf = (tb) => (tb.badge || 0) + (tb.sub || []).reduce((a, lf) => a + (lf === tb || lf.id === tb.id ? 0 : (lf.badge || 0)), 0);

function AppTile({ tb, open, onOpen, onMenu, compact = false }) {
  const { t } = useI18n();
  const b = badgeOf(tb);
  return (
    <button type="button" className={compact ? 'os-lx-pin' : 'os-lx-app'} data-app={tb.id} onClick={() => onOpen(tb)}
      onContextMenu={(e) => { e.preventDefault(); onMenu(tb, menuPoint(e)); }}
      onKeyDown={(e) => { if (isMenuKey(e)) { e.preventDefault(); onMenu(tb, menuPoint(e)); } }}>
      <span className="os-lx-app-ic"><tb.icon size={compact ? 18 : 16} aria-hidden />{compact && b ? <span className="os-icon-badge">{b}</span> : null}</span>
      <span className={compact ? 'os-lx-pin-l' : 'min-w-0 truncate'} title={tb.label}>{tb.label}</span>
      {open && <span className="os-lx-dot" title={t('os.search.isopen', 'Already open: it will come to the front')} />}
      {!compact && b ? <Badge tone={tb.badgeKind === 'count' ? '' : 'primary'} className="ms-auto shrink-0" title={tb.badgeTitle || undefined}>{b}</Badge> : null}
    </button>
  );
}

export default function OsLauncher({ title, icon: Icon, sections, leaves, searchKeywords, remoteSearch, initialQuery = '', onOpenLeaf, onOpenHref, onClose, onExit, onReset, onCloseAll, openIds, pinned, recent, onAppMenu, onPersonalize, full, onFull }) {
  const { t } = useI18n();
  const [q, setQ] = useState(initialQuery);
  const [sel, setSel] = useState(0);
  const [remote, setRemote] = useState(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    // Escape inside a tile's menu closes that menu only (the menu listens on the same node, so
    // the order of registration would otherwise close both).
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.activeElement?.closest?.('.os-menu')) return;
      e.stopPropagation(); closeRef.current(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const index = useMemo(() => buildIndex(leaves.map((lf) => ({
    id: lf.id,
    title: lf.label,
    synonyms: `${lf.parent.label !== lf.label ? lf.parent.label : ''} ${searchKeywords?.[lf.id] || ''}`.trim(),
    leaf: lf,
  }))), [leaves, searchKeywords]);

  const query = q.trim();
  const hits = useMemo(() => (query ? searchIndex(index, query, { limit: 8 }).map((r) => r.item.leaf) : []), [index, query]);

  useEffect(() => {
    if (!remoteSearch || query.length < 2) { setRemote(null); return undefined; }
    let alive = true;
    setRemote(null);
    const h = setTimeout(() => {
      Promise.resolve(remoteSearch(query)).then((r) => { if (alive) setRemote(r?.groups || []); }).catch(() => { if (alive) setRemote([]); });
    }, 220);
    return () => { alive = false; clearTimeout(h); };
  }, [query, remoteSearch]);

  // One flat list for the arrow keys: the screens, then the objects.
  const rows = useMemo(() => {
    const out = hits.map((lf) => ({ key: `l:${lf.id}`, run: () => onOpenLeaf(lf.id) }));
    for (const g of remote || []) for (const it of g.items || []) out.push({ key: `r:${g.kind}:${it.id}`, run: () => onOpenHref(it.href) });
    return out;
  }, [hits, remote, onOpenLeaf, onOpenHref]);
  useEffect(() => { setSel(0); }, [query]);

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown' && !query) {
      // No query: the arrow walks into the tiles.
      const first = listRef.current?.querySelector('.os-lx-pin, .os-lx-app');
      if (first) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows.length) return;
      e.preventDefault();
      setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
    } else if (e.key === 'Enter' && rows[sel]) {
      e.preventDefault();
      rows[sel].run();
    }
  };
  useEffect(() => { listRef.current?.querySelector('[data-sel="1"]')?.scrollIntoView?.({ block: 'nearest' }); }, [sel]);
  const onBodyKey = (e) => {
    if (query) return;
    if (e.key === 'ArrowUp') {
      const all = [...(listRef.current?.querySelectorAll('.os-lx-pin, .os-lx-app') || [])];
      if (all[0] === document.activeElement) { e.preventDefault(); inputRef.current?.focus(); return; }
    }
    spatialFocus(e, listRef.current, '.os-lx-pin, .os-lx-app');
  };

  let n = -1;
  const rowProps = () => { n += 1; const on = n === sel; const i = n; return { 'data-sel': on ? '1' : undefined, className: `os-lx-row${on ? ' is-sel' : ''}`, onMouseEnter: () => setSel(i) }; };
  const openTab = (tb) => onOpenLeaf((tb.sub?.length ? tb.sub[0] : tb).id);

  return (
    <>
      <div className="os-scrim" aria-hidden onPointerDown={() => onClose(false)} />
      <div className="os-launcher" role="dialog" aria-modal="false" aria-label={t('os.start.label', 'Start menu and search')}>
        <div className="os-lx-head">
          {Icon && <span className="os-lx-logo"><Icon size={16} aria-hidden /></span>}
          <span className="font-semibold text-sm truncate" title={title}>{title}</span>
        </div>
        <div className="os-lx-search">
          <Search size={15} aria-hidden className="text-[var(--faint)] shrink-0" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKey}
            placeholder={remoteSearch ? t('os.search.ph.remote', 'Search a screen, an account, a repo…') : t('os.search.ph', 'Search a screen…')}
            aria-label={t('os.search', 'Search')} role="combobox" aria-expanded={!!query} aria-controls="os-lx-results" aria-autocomplete="list" />
        </div>
        <div ref={listRef} id="os-lx-results" className="os-lx-body scroll-thin" onKeyDown={onBodyKey}>
          {query ? (
            <>
              <div className="os-lx-h">{t('os.search.screens', 'Screens')}</div>
              {hits.length ? hits.map((lf) => (
                <button key={lf.id} type="button" {...rowProps()} onClick={() => onOpenLeaf(lf.id)}>
                  {lf.parent.icon && <lf.parent.icon size={15} aria-hidden className="shrink-0 text-[var(--accent-ink)]" />}
                  <span className="truncate" title={lf.label}>{lf.label}</span>
                  {lf.parent.label !== lf.label && <span className="os-lx-sub truncate" title={lf.parent.label}>{lf.parent.label}</span>}
                  {openIds.has(lf.parent.id) && <span className="os-lx-open" title={t('os.search.isopen', 'Already open: it will come to the front')}>{t('os.search.open', 'open')}</span>}
                </button>
              )) : <div className="os-lx-empty">{t('sd.nohit', 'Nothing by that name.')}</div>}
              {remoteSearch && query.length >= 2 && (
                remote === null ? <div className="os-lx-empty">{t('sd.remote.loading', 'Searching the data…')}</div>
                  : !remote.length ? <div className="os-lx-empty">{t('sd.remote.none', 'No account, repo, conversation or content by that name.')}</div>
                  : remote.map((g) => (
                    <div key={g.kind}>
                      <div className="os-lx-h">{t(`sd.remote.${g.kind}`, g.label)}</div>
                      {(g.items || []).map((it) => (
                        <button key={it.id} type="button" {...rowProps()} onClick={() => onOpenHref(it.href)}>
                          <ChevronRight size={14} aria-hidden className="shrink-0 text-[var(--faint)]" />
                          <span className="min-w-0">
                            <span className="block truncate" title={it.title}>{it.title}</span>
                            {it.sub && <span className="block text-[11px] text-[var(--faint)] truncate" title={it.sub}>{it.sub}</span>}
                          </span>
                        </button>
                      ))}
                    </div>
                  ))
              )}
            </>
          ) : (
            <>
              <div className="os-lx-h os-lx-h-row"><Pin size={11} aria-hidden /> {t('os.start.pinned', 'Pinned')}</div>
              {pinned.length ? (
                <div className="os-lx-pins" role="group" aria-label={t('os.start.pinned', 'Pinned')}>
                  {pinned.map((tb) => <AppTile key={tb.id} tb={tb} compact open={openIds.has(tb.id)} onOpen={openTab} onMenu={onAppMenu} />)}
                </div>
              ) : <div className="os-lx-empty">{t('os.start.pinned.none', 'Right-click a screen below, then "Pin to start", to keep it here.')}</div>}
              {recent.length > 0 && (
                <>
                  <div className="os-lx-h os-lx-h-row"><Clock3 size={11} aria-hidden /> {t('os.start.recent', 'Recent')}</div>
                  <div className="os-lx-grid" role="group" aria-label={t('os.start.recent', 'Recent')}>
                    {recent.map((tb) => <AppTile key={tb.id} tb={tb} open={openIds.has(tb.id)} onOpen={openTab} onMenu={onAppMenu} />)}
                  </div>
                </>
              )}
              {sections.map((sec, i) => (
                <div key={sec.heading || `s-${i}`}>
                  <div className="os-lx-h">{sec.heading || t('os.start.all', 'All screens')}</div>
                  <div className="os-lx-grid" role="group" aria-label={sec.heading || t('os.start.all', 'All screens')}>
                    {sec.items.map((tb) => <AppTile key={tb.id} tb={tb} open={openIds.has(tb.id)} onOpen={openTab} onMenu={onAppMenu} />)}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="os-lx-foot">
          <div className="os-lx-actions">
            <button type="button" className="os-lx-act" onClick={onPersonalize}><Palette size={14} aria-hidden /> {t('os.pz.t', 'Personalise')}</button>
            <button type="button" className="os-lx-act" onClick={onFull}>{full ? <Minimize size={14} aria-hidden /> : <Maximize size={14} aria-hidden />} {full ? t('os.full.exit', 'Exit fullscreen') : t('os.full.enter', 'Fullscreen')}</button>
            <button type="button" className="os-lx-act" onClick={onCloseAll}><XCircle size={14} aria-hidden /> {t('os.closeall', 'Close all windows')}</button>
            <button type="button" className="os-lx-act" onClick={onReset}><RotateCcw size={14} aria-hidden /> {t('os.reset', 'Reset layout')}</button>
          </div>
          <button type="button" className="os-lx-act os-lx-exit" onClick={onExit}><PanelLeft size={14} aria-hidden /> {t('os.classic', 'Classic mode')}</button>
        </div>
      </div>
    </>
  );
}
