import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Trash2, Sliders, Lock, Inbox, ShieldCheck, ArrowRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Badge, EmptyState, Spinner, useToast, useDialog } from '../ui/ui.jsx';
import { useAuth } from './auth.jsx';

// /notifications — one centre for everybody.
//
// The same page for a member and for staff, because the difference between them is not the
// screen, it is what they are allowed to see: a moderator additionally has QUEUES waiting
// for them, and those appear here as a section rather than as a second inbox somewhere else.
// Two inboxes is how one of them stops being read.
//
// The bell in the topbar stays a glance; this is the place you come when you want to deal
// with things, and the only place the preferences live.

function timeAgo(iso, t) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return t('notif.now', 'just now');
  if (s < 3600) return t('notif.min', '{n} min ago').replace('{n}', String(Math.floor(s / 60)));
  if (s < 86400) return t('notif.hr', '{n} h ago').replace('{n}', String(Math.floor(s / 3600)));
  return new Date(iso).toLocaleDateString();
}

function Preferences() {
  const { t } = useI18n(); const toast = useToast();
  const [cats, setCats] = useState(null);
  const load = () => api.get('/me/notification-prefs').then((r) => setCats(r.categories || [])).catch(() => setCats([]));
  useEffect(() => { load(); }, []);

  const toggle = async (c) => {
    // Optimistic, then reconciled: a switch that waits for a round-trip feels broken, and
    // the failure path here is a reload rather than a wrong state left on screen.
    setCats((list) => list.map((x) => (x.key === c.key ? { ...x, enabled: !x.enabled } : x)));
    try { await api.put('/me/notification-prefs', { category: c.key, enabled: !c.enabled }); }
    catch (x) {
      toast.error(x?.data?.error === 'category_locked'
        ? t('notif.locked', 'Account and security notices cannot be switched off.')
        : t('common.failed', 'Failed.'));
      load();
    }
  };

  if (!cats) return null;
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2"><Sliders size={15} className="text-[var(--primary-2)]" /> {t('notif.prefs', 'What you hear about')}</div>
      <p className="text-[12px] text-[var(--muted)] mb-3">
        {t('notif.prefs.s', 'Switching a category off stops those notifications being created at all — they are not hidden and kept, so turning it back on shows nothing from the meantime.')}
      </p>
      <div className="divide-y divide-[var(--line)]">
        {cats.map((c) => (
          <label key={c.key} className={`py-2.5 flex items-center gap-3 ${c.locked ? 'opacity-70' : 'cursor-pointer'}`}>
            <input type="checkbox" checked={c.enabled} disabled={c.locked} onChange={() => !c.locked && toggle(c)} />
            <span className="flex-1 text-[13px]">{t(`notif.cat.${c.key}`, c.label)}</span>
            {c.locked && (
              <span className="text-[11px] text-[var(--faint)] flex items-center gap-1">
                <Lock size={11} /> {t('notif.always', 'always on')}
              </span>
            )}
          </label>
        ))}
      </div>
    </Card>
  );
}

// The staff half. Only rendered when /admin/pending answers — which it does for anyone with
// a moderation capability and 403s for everybody else, so the page needs no role logic of
// its own beyond "did that work".
function StaffQueues() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/admin/pending').then(setData).catch(() => setData(null)); }, []);
  if (!data || !data.total) return null;

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold mb-1 flex items-center gap-2">
        <ShieldCheck size={15} className="text-[var(--primary-2)]" /> {t('notif.staff', 'Waiting for you')}
        <Badge tone="amber">{data.total}</Badge>
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-3">{t('notif.staff.s', 'Queues you can act on. Counted live, not stored — so nothing here can be "read" without being dealt with.')}</p>
      <div className="space-y-1">
        {(data.queues || []).filter((q) => q.n).map((q) => (
          <Link key={q.key} to={q.to} className="flex items-center gap-2 py-1.5 text-[13px] hover:text-[var(--primary-2)]">
            <Badge tone="amber">{q.n}</Badge>
            <span className="flex-1">{t(`notif.queue.${q.key}`, q.key)}</span>
            <ArrowRight size={13} className="text-[var(--faint)]" />
          </Link>
        ))}
      </div>
    </Card>
  );
}

