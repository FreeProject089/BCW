// Admin: the conversations between members (repo / catalogue / profile / team contact),
// to MODERATE — hide a message, block a sender, close — and the anti-spam limits. Staff do
// not answer for the owners; the flagged ones are what they read first.
import { useState } from 'react';
import { MessageSquare, Flag, Lock, Ban, EyeOff, Eye, RefreshCw, Sliders } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAsync } from './pages.jsx';
import { Button, Card, Badge, Input, Field, Select, EmptyState, Spinner, useToast, useDialog } from '../ui/ui.jsx';

const when = (d) => new Date(d).toLocaleString();

function AdminThreadDetail({ id, onBack, onChanged }) {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const { data, loading, reload } = useAsync(() => api.get(`/admin/threads/${id}`), [id]);
  if (loading && !data) return <div className="py-6 text-center"><Spinner /></div>;
  const th = data?.thread; if (!th) return null;
  const act = async (path, confirm) => {
    if (confirm && !await dialog.confirm({ ...confirm, danger: true })) return;
    try { await api.post(path); await reload(); onChanged?.(); } catch { toast.error(t('common.failed', 'Failed.')); }
  };
  return (
    <div className="space-y-3">
      <Button size="sm" variant="ghost" onClick={onBack}>← {t('adm.th.back', 'All conversations')}</Button>
      <Card className="p-4 space-y-3">
        <div className="flex items-start gap-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{th.subject}</div>
            <div className="text-[12px] text-[var(--muted)]">{th.kind} · {th.targetLabel} · {t('adm.th.from', 'from')} {th.sender?.displayName || th.senderName || t('th.anon', 'an anonymous sender')} {th.senderEmail ? `<${th.senderEmail}>` : ''} · {t('adm.th.to', 'to')} {th.ownerTeam?.name || th.ownerUser?.displayName || '—'} · IP {th.ip || '—'}</div>
          </div>
          {th.staffFlag === 'flagged' && <Badge tone="warning"><Flag size={10} /> {t('adm.th.flagged', 'flagged')}</Badge>}
          <Badge tone={th.status === 'open' ? 'success' : th.status === 'blocked' ? 'error' : ''}>{th.status}</Badge>
        </div>
        <div className="space-y-2 max-h-[50vh] overflow-auto">
          {th.messages.map((m) => (
            <div key={m.id} className={`rounded-xl border px-3 py-2 text-sm ${m.hidden ? 'border-dashed border-error/50 opacity-70' : 'border-[var(--line)]'}`}>
              <div className="text-[11px] text-[var(--faint)] flex items-center gap-2"><span>{m.side} · {m.author || '—'} · {when(m.createdAt)}</span><span className="flex-1" />
                <button type="button" className="inline-flex items-center gap-1 hover:text-[var(--text)]" onClick={() => act(`/admin/threads/${th.id}/messages/${m.id}/${m.hidden ? 'unhide' : 'hide'}`)}>{m.hidden ? <><Eye size={11} /> {t('adm.th.unhide', 'Unhide')}</> : <><EyeOff size={11} /> {t('adm.th.hide', 'Hide')}</>}</button>
              </div>
              <div className="whitespace-pre-wrap break-words mt-1">{m.body}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap pt-2 border-t border-[var(--line)]">
          {th.status !== 'closed' && <Button size="sm" variant="ghost" onClick={() => act(`/admin/threads/${th.id}/close`)}><Lock size={13} /> {t('adm.th.close', 'Close')}</Button>}
          {th.status !== 'blocked' && <Button size="sm" variant="ghost" className="!text-error" onClick={() => act(`/admin/threads/${th.id}/block`, { title: t('adm.th.block.q', 'Block this sender?'), message: t('adm.th.block.m', 'Their account / e-mail can no longer open or answer conversations; every thread they opened is blocked.') })}><Ban size={13} /> {t('adm.th.block', 'Block the sender')}</Button>}
        </div>
      </Card>
    </div>
  );
}

function ThreadsConfig() {
  const { t } = useI18n(); const toast = useToast();
  const { data, reload } = useAsync(() => api.get('/admin/threads/config'), []);
  const [f, setF] = useState(null); const [busy, setBusy] = useState(false);
  const cfg = f || data?.config; if (!cfg) return null;
  const num = (k, label) => <Field label={label}><Input type="number" min={0} value={cfg[k]} onChange={(e) => setF({ ...cfg, [k]: Number(e.target.value) || 0 })} /></Field>;
  const save = async () => { setBusy(true); try { await api.put('/admin/threads/config', { ...cfg, blockedEmails: String(cfg.blockedEmailsText ?? cfg.blockedEmails.join('\n')).split(/\s+/).filter(Boolean) }); setF(null); await reload(); toast.success(t('common.saved', 'Saved.')); } catch { toast.error(t('common.failed', 'Failed.')); } finally { setBusy(false); } };
  return (
    <Card className="p-4 space-y-3">
      <div className="font-semibold flex items-center gap-2"><Sliders size={15} /> {t('adm.th.cfg', 'Limits & blocked senders')}</div>
      <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={cfg.enabled !== false} onChange={(e) => setF({ ...cfg, enabled: e.target.checked })} /> {t('adm.th.enabled', 'Members can message each other')}</label>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {num('userPerHour', t('adm.th.uph', 'Account / hour'))}{num('userPerDay', t('adm.th.upd', 'Account / day'))}
        {num('anonPerHour', t('adm.th.aph', 'Anonymous / hour'))}{num('anonPerDay', t('adm.th.apd', 'Anonymous / day'))}
        {num('messagesPerHour', t('adm.th.mph', 'Replies / hour'))}{num('maxBody', t('adm.th.max', 'Max length'))}
      </div>
      <Field label={t('adm.th.blockedmails', 'Blocked e-mails (one per line)')}><textarea className="input" rows={3} value={cfg.blockedEmailsText ?? (cfg.blockedEmails || []).join('\n')} onChange={(e) => setF({ ...cfg, blockedEmailsText: e.target.value })} /></Field>
      <div className="text-[12px] text-[var(--muted)]">{t('adm.th.blockedusers', 'Blocked accounts')}: {(cfg.blockedUserIds || []).length} {(cfg.blockedUserIds || []).length > 0 && <button type="button" className="text-[var(--primary-2)] hover:underline" onClick={() => setF({ ...cfg, blockedUserIds: [] })}>{t('adm.th.unblockall', 'unblock all')}</button>}</div>
      <div className="flex justify-end"><Button size="sm" variant="primary" loading={busy} disabled={!f} onClick={save}>{t('common.save', 'Save')}</Button></div>
    </Card>
  );
}

export function AdminThreads() {
  const { t } = useI18n();
  const [status, setStatus] = useState('flagged'); const [q, setQ] = useState(''); const [open, setOpen] = useState(null);
  const { data, loading, reload } = useAsync(() => api.get(`/admin/threads?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`), [status, q]);
  if (open) return <AdminThreadDetail id={open} onBack={() => setOpen(null)} onChanged={reload} />;
  const rows = data?.threads || [];
  return (
    <div className="space-y-4 mt-6">
      <Card className="p-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <MessageSquare size={16} className="text-[var(--primary-2)]" />
          <div className="font-semibold">{t('adm.th.title', 'Member conversations')}</div>
          {data?.flagged > 0 && <Badge tone="warning"><Flag size={10} /> {data.flagged}</Badge>}
          <div className="ms-auto flex items-center gap-2">
            <Select value={status} className="!w-auto" onChange={(e) => setStatus(e.target.value)}>
              <option value="flagged">{t('adm.th.f.flagged', 'Flagged')}</option><option value="">{t('adm.th.f.all', 'All')}</option><option value="open">{t('th.st.open', 'open')}</option><option value="closed">{t('th.st.closed', 'closed')}</option><option value="blocked">{t('th.st.blocked', 'blocked')}</option>
            </Select>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('common.search', 'Search…')} className="w-44" />
            <Button size="sm" variant="ghost" onClick={reload}><RefreshCw size={13} /></Button>
          </div>
        </div>
        <p className="text-[12px] text-[var(--muted)] mb-2">{t('adm.th.desc', 'Conversations between a visitor and the user or team behind a repo, a catalogue or a profile. Staff moderate; they do not answer for the owners.')}</p>
        {loading && !data ? <div className="py-6 text-center"><Spinner /></div> : !rows.length ? <EmptyState icon={MessageSquare} title={t('adm.th.empty', 'Nothing here.')} /> : (
          <ul className="divide-y divide-[var(--line)]">
            {rows.map((th) => (
              <li key={th.id}><button type="button" onClick={() => setOpen(th.id)} className="w-full text-start py-2 px-2 -mx-2 rounded-lg hover:panel flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{th.subject}</span><span className="block text-[12px] text-[var(--muted)] truncate">{th.kind} · {th.targetLabel} · {th.sender?.displayName || th.senderEmail || th.senderName || '—'} → {th.ownerTeam?.name || th.ownerUser?.displayName || '—'}</span></span>
                {th.staffFlag === 'flagged' && <Flag size={12} className="text-warning shrink-0" />}
                <Badge tone={th.status === 'open' ? 'success' : th.status === 'blocked' ? 'error' : ''}>{th.status}</Badge>
                <span className="text-[11px] text-[var(--faint)] tabular-nums shrink-0">{when(th.lastActivityAt)}</span>
              </button></li>
            ))}
          </ul>
        )}
      </Card>
      <ThreadsConfig />
    </div>
  );
}
