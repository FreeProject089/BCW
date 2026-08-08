import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Flag, Send, ImagePlus, X, Loader2, Shield, MessageSquare, Lock, Info } from 'lucide-react';
import { api, uploadReportImage } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../pages/auth.jsx';
import { Button, Modal, Textarea, Select, useToast, Card, Spinner } from './ui.jsx';

const REASONS = [
  ['spam', 'rp.reason.spam', 'Spam or advertising'],
  ['abuse', 'rp.reason.abuse', 'Abuse or harassment'],
  ['malware', 'rp.reason.malware', 'Malware / unsafe content'],
  ['stolen', 'rp.reason.stolen', 'Stolen / reposted content'],
  ['broken', 'rp.reason.broken', 'Broken or misleading'],
  ['other', 'rp.reason.other', 'Something else'],
];

// A message composer: textarea + image attachments (uploaded to object storage on send).
export function ReportComposer({ onSend, placeholder, sending }) {
  const { t } = useI18n(); const toast = useToast();
  const [body, setBody] = useState('');
  const [images, setImages] = useState([]); // uploaded URLs
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const pick = async (e) => {
    const files = [...(e.target.files || [])]; e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    for (const f of files) {
      try { const url = await uploadReportImage(f); setImages((s) => [...s, url]); }
      catch (x) { toast.error(x.status === 413 ? t('rp.imgbig', 'Image too large.') : t('rp.imgfail', 'Upload failed.')); }
    }
    setUploading(false);
  };
  const submit = async () => {
    if (!body.trim() && !images.length) return;
    const ok = await onSend({ body: body.trim(), images });
    if (ok) { setBody(''); setImages([]); }
  };
  return (
    <div className="space-y-2">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder || t('rp.msgph', 'Write a message…')} rows={3} />
      {images.length > 0 && <div className="flex flex-wrap gap-2">
        {images.map((u) => (
          <div key={u} className="relative w-16 h-16 rounded-lg overflow-hidden border border-[var(--line)]">
            <img src={u} alt="" className="w-full h-full object-cover" />
            <button onClick={() => setImages((s) => s.filter((x) => x !== u))} className="absolute top-0.5 right-0.5 bg-black/60 rounded p-0.5 text-white hover:bg-black/80"><X size={11} /></button>
          </div>
        ))}
      </div>}
      <div className="flex items-center justify-between gap-2">
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={pick} />
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {t('rp.attach', 'Attach')}</Button>
        <Button size="sm" variant="primary" onClick={submit} disabled={sending || (!body.trim() && !images.length)}>{sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {t('rp.send', 'Send')}</Button>
      </div>
    </div>
  );
}