export default function NotificationCentre() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const { user, loading } = useAuth();
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = () => api.get('/me/notifications').then((r) => setItems(r.notifications || [])).catch(() => setItems([]));
  useEffect(() => { if (user) load(); }, [user]);

  if (loading) return null;
  if (!user) {
    return (
      <div className="max-w-lg mx-auto py-12">
        <Card className="p-7 text-center">
          <Bell size={22} className="text-[var(--primary-2)] mx-auto mb-3" />
          <p className="text-sm text-[var(--muted)] mb-4">{t('notif.signin', 'Sign in to see your notifications.')}</p>
          <Link to="/auth?next=/notifications"><Button variant="primary">{t('nav.signin', 'Sign in')}</Button></Link>
        </Card>
      </div>
    );
  }

  const shown = (items || []).filter((n) => (filter === 'unread' ? !n.readAt : true));
  const unread = (items || []).filter((n) => !n.readAt).length;

  const markAll = async () => {
    setItems((s) => s.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString() })));
    try { await api.post('/me/notifications/read-all'); } catch { load(); }
  };
  const remove = async (n) => {
    setItems((s) => s.filter((x) => x.id !== n.id));
    try { await api.del(`/me/notifications/${n.id}`); } catch { load(); }
  };
  const clearAll = async () => {
    if (!await dialog.confirm({
      title: t('notif.clear.t', 'Delete every notification?'),
      message: t('notif.clear.m', 'They go for good. Anything still waiting for you — a report, a suspended item — stays waiting; this only clears the messages about it.'),
      okLabel: t('common.delete', 'Delete'), danger: true,
    })) return;
    setItems([]);
    try { await api.del('/me/notifications'); toast.success(t('common.deleted', 'Deleted.')); } catch { load(); }
  };

  return (
    <div className="max-w-3xl mx-auto py-8">
      <div className="flex items-center gap-3 mb-5">
        <span className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--line)]"><Bell size={20} className="text-[var(--primary-2)]" /></span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold leading-tight">{t('notif.title', 'Notifications')}</h1>
          <p className="text-sm text-[var(--muted)]">{unread ? t('notif.unread', '{n} unread').replace('{n}', String(unread)) : t('notif.allread', 'Nothing unread.')}</p>
        </div>
      </div>

      <StaffQueues />

      <Card className="p-0 overflow-hidden mt-4">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--line)]">
          <div className="inline-flex rounded-[10px] bg-[var(--surface-2)] p-0.5">
            {[['all', t('notif.f.all', 'All')], ['unread', t('notif.f.unread', 'Unread')]].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`px-2.5 py-1 rounded-[8px] text-[12px] ${filter === k ? 'bg-[var(--bg-solid)] font-medium' : 'text-[var(--muted)]'}`}>{l}</button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            {unread > 0 && <Button size="sm" variant="ghost" onClick={markAll}><CheckCheck size={13} /> {t('notif.markall', 'Mark all read')}</Button>}
            {(items || []).length > 0 && <Button size="sm" variant="ghost" onClick={clearAll}><Trash2 size={13} /> {t('notif.clear', 'Clear')}</Button>}
          </div>
        </div>

        {items === null ? <div className="p-6"><Spinner /></div>
          : !shown.length ? (
            <div className="p-6">
              <EmptyState icon={Inbox}
                title={filter === 'unread' ? t('notif.none.unread', 'Nothing unread.') : t('notif.none', 'No notifications yet.')}
                sub={t('notif.none.s', 'Things that need you — a repo going online, a report answered, a price changing — arrive here.')} />
            </div>
          ) : (
            <div className="divide-y divide-[var(--line)]">
              {shown.map((n) => (
                <div key={n.id} className={`px-4 py-3 flex items-start gap-3 ${n.readAt ? '' : 'bg-[var(--primary)]/5'}`}>
                  {!n.readAt && <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] mt-1.5 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">{n.kind}</div>
                    <div className="text-[13px] text-[var(--muted)] break-words">{n.bodyFr && document.documentElement.lang === 'fr' ? n.bodyFr : n.body}</div>
                    <div className="text-[11px] text-[var(--faint)] mt-0.5">{timeAgo(n.createdAt, t)}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => remove(n)} title={t('common.delete', 'Delete')}><Trash2 size={12} /></Button>
                </div>
              ))}
            </div>
          )}
      </Card>

      <div className="mt-4"><Preferences /></div>
    </div>
  );
}
