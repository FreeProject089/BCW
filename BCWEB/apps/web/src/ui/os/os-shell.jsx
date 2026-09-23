// The OS mode of the dashboards (M1): a desktop, windows, a taskbar and a start menu, over
// the SAME screens SideDash shows. Loaded lazily by SideDash (pages/pages.jsx) only when the
// mode is on and the screen is at least 768px wide, so none of this is in the entry chunk.
//
// NOT AN OS SIMULATION
// Every window is a real dashboard screen, rendered by the very function SideDash renders
// its content column with (`render(leafId)`, the page's `(s) => …` children). There are no
// "apps" of the shell's own, no file system, nothing that is not already a tab. Permissions
// are therefore exactly the nav's: the launcher, the desktop and the windows are all built
// from the `tabs` array the dashboard handed SideDash, and a window restored from storage
// for a tab that is not in that array today is simply not drawn.
//
// THE URL IS STILL THE NAVIGATION
// `?s=<leaf>` follows the focused window, and a change of `?s=` from anywhere (a link inside a
// screen, the command palette, the back button, a deep link opened in a new tab) opens or
// focuses that screen's window. So every existing link into the dashboards keeps working, and
// switching back to the classic mode lands on the screen that was in front.
//
// STATE
// The window manager is the pure reducer in wm.js. The layout (open windows, geometry, which
// one is in front) is kept per account and per dashboard in localStorage, and can be reset
// from the start menu. Minimised windows beyond six mounted are unmounted, oldest first
// (wm.js mountedIds); the taskbar says so on the ones that were.

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LayoutGrid, Search, Monitor, AppWindow } from 'lucide-react';
import { useI18n } from '../../i18n.jsx';
import { useDialog } from '../ui.jsx';
import { useShortcutHandlers } from '../shortcuts.jsx';
import { confirmLeave } from '../../lib/leave-guard.js';
import { reduce, initialState, mountedIds, serialize, rectForZone, MAX_MOUNTED } from './wm.js';
import { layoutKey, clearOsLayout, useOsMode } from './os-mode.jsx';
import OsWindow from './os-window.jsx';
import OsLauncher, { badgeOf } from './os-launcher.jsx';
import './os.css';

const TASKBAR_H = 48;

function headerH() {
  try { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 68; } catch { return 68; }
}

function readLayout(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function Clock() {
  const { lang } = useI18n();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const h = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(h); }, []);
  let text = '';
  try { text = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(now); } catch { text = now.toTimeString().slice(0, 5); }
  return <time className="os-clock" dateTime={now.toISOString()}>{text}</time>;
}

