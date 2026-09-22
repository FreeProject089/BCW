// Conversations: the dashboard's inbox / sent boxes with a thread view, and the page an
// anonymous sender reaches by the link in their e-mail (/messages/t/:token).
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { MessageSquare, Inbox, Send, Lock, Flag, RotateCcw, ArrowLeft, Users, Archive, Paperclip, X, FileText, Fingerprint, Mail, Download, ShieldCheck } from 'lucide-react';
import Avatar from '../ui/Avatar.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import { useAsync } from './pages.jsx';
import { Button, Card, Badge, Textarea, EmptyState, Spinner, useToast, useDialog } from '../ui/ui.jsx';
import { ReceiptTicks } from '../ui/receipt.jsx';
import { topicLabel } from '../ui/topic-label.js';

const KIND_ICON = { repo: '📦', catalog: '🗂️', user: '👤', team: '👥', project: '🧩' };
const when = (d) => new Date(d).toLocaleString();

// Files are always a DOWNLOAD (the API sends them as attachments), never shown inline.
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
function FileChip({ f, href, onFill }) {
  return (
    <a href={href} download={f.name} className={`inline-flex items-center gap-1.5 text-[12px] rounded-lg px-2 py-1 mt-1.5 me-1.5 border ${onFill ? 'border-transparent underline decoration-dotted' : 'border-[var(--line)] hover:border-[var(--ring)]'}`}>
      <FileText size={12} aria-hidden /> <span className="truncate max-w-[12rem]" title={f.name}>{f.name}</span> <span className="opacity-70">{fmtSize(f.size)}</span>
    </a>
  );
}

function Bubble({ m, me, fileHref }) {
  const { t } = useI18n();
  const mine = m.side === me;
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${m.hidden ? 'italic text-[var(--faint)] border border-dashed border-[var(--line)]' : mine ? 'bg-[var(--primary)] text-[var(--on-primary)]' : 'bg-[var(--surface-2)]'} ${m.side === 'staff' ? 'ring-1 ring-warning' : ''}`}>
        {m.hidden ? t('th.hidden', 'Message hidden by staff.') : m.body}
        {!m.hidden && m.files?.length > 0 && <div className="flex flex-wrap">{m.files.map((f) => <FileChip key={f.id} f={f} href={fileHref(f.id)} onFill={mine} />)}</div>}
        <div className={`text-[10.5px] mt-1 ${mine ? 'opacity-75' : 'text-[var(--faint)]'}`}>{m.author || (m.side === 'sender' ? t('th.sender', 'Sender') : m.side === 'staff' ? t('th.staff', 'Staff') : t('th.owner', 'Owner'))} · {when(m.createdAt)} {mine && <ReceiptTicks state={m.receipt} onFill />}</div>
      </div>
    </div>
  );
}

const readB64 = (file) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = fail;
  r.readAsDataURL(file);
});

/** `files` is what the API said this thread accepts: { allowed, maxBytes, maxFiles }. */
function Composer({ onSend, disabled, files }) {
  const { t } = useI18n(); const toast = useToast();
  const [v, setV] = useState(''); const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState([]);
  const pick = (e) => {
    const list = [...(e.target.files || [])];
    e.target.value = '';
    const next = [...picked, ...list].slice(0, files?.maxFiles || 0);
    const big = next.find((f) => f.size > (files?.maxBytes || 0));
    if (big) { toast.error(t('th.file.big', '“{n}” is larger than {s}.').replace('{n}', big.name).replace('{s}', fmtSize(files.maxBytes))); return; }
    setPicked(next);
  };
  const go = async () => {
    if (!v.trim()) return;
    setBusy(true);
    try {
      const payload = await Promise.all(picked.map(async (f) => ({ name: f.name, type: f.type || 'application/octet-stream', data: await readB64(f) })));
      if (await onSend(v.trim(), payload)) { setV(''); setPicked([]); }
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2 items-end">
        <Textarea rows={2} value={v} onChange={(e) => setV(e.target.value)} disabled={disabled} maxLength={4000} placeholder={t('th.reply.ph', 'Write a reply…')} className="flex-1" />
        {files?.allowed && (
          <label className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--line)] cursor-pointer hover:border-[var(--ring)] ${picked.length >= files.maxFiles ? 'opacity-50 pointer-events-none' : ''}`} title={t('th.file.add', 'Attach a file')} aria-label={t('th.file.add', 'Attach a file')}>
            <Paperclip size={14} aria-hidden />
            <input type="file" multiple className="sr-only" onChange={pick} accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,application/zip,application/json" />
          </label>
        )}
        <Button variant="primary" loading={busy} disabled={disabled || !v.trim()} onClick={go} aria-label={t('cm.send', 'Send')}><Send size={14} /></Button>
      </div>
      {picked.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {picked.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 text-[12px] rounded-lg border border-[var(--line)] px-2 py-0.5">
              <FileText size={11} aria-hidden /> {f.name} · {fmtSize(f.size)}
              <button type="button" onClick={() => setPicked(picked.filter((_, j) => j !== i))} aria-label={t('th.file.remove', 'Remove this file')}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Who wrote in, for the side that answers. A member: their picture, name, BC id and a link
 * to their profile. Anonymous: exactly what they typed in the form.
 */
function SenderCard({ th }) {
  const { t } = useI18n();
  if (th.sender?.bcId) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-[var(--line)] px-3 py-2 text-[12px]">
        <Avatar user={th.sender} size={28} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <Link to={th.sender.profile} className="font-medium text-[13px] hover:text-[var(--accent-ink)] truncate block" title={th.sender.displayName}>{th.sender.displayName}</Link>
          <span className="text-[var(--muted)] inline-flex items-center gap-1"><Fingerprint size={11} aria-hidden /> {th.sender.bcId}{th.sender.since && ` · ${t('th.sender.since', 'member since {d}').replace('{d}', new Date(th.sender.since).toLocaleDateString())}`}</span>
        </div>
      </div>
    );
  }
  if (!th.sender && (th.senderName || (th.senderEmail && th.senderEmail !== '(e-mail)'))) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2 text-[12px] text-[var(--muted)]">
        <Mail size={13} aria-hidden /> <span className="text-[var(--text)]">{th.senderName || t('th.anon', 'an anonymous sender')}</span>
        {th.senderEmail && th.senderEmail !== '(e-mail)' && <span className="truncate" title={th.senderEmail}>{th.senderEmail}</span>}
        <span className="ms-auto">{t('th.sender.anon', 'no account')}</span>
      </div>
    );
  }
  return null;
}

