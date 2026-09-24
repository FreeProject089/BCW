// The OS mode of the dashboards (M1, completed by N-os): a desktop, windows, a taskbar, a start
// menu and a system tray, over the SAME screens SideDash shows. Loaded lazily by SideDash
// (pages/pages.jsx) only when the mode is on and the screen is at least 768px wide, so none of
// this is in the entry chunk.
//
// NOT AN OS SIMULATION
// Every window is a real dashboard screen, rendered by the very function SideDash renders
// its content column with (`render(leafId)`, the page's `(s) => …` children). There are no
// "apps" of the shell's own, no file system, nothing that is not already a tab. Permissions
// are therefore exactly the nav's: the launcher, the desktop, the pins and the windows are all
// built from the `tabs` array the dashboard handed SideDash, and a window or a pin restored
// from storage for a tab that is not in that array today is simply not drawn.
//
// THE URL IS STILL THE NAVIGATION
// `?s=<leaf>` follows the focused window, and a change of `?s=` from anywhere (a link inside a
// screen, the command palette, the back button, a deep link opened in a new tab) opens or
// focuses that screen's window. So every existing link into the dashboards keeps working, and
// switching back to the classic mode lands on the screen that was in front.
//
// ONE CLICK
// A desktop icon, a start menu tile, a pinned taskbar button: one click (or Enter) opens. The
// double click of a file manager is the wrong model for a list of screens, and it was the one
// gesture a touch screen, a pen and a keyboard do not have.
//
// FULLSCREEN
// The Fullscreen API on <html>, with the shell covering the page (html[data-os-full]): the
// site's topbar goes away and the desktop takes the whole screen. Not on the shell's own
// element: dialogs, toasts and menus are portalled to <body>, and in element fullscreen
// everything outside that element is not drawn at all, so every confirm would open invisible.
// Where the API is refused (an iPhone-class browser, a frame without the permission) the same
// look is applied without it ("immersive"). Escape, the tray button, the start menu or
// Alt+Shift+F leave it; leaving the OS mode leaves it too.
//
// STATE
// The window manager is the pure reducer in wm.js. The layout (open windows, geometry, which
// one is in front, the pins, the icons taken off the desktop, the recent screens) is kept per
// account and per dashboard in localStorage, and can be reset from the start menu. The look
// (wallpaper, icon size, taskbar position…) is the account's OS preference (os-mode.jsx).
// Minimised windows beyond six mounted are unmounted, oldest first (wm.js mountedIds); the
// taskbar says so on the ones that were.

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  LayoutGrid, Search, AppWindow, Pin, PinOff, Minus, Maximize2, Minimize2, PanelLeft, PanelRight, X, XCircle, Palette,
  Eye, EyeOff, Maximize, Minimize, RotateCcw, Monitor, LayoutDashboard, ArrowLeft, ArrowRight, PanelLeftOpen,
} from 'lucide-react';
import { useI18n } from '../../i18n.jsx';
import { useDialog, useToast } from '../ui.jsx';
import { useShortcutHandlers } from '../shortcuts.jsx';
import { confirmLeave } from '../../lib/leave-guard.js';
import { reduce, initialState, mountedIds, serialize, rectForZone, assistZones, fracOf, sameFrac, largestFreeRect, MAX_MOUNTED } from './wm.js';
import { layoutKey, clearOsLayout, useOsMode } from './os-mode.jsx';
import OsWindow from './os-window.jsx';
import OsLauncher, { badgeOf } from './os-launcher.jsx';
import OsMenu, { isMenuKey, menuPoint, spatialFocus } from './os-menu.jsx';
import OsTray from './os-tray.jsx';
import OsPersonalize from './os-personalize.jsx';
import { SnapFlyout, SnapAssist } from './os-snap.jsx';
import './os.css';

const TASKBAR_H = 48;

function headerH() {
  try { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 68; } catch { return 68; }
}

