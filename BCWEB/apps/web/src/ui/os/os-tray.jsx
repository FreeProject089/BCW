// The system tray of the OS mode (N-os): notifications, theme, language, fullscreen, the
// clock with its calendar, and the "show desktop" sliver at the far end.
//
// In fullscreen the site's topbar is out of sight, so everything a person reaches for in it
// while working (the bell, the theme, the language) has to be here too. Each one calls the
// SAME thing the topbar does: the notification list is NotifList from ui/notif-bell.jsx over
// lib/notifs.js, the theme is useTheme().toggle, the language is useI18n().setLang. Nothing
// here keeps a second copy of that state.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, ArrowRight, Sun, Moon, Languages, Maximize, Minimize, ChevronLeft, ChevronRight, PanelLeft } from 'lucide-react';
import { useI18n } from '../../i18n.jsx';
import { useTheme } from '../theme.jsx';
import { useAuth } from '../../pages/auth.jsx';
import { NotifList, NotifFilter } from '../notif-bell.jsx';
import { listNotifs, onNotifsChanged, applyNotifChange, markNotifRead, markAllNotifsRead } from '../../lib/notifs.js';
import { notifHref } from '../../lib/notif-view.js';

/** A tray popover: above the taskbar, right-aligned, closes on Escape and on a click outside. */
function useTrayPop() {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const pop = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    pop.current?.querySelector('button, a, [tabindex="0"]')?.focus({ preventScroll: true });
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    const onDown = (e) => { if (!pop.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [open]);
  return { open, setOpen, btn, pop };
}

// Portalled to <body>, like the menus: rendered inside the taskbar, a positioned box would
// measure itself against a 48px bar (and under Translucent surfaces the bar's backdrop-filter
// makes it the containing block even of a fixed box).
function Pop({ p, className, label, top, children }) {
  return createPortal(
    <div ref={p.pop} className={`os-pop ${className}${top ? ' os-pop-top' : ''}`} role="dialog" aria-label={label}>{children}</div>,
    document.body,
  );
}

function NotifTray({ top }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const p = useTrayPop();
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const readIds = useRef(new Set());
  const load = useCallback(() => listNotifs().then((d) => {
    setItems((d.notifications || []).map((n) => (readIds.current.has(n.id) && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)));
  }).catch(() => {}), []);
  useEffect(() => {
    if (!user) return undefined;
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load, user]);
  useEffect(() => onNotifsChanged((d) => {
    setItems((s) => {
      if (d.readAll) s.forEach((x) => readIds.current.add(x.id));
      (d.read || []).forEach((id) => readIds.current.add(id));
      return applyNotifChange(s, d);
    });
  }), []);
  if (!user) return null;
  const unread = items.filter((n) => !n.readAt).length;
  const markOne = async (n) => {
    if (n.readAt) return;
    readIds.current.add(n.id);
    setItems((s) => s.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    try { await markNotifRead(n.id); } catch { void load(); }
  };
  const markAll = async () => {
    items.forEach((x) => readIds.current.add(x.id));
    setItems((s) => s.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
    try { await markAllNotifsRead(); } catch { void load(); }
  };
  const shown = (filter === 'unread' ? items.filter((n) => !n.readAt) : items).slice(0, 30);
  const label = unread
    ? t('os.tray.notifs.n', 'Unread notifications: {n}').replace('{n}', String(unread))
    : t('nav.notifications', 'Notifications');
  return (
    <>
      <button ref={p.btn} type="button" className={`os-traybtn os-trayic${p.open ? ' is-on' : ''}`} aria-expanded={p.open} aria-haspopup="dialog"
        onClick={() => { p.setOpen((o) => !o); if (!p.open) void load(); }} title={label} aria-label={label}>
        <Bell size={16} aria-hidden />
        {unread > 0 && <span className="os-tray-badge" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
      </button>
      {p.open && (
        <Pop p={p} className="os-pop-notif" top={top} label={t('nav.notifications', 'Notifications')}>
          <div className="nb-head">
            <span className="text-sm font-semibold flex items-center gap-1.5"><Bell size={14} className="text-[var(--accent-ink)]" aria-hidden /> {t('nav.notifications', 'Notifications')}</span>
            {unread > 0 && <button type="button" className="nb-link ms-auto" onClick={markAll}><CheckCheck size={13} aria-hidden /> {t('notif.markall', 'Mark all read')}</button>}
          </div>
          <div className="nb-filter"><NotifFilter value={filter} onChange={setFilter} unread={unread} /></div>
          <div className="nb-body">
            {shown.length
              ? <NotifList items={shown} compact onOpen={(n) => { void markOne(n); if (notifHref(n)) p.setOpen(false); }} onMarkRead={markOne} />
              : <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">{filter === 'unread' ? t('notif.none.unread', 'Nothing unread.') : t('notif.none', 'No notifications yet.')}</div>}
          </div>
          <Link to="/notifications" onClick={() => p.setOpen(false)} className="nb-foot justify-center text-[var(--muted)] hover:text-[var(--text)]">
            {t('notif.centre', 'Notification centre')} <ArrowRight size={12} aria-hidden />
          </Link>
        </Pop>
      )}
    </>
  );
}

// ── The clock and its calendar ───────────────────────────────────────────────
const locOf = (lang) => (lang === 'fr' ? 'fr-FR' : 'en-GB');
function fmt(d, lang, opts) {
  try { return new Intl.DateTimeFormat(locOf(lang), opts).format(d); } catch { return d.toISOString().slice(0, 10); }
}

/** The weeks of a month, Monday first (both locales the site speaks start on Monday). */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function ClockTray({ seconds, top }) {
  const { t, lang } = useI18n();
  const p = useTrayPop();
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState(() => ({ y: now.getFullYear(), m: now.getMonth() }));
  useEffect(() => {
    const h = setInterval(() => setNow(new Date()), seconds ? 1000 : 15_000);
    return () => clearInterval(h);
  }, [seconds]);
  useEffect(() => { if (p.open) setView({ y: now.getFullYear(), m: now.getMonth() }); }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const time = fmt(now, lang, { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
  const date = fmt(now, lang, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const full = fmt(now, lang, { dateStyle: 'full' });
  const weeks = monthGrid(view.y, view.m);
  const monthLabel = fmt(new Date(view.y, view.m, 1), lang, { month: 'long', year: 'numeric' });
  const dayNames = Array.from({ length: 7 }, (_, i) => fmt(new Date(2024, 0, 1 + i), lang, { weekday: 'narrow' }));
  const isToday = (d) => d && view.y === now.getFullYear() && view.m === now.getMonth() && d === now.getDate();
  const shift = (n) => setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  return (
    <>
      <button ref={p.btn} type="button" className={`os-clock${p.open ? ' is-on' : ''}`} aria-expanded={p.open} aria-haspopup="dialog"
        onClick={() => p.setOpen((o) => !o)} title={full} aria-label={`${time}, ${full}. ${t('os.tray.cal', 'Open the calendar')}`}>
        <time dateTime={now.toISOString()} className="os-clock-t">{time}</time>
        <span className="os-clock-d" aria-hidden>{date}</span>
      </button>
      {p.open && (
        <Pop p={p} className="os-pop-cal" top={top} label={t('os.tray.cal.t', 'Calendar')}>
          <div className="os-cal-now">
            <div className="os-cal-time">{fmt(now, lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            <div className="os-cal-full">{full}</div>
          </div>
          <div className="os-cal-head">
            <span className="os-cal-month" aria-live="polite">{monthLabel}</span>
            <button type="button" className="os-cal-nav" onClick={() => shift(-1)} aria-label={t('os.tray.cal.prev', 'Previous month')} title={t('os.tray.cal.prev', 'Previous month')}><ChevronLeft size={16} aria-hidden /></button>
            <button type="button" className="os-cal-nav" onClick={() => shift(1)} aria-label={t('os.tray.cal.next', 'Next month')} title={t('os.tray.cal.next', 'Next month')}><ChevronRight size={16} aria-hidden /></button>
          </div>
          <table className="os-cal-grid">
            <thead><tr>{dayNames.map((d, i) => <th key={i} scope="col">{d}</th>)}</tr></thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={i}>{w.map((d, j) => <td key={j} className={isToday(d) ? 'is-today' : ''} aria-current={isToday(d) ? 'date' : undefined}>{d || ''}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="os-cal-today" onClick={() => setView({ y: now.getFullYear(), m: now.getMonth() })}>{t('os.tray.cal.today', 'Today')}</button>
        </Pop>
      )}
    </>
  );
}

export default function OsTray({ full, onFull, seconds, onShowDesktop, onClassic, top = false }) {
  const { t, lang, setLang } = useI18n();
  const { theme, toggle } = useTheme() || {};
  const dark = theme === 'dark';
  const themeLabel = dark ? t('os.tray.light', 'Switch to the light theme') : t('os.tray.dark', 'Switch to the dark theme');
  const langLabel = lang === 'fr' ? t('os.tray.lang.en', 'Switch to English') : t('os.tray.lang.fr', 'Switch to French');
  const fullLabel = full ? t('os.full.exit', 'Exit fullscreen') : t('os.full.enter', 'Fullscreen');
  return (
    <div className="os-tray">
      <button type="button" className="os-traybtn" onClick={onClassic} title={t('os.classic.tip', 'Back to the classic dashboard (the sidebar). Your windows are kept for next time.')} aria-label={t('os.classic', 'Classic mode')}>
        <PanelLeft size={15} aria-hidden /><span className="os-tray-label">{t('os.classic', 'Classic mode')}</span>
      </button>
      <span className="os-tray-sep" aria-hidden />
      <NotifTray top={top} />
      <button type="button" className="os-traybtn os-trayic" onClick={() => toggle?.()} title={themeLabel} aria-label={themeLabel}>
        {dark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
      </button>
      <button type="button" className="os-traybtn os-traylang" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} title={langLabel} aria-label={langLabel} lang={lang === 'fr' ? 'en' : 'fr'}>
        <Languages size={14} aria-hidden /><span aria-hidden>{lang === 'fr' ? 'FR' : 'EN'}</span>
      </button>
      <button type="button" className={`os-traybtn os-trayic${full ? ' is-on' : ''}`} onClick={onFull} aria-pressed={full} title={`${fullLabel} (Alt+Shift+F)`} aria-label={fullLabel}>
        {full ? <Minimize size={16} aria-hidden /> : <Maximize size={16} aria-hidden />}
      </button>
      <ClockTray seconds={seconds} top={top} />
      <button type="button" className="os-showdesk" onClick={onShowDesktop}
        title={t('os.showdesk', 'Show the desktop')} aria-label={t('os.showdesk', 'Show the desktop')} />
    </div>
  );
}