// The message list of a report thread (shared by the user + admin views).
export function ReportThread({ messages }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      {messages.map((m) => (
        // A system note (authorId null — the schema's own convention) records something
        // that HAPPENED to the thread rather than something someone said: closed, reopened,
        // archived. Rendered as a centred line, not a bubble, so the eye reads it as a
        // timeline entry and never mistakes it for a reply from the other side.
        m.authorId === null && !m.staff ? (
          <div key={m.id} className="flex justify-center">
            <div className="text-[11px] text-[var(--faint)] flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--surface-2)] border border-[var(--line)]">
              <Info size={11} />
              <span>{m.body}</span>
              <span>· {new Date(m.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        ) : (
        <div key={m.id} className={`flex ${m.staff ? 'justify-start' : 'justify-end'}`}>
          <div className={`max-w-[85%] rounded-xl px-3 py-2 border ${m.staff ? 'bg-[var(--surface-2)] border-[var(--line)]' : 'bg-[var(--primary)]/10 border-[var(--primary)]/30'}`}>
            <div className="text-[11px] text-[var(--faint)] mb-1 flex items-center gap-1.5">
              {m.staff && <Shield size={11} className="text-[var(--primary-2)]" />}
              <span className="font-medium">{m.staff ? (m.author || t('rp.staff', 'Staff')) : (m.author || t('rp.you', 'You'))}</span>
              <span>· {new Date(m.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {m.body && <div className="text-sm whitespace-pre-wrap break-words">{m.body}</div>}
            {m.images?.length > 0 && <div className="flex flex-wrap gap-2 mt-2">
              {m.images.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-24 h-24 object-cover rounded-lg border border-[var(--line)]" /></a>)}
            </div>}
          </div>
        </div>
        )
      ))}
    </div>
  );
}

// A "Report" button. Logged-in → opens the report modal; logged-out → the contact page
// with the target prefilled (the classic route for anonymous reports).
export function ReportButton({ targetType, targetId, targetLabel, size = 'sm', variant = 'ghost', className = '', label }) {
  const { t } = useI18n(); const { user } = useAuth(); const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const go = () => {
    if (user) return setOpen(true);
    const q = new URLSearchParams({ report: targetType, id: targetId || '', label: targetLabel || '' });
    navigate(`/contact?${q.toString()}`);
  };
  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={go}><Flag size={13} /> {label || t('rp.report', 'Report')}</Button>
      {open && <ReportModal targetType={targetType} targetId={targetId} targetLabel={targetLabel} onClose={() => setOpen(false)} />}
    </>
  );
}

// Landing page for a report-thread invite link (/reports/join/:token). Previews the invite
// then joins the caller (must be logged in + match any target constraint), then opens the thread.
export function ReportJoin() {
  const { token } = useParams();
  const { t } = useI18n(); const { user } = useAuth(); const navigate = useNavigate();
  const [state, setState] = useState({ loading: true });
  const [joining, setJoining] = useState(false);
  useEffect(() => {
    if (!user) return; // wait for auth
    api.get(`/reports/join/${token}`).then((r) => setState({ preview: r })).catch((x) => setState({ error: x.data?.error || 'invalid_invite' }));
  }, [token, user]);
  const join = async () => {
    setJoining(true);
    try { const r = await api.post(`/reports/join/${token}`); navigate(`/dashboard?s=reports&r=${r.reportId}`); }
    catch (x) { setState({ error: x.data?.error || 'invalid_invite' }); setJoining(false); }
  };
  const ERR = {
    invalid_invite: t('rj.invalid', 'This invite link is invalid.'),
    invite_expired: t('rj.expired', 'This invite link has expired.'),
    invite_used_up: t('rj.used', 'This invite link has been used up.'),
    invite_not_for_you: t('rj.notyou', 'This invite is locked to a different account.'),
  };
  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <Card className="p-6 text-center">
        {!user ? <>
          <Lock size={28} className="mx-auto text-[var(--primary-2)] mb-3" />
          <h1 className="text-lg font-semibold">{t('rj.signin.t', 'Sign in to join')}</h1>
          <p className="text-sm text-[var(--muted)] mt-1 mb-4">{t('rj.signin.s', 'You need an account to join this conversation.')}</p>
          <Link to={`/auth?next=${encodeURIComponent(location.pathname)}`}><Button variant="primary">{t('nav.signin', 'Sign in')}</Button></Link>
        </> : state.loading ? <div className="flex items-center justify-center gap-2 text-[var(--muted)] py-6"><Spinner /> {t('common.loading', 'Loading…')}</div>
          : state.error ? <>
            <X size={28} className="mx-auto text-red-400 mb-3" />
            <h1 className="text-lg font-semibold">{t('rj.cant', 'Can’t join')}</h1>
            <p className="text-sm text-[var(--muted)] mt-1">{ERR[state.error] || ERR.invalid_invite}</p>
          </> : <>
            <MessageSquare size={28} className="mx-auto text-[var(--primary-2)] mb-3" />
            <h1 className="text-lg font-semibold">{t('rj.title', 'Join this conversation')}</h1>
            <p className="text-sm text-[var(--muted)] mt-1 mb-4">{state.preview?.report?.label ? t('rj.about', 'About “{n}”.').replace('{n}', state.preview.report.label) : t('rj.support', 'A support conversation.')}</p>
            <Button variant="primary" onClick={join} disabled={joining}>{joining ? <Spinner /> : t('rj.join', 'Join conversation')}</Button>
          </>}
      </Card>
    </div>
  );
}

export function ReportModal({ targetType, targetId, targetLabel, onClose }) {
  const { t } = useI18n(); const toast = useToast();
  const [reason, setReason] = useState('spam');
  const [busy, setBusy] = useState(false);
  const send = async ({ body, images }) => {
    if (!body) { toast.error(t('rp.needbody', 'Describe the problem first.')); return false; }
    setBusy(true);
    try {
      const { solvePow } = await import('../lib/pow.js');
      const pow = await solvePow(() => api.get('/auth/pow')); // antispam proof-of-work
      await api.post('/reports', { targetType, targetId, targetLabel, reason, body, images, pow });
      toast.success(t('rp.sent', 'Report sent — we’ll follow up in your dashboard.'));
      onClose(); return true;
    } catch (x) {
      const e = x.data?.error;
      if (e === 'already_open') { toast.error(t('rp.dup', 'You already have an open report on this. Continue it in your dashboard.')); onClose(); }
      else if (e === 'cannot_report_self') toast.error(t('rp.self', "You can't report yourself."));
      else if (e === 'too_many_open') toast.error(t('rp.toomanyopen', 'You have too many open reports — close some first.'));
      else if (e === 'daily_limit') toast.error(t('rp.daily', 'Daily report limit reached — try again tomorrow.'));
      else toast.error(e || t('acc.failed', 'Failed.'));
      return false;
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={targetLabel ? t('rp.title.n', 'Report “{n}”').replace('{n}', targetLabel) : t('rp.title', 'Report')} icon={Flag} width="max-w-md">
      <div className="space-y-3">
        <div>
          <div className="text-xs font-semibold text-[var(--faint)] uppercase tracking-wider mb-1">{t('rp.reason', 'Reason')}</div>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([v, k, fb]) => <option key={v} value={v}>{t(k, fb)}</option>)}</Select>
        </div>
        <ReportComposer onSend={send} sending={busy} placeholder={t('rp.detailph', 'Add details — what’s wrong, links, screenshots…')} />
        <p className="text-[11px] text-[var(--faint)]">{t('rp.note', 'Reports go to the moderation team. You can track the conversation in your dashboard → Reports.')}</p>
      </div>
    </Modal>
  );
}