function readLayout(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Fullscreen on <html> (see FULLSCREEN above), with the immersive fallback. */
function useFullscreen() {
  const [real, setReal] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  const [immersive, setImmersive] = useState(false);
  const ours = useRef(false);
  useEffect(() => {
    const h = () => {
      const on = !!document.fullscreenElement;
      setReal(on);
      if (on) setImmersive(false); else ours.current = false;
    };
    document.addEventListener('fullscreenchange', h);
    return () => {
      document.removeEventListener('fullscreenchange', h);
      // Leaving the OS mode leaves the fullscreen it entered (not one somebody else asked for).
      if (ours.current && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);
  const on = real || immersive;
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (on) root.setAttribute('data-os-full', ''); else root.removeAttribute('data-os-full');
    return () => root.removeAttribute('data-os-full');
  }, [on]);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); return; }
    if (immersive) { setImmersive(false); return; }
    const el = document.documentElement;
    if (typeof el.requestFullscreen !== 'function') { setImmersive(true); return; }
    // A request can also hang: some embedded browsers (an app's web view, a preview pane)
    // neither grant nor refuse it. Without an answer in time, the immersive look is applied,
    // so the button never does nothing; a late grant then takes over (see the listener above).
    let settled = false;
    const fallback = () => { if (!settled && !document.fullscreenElement) { settled = true; setImmersive(true); } };
    try {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => { settled = true; ours.current = true; if (!document.fullscreenElement) setImmersive(true); }, fallback);
      setTimeout(fallback, 1200);
    } catch { fallback(); }
  }, [immersive]);
  return { on, real, immersive, toggle, leaveImmersive: () => setImmersive(false) };
}