/** One thread, signed in or by token. `load`/`post` abstract the two APIs; `fileBase` is
 *  the path its files are downloaded from (they differ the same way). */
export function ThreadView({ load, post, actions, back, fileBase }) {
  const { t } = useI18n(); const toast = useToast();
  const { data, loading, reload } = useAsync(load, [load]);
  if (loading && !data) return <div className="py-8 text-center"><Spinner /></div>;
  if (!data) return <EmptyState icon={MessageSquare} title={t('th.gone.t', 'Conversation not available')}
    sub={t('th.gone.s', 'It may have been closed and removed, or the link you followed may have expired.')}
    action={{ label: t('th.gone.a', 'Your messages'), to: '/dashboard?s=reports', icon: Inbox }} />;
  const { thread: th, side } = data;
  // Two different reasons a reply box is not there, and they are not the same sentence.
  // CLOSED is a decision somebody took on this conversation. FROZEN is a switch somewhere
  // else: the site's, or the other person's. Saying "closed" for both sends people looking
  // for a Reopen button that would not help them.
  const frozen = data.canWrite === false && th.status === 'open';
  const send = async (body, files) => {
    try { await post(body, files?.length ? files : undefined); await reload(); return true; }
    catch (x) {
      const e = x.data?.error;
      toast.error(e === 'closed' ? t('th.closed', 'This conversation is closed.') : e === 'blocked' ? t('cm.blocked', 'Messaging is not available for this sender.') : e === 'rate_limited' ? t('cm.rate', 'Too many messages for now, try again later.')
        : e === 'storage_full' ? t('th.file.full', 'This inbox has no room left for files.')
          : e === 'attachments_need_pool' || e === 'attachments_off' ? t('th.file.off', 'Files are not accepted here.')
            : e === 'unsupported_type' ? t('th.file.type', 'That kind of file is not accepted.')
              : e === 'too_large' ? t('th.file.big2', 'A file is too large.') : t('common.failed', 'Failed.'));
      return false;
    }
  };
  const fileHref = (fid) => `/api${fileBase}/files/${fid}`;
  const who = th.ownerTeam ? <Link to={`/t/${th.ownerTeam.slug}`} className="inline-flex items-center gap-1 hover:text-[var(--accent-ink)]"><Users size={12} /> {th.ownerTeam.name}</Link> : th.ownerUser?.displayName || '—';
  return (
    <Card className="p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        {back && <Button size="sm" variant="ghost" onClick={back}><ArrowLeft size={14} /></Button>}
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{KIND_ICON[th.kind] || ''} {th.subject}</div>
          <div className="text-[12px] text-[var(--muted)]">{t('th.about', 'About')} <b className="text-[var(--text)]">{th.targetLabel}</b> · {t('th.between', 'between')} {th.sender?.displayName || th.senderName || t('th.anon', 'an anonymous sender')} {t('th.and', 'and')} {who}</div>
        </div>
        <Badge tone={th.status === 'open' ? (frozen ? '' : 'success') : th.status === 'blocked' ? 'error' : ''}>{frozen ? t('th.st.frozen', 'frozen') : th.status === 'open' ? t('th.st.open', 'open') : th.status === 'closed' ? t('th.st.closed', 'closed') : th.status === 'archived' ? t('th.st.archived', 'archived') : t('th.st.blocked', 'blocked')}</Badge>
      </div>
      {side === 'owner' && <SenderCard th={th} />}
      <div className="space-y-2 max-h-[55vh] overflow-auto pr-1">
        {th.messages.map((m) => <Bubble key={m.id} m={m} me={side} fileHref={fileHref} />)}
      </div>
      {th.status === 'open' && !frozen ? <Composer onSend={send} files={data.files} /> : (
        <p className="text-[12px] text-[var(--faint)] flex items-start gap-1"><Lock size={12} className="mt-0.5 shrink-0" /> <span>
          {frozen
            ? (data.frozen === 'messaging_off_member'
              ? t('th.frozen.member', 'This member no longer accepts conversations. Nobody can add to this one, and nothing was deleted.')
              : t('th.frozen.site', 'Conversations between members are switched off on this site. Nobody can add to this one, and nothing was deleted.'))
            : th.status === 'closed' ? t('th.closed', 'This conversation is closed.')
              : th.status === 'archived' ? t('th.archivedline', 'This conversation was archived after a long silence. Reopen it to answer.')
                : t('th.blockedline', 'This sender was blocked by staff.')}
        </span></p>
      )}
      {actions && <div className="flex gap-2 flex-wrap pt-1 border-t border-[var(--line)]">{actions(th, reload)}</div>}
      {/* A signed copy: readable, and provable later (lib/conversation-copy.mjs). Each side gets
          what IT saw. Closing the conversation mails one to each participant anyway. */}
      {fileBase && side !== 'staff' && (
        <div className="flex gap-2 flex-wrap items-center text-[12px] text-[var(--muted)]">
          <ShieldCheck size={13} aria-hidden /> {t('th.copy', 'A signed copy')}
          <a href={`/api${fileBase}/copy`} download className="inline-flex items-center gap-1 text-[var(--accent-ink)] hover:underline"><Download size={12} aria-hidden /> {t('th.copy.dl', 'Download')}</a>
          <button type="button" className="inline-flex items-center gap-1 text-[var(--accent-ink)] hover:underline"
            onClick={async () => { try { const r = await api.post(`${fileBase}/copy/mail`); if (r.sent) toast.success(t('th.copy.sent', 'Sent to your e-mail address.')); else toast.info(t('th.copy.nomail', 'E-mail is switched off on this site. Use Download instead.')); } catch { toast.error(t('common.failed', 'Failed.')); } }}>
            <Mail size={12} aria-hidden /> {t('th.copy.mail', 'Mail it to me')}
          </button>
          <Link to="/verify-copy" className="hover:underline">{t('th.copy.verify', 'Check a copy')}</Link>
        </div>
      )}
    </Card>
  );
}

