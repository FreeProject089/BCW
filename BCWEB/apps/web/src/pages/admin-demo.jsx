// Demo mode: the admin half of apps/api/src/routes/demo.mjs.
//
// What the API guarantees, and what this screen must therefore never pretend otherwise:
//   · demo mode is an OVERLAY. It writes one AdminSetting row (the session) and nothing else;
//     the dataset below is generated from a seed on every read and stored nowhere;
//   · it changes nothing for anybody else: visitors keep seeing the real site, so this is a
//     screen to present from, not a switch that turns the site into a demo;
//   · every route is requireRole('ADMIN') (not a capability, on purpose: see demo.mjs), so
//     the tab, the banner and the first-run call to action are drawn for admins only;
//   · a demo "action" is recorded in memory and the reply says `persisted: false`. The screen
//     repeats that in words next to the list, so a click never reads as "saved".
//
// Two failure answers are part of the contract and each gets its own words:
//   409 demo_session_changed  somebody (or another tab) restarted the demo; the body carries
//                             the new session, so we switch to it rather than show an error
//   404 demo_off              the demo ended (stopped, or its clock ran out: expiry is lazy)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlayCircle, Square, Clock, Users, Package, Newspaper, TrendingUp, Bot, CreditCard, CheckCircle2, AlertTriangle, RefreshCw, Sliders, BookOpen, Boxes, FlaskConical } from 'lucide-react';
import { Card, Badge, Button, Input, Field, Spinner, EmptyState, Explain, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

const EVT = 'bcw:demo-changed';
const announce = () => { try { window.dispatchEvent(new Event(EVT)); } catch { /* SSR / tests */ } };

/** Seconds left, ticking locally from the server's `expiresInSec` and the moment it was read. */
function useSecondsLeft(session) {
  const base = useRef({ at: 0, sec: 0 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { base.current = { at: Date.now(), sec: session?.expiresInSec ?? 0 }; setNow(Date.now()); }, [session?.id, session?.expiresInSec]);
  useEffect(() => {
    if (!session) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);
  if (!session) return 0;
  return Math.max(0, Math.round(base.current.sec - (now - base.current.at) / 1000));
}

export const fmtLeft = (sec) => {
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

/** Status of the demo, re-read on a slow poll and whenever a screen says it changed. */
function useDemoStatus(enabled = true) {
  const [st, setSt] = useState(null);
  const load = useCallback(() => api.get('/admin/demo').then((r) => { setSt(r); return r; }).catch(() => { setSt((s) => s || { active: false, session: null, error: true }); return null; }), []);
  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const id = setInterval(load, 60_000);
    window.addEventListener(EVT, load);
    return () => { clearInterval(id); window.removeEventListener(EVT, load); };
  }, [enabled, load]);
  return [st, load];
}

/**
 * The thin strip every admin screen shows while a demo runs, so nobody presents from the
 * dashboard without knowing the figures on the demo screen are generated. Admins only (the
 * route is admin-only; a MOD would get a 403 on every poll).
 */
export function DemoBanner({ current }) {
  const { t } = useI18n();
  const [st] = useDemoStatus(true);
  const session = st?.active ? st.session : null;
  const left = useSecondsLeft(session);
  if (!session || current === 'demo') return null;
  return (
    <div className="mb-3 rounded-xl border border-[var(--primary)] tint-primary px-3 py-2 flex items-center gap-2 flex-wrap text-sm" role="status" data-demo-banner>
      <FlaskConical size={15} className="text-[var(--accent-ink)] shrink-0" />
      <span className="font-medium">{t('demo.banner.on', 'Demo mode is on')}</span>
      <span className="text-[var(--muted)] tabular-nums">{t('demo.left', '{t} left').replace('{t}', fmtLeft(left))}</span>
      <Link to="/admin?s=demo" className="ms-auto text-[var(--accent-ink)] font-medium hover:underline">{t('demo.open', 'Open the demo')}</Link>
    </div>
  );
}

function Tile({ icon: Icon, label, value }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)] mb-1"><Icon size={12} /> {label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

function DemoDataset({ data, onAction, busyAction }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const days = data.analytics || [];
  const peak = Math.max(1, ...days.map((d) => d.views));
  const items = showAll ? data.catalog : data.catalog.slice(0, 12);
  const kinds = useMemo(() => data.catalog.reduce((a, c) => ({ ...a, [c.kind]: (a[c.kind] || 0) + 1 }), {}), [data.catalog]);
  return (
    <div className="space-y-4" data-demo-dataset>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Tile icon={Users} label={t('demo.t.users', 'Accounts')} value={data.totals.users} />
        <Tile icon={Package} label={t('demo.t.items', 'Catalogue items')} value={data.totals.catalog} />
        <Tile icon={CheckCircle2} label={t('demo.t.published', 'Published')} value={data.totals.published} />
        <Tile icon={Newspaper} label={t('demo.t.posts', 'Blog posts')} value={data.totals.posts} />
      </div>

      <Card className="p-4">
        <div className="text-sm font-semibold mb-2 flex items-center gap-2"><TrendingUp size={15} className="text-[var(--accent-ink)]" /> {t('demo.traffic', 'Visits, last 30 days')}</div>
        <div className="flex items-end gap-[3px] h-28" aria-hidden="true">
          {days.map((d) => (
            <div key={d.date} className="flex-1 min-w-0 rounded-t bg-gradient-to-t from-brand to-brand-2" style={{ height: `${Math.max(3, (d.views / peak) * 100)}%` }} title={`${d.date} · ${d.views}`} />
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-[var(--faint)] mt-1"><span>{days[0]?.date}</span><span>{days[days.length - 1]?.date}</span></div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4 min-w-0">
          <div className="text-sm font-semibold mb-2 flex items-center gap-2 flex-wrap"><Package size={15} className="text-[var(--accent-ink)]" /> {t('demo.catalog', 'Catalogue')}
            <span className="text-[11px] font-normal text-[var(--faint)]">{Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(' · ')}</span></div>
          <div className="divide-y divide-[var(--line)]">
            {items.map((c) => (
              <div key={c.id} className="py-1.5 flex items-center gap-2 text-xs min-w-0">
                <Badge tone="">{c.kind}</Badge>
                <span className="truncate flex-1 min-w-0 font-medium" title={c.name}>{c.name}</span>
                <Badge tone={c.status === 'PUBLISHED' ? 'green' : c.status === 'PENDING' ? 'amber' : c.status === 'REJECTED' ? 'red' : ''}>{c.status}</Badge>
                <span className="tabular-nums text-[var(--muted)] w-14 text-end shrink-0">{c.downloads}</span>
                {c.status === 'PENDING' && (
                  <Button size="sm" variant="ghost" disabled={busyAction} onClick={() => onAction('publish', c.name)} title={t('demo.act.h', 'Recorded for this demo only, nothing is saved')}>{t('demo.act.publish', 'Publish')}</Button>
                )}
              </div>
            ))}
          </div>
          {data.catalog.length > 12 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAll((v) => !v)}>{showAll ? t('demo.less', 'Show less') : t('demo.all', 'Show all {n}').replace('{n}', String(data.catalog.length))}</Button>}
        </Card>

        <div className="space-y-4 min-w-0">
          <Card className="p-4">
            <div className="text-sm font-semibold mb-2 flex items-center gap-2"><Users size={15} className="text-[var(--accent-ink)]" /> {t('demo.users', 'Accounts')}</div>
            <div className="divide-y divide-[var(--line)]">
              {data.users.map((u) => (
                <div key={u.id} className="py-1.5 flex items-center gap-2 text-xs min-w-0">
                  <span className="truncate flex-1 min-w-0 font-medium" title={u.email}>{u.displayName}</span>
                  {u.role !== 'USER' && <Badge tone="primary">{u.role}</Badge>}
                  <span className="text-[var(--faint)] shrink-0">{t('demo.lvl', 'lvl {n}').replace('{n}', String(u.level))}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm font-semibold mb-2 flex items-center gap-2"><Newspaper size={15} className="text-[var(--accent-ink)]" /> {t('demo.posts', 'Blog')}</div>
            {data.posts.map((p) => (
              <div key={p.id} className="py-1 text-xs flex items-center gap-2 min-w-0">
                <span className="truncate flex-1 min-w-0" title={p.title}>{p.title}</span>
                <span className="text-[var(--faint)] shrink-0">{new Date(p.publishedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </Card>
          <div className="grid sm:grid-cols-2 gap-2.5">
            <Card className="p-3 text-xs">
              <div className="font-semibold mb-1 flex items-center gap-1.5"><Bot size={13} /> {data.discord.guildName}</div>
              <div className="text-[var(--muted)]">{t('demo.discord', '{m} members · {o} online').replace('{m}', String(data.discord.members)).replace('{o}', String(data.discord.online))}</div>
              <div className="text-[var(--faint)] mt-1">{t('demo.nobot', 'No bot connection in demo mode.')}</div>
            </Card>
            <Card className="p-3 text-xs">
              <div className="font-semibold mb-1 flex items-center gap-1.5"><CreditCard size={13} /> {t('demo.billing', 'Billing')}</div>
              <div className="text-[var(--muted)]">{t('demo.mrr', '{v} € / month · {n} subscriptions').replace('{v}', String(data.billing.mrr)).replace('{n}', String(data.billing.subscriptions))}</div>
              <div className="text-[var(--faint)] mt-1">{t('demo.nostripe', 'No Stripe call in demo mode.')}</div>
            </Card>
          </div>
        </div>
      </div>

      {data.overlay?.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-semibold mb-1">{t('demo.overlay', 'What you did in this demo')}</div>
          <div className="text-[11px] text-[var(--faint)] mb-2">{t('demo.overlay.s', 'Kept in memory for this demo only. Nothing reached the database.')}</div>
          {data.overlay.slice().reverse().map((o, i) => (
            <div key={`${o.at}-${i}`} className="text-xs py-0.5 flex gap-2 min-w-0">
              <span className="text-[var(--faint)] tabular-nums shrink-0">{new Date(o.at).toLocaleTimeString()}</span>
              <span className="font-medium shrink-0">{o.action}</span>
              <span className="truncate text-[var(--muted)] min-w-0" title={o.note}>{o.note}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/** Admin → Demo mode. */
export function AdminDemo() {
  const { t } = useI18n(); const toast = useToast();
  const [st, reloadStatus] = useDemoStatus(true);
  const [form, setForm] = useState({ minutes: '60', items: '120', label: '' });
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [dataErr, setDataErr] = useState('');
  const [acting, setActing] = useState(false);
  const [lastStop, setLastStop] = useState(null);
  const session = st?.active ? st.session : null;
  const left = useSecondsLeft(session);

  const loadData = useCallback(async (sid) => {
    if (!sid) { setData(null); return; }
    try { setData(await api.get(`/admin/demo/data?session=${encodeURIComponent(sid)}`)); setDataErr(''); }
    catch (x) {
      if (x?.status === 409 && x.data?.error === 'demo_session_changed') {
        // Restarted elsewhere: follow the live session instead of showing a stale dataset.
        toast.info(t('demo.changed', 'The demo was restarted elsewhere, showing the new one.'));
        reloadStatus(); announce();
      } else if (x?.status === 404) {
        setData(null); setDataErr('off'); reloadStatus(); announce();
      } else setDataErr('failed');
    }
  }, [reloadStatus, t, toast]);

  useEffect(() => { loadData(session?.id); }, [session?.id, loadData]);
  // The clock ran out while the screen was open: ask the server, which removes it lazily.
  useEffect(() => { if (session && left === 0) { const id = setTimeout(() => { reloadStatus(); announce(); }, 1500); return () => clearTimeout(id); } return undefined; }, [session, left, reloadStatus]);

  const start = async () => {
    const minutes = Math.min(480, Math.max(1, parseInt(form.minutes, 10) || 60));
    const items = Math.min(400, Math.max(1, parseInt(form.items, 10) || 120));
    setBusy(true);
    try {
      await api.post('/admin/demo', { minutes, items, ...(form.label.trim() ? { label: form.label.trim() } : {}) });
      setLastStop(null);
      toast.success(t('demo.started', 'Demo started.'));
      await reloadStatus(); announce();
    } catch (x) {
      toast.error(x?.data?.error === '2fa_required' ? t('demo.need2fa', 'Turn on two-factor authentication first.') : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true);
    try {
      // undo: stopping deletes no real data (the demo is generated from a seed and stored
      // nowhere); "undoing" it would be starting another demo, which is the button below.
      const r = await api.del('/admin/demo');
      setLastStop(r); setData(null);
      toast.success(t('demo.stopped', 'Demo stopped. Nothing is left behind.'));
    } catch (x) {
      if (x?.status === 500 && x.data?.error === 'demo_not_clean') { setLastStop(x.data); toast.error(t('demo.notclean', 'Stopped, but something demo was still found. See the check below.')); }
      else toast.error(t('common.failed', 'Failed.'));
    } finally { setBusy(false); reloadStatus(); announce(); }
  };

  const act = async (action, note) => {
    if (!session) return;
    setActing(true);
    try {
      await api.post('/admin/demo/actions', { session: session.id, action, note });
      toast.success(t('demo.acted', 'Done in the demo. Nothing was saved.'));
      loadData(session.id);
    } catch (x) {
      if (x?.status === 409) { reloadStatus(); announce(); }
      else if (x?.status === 404) { setDataErr('off'); reloadStatus(); announce(); }
      else toast.error(t('common.failed', 'Failed.'));
    } finally { setActing(false); }
  };

  if (!st) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2 flex-1"><FlaskConical size={16} className="text-[var(--accent-ink)]" /> {t('demo.title', 'Demo mode')}</h2>
        <Button size="sm" variant="ghost" onClick={() => { reloadStatus(); if (session) loadData(session.id); }}><RefreshCw size={13} /> {t('common.refresh', 'Refresh')}</Button>
      </div>
      <Explain summary={t('demo.what', 'Believable content to present the dashboard with, generated and stored nowhere.')}>
        <p className="text-sm text-[var(--muted)]">{t('demo.what.more', 'Only this screen shows the demo: visitors keep seeing the real site. No mail is sent, Stripe is never called and the bot is never connected. Stopping removes the one setting it wrote, and the check below proves it.')}</p>
      </Explain>

      {session ? (
        <div className="rounded-xl border border-[var(--primary)] tint-primary p-3 flex items-center gap-3 flex-wrap" role="status" data-demo-live>
          <FlaskConical size={18} className="text-[var(--accent-ink)] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold">{t('demo.banner.on', 'Demo mode is on')}{session.label ? ` · ${session.label}` : ''}</div>
            <div className="text-xs text-[var(--muted)] flex items-center gap-1.5 flex-wrap">
              <Clock size={12} /> <span className="tabular-nums">{t('demo.left', '{t} left').replace('{t}', fmtLeft(left))}</span>
              <span>· {t('demo.items', '{n} items').replace('{n}', String(session.n))}</span>
            </div>
          </div>
          <Button variant="danger" disabled={busy} onClick={stop}>{busy ? <Spinner /> : <><Square size={14} /> {t('demo.stop', 'Stop the demo')}</>}</Button>
        </div>
      ) : (
        <Card className="p-4">
          <div className="text-sm font-semibold mb-3 flex items-center gap-2"><PlayCircle size={15} className="text-[var(--accent-ink)]" /> {t('demo.start.t', 'Start a demo')}</div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label={t('demo.minutes', 'Duration (minutes, max 480)')}>
              <Input type="number" min={1} max={480} value={form.minutes} onChange={(e) => setForm((f) => ({ ...f, minutes: e.target.value }))} />
            </Field>
            <Field label={t('demo.size', 'Catalogue size (max 400)')}>
              <Input type="number" min={1} max={400} value={form.items} onChange={(e) => setForm((f) => ({ ...f, items: e.target.value }))} />
            </Field>
            <Field label={t('demo.label', 'Label (optional)')}>
              <Input value={form.label} maxLength={80} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder={t('demo.label.ph', 'Partner meeting')} />
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="primary" disabled={busy} onClick={start}>{busy ? <Spinner /> : <><PlayCircle size={14} /> {t('demo.start', 'Start the demo')}</>}</Button>
          </div>
        </Card>
      )}

      {dataErr === 'off' && !session && <div className="text-sm text-[var(--muted)]">{t('demo.ended', 'The demo has ended.')}</div>}
      {dataErr === 'failed' && <div className="text-sm text-error">{t('demo.loadfail', 'Could not load the demo data.')}</div>}

      {lastStop && (
        <Card className="p-3 text-xs flex items-center gap-2 flex-wrap" data-demo-audit>
          {lastStop.audit?.clean ? <CheckCircle2 size={14} className="text-success" /> : <AlertTriangle size={14} className="text-error" />}
          <span className="font-medium">{lastStop.audit?.clean ? t('demo.clean', 'Clean: nothing demo remains.') : t('demo.dirty', 'Not clean: demo traces remain.')}</span>
          <span className="text-[var(--muted)]">{t('demo.removed', '{s} setting(s) and {o} in-memory list(s) removed').replace('{s}', String(lastStop.removed?.settings ?? 0)).replace('{o}', String(lastStop.removed?.overlays ?? 0))}</span>
        </Card>
      )}

      {session && !data && !dataErr && <Spinner />}
      {session && data && <DemoDataset data={data} onAction={act} busyAction={acting} />}
    </div>
  );
}

/**
 * What a fresh install shows on "Needs attention": every queue empty is also what a brand-new
 * site looks like, and "nothing waiting" alone reads as a dead end. The next steps, with demo
 * mode first for an admin who wants to see the dashboard with something in it.
 */
export function AdminFirstRun({ isAdmin }) {
  const { t } = useI18n();
  const steps = [
    isAdmin && { to: '/admin?s=demo', icon: FlaskConical, title: t('fr.demo', 'Try demo mode'), sub: t('fr.demo.s', 'See the dashboard full of generated content, stored nowhere.') },
    isAdmin && { to: '/admin?s=settings', icon: Sliders, title: t('fr.settings', 'Set up the site'), sub: t('fr.settings.s', 'Name, limits, anti-abuse and retention.') },
    isAdmin && { to: '/admin?s=catalogs', icon: Boxes, title: t('fr.catalog', 'Publish a first entry'), sub: t('fr.catalog.s', 'An official app, plugin or theme, live at once.') },
    { to: '/admin?s=guide', icon: BookOpen, title: t('fr.guide', 'Read the admin guide'), sub: t('fr.guide.s', 'What each screen is for, in a few lines.') },
  ].filter(Boolean);
  return (
    <div data-first-run>
      <EmptyState icon={CheckCircle2} title={t('nq.clear.t', 'Nothing waiting')} sub={t('fr.sub', 'Every queue you can act on is empty. On a new site, here is where to start.')} />
      <div className="grid sm:grid-cols-2 gap-2.5 mt-3">
        {steps.map((s) => (
          <Link key={s.to} to={s.to} className="block">
            <Card className="p-3.5 h-full hover:border-[var(--primary)] transition-colors flex items-start gap-3">
              <span className="grid place-items-center w-8 h-8 rounded-lg tint-primary shrink-0"><s.icon size={15} className="text-[var(--accent-ink)]" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{s.title}</span>
                <span className="block text-xs text-[var(--muted)]">{s.sub}</span>
              </span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
