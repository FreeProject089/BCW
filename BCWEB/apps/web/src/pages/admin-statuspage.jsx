// The public status page, from the inside: what broke, and what we told people about it.
//
// `IncidentNote` has existed since the status page shipped, the public page renders every note
// marked public, and NOTHING could write one. So every incident on the page read "no account of
// this one" — which is precisely what somebody opens a status page to read.
//
// There is no "create an incident" button, deliberately. An outage row is written by the
// monitor when a probe stops answering; incidents typed in by hand would disagree with the
// uptime bars drawn from those same rows, and a status page that argues with itself is worth
// less than none.
import { useState } from 'react';
import { Activity, RefreshCw, PenSquare, Send, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Select, Badge, Textarea, Spinner, EmptyState, useToast, useDialog } from '../ui/ui.jsx';
import { useAsync, Loading } from './pages.jsx';

export default function AdminStatusPage() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [days, setDays] = useState(90);
  const { data, loading, reload } = useAsync(() => api.get(`/admin/status/incidents?days=${days}`), [days]);
  const [open, setOpen] = useState(null);            // which outage is being written about
  const [f, setF] = useState({ state: 'investigating', body: '', publicNote: true });
  const [busy, setBusy] = useState(false);

  // The four states a reader understands, in the words they would use. "investigating" is what
  // the column stores; "Looking into it" is what the page says.
  const STATES = [
    ['investigating', t('stp.n.investigating', 'Looking into it')],
    ['identified', t('stp.n.identified', 'Cause found')],
    ['monitoring', t('stp.n.monitoring', 'Fix in place, watching')],
    ['resolved', t('stp.n.resolved', 'Over')],
  ];

  const post = async (id) => {
    if (!f.body.trim()) return toast.error(t('stp.n.needbody', 'Say what happened — an empty update is worse than none.'));
    setBusy(true);
    try {
      await api.post(`/admin/status/incidents/${id}/notes`, { state: f.state, body: f.body.trim(), publicNote: f.publicNote });
      toast.success(f.publicNote ? t('stp.n.posted', 'Posted to the status page.') : t('stp.n.saved', 'Saved — internal only.'));
      setF({ state: 'investigating', body: '', publicNote: true });
      setOpen(null);
      reload();
    } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); }
  };

  const toggleVisible = async (n) => {
    try { await api.patch(`/admin/status/notes/${n.id}`, { publicNote: !n.publicNote }); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const remove = async (n) => {
    const ok = await dialog.confirm({
      title: t('stp.n.del.t', 'Delete this update?'),
      message: t('stp.n.del.m', 'Hiding it from the page is one click away and keeps the record. Deleting is for an update that should never have been published at all.'),
      okLabel: t('common.delete', 'Delete'), danger: true,
    });
    if (!ok) return;
    try { await api.del(`/admin/status/notes/${n.id}`); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const outages = data?.outages || [];
  return (
    <div>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2 mr-2">
          <Activity size={16} className="text-[var(--primary-2)]" /> {t('stp.title', 'Status page')}
        </h2>
        <Select className="w-auto ml-auto" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          <option value="30">{t('cls.d30', 'Last 30 days')}</option>
          <option value="90">{t('cls.d90', 'Last 90 days')}</option>
          <option value="365">{t('cls.d365', 'Last year')}</option>
        </Select>
        <Button size="sm" variant="ghost" onClick={reload}><RefreshCw size={13} /> {t('common.refresh', 'Refresh')}</Button>
      </div>
      <p className="text-sm text-[var(--muted)] mb-4">
        {t('stp.sub', 'Every outage the probes recorded, and the account people read. Incidents are not created here — the monitor writes them when a service stops answering, so the page can never disagree with its own uptime bars.')}
        {' '}
        <a className="underline" href="/status" target="_blank" rel="noreferrer">{t('stp.open', 'Open the public page')}</a>
      </p>

      {loading && !data ? <Loading /> : !outages.length ? (
        <EmptyState icon={CheckCircle2} title={t('stp.none', 'Nothing has broken in this window.')}
          sub={t('stp.none.s', 'Which is the good state — and is what the public page says too.')} />
      ) : (
        <div className="space-y-3">
          {outages.map((o) => {
            const mins = Math.round(((o.endedAt ? new Date(o.endedAt) : new Date()) - new Date(o.startedAt)) / 60000);
            return (
              <Card key={o.id} className="p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone={o.endedAt ? 'green' : 'red'}>{o.endedAt ? t('stp.over', 'Over') : t('stp.ongoing', 'Ongoing')}</Badge>
                  <span className="font-medium">{o.service}</span>
                  <span className="text-[12px] text-[var(--faint)]">{new Date(o.startedAt).toLocaleString()} · {mins} min</span>
                  <Button size="sm" className="ml-auto" onClick={() => setOpen(open === o.id ? null : o.id)}>
                    <PenSquare size={13} /> {t('stp.n.add', 'Write an update')}
                  </Button>
                </div>
                {o.cause && <div className="text-[12px] text-[var(--muted)] mt-1">{t('stp.cause', 'Cause')}: {o.cause}</div>}

                {(o.notes || []).length > 0 && (
                  <div className="mt-3 space-y-2 border-l-2 border-[var(--line)] pl-3">
                    {o.notes.map((n) => (
                      <div key={n.id} className="text-[12px]">
                        <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--faint)]">
                          <span className="font-medium text-[var(--text)]">{STATES.find(([k]) => k === n.state)?.[1] || n.state}</span>
                          <span>{new Date(n.createdAt).toLocaleString()}</span>
                          {n.authorLabel && <span>· {n.authorLabel}</span>}
                          {!n.publicNote && <Badge>{t('stp.n.internal', 'internal')}</Badge>}
                          <button className="ml-auto hover:text-[var(--text)]" onClick={() => toggleVisible(n)}>
                            {n.publicNote ? t('stp.n.hide', 'Hide from the page') : t('stp.n.show', 'Publish')}
                          </button>
                          <button className="hover:text-[var(--danger)]" onClick={() => remove(n)}>{t('common.delete', 'Delete')}</button>
                        </div>
                        <div className="text-[var(--muted)] whitespace-pre-wrap break-words">{n.body}</div>
                      </div>
                    ))}
                  </div>
                )}

                {open === o.id && (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2 flex-wrap items-center">
                      <Select className="w-auto" value={f.state} onChange={(e) => setF((x) => ({ ...x, state: e.target.value }))}>
                        {STATES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                      </Select>
                      {/* Public by choice, not by default-off: the point of the note is that
                          people outside the team read it. Internal is for the detail that
                          would only worry them. */}
                      <label className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]">
                        <input type="checkbox" checked={f.publicNote}
                          onChange={(e) => setF((x) => ({ ...x, publicNote: e.target.checked }))} />
                        {t('stp.n.public', 'Show on the public page')}
                      </label>
                    </div>
                    <Textarea rows={3} value={f.body} onChange={(e) => setF((x) => ({ ...x, body: e.target.value }))}
                      placeholder={t('stp.n.ph', 'What is happening, in the words you would use to a person waiting for it to work again.')} />
                    <div className="flex gap-2">
                      <Button variant="primary" size="sm" disabled={busy} onClick={() => post(o.id)}>
                        {busy ? <Spinner /> : <><Send size={13} /> {t('stp.n.send', 'Post the update')}</>}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>{t('common.cancel', 'Cancel')}</Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
