import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck, Trash2, ArrowRight } from 'lucide-react';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../pages/auth.jsx';
import { api } from '../lib/api.js';
import { canAdmin, effectiveCaps } from '../lib/roles.js';
import { listNotifs, onNotifsChanged, applyNotifChange, markNotifRead, markAllNotifsRead } from '../lib/notifs.js';
import { groupByDay, notifBody, notifHref, notifLabel, notifMeta, notifTime } from '../lib/notif-view.js';
import './notif-list.css';

/**
 * One list, grouped by day. Shared by the bell and the centre, so the two cannot drift: the
 * same rows, the same read/unread look, the same place a click goes.
 *
 * Unread is said three ways at once (a tinted row, a dot, the text in full ink), because a
 * single cue was not enough to tell at a glance which ones were new.
 */
export function NotifList({ items, onOpen, onMarkRead, onDelete, compact = false }) {
  const { t, lang } = useI18n();
  const groups = groupByDay(items, t, lang);
  return (
    <div className={`nl ${compact ? 'is-compact' : ''}`}>
      {groups.map((g) => (
        <section key={g.key} className="nl-day" aria-label={g.label}>
          <h3 className="nl-day-t">{g.label}</h3>
          <ul className="nl-list">
            {g.items.map((n) => {
              const m = notifMeta(n);
              const unread = !n.readAt;
              return (
                <li key={n.id} className={`nl-row ${unread ? 'is-unread' : ''}`}>
                  <button type="button" className="nl-main" onClick={() => onOpen(n)}>
                    <span className={`nl-ico ${m.tint}`} aria-hidden><m.icon size={14} className={m.tone} /></span>
                    <span className="nl-text">
                      <span className="nl-meta">
                        <span className={`nl-kind ${m.tone}`}>{notifLabel(n, t)}</span>
                        <span className="nl-time">{notifTime(n.createdAt, t, lang)}</span>
                        {unread && <span className="nl-dot" role="img" aria-label={t('notif.unread1', 'Unread')} />}
                      </span>
                      <span className="nl-body">{notifBody(n, lang)}</span>
                    </span>
                  </button>
                  {(onMarkRead || onDelete) && (
                    <span className="nl-actions">
                      {unread && onMarkRead && (
                        <button type="button" className="nl-act" onClick={() => onMarkRead(n)}
                          aria-label={t('notif.markone', 'Mark as read')} title={t('notif.markone', 'Mark as read')}><Check size={14} /></button>
                      )}
                      {onDelete && (
                        <button type="button" className="nl-act is-danger" onClick={() => onDelete(n)}
                          aria-label={t('common.delete', 'Delete')} title={t('common.delete', 'Delete')}><Trash2 size={13} /></button>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** All / Unread: the only filter. More than that and the bell turns back into a control panel. */
export function NotifFilter({ value, onChange, unread }) {
  const { t } = useI18n();
  return (
    <div className="nl-seg" role="tablist" aria-label={t('notif.filter', 'Show')}>
      {[['all', t('notif.f.all', 'All')], ['unread', t('notif.f.unread', 'Unread')]].map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={value === k ? 'is-on' : ''}>
          {l}{k === 'unread' && unread > 0 ? <span className="nl-seg-n">{unread}</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * The topbar bell: a glance, not a control panel. Latest notifications grouped by day, All or
 * Unread, one "Mark all read", and a way to the centre where deleting and the per-category
 * switches live.
 *
 * It used to carry its own "Clear" that only hid rows in THIS browser behind a stored
 * timestamp, while the centre still listed them: two lists that disagreed about what you had.
 * Gone; the bell now shows the same list as the centre.
 *
 * `onBadge` publishes the number for the mobile bar (App's publishNavBadge), so that bar never
 * runs a second poll to draw the same digit.
 */
export default function NavNotifications({ icon = null, onBadge } = {}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const ref = useRef(null);
  // Locally-read ids, so a 60 s poll that overtakes the write cannot flip a row back to unread.
  const readIds = useRef(new Set());
  const load = useCallback(() => listNotifs().then((d) => {
    setItems((d.notifications || []).map((n) => (readIds.current.has(n.id) && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)));
  }).catch(() => {}), []);
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  // What the centre, the dashboard or a report screen did, applied here at once (the badge
  // drops on the click), then reconciled with a reload.
  useEffect(() => onNotifsChanged((d) => {
    setItems((s) => {
      if (d.readAll) s.forEach((x) => readIds.current.add(x.id));
      (d.read || []).forEach((id) => readIds.current.add(id));
      return applyNotifChange(s, d);
    });
    void load();
  }), [load]);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const unread = items.filter((n) => !n.readAt).length;
  // Staff queues count towards the SAME badge: a moderator on the blog page has no other sign
  // that a report came in. Gated on the nav's own predicates, so a member's browser never polls
  // a route that would only answer 403.
  const canSeeQueues = !!user && (canAdmin(user) || effectiveCaps(user).includes('manage_users'));
  const [pending, setPending] = useState(0);
  // Opening the bell marks the current queue total as seen, so its share of the badge drops on
  // the click; only what arrives after counts again. The footer link keeps the true total.
  const [pendingSeen, setPendingSeen] = useState(() => { try { return Number(localStorage.getItem('bcw_pending_seen')) || 0; } catch { return 0; } });
  useEffect(() => {
    if (!canSeeQueues) { setPending(0); return undefined; }
    let live = true;
    const poll = () => api.get('/admin/pending').then((r) => { if (live) setPending(r?.total || 0); }).catch(() => { if (live) setPending(0); });
    poll();
    const id = setInterval(poll, 60_000);
    return () => { live = false; clearInterval(id); };
  }, [canSeeQueues]);
  const pendingNew = Math.max(0, pending - pendingSeen);
  const markPendingSeen = () => { setPendingSeen(pending); try { localStorage.setItem('bcw_pending_seen', String(pending)); } catch { /* badge only */ } };
  const badge = unread + pendingNew;
  useEffect(() => { onBadge?.(badge); }, [badge, onBadge]);
  useEffect(() => () => onBadge?.(0), [onBadge]); // signing out unmounts the bell; no number left behind

  const markOne = async (n) => {
    if (n.readAt) return;
    readIds.current.add(n.id);
    setItems((s) => s.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    try { await markNotifRead(n.id); } catch { void load(); }
  };
  const openNotif = (n) => {
    void markOne(n);
    const to = notifHref(n);
    if (to) { setOpen(false); nav(to); }
  };
  // Immediate and silent: marking read is not worth a toast, and nothing is lost by it.
  const markAll = async () => {
    items.forEach((x) => readIds.current.add(x.id));
    setItems((s) => s.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
    try { await markAllNotifsRead(); } catch { void load(); }
  };

  const shown = (filter === 'unread' ? items.filter((n) => !n.readAt) : items).slice(0, 30);
  const toggle = () => { setOpen((o) => !o); if (!open) { void load(); markPendingSeen(); } };

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="nav-link !px-2 relative" onClick={toggle} aria-expanded={open} aria-haspopup="dialog"
        title={t('nav.notifications', 'Notifications')} aria-label={t('nav.notifications', 'Notifications')}>
        {icon || <Bell size={16} />}
        {badge > 0 && <span className="absolute top-0.5 right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-[var(--primary)] text-[var(--on-primary)] text-[9px] font-bold grid place-items-center">{badge > 9 ? '9+' : badge}</span>}
      </button>
      {open && (
        <div className="nb-panel anim-fade" role="dialog" aria-label={t('nav.notifications', 'Notifications')}>
          <div className="nb-head">
            <span className="text-sm font-semibold flex items-center gap-1.5"><Bell size={14} className="text-[var(--accent-ink)]" aria-hidden /> {t('nav.notifications', 'Notifications')}</span>
            {unread > 0 && (
              <button type="button" className="nb-link ms-auto" onClick={markAll}><CheckCheck size={13} aria-hidden /> {t('notif.markall', 'Mark all read')}</button>
            )}
          </div>
          <div className="nb-filter"><NotifFilter value={filter} onChange={setFilter} unread={unread} /></div>
          <div className="nb-body">
            {shown.length
              ? <NotifList items={shown} compact onOpen={openNotif} onMarkRead={markOne} />
              : <div className="px-3 py-8 text-center text-sm text-[var(--muted)]">{filter === 'unread' ? t('notif.none.unread', 'Nothing unread.') : t('notif.none', 'No notifications yet.')}</div>}
          </div>
          {pending > 0 && (
            <Link to="/notifications" onClick={() => setOpen(false)} className="nb-foot nb-staff">
              <span className="nb-staff-n">{pending}</span>
              <span className="flex-1 min-w-0">{t('notif.staff.badge', 'waiting in your moderation queues')}</span>
            </Link>
          )}
          <Link to="/notifications" onClick={() => setOpen(false)} className="nb-foot justify-center text-[var(--muted)] hover:text-[var(--text)]">
            {t('notif.centre', 'Notification centre')} <ArrowRight size={12} aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}