export default function OsShell({ scope, title, icon: Icon, tabs, render, searchKeywords = null, remoteSearch = null }) {
  const { t } = useI18n();
  const dialog = useDialog();
  const toast = useToast();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const mode = useOsMode(scope);
  const prefs = mode.prefs;
  const key = layoutKey(scope, mode.uid);
  const fs = useFullscreen();

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

  // Only windows and pins whose tab exists for this person, today.
  const wins = useMemo(() => state.wins.filter((w) => tabById.has(w.id)), [state.wins, tabById]);
  const activeWin = wins.find((w) => w.id === state.active && w.mode !== 'min') || null;
  const mounted = useMemo(() => mountedIds({ ...state, wins }, MAX_MOUNTED), [state, wins]);
  const openIds = useMemo(() => new Set(wins.map((w) => w.id)), [wins]);
  const pinSet = useMemo(() => new Set(state.pins || []), [state.pins]);
  const startSet = useMemo(() => new Set(state.start || []), [state.start]);
  const hiddenSet = useMemo(() => new Set(state.hidden || []), [state.hidden]);
  const barPins = useMemo(() => (state.pins || []).map((id) => tabById.get(id)).filter(Boolean), [state.pins, tabById]);
  const startPins = useMemo(() => (state.start || []).map((id) => tabById.get(id)).filter(Boolean), [state.start, tabById]);
  const recentTabs = useMemo(() => (state.recent || []).map((id) => tabById.get(id)).filter(Boolean).slice(0, 4), [state.recent, tabById]);
  const deskTabs = useMemo(() => realTabs.filter((tb) => !hiddenSet.has(tb.id)), [realTabs, hiddenSet]);
  const hiddenCount = realTabs.length - deskTabs.length;
  const leafFor = (w) => (leafById.get(w.leaf)?.parent?.id === w.id ? leafById.get(w.leaf) : leafById.get((tabById.get(w.id)?.sub?.[0] || tabById.get(w.id))?.id));
  const firstLeaf = (tb) => (tb.sub?.[0] || tb).id;

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
  const measureRef = useRef(() => {});
  useLayoutEffect(() => {
    const el = deskRef.current;
    if (!el) return undefined;
    const measure = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) dispatch({ type: 'viewport', w: r.width, h: r.height }); };
    measureRef.current = measure;
    measure();
    // A resize listener as well as the observer: a background tab gets no observer callbacks.
    window.addEventListener('resize', measure);
    let ro = null;
    try { ro = new ResizeObserver(measure); ro.observe(el); } catch { /* old browser: the listener covers it */ }
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, []);
  // Entering or leaving fullscreen, or moving the taskbar, changes the desktop's box.
  useLayoutEffect(() => { measureRef.current(); }, [fs.on, prefs.bar]);

  // ── Persistence ────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(serialize(state))); } catch { /* private window: this session only */ }
    }, 250);
    return () => clearTimeout(h);
  }, [state.wins, state.active, state.pins, state.start, state.hidden, state.recent, key]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Overlays: the start menu, a context menu, the snap grid, snap assist, Personalise ──
  const [launcher, setLauncher] = useState(null); // null | { q }
  const [menu, setMenu] = useState(null); // null | { at, items, label }
  const [fly, setFly] = useState(null); // null | { id, rect, kb }
  const [assist, setAssist] = useState(null); // null | { zones, taken: [ids] }
  const [personalize, setPersonalize] = useState(false);
  const startRef = useRef(null);
  const flyHover = useRef(false);
  const flyTimer = useRef(null);
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
  const closeMany = async (ids) => {
    if (!ids.length || !(await confirmLeave())) return;
    dispatch({ type: 'closeMany', ids });
  };
  const resetLayout = async () => {
    setLauncher(null); setPersonalize(false);
    const ok = await dialog.confirm({
      title: t('os.reset.t', 'Reset the layout?'),
      message: t('os.reset.m2', 'Every window of this dashboard closes, and the saved positions, the pins and the icons you took off the desktop are forgotten. Nothing on the site changes.'),
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
  const exit = () => { setLauncher(null); if (fs.on) fs.toggle(); mode.set(false); };
  const toClassic = (leafId) => {
    if (leafId) setSp((p) => { const n = new URLSearchParams(p); n.set('s', leafId); return n; }, { replace: true });
    exit();
  };

  // Snap, then offer the rest of the layout to the other windows (snap assist).
  const snapTo = useCallback((id, zone) => {
    dispatch({ type: 'snap', id, zone });
    const zones = assistZones(zone);
    setAssist(zones.length ? { zones, taken: [id] } : null);
  }, []);
  const fill = (id) => {
    const others = state.wins.filter((w) => w.id !== id && w.mode !== 'min');
    if (!largestFreeRect(others, state.vp)) { toast.info(t('os.win.fill.none', 'No free space is left: every part of the desktop has a window on it.')); return; }
    dispatch({ type: 'fill', id });
  };
  const closeFly = useCallback((refocus) => {
    clearTimeout(flyTimer.current);
    setFly((f) => {
      if (f && refocus) setTimeout(() => els.current.get(f.id)?.querySelector('[aria-haspopup="dialog"]')?.focus(), 0);
      return null;
    });
  }, []);
  const fillRef = useRef(fill); fillRef.current = fill;
  const classicRef = useRef(toClassic); classicRef.current = toClassic;
  const act = useMemo(() => ({
    snap: snapTo,
    fill: (id) => fillRef.current(id),
    classic: (leafId) => classicRef.current(leafId),
    openFly: (id, el, kb) => { clearTimeout(flyTimer.current); const r = el.getBoundingClientRect(); setFly({ id, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, kb }); },
    closeFly: () => closeFly(false),
    // Leaving the maximise button: the grid stays while the pointer is on its way into it.
    leaveFly: () => { clearTimeout(flyTimer.current); flyTimer.current = setTimeout(() => { if (!flyHover.current) setFly((f) => (f && !f.kb ? null : f)); }, 320); },
  }), [snapTo, closeFly]);
  useEffect(() => () => clearTimeout(flyTimer.current), []);

  // Snap assist, derived from the live state: the first zone of the layout nobody occupies,
  // and the windows not already in one of its zones.
  const assistView = useMemo(() => {
    if (!assist) return null;
    const inZone = (w, z) => w.mode !== 'min' && sameFrac(fracOf(w.snap), z);
    const free = assist.zones.find((z) => !wins.some((w) => inZone(w, z)));
    if (!free) return null;
    const cands = wins.filter((w) => !assist.taken.includes(w.id) && !assist.zones.some((z) => inZone(w, z)));
    if (!cands.length) return null;
    return {
      zone: free,
      rect: rectForZone(free, state.vp),
      candidates: cands.map((w) => { const tb = tabById.get(w.id); const lf = leafFor(w); return { id: w.id, icon: tb.icon, label: lf && lf.label !== tb.label ? `${tb.label} · ${lf.label}` : tb.label }; }),
    };
  }, [assist, wins, state.vp, tabById]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (assist && !assistView) setAssist(null); }, [assist, assistView]);

  const order = wins.map((w) => w.id);
  const activeId = activeWin?.id;
  useShortcutHandlers({
    'os.launcher': () => setLauncher((l) => (l ? null : { q: '' })),
    'os.next': () => dispatch({ type: 'cycle', dir: 1, order }),
    'os.prev': () => dispatch({ type: 'cycle', dir: -1, order }),
    // N-os (agent-os-N)
    'os.snapLeft': () => activeId && snapTo(activeId, 'left'),
    'os.snapRight': () => activeId && snapTo(activeId, 'right'),
    'os.max': () => activeId && dispatch({ type: 'snap', id: activeId, zone: 'max' }),
    'os.restore': () => {
      if (!activeWin) return;
      dispatch({ type: activeWin.mode === 'max' || activeWin.snap ? 'unsnap' : 'minimize', id: activeWin.id });
    },
    'os.close': () => activeId && closeWin(activeId),
    'os.layouts': () => { const el = activeId && els.current.get(activeId)?.querySelector('[aria-haspopup="dialog"]'); if (el) act.openFly(activeId, el, true); },
    'os.desktop': () => dispatch({ type: 'showDesktop' }),
    'os.tile': () => dispatch({ type: 'tile' }),
    'os.fullscreen': () => fs.toggle(),
  });

  // Escape leaves the immersive fallback (real fullscreen: the browser handles Escape itself),
  // unless something else on the page used that Escape first.
  useEffect(() => {
    if (!fs.immersive) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[aria-modal="true"], .os-menu, .os-launcher, .os-pop, .os-snapfly')) return;
      fs.leaveImmersive();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fs.immersive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Menus ──────────────────────────────────────────────────────────────────
  const openMenu = (at, items, label) => { setLauncher(null); setMenu({ at, items, label }); };
  const pinItems = (tb) => [
    { k: 'pinbar', icon: pinSet.has(tb.id) ? PinOff : Pin, label: pinSet.has(tb.id) ? t('os.pin.bar.off', 'Unpin from the taskbar') : t('os.pin.bar.on', 'Pin to the taskbar'), run: () => dispatch({ type: 'pin', id: tb.id }) },
    { k: 'pinstart', icon: startSet.has(tb.id) ? PinOff : LayoutGrid, label: startSet.has(tb.id) ? t('os.pin.start.off', 'Unpin from start') : t('os.pin.start.on', 'Pin to start'), run: () => dispatch({ type: 'pin', id: tb.id, where: 'start' }) },
  ];
  const iconMenu = (tb, at) => openMenu(at, [
    { k: 'open', icon: AppWindow, label: openIds.has(tb.id) ? t('os.m.front', 'Bring to the front') : t('os.m.open', 'Open'), run: () => openLeaf(firstLeaf(tb)) },
    { sep: true },
    ...pinItems(tb),
    { k: 'hide', icon: EyeOff, label: t('os.m.deskoff', 'Remove from the desktop'), run: () => dispatch({ type: 'desk', id: tb.id, show: false }) },
    { sep: true },
    { k: 'classic', icon: PanelLeftOpen, label: t('os.win.classic', 'Open in the classic mode'), run: () => toClassic(firstLeaf(tb)) },
  ], tb.label);
  const appMenu = (tb, at) => setMenu({ at, label: tb.label, items: [
    { k: 'open', icon: AppWindow, label: openIds.has(tb.id) ? t('os.m.front', 'Bring to the front') : t('os.m.open', 'Open'), run: () => openLeaf(firstLeaf(tb)) },
    { sep: true },
    ...pinItems(tb),
    hiddenSet.has(tb.id)
      ? { k: 'desk', icon: Eye, label: t('os.m.deskon', 'Show on the desktop'), run: () => dispatch({ type: 'desk', id: tb.id, show: true }) }
      : { k: 'desk', icon: EyeOff, label: t('os.m.deskoff', 'Remove from the desktop'), run: () => dispatch({ type: 'desk', id: tb.id, show: false }) },
  ] });
  const visibleCount = wins.filter((w) => w.mode !== 'min').length;
  const deskMenu = (at) => openMenu(at, [
    { k: 'pz', icon: Palette, label: t('os.pz.t2', 'Personalise…'), run: () => setPersonalize(true) },
    { k: 'sm', checked: prefs.icons === 'sm', label: t('os.pz.icons.sm', 'Small icons'), run: () => mode.setPrefs({ icons: 'sm' }) },
    { k: 'md', checked: prefs.icons === 'md', label: t('os.pz.icons.md', 'Medium icons'), run: () => mode.setPrefs({ icons: 'md' }) },
    { k: 'lg', checked: prefs.icons === 'lg', label: t('os.pz.icons.lg', 'Large icons'), run: () => mode.setPrefs({ icons: 'lg' }) },
    { k: 'showall', icon: Eye, label: t('os.m.showall', 'Show every icon again'), disabled: !hiddenCount, run: () => dispatch({ type: 'deskReset' }) },
    { sep: true },
    { k: 'tile', icon: LayoutDashboard, label: t('os.m.tile', 'Tile the windows'), hint: 'Alt+Shift+T', disabled: !visibleCount, run: () => dispatch({ type: 'tile' }) },
    { k: 'desk', icon: Monitor, label: t('os.showdesk', 'Show the desktop'), hint: 'Alt+Shift+D', disabled: !wins.length, run: () => dispatch({ type: 'showDesktop' }) },
    { sep: true },
    { k: 'full', icon: fs.on ? Minimize : Maximize, label: fs.on ? t('os.full.exit', 'Exit fullscreen') : t('os.full.enter', 'Fullscreen'), hint: 'Alt+Shift+F', run: fs.toggle },
    { k: 'reset', icon: RotateCcw, label: t('os.reset', 'Reset layout'), run: resetLayout },
    { k: 'classic', icon: PanelLeft, label: t('os.classic', 'Classic mode'), run: exit },
  ], t('os.desktop', 'Desktop'));
  const taskMenu = (w, at) => {
    const tb = tabById.get(w.id);
    const freed = w.mode === 'max' || !!w.snap;
    const others = wins.filter((x) => x.id !== w.id).map((x) => x.id);
    openMenu(at, [
      w.mode === 'min' || activeWin?.id !== w.id
        ? { k: 'front', icon: AppWindow, label: t('os.m.front', 'Bring to the front'), run: () => dispatch({ type: 'focus', id: w.id }) }
        : { k: 'min', icon: Minus, label: t('os.win.min', 'Minimise'), run: () => dispatch({ type: 'minimize', id: w.id }) },
      freed
        ? { k: 'restore', icon: Minimize2, label: t('os.win.restore', 'Restore'), run: () => dispatch({ type: 'unsnap', id: w.id }) }
        : { k: 'max', icon: Maximize2, label: t('os.win.max', 'Maximise'), run: () => dispatch({ type: 'snap', id: w.id, zone: 'max' }) },
      { k: 'left', icon: PanelLeft, label: t('os.win.snapleft', 'Snap to the left half'), run: () => snapTo(w.id, 'left') },
      { k: 'right', icon: PanelRight, label: t('os.win.snapright', 'Snap to the right half'), run: () => snapTo(w.id, 'right') },
      { sep: true },
      pinItems(tb)[0],
      { sep: true },
      { k: 'others', icon: XCircle, label: t('os.m.closeothers', 'Close the other windows'), disabled: !others.length, run: () => closeMany(others) },
      { k: 'close', icon: X, label: t('os.win.close', 'Close'), danger: true, run: () => closeWin(w.id) },
    ], tb.label);
  };
  const barMenu = (at) => openMenu(at, [
    { k: 'desk', icon: Monitor, label: t('os.showdesk', 'Show the desktop'), hint: 'Alt+Shift+D', disabled: !wins.length, run: () => dispatch({ type: 'showDesktop' }) },
    { k: 'tile', icon: LayoutDashboard, label: t('os.m.tile', 'Tile the windows'), hint: 'Alt+Shift+T', disabled: !visibleCount, run: () => dispatch({ type: 'tile' }) },
    { k: 'closeall', icon: XCircle, label: t('os.closeall', 'Close all windows'), disabled: !wins.length, danger: true, run: closeAll },
    { sep: true },
    { k: 'labels', checked: prefs.labels, label: t('os.pz.labels', 'Names on the taskbar buttons'), run: () => mode.setPrefs({ labels: !prefs.labels }) },
    { k: 'top', checked: prefs.bar === 'top', label: t('os.m.bartop', 'Taskbar at the top'), run: () => mode.setPrefs({ bar: prefs.bar === 'top' ? 'bottom' : 'top' }) },
    { k: 'pz', icon: Palette, label: t('os.pz.t2', 'Personalise…'), run: () => setPersonalize(true) },
  ], t('os.taskbar', 'Taskbar'));
  const qlMenu = (tb, at) => openMenu(at, [
    { k: 'open', icon: AppWindow, label: openIds.has(tb.id) ? t('os.m.front', 'Bring to the front') : t('os.m.open', 'Open'), run: () => openLeaf(firstLeaf(tb)) },
    { k: 'left', icon: ArrowLeft, label: t('os.m.moveleft', 'Move left'), disabled: barPins[0]?.id === tb.id, run: () => dispatch({ type: 'movePin', id: tb.id, dir: -1 }) },
    { k: 'right', icon: ArrowRight, label: t('os.m.moveright', 'Move right'), disabled: barPins[barPins.length - 1]?.id === tb.id, run: () => dispatch({ type: 'movePin', id: tb.id, dir: 1 }) },
    { sep: true },
    ...pinItems(tb),
  ], tb.label);
  const onMenuKey = (fn) => (e) => { if (isMenuKey(e)) { e.preventDefault(); fn(menuPoint(e)); } };

  const [snapPreview, setSnapPreview] = useState(null);
  const preview = snapPreview ? rectForZone(snapPreview, state.vp) : null;
  const iconsRef = useRef(null);
  const tasksRef = useRef(null);

  return (
    <div className="os-shell" data-wallpaper={prefs.wallpaper} data-icons={prefs.icons} data-bar={prefs.bar} data-anim={prefs.anim ? '' : undefined}
      data-full={fs.on ? '' : undefined} style={{ '--os-taskbar-h': `${TASKBAR_H}px` }}>
      <div className="os-desktop" ref={deskRef}
        onContextMenu={(e) => { if (e.target === e.currentTarget || e.target === iconsRef.current) { e.preventDefault(); deskMenu(menuPoint(e)); } }}>
        <ul ref={iconsRef} className="os-icons" aria-label={t('os.desktop', 'Desktop')}
          onKeyDown={(e) => spatialFocus(e, iconsRef.current, '.os-icon')}>
          {deskTabs.map((tb) => {
            const b = badgeOf(tb);
            const open = openIds.has(tb.id);
            return (
              <li key={tb.id}>
                <button type="button" className={`os-icon${open ? ' is-open' : ''}`}
                  onClick={() => openLeaf(firstLeaf(tb))}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); iconMenu(tb, menuPoint(e)); }}
                  onKeyDown={onMenuKey((at) => iconMenu(tb, at))}
                  title={tb.label}>
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
            <span>{t('os.hint.one', 'Click an icon, or open the start menu, to put a screen in a window. Right-click for more.')}</span>
          </div>
        )}

        {wins.map((w) => (
          <OsWindow key={w.id} win={w} tab={tabById.get(w.id)} leaf={leafFor(w)} active={activeWin?.id === w.id}
            mounted={mounted.has(w.id)} vp={state.vp} deskRef={deskRef} dispatch={dispatch} render={render}
            onLeaf={setLeaf} onClose={closeWin} onSnapPreview={setSnapPreview} registerEl={registerEl} act={act} pinned={pinSet.has(w.id)} />
        ))}

        {preview && <div className="os-snap-preview" aria-hidden style={{ left: preview.x, top: preview.y, width: preview.w, height: preview.h }} />}
        {assistView && (
          <SnapAssist key={JSON.stringify(assistView.zone)} rect={assistView.rect} candidates={assistView.candidates}
            onPick={(cid) => { dispatch({ type: 'snap', id: cid, zone: assistView.zone }); setAssist((a) => (a ? { ...a, taken: [...a.taken, cid] } : a)); }}
            onClose={() => setAssist(null)} />
        )}
      </div>

      <nav className={`os-taskbar${prefs.labels ? '' : ' is-compact'}`} aria-label={t('os.taskbar', 'Taskbar')}
        onContextMenu={(e) => { if (!e.target.closest('button')) { e.preventDefault(); barMenu(menuPoint(e)); } }}>
        <button ref={startRef} type="button" className={`os-start${launcher ? ' is-on' : ''}`} aria-haspopup="dialog" aria-expanded={!!launcher}
          onClick={() => setLauncher((l) => (l ? null : { q: '' }))} title={`${t('os.start', 'Start')} (Alt+O)`}>
          {Icon ? <Icon size={16} aria-hidden /> : <LayoutGrid size={16} aria-hidden />}
          <span className="os-start-label">{t('os.start', 'Start')}</span>
        </button>
        <button type="button" className="os-searchbtn" onClick={() => setLauncher({ q: '' })} aria-label={t('os.search', 'Search')} title={`${t('os.search', 'Search')} (Alt+O)`}>
          <Search size={14} aria-hidden /> <span className="truncate">{t('os.search.btn', 'Search…')}</span>
        </button>
        {barPins.length > 0 && (
          <ul className="os-ql" aria-label={t('os.ql', 'Pinned screens')} onKeyDown={(e) => spatialFocus(e, e.currentTarget, 'button')}>
            {barPins.map((tb) => (
              <li key={tb.id}>
                <button type="button" className={`os-ql-btn${openIds.has(tb.id) ? ' is-open' : ''}`} onClick={() => openLeaf(firstLeaf(tb))}
                  onContextMenu={(e) => { e.preventDefault(); qlMenu(tb, menuPoint(e)); }} onKeyDown={onMenuKey((at) => qlMenu(tb, at))}
                  title={tb.label} aria-label={tb.label}>
                  <tb.icon size={17} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <ul ref={tasksRef} className="os-tasks" aria-label={t('os.tasks', 'Open windows')} onKeyDown={(e) => spatialFocus(e, tasksRef.current, '.os-task')}>
          {wins.map((w) => {
            const tb = tabById.get(w.id);
            const lf = leafFor(w);
            const dormant = w.mode === 'min' && !mounted.has(w.id);
            const on = activeWin?.id === w.id;
            const full = lf && lf.label !== tb.label ? `${tb.label} · ${lf.label}` : tb.label;
            const tip = dormant ? `${full}. ${t('os.task.dormant', 'Unloaded to save memory: more than six windows were open. It reloads when you open it, and what was not saved is lost.')}` : full;
            return (
              <li key={w.id}>
                <button type="button" className={`os-task${on ? ' is-on' : ''}${w.mode === 'min' ? ' is-min' : ''}${dormant ? ' is-dormant' : ''}`}
                  aria-pressed={on} title={tip} aria-label={tip} onClick={() => dispatch({ type: 'taskbar', id: w.id })}
                  onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeWin(w.id); } }}
                  onContextMenu={(e) => { e.preventDefault(); taskMenu(w, menuPoint(e)); }} onKeyDown={onMenuKey((at) => taskMenu(w, at))}>
                  <tb.icon size={16} aria-hidden className="shrink-0" />
                  <span className="os-task-l">{tb.label}</span>
                  {dormant && <span className="os-task-zz" aria-hidden>·</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <OsTray full={fs.on} onFull={fs.toggle} seconds={prefs.seconds} top={prefs.bar === 'top'} onShowDesktop={() => dispatch({ type: 'showDesktop' })} onClassic={exit} />
      </nav>

      {launcher && (
        <OsLauncher title={title} icon={Icon} sections={sections} leaves={leaves} searchKeywords={searchKeywords} remoteSearch={remoteSearch}
          initialQuery={launcher.q} onOpenLeaf={openLeaf} onOpenHref={openHref} onClose={closeLauncher} onExit={exit}
          onReset={resetLayout} onCloseAll={closeAll} openIds={openIds} pinned={startPins} recent={recentTabs} onAppMenu={appMenu}
          onPersonalize={() => { setLauncher(null); setPersonalize(true); }} full={fs.on} onFull={() => { setLauncher(null); fs.toggle(); }} />
      )}
      {menu && <OsMenu at={menu.at} items={menu.items} label={menu.label} onClose={() => setMenu(null)} />}
      {fly && wins.some((w) => w.id === fly.id) && (
        <SnapFlyout anchor={fly.rect} vp={state.vp} viaKeyboard={fly.kb}
          onPick={(z) => { const id = fly.id; closeFly(false); snapTo(id, z); }}
          onClose={closeFly}
          onHover={(on) => { flyHover.current = on; if (!on && !fly.kb) act.leaveFly(); else clearTimeout(flyTimer.current); }} />
      )}
      {personalize && (
        <OsPersonalize prefs={prefs} setPrefs={mode.setPrefs} hiddenCount={hiddenCount}
          onShowIcons={() => dispatch({ type: 'deskReset' })} onReset={resetLayout} onClose={() => setPersonalize(false)} />
      )}
      {fs.on && <span className="sr-only" role="status">{t('os.full.on', 'Fullscreen. Press Escape, or the fullscreen button in the tray, to leave it.')}</span>}
    </div>
  );
}