export default function OsShell({ scope, title, icon: Icon, tabs, render, searchKeywords = null, remoteSearch = null }) {
  const { t } = useI18n();
  const dialog = useDialog();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const mode = useOsMode(scope);
  const key = layoutKey(scope, mode.uid);

  // The nav, exactly as SideDash reads it.
  const realTabs = useMemo(() => tabs.filter((tb) => tb.id), [tabs]);
  const leaves = useMemo(() => realTabs.flatMap((tb) => (tb.sub?.length ? tb.sub : [tb]).map((lf) => ({ ...lf, parent: tb }))), [realTabs]);
  const tabById = useMemo(() => new Map(realTabs.map((tb) => [tb.id, tb])), [realTabs]);
  const leafById = useMemo(() => new Map(leaves.map((lf) => [lf.id, lf])), [leaves]);
  const sections = useMemo(() => {
    const out = [];
    for (const tb of tabs) {
      if (tb.heading) out.push({ heading: tb.heading, items: [] });
      else if (tb.id) { if (!out.length) out.push({ heading: null, items: [] }); out[out.length - 1].items.push(tb); }
    }
    return out.filter((s) => s.items.length);
  }, [tabs]);

  const urlLeaf = sp.get('s');
  const [state, dispatch] = useReducer(reduce, null, () => {
    const vp = { w: typeof window !== 'undefined' ? window.innerWidth : 1280, h: typeof window !== 'undefined' ? window.innerHeight - headerH() - TASKBAR_H : 700 };
    let s = initialState(vp);
    const saved = readLayout(key);
    if (saved) s = reduce(s, { type: 'hydrate', saved });
    // A deep link wins over the saved layout: it is what the person just asked for.
    const lf = urlLeaf && leafById.get(urlLeaf);
    if (lf) s = reduce(s, { type: 'open', id: lf.parent.id, leaf: lf.id });
    return s;
  });

  // Only windows whose tab exists for this person, today.
  const wins = useMemo(() => state.wins.filter((w) => tabById.has(w.id)), [state.wins, tabById]);
  const activeWin = wins.find((w) => w.id === state.active && w.mode !== 'min') || null;
  const mounted = useMemo(() => mountedIds({ ...state, wins }, MAX_MOUNTED), [state, wins]);
  const openIds = useMemo(() => new Set(wins.map((w) => w.id)), [wins]);
  const leafFor = (w) => leafById.get(w.leaf)?.parent?.id === w.id ? leafById.get(w.leaf) : leafById.get((tabById.get(w.id)?.sub?.[0] || tabById.get(w.id))?.id);

  // ── The page around the shell ──────────────────────────────────────────────
  // The shell takes the viewport under the topbar; the page behind it must not scroll. A
  // layout effect, declared BEFORE the measurement below: hiding the page's scrollbar widens
  // the desktop, and a background tab never reports that through a ResizeObserver.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-os-shell', scope);
    try { window.scrollTo(0, 0); } catch { /* jsdom */ }
    return () => root.removeAttribute('data-os-shell');
  }, [scope]);

  // ── Desktop size ───────────────────────────────────────────────────────────
  const deskRef = useRef(null);
  useLayoutEffect(() => {
    const el = deskRef.current;
    if (!el) return undefined;
    const measure = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) dispatch({ type: 'viewport', w: r.width, h: r.height }); };
    measure();
    // A resize listener as well as the observer: a background tab gets no observer callbacks.
    window.addEventListener('resize', measure);
    let ro = null;
    try { ro = new ResizeObserver(measure); ro.observe(el); } catch { /* old browser: the listener covers it */ }
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, []);

  // ── Persistence ────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(serialize(state))); } catch { /* private window: this session only */ }
    }, 250);
    return () => clearTimeout(h);
  }, [state.wins, state.active, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── URL ⇄ windows ──────────────────────────────────────────────────────────
  // In: a `?s=` from anywhere opens or focuses that screen's window.
  const tabsKey = realTabs.map((tb) => tb.id).join(',');
  useEffect(() => {
    const lf = urlLeaf && leafById.get(urlLeaf);
    if (!lf) return;
    const w = state.wins.find((x) => x.id === lf.parent.id);
    if (w && state.active === w.id && w.mode !== 'min' && w.leaf === lf.id) return;
    dispatch({ type: 'open', id: lf.parent.id, leaf: lf.id });
  }, [urlLeaf, tabsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Out: the address bar follows the window in front (replace, so Back leaves the dashboard
  // instead of walking through every focus change).
  const frontLeaf = activeWin ? (leafFor(activeWin)?.id || null) : null;
  useEffect(() => {
    // A leaf this person does not have (yet: the dashboard adds some tabs after a fetch) is
    // left alone, so the window opens once the tab appears.
    if (urlLeaf && !leafById.has(urlLeaf)) return;
    if ((urlLeaf || null) === frontLeaf) return;
    setSp((p) => { const n = new URLSearchParams(p); if (frontLeaf) n.set('s', frontLeaf); else n.delete('s'); return n; }, { replace: true });
  }, [frontLeaf]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Focus follows the front window ─────────────────────────────────────────
  const els = useRef(new Map());
  const registerEl = useCallback((id, el) => { if (el) els.current.set(id, el); else els.current.delete(id); }, []);
  useEffect(() => {
    const el = state.active && els.current.get(state.active);
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [state.active]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const [launcher, setLauncher] = useState(null); // null | { q }
  const startRef = useRef(null);
  const closeLauncher = useCallback((refocus) => { setLauncher(null); if (refocus) startRef.current?.focus(); }, []);
  const openLeaf = useCallback((leafId) => {
    const lf = leafById.get(leafId);
    if (!lf) return;
    setLauncher(null);
    dispatch({ type: 'open', id: lf.parent.id, leaf: lf.id });
  }, [leafById]);
  const openHref = useCallback((href) => {
    setLauncher(null);
    if (/^https?:/i.test(href || '')) window.open(href, '_blank', 'noopener');
    else if (href) navigate(href);
  }, [navigate]);
  const setLeaf = useCallback((id, leafId) => dispatch({ type: 'open', id, leaf: leafId }), []);
  const closeWin = useCallback(async (id) => {
    // An editor with unsaved changes asks first, like switching section does in the classic
    // mode: closing the window unmounts it.
    if (!(await confirmLeave())) return;
    dispatch({ type: 'close', id });
  }, []);
  const resetLayout = async () => {
    setLauncher(null);
    const ok = await dialog.confirm({
      title: t('os.reset.t', 'Reset the layout?'),
      message: t('os.reset.m', 'Every window of this dashboard closes and the saved positions are forgotten. Nothing on the site changes.'),
      okLabel: t('os.reset', 'Reset layout'),
    });
    if (!ok || !(await confirmLeave())) return;
    clearOsLayout(scope, mode.uid);
    dispatch({ type: 'reset' });
  };
  const closeAll = async () => {
    setLauncher(null);
    if (!(await confirmLeave())) return;
    dispatch({ type: 'closeAll' });
  };
  const exit = () => { setLauncher(null); mode.set(false); };

  const order = wins.map((w) => w.id);
  useShortcutHandlers({
    'os.launcher': () => setLauncher((l) => (l ? null : { q: '' })),
    'os.next': () => dispatch({ type: 'cycle', dir: 1, order }),
    'os.prev': () => dispatch({ type: 'cycle', dir: -1, order }),
  });

  const [snapPreview, setSnapPreview] = useState(null);
  const preview = snapPreview ? rectForZone(snapPreview, state.vp) : null;
  const lastPointer = useRef('mouse');
  const wall = mode.wallpaper;

  return (
    <div className="os-shell" data-wallpaper={wall} style={{ '--os-taskbar-h': `${TASKBAR_H}px` }}>
      <div className="os-desktop" ref={deskRef}>
        <ul className="os-icons" aria-label={t('os.desktop', 'Desktop')}>
          {realTabs.map((tb) => {
            const b = badgeOf(tb);
            return (
              <li key={tb.id}>
                <button type="button" className="os-icon"
                  onPointerDown={(e) => { lastPointer.current = e.pointerType; }}
                  // Double-click opens, like a desktop; a touch, a pen or the keyboard (detail 0)
                  // opens on the first activation, since there is no double-click to learn there.
                  onClick={(e) => { if (e.detail === 0 || lastPointer.current !== 'mouse') openLeaf((tb.sub?.[0] || tb).id); }}
                  onDoubleClick={() => openLeaf((tb.sub?.[0] || tb).id)}
                  title={t('os.icon.tip', 'Double-click to open')}>
                  <span className="os-icon-tile"><tb.icon size={22} aria-hidden />{b ? <span className="os-icon-badge">{b}</span> : null}</span>
                  <span className="os-icon-label">{tb.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {!wins.some((w) => w.mode !== 'min') && (
          <div className="os-hint" aria-hidden>
            <AppWindow size={18} className="text-[var(--accent-ink)]" />
            <span>{t('os.hint', 'Double-click an icon, or open the start menu, to put a screen in a window.')}</span>
          </div>
        )}

        {wins.map((w) => (
          <OsWindow key={w.id} win={w} tab={tabById.get(w.id)} leaf={leafFor(w)} active={activeWin?.id === w.id}
            mounted={mounted.has(w.id)} vp={state.vp} deskRef={deskRef} dispatch={dispatch} render={render}
            onLeaf={setLeaf} onClose={closeWin} onSnapPreview={setSnapPreview} registerEl={registerEl} />
        ))}

        {preview && <div className="os-snap-preview" aria-hidden style={{ left: preview.x, top: preview.y, width: preview.w, height: preview.h }} />}
      </div>

      <nav className="os-taskbar" aria-label={t('os.taskbar', 'Taskbar')}>
        <button ref={startRef} type="button" className={`os-start${launcher ? ' is-on' : ''}`} aria-haspopup="dialog" aria-expanded={!!launcher}
          onClick={() => setLauncher((l) => (l ? null : { q: '' }))}>
          {Icon ? <Icon size={16} aria-hidden /> : <LayoutGrid size={16} aria-hidden />}
          <span className="os-start-label">{t('os.start', 'Start')}</span>
        </button>
        <button type="button" className="os-searchbtn" onClick={() => setLauncher({ q: '' })} aria-label={t('os.search', 'Search')}>
          <Search size={14} aria-hidden /> <span className="truncate">{t('os.search.btn', 'Search…')}</span>
        </button>
        <ul className="os-tasks" aria-label={t('os.tasks', 'Open windows')}>
          {wins.map((w) => {
            const tb = tabById.get(w.id);
            const lf = leafFor(w);
            const dormant = w.mode === 'min' && !mounted.has(w.id);
            const on = activeWin?.id === w.id;
            const tip = dormant
              ? t('os.task.dormant', 'Unloaded to save memory: more than six windows were open. It reloads when you open it, and what was not saved is lost.')
              : (lf && lf.label !== tb.label ? `${tb.label} · ${lf.label}` : tb.label);
            return (
              <li key={w.id}>
                <button type="button" className={`os-task${on ? ' is-on' : ''}${w.mode === 'min' ? ' is-min' : ''}${dormant ? ' is-dormant' : ''}`}
                  aria-pressed={on} title={tip} aria-label={tip} onClick={() => dispatch({ type: 'taskbar', id: w.id })}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeWin(w.id); } }}>
                  <tb.icon size={15} aria-hidden className="shrink-0" />
                  <span className="truncate" title={tip}>{tb.label}</span>
                  {dormant && <span className="os-task-zz" aria-label={t('os.task.dormant.s', 'unloaded')}>·</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="os-tray">
          <button type="button" className="os-traybtn" onClick={exit} aria-label={t('os.classic', 'Classic mode')} title={t('os.classic.tip', 'Back to the classic dashboard (the sidebar). Your windows are kept for next time.')}>
            <Monitor size={14} aria-hidden /> <span className="os-tray-label">{t('os.classic', 'Classic mode')}</span>
          </button>
          <Clock />
          <button type="button" className="os-showdesk" onClick={() => dispatch({ type: 'showDesktop' })}
            title={t('os.showdesk', 'Show the desktop')} aria-label={t('os.showdesk', 'Show the desktop')} />
        </div>
      </nav>

      {launcher && (
        <OsLauncher title={title} icon={Icon} sections={sections} leaves={leaves} searchKeywords={searchKeywords} remoteSearch={remoteSearch}
          initialQuery={launcher.q} onOpenLeaf={openLeaf} onOpenHref={openHref} onClose={closeLauncher} onExit={exit}
          onReset={resetLayout} onCloseAll={closeAll} wallpaper={wall} onWallpaper={mode.setWallpaper} openIds={openIds} />
      )}
    </div>
  );
}
