// Conversations: the dashboard's inbox / sent boxes with a thread view, and the page an
// anonymous sender reaches by the link in their e-mail (/messages/t/:token).
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { MessageSquare, Inbox, Send, Lock, Flag, RotateCcw, ArrowLeft, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import { useAsync } from './pages.jsx';
import { Button, Card, Badge, Textarea, EmptyState, Spinner, useToast, useDialog } from '../ui/ui.jsx';

const KIND_ICON = { repo: '📦', catalog: '🗂️', user: '👤', team: '👥' };
const when = (d) => new Date(d).toLocaleString();

function Bubble({ m, me }) {
  const { t } = useI18n();
  const mine = m.side === me;
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${m.hidden ? 'italic text-[var(--faint)] border border-dashed border-[var(--line)]' : mine ? 'bg-[var(--primary)] text-[var(--on-primary)]' : 'bg-[var(--surface-2)]'} ${m.side === 'staff' ? 'ring-1 ring-warning' : ''}`}>
        {m.hidden ? t('th.hidden', 'Message hidden by staff.') : m.body}
        <div className={`text-[10.5px] mt-1 ${mine ? 'opacity-75' : 'text-[var(--faint)]'}`}>{m.author || (m.side === 'sender' ? t('th.sender', 'Sender') : m.side === 'staff' ? t('th.staff', 'Staff') : t('th.owner', 'Owner'))} · {when(m.createdAt)}</div>
      </div>
    </div>
  );
}

function Composer({ onSend, disabled }) {
  const { t } = useI18n();
  const [v, setV] = useState(''); const [busy, setBusy] = useState(false);
  const go = async () => { if (!v.trim()) return; setBusy(true); try { if (await onSend(v.trim())) setV(''); } finally { setBusy(false); } };
  return (
    <div className="flex gap-2 items-end">
      <Textarea rows={2} value={v} onChange={(e) => setV(e.target.value)} disabled={disabled} maxLength={4000} placeholder={t('th.reply.ph', 'Write a reply…')} className="flex-1" />
      <Button variant="primary" loading={busy} disabled={disabled || !v.trim()} onClick={go}><Send size={14} /></Button>
    </div>
  );
}

/** One thread, signed in or by token. `load`/`post` abstract the two APIs. */
export function ThreadView({ load, post, actions, back }) {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(load, [load]);
  if (loading && !data) return <div className="py-8 text-center"><Spinner /></div>;
  if (!data) return <EmptyState icon={MessageSquare} title={t('th.gone.t', 'Conversation not available')}
    sub={t('th.gone.s', 'It may have been closed and removed, or the link you followed may have expired.')}
    action={{ label: t('th.gone.a', 'Your messages'), to: '/dashboard?s=reports', icon: Inbox }} />;
  const { thread: th, side } = data;
  const send = async (body) => {
    try { await post(body); await reload(); return true; }
    catch (x) { const e = x.data?.error; toast.error(e === 'closed' ? t('th.closed', 'This conversation is closed.') : e === 'blocked' ? t('cm.blocked', 'Messaging is not available for this sender.') : e === 'rate_limited' ? t('cm.rate', 'Too many messages for now, try again later.') : t('common.failed', 'Failed.')); return false; }
  };
  const who = th.ownerTeam ? <Link to={`/t/${th.ownerTeam.slug}`} className="inline-flex items-center gap-1 hover:text-[var(--primary-2)]"><Users size={12} /> {th.ownerTeam.name}</Link> : th.ownerUser?.displayName || '—';
  return (
    <Card className="p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        {back && <Button size="sm" variant="ghost" onClick={back}><ArrowLeft size={14} /></Button>}
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{KIND_ICON[th.kind] || ''} {th.subject}</div>
          <div className="text-[12px] text-[var(--muted)]">{t('th.about', 'About')} <b className="text-[var(--text)]">{th.targetLabel}</b> · {t('th.between', 'between')} {th.sender?.displayName || th.senderName || t('th.anon', 'an anonymous sender')} {t('th.and', 'and')} {who}</div>
        </div>
        <Badge tone={th.status === 'open' ? 'success' : th.status === 'blocked' ? 'error' : ''}>{th.status === 'open' ? t('th.st.open', 'open') : th.status === 'closed' ? t('th.st.closed', 'closed') : t('th.st.blocked', 'blocked')}</Badge>
      </div>
      <div className="space-y-2 max-h-[55vh] overflow-auto pr-1">
        {th.messages.map((m) => <Bubble key={m.id} m={m} me={side} />)}
      </div>
      {th.status === 'open' ? <Composer onSend={send} /> : <p className="text-[12px] text-[var(--faint)] flex items-center gap-1"><Lock size={12} /> {th.status === 'closed' ? t('th.closed', 'This conversation is closed.') : t('th.blockedline', 'This sender was blocked by staff.')}</p>}
      {actions && <div className="flex gap-2 flex-wrap pt-1 border-t border-[var(--line)]">{actions(th, reload)}</div>}
    </Card>
  );
}

/** Dashboard: inbox (addressed to me or my teams) and sent. `?thread=` opens one. */
export function MyThreads() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [sp, setSp] = useSearchParams();
  const [box, setBox] = useState('inbox');
  const open = sp.get('thread');
  const { data, loading, reload } = useAsync(() => api.get(`/me/threads?box=${box}`), [box, open]);
  useEffect(() => { const h = () => reload(); window.addEventListener('focus', h); return () => window.removeEventListener('focus', h); }, [reload]);
  const setOpen = (id) => { const n = new URLSearchParams(sp); if (id) n.set('thread', id); else n.delete('thread'); setSp(n, { replace: true }); };
  if (open) {
    return (
      <ThreadView back={() => setOpen(null)}
        load={() => api.get(`/me/threads/${open}`)}
        post={(body) => api.post(`/me/threads/${open}/messages`, { body })}
        actions={(th, r) => (<>
          {th.status === 'open'
            ? <Button size="sm" variant="ghost" onClick={async () => { if (!await dialog.confirm({ title: t('th.close.q', 'Close this conversation?'), message: t('th.close.m', 'Nobody can answer a closed conversation. You can reopen it.') })) return; await api.post(`/me/threads/${th.id}/close`); r(); }}><Lock size={13} /> {t('th.close', 'Close')}</Button>
            : th.status === 'closed' && <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/me/threads/${th.id}/reopen`); r(); }}><RotateCcw size={13} /> {t('th.reopen', 'Reopen')}</Button>}
          <Button size="sm" variant="ghost" className="!text-error" onClick={async () => { if (!await dialog.confirm({ title: t('th.flag.q', 'Report this conversation to staff?'), message: t('th.flag.m', 'Staff will read it and may hide messages or block the sender.') })) return; await api.post(`/me/threads/${th.id}/flag`); toast.success(t('th.flagged', 'Reported to staff.')); }}><Flag size={13} /> {t('th.flag', 'Report to staff')}</Button>
        </>)} />
    );
  }
  const rows = data?.threads || [];
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <MessageSquare size={16} className="text-[var(--primary-2)]" />
        <div className="font-semibold">{t('th.title', 'Conversations')}</div>
        <div className="ms-auto inline-flex rounded-lg border border-[var(--line)] overflow-hidden">
          {[['inbox', Inbox, t('th.inbox', 'Inbox')], ['sent', Send, t('th.sent', 'Sent')]].map(([id, I, l]) => (
            <button key={id} type="button" onClick={() => setBox(id)} className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs ${box === id ? 'tint-primary font-medium' : 'text-[var(--muted)]'}`}><I size={12} /> {l}</button>
          ))}
        </div>
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-3">{t('th.desc', 'Messages from people about your repos, catalogues, teams and profile, and the ones you sent. Reports to the staff are below.')}</p>
      {loading && !data ? <div className="py-6 text-center"><Spinner /></div> : !rows.length ? (
        box === 'inbox'
          ? <EmptyState icon={Inbox} title={t('th.empty.in2', 'No messages')}
              sub={t('th.empty.in.s', 'People write to you here about your repos, catalogues, teams and profile, and nobody has yet.')}
              action={{ label: t('th.empty.in.a', 'See your public profile'), to: '/profile', icon: Users }}
              hint={t('th.empty.in.h', 'They reach you from the Contact button on anything you own.')} />
          : <EmptyState icon={Send} title={t('th.empty.sent2', 'Nothing sent')}
              sub={t('th.empty.sent.s', 'Messages you start show up here, and you have not written to anyone yet.')}
              action={{ label: t('th.empty.sent.a', 'Browse repos'), to: '/repos', icon: MessageSquare }}
              hint={t('th.empty.sent.h', 'Use the Contact button on a repo, catalogue or profile to start one.')} />
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {rows.map((th) => {
            const unread = box === 'inbox' ? th.ownerUnread : th.senderUnread;
            return (
              <li key={th.id}>
                <button type="button" onClick={() => setOpen(th.id)} className="w-full text-start py-2.5 flex items-center gap-3 hover:panel rounded-lg px-2 -mx-2">
                  <span className="text-lg shrink-0" aria-hidden>{KIND_ICON[th.kind] || '✉️'}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${unread ? 'font-semibold' : ''}`} title={th.subject}>{th.subject}</span>
                    <span className="block text-[12px] text-[var(--muted)] truncate">{th.targetLabel} · {box === 'inbox' ? (th.sender?.displayName || th.senderName || t('th.anon', 'an anonymous sender')) : (th.ownerTeam?.name || th.ownerUser?.displayName || '—')}</span>
                  </span>
                  {unread && <span className="w-2 h-2 rounded-full bg-[var(--primary)] shrink-0" />}
                  {th.status !== 'open' && <Lock size={12} className="text-[var(--faint)] shrink-0" />}
                  <span className="text-[11px] text-[var(--faint)] shrink-0 tabular-nums">{when(th.lastActivityAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** /messages/t/:token — the anonymous sender's side. */
export default function AnonThreadPage() {
  const { t } = useI18n(); const { token } = useParams(); const { user } = useAuth();
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
      <h1 className="text-xl font-extrabold flex items-center gap-2"><MessageSquare size={18} className="text-[var(--primary-2)]" /> {t('th.title', 'Conversations')}</h1>
      <ThreadView load={() => api.get(`/threads/t/${encodeURIComponent(token)}`)} post={(body) => api.post(`/threads/t/${encodeURIComponent(token)}/messages`, { body })} />
      <p className="text-[12px] text-[var(--faint)]">{t('th.anon.note', 'This page is reachable only by the link you were e-mailed. Anyone holding the link can read and answer.')} {!user && <Link to="/signin" className="text-[var(--primary-2)] hover:underline">{t('th.anon.signin', 'With an account, conversations live in your dashboard.')}</Link>}</p>
    </div>
  );
}