/** Dashboard: inbox (addressed to me or my teams) and sent. `?thread=` opens one. */
export function MyThreads() {
  const { t, lang } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [sp, setSp] = useSearchParams();
  const [box, setBox] = useState('inbox');
  const open = sp.get('thread');
  // ?project=<ref>: one project's inbox, as its page's Inbox button opens it.
  const project = sp.get('project') || '';
  const { data, loading, reload } = useAsync(() => api.get(`/me/threads?box=${box}${project ? `&project=${encodeURIComponent(project)}` : ''}`), [box, open, project]);
  useEffect(() => { const h = () => reload(); window.addEventListener('focus', h); return () => window.removeEventListener('focus', h); }, [reload]);
  const setOpen = (id) => { const n = new URLSearchParams(sp); if (id) n.set('thread', id); else n.delete('thread'); setSp(n, { replace: true }); };
  if (open) {
    return (
      <ThreadView back={() => setOpen(null)}
        load={() => api.get(`/me/threads/${open}`)}
        post={(body, files) => api.post(`/me/threads/${open}/messages`, { body, files })}
        fileBase={`/me/threads/${open}`}
        actions={(th, r) => (<>
          {th.status === 'open'
            ? <>
              <Button size="sm" variant="ghost" onClick={async () => { if (!await dialog.confirm({ title: t('th.close.q', 'Close this conversation?'), message: t('th.close.m', 'Nobody can answer a closed conversation. You can reopen it.') })) return; await api.post(`/me/threads/${th.id}/close`); r(); }}><Lock size={13} /> {t('th.close', 'Close')}</Button>
              {/* Archive is not close. Close is a decision; archive is "put it away", and it
                  frees a slot against the site's limit on open conversations. */}
              <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/me/threads/${th.id}/archive`); r(); }}><Archive size={13} /> {t('th.archive', 'Archive')}</Button>
            </>
            : (th.status === 'closed' || th.status === 'archived') && <Button size="sm" variant="ghost" onClick={async () => { await api.post(`/me/threads/${th.id}/reopen`); r(); }}><RotateCcw size={13} /> {t('th.reopen', 'Reopen')}</Button>}
          <Button size="sm" variant="ghost" className="!text-error" onClick={async () => { if (!await dialog.confirm({ title: t('th.flag.q', 'Report this conversation to staff?'), message: t('th.flag.m', 'Staff will read it and may hide messages or block the sender.') })) return; await api.post(`/me/threads/${th.id}/flag`); toast.success(t('th.flagged', 'Reported to staff.')); }}><Flag size={13} /> {t('th.flag', 'Report to staff')}</Button>
        </>)} />
    );
  }
  const rows = data?.threads || [];
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <MessageSquare size={16} className="text-[var(--accent-ink)]" />
        <div className="font-semibold">{t('th.title', 'Conversations')}</div>
        <div className="ms-auto inline-flex rounded-lg border border-[var(--line)] overflow-hidden">
          {[['inbox', Inbox, t('th.inbox', 'Inbox')], ['sent', Send, t('th.sent', 'Sent')]].map(([id, I, l]) => (
            <button key={id} type="button" onClick={() => setBox(id)} className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs ${box === id ? 'tint-primary font-medium' : 'text-[var(--muted)]'}`}><I size={12} /> {l}</button>
          ))}
        </div>
      </div>
      {project && (
        <div className="mb-3 flex items-center gap-2 text-[12px]">
          <Badge tone="primary">🧩 {t('th.projectfilter', 'One project')}: {rows[0]?.targetLabel || project}</Badge>
          <button type="button" className="text-[var(--accent-ink)] hover:underline" onClick={() => { const n = new URLSearchParams(sp); n.delete('project'); setSp(n, { replace: true }); }}>{t('th.projectfilter.clear', 'Show every conversation')}</button>
        </div>
      )}
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
                    <span className="block text-[12px] text-[var(--muted)] truncate">{th.targetLabel}{th.topic ? ` · ${topicLabel({ id: th.topic, basic: true, label: th.topic }, t, lang)}` : ''} · {box === 'inbox' ? (th.sender?.displayName || th.senderName || t('th.anon', 'an anonymous sender')) : (th.ownerTeam?.name || th.ownerUser?.displayName || '—')}</span>
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
      <h1 className="text-xl font-extrabold flex items-center gap-2"><MessageSquare size={18} className="text-[var(--accent-ink)]" /> {t('th.title', 'Conversations')}</h1>
      <ThreadView load={() => api.get(`/threads/t/${encodeURIComponent(token)}`)} post={(body, files) => api.post(`/threads/t/${encodeURIComponent(token)}/messages`, { body, files })} fileBase={`/threads/t/${encodeURIComponent(token)}`} />
      <p className="text-[12px] text-[var(--faint)]">{t('th.anon.note', 'This page is reachable only by the link you were e-mailed. Anyone holding the link can read and answer.')} {!user && <Link to="/signin" className="text-[var(--accent-ink)] hover:underline">{t('th.anon.signin', 'With an account, conversations live in your dashboard.')}</Link>}</p>
    </div>
  );
}
