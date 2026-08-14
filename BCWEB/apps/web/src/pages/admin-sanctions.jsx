import { useState } from 'react';
import { Gavel, Search, RefreshCw, Send, Undo2, Scale, AlertTriangle, Ban, Clock, FileText, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Input, Select, Badge, Field, Textarea, EmptyState, useToast, useDialog } from '../ui/ui.jsx';
import { useAsync, Loading } from './pages.jsx';

// Every moderation decision, in one place.
//
// The point of this screen is not that it can issue sanctions — the user screen and the
// content screens already do that, where the context is. It is that a decision, once made,
// stops being findable: it lived as three columns on one user row, so "what did we do about
// this person in March" and "how many takedowns are being contested right now" had no
// answer. Here they do, and both are one query.

const KIND_TONE = { warning: 'amber', suspension: 'amber', ban: 'red', closure: 'red', takedown: 'amber' };
const KIND_ICON = { warning: AlertTriangle, suspension: Clock, ban: Ban, closure: FileText, takedown: Scale };

const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

/** One row. Deliberately dense: this list is read by somebody scanning for a pattern, not
 *  reading one decision — the detail lives behind the row, not in it. */
function Row({ s, onLift, onResend, onAnswer }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICON[s.kind] || Gavel;
  const contestOpen = s.contestedAt && !s.contestOutcome;

  return (
    <div className={`border-b border-[var(--line)] last:border-0 ${contestOpen ? 'bg-warning/5' : ''}`}>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-[var(--surface-2)]">
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-[var(--surface-2)] shrink-0 mt-0.5"><Icon size={14} className="text-[var(--muted)]" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            <code className="text-[11px] font-mono text-[var(--primary-2)]">{s.code}</code>
            <Badge tone={KIND_TONE[s.kind] || 'primary'}>{t(`sanc.k.${s.kind}`, s.kind)}</Badge>
            {s.status !== 'active' && <Badge>{t(`sanc.s.${s.status}`, s.status)}</Badge>}
            {contestOpen && <Badge tone="amber">{t('sanc.contested', 'contested')}</Badge>}
            {s.contestOutcome && <Badge tone={s.contestOutcome === 'overturned' ? 'green' : ''}>{t(`sanc.o.${s.contestOutcome}`, s.contestOutcome)}</Badge>}
          </span>
          <span className="block text-[13px] mt-0.5 break-words">{s.reason}</span>
          <span className="block text-[11px] text-[var(--faint)] mt-0.5">
            {s.user ? `${s.user.displayName || s.user.email}` : '—'}
            {s.targetName ? ` · ${t(`sanc.t.${s.targetType}`, s.targetType)} “${s.targetName}”` : ''}
            {` · ${fmt(s.issuedAt)}`}
            {s.expiresAt ? ` → ${fmt(s.expiresAt)}` : ''}
          </span>
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 pl-[52px] space-y-2">
          {s.request && (
            <div className="text-[12px]">
              <span className="text-[var(--faint)]">{t('sanc.request', 'Asked of them')}: </span>{s.request}
            </div>
          )}
          {s.relatedIds?.length > 0 && (
            <div className="text-[11px] text-[var(--faint)]">{t('sanc.related', '{n} other item(s) covered by the same decision').replace('{n}', String(s.relatedIds.length))}</div>
          )}
          {s.meta?.cancelledSubs?.length > 0 && (
            <div className="text-[11px] text-[var(--muted)]">
              {t('sanc.cancelled', '{n} subscription(s) cancelled — their term ended before the sanction did.').replace('{n}', String(s.meta.cancelledSubs.length))}
              {s.meta.keptSubs?.length > 0 && ' ' + t('sanc.kept', '{n} kept.').replace('{n}', String(s.meta.keptSubs.length))}
            </div>
          )}
          {s.issuedBy && <div className="text-[11px] text-[var(--faint)]">{t('sanc.by', 'Issued by')} {s.issuedBy.displayName}</div>}
          {s.liftedAt && <div className="text-[11px] text-[var(--faint)]">{t('sanc.lifted', 'Lifted {d}', )?.replace('{d}', fmt(s.liftedAt))}{s.liftReason ? ` — ${s.liftReason}` : ''}</div>}

          {s.contestedAt && (
            <Card className="p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-1">{t('sanc.theircontest', 'Their contest')} · {fmt(s.contestedAt)}</div>
              <div className="text-[13px] whitespace-pre-wrap break-words">{s.contestBody}</div>
              {s.contestAnswer && (
                <div className="mt-2 pt-2 border-t border-[var(--line)] text-[13px]">
                  <span className="text-[var(--faint)]">{t('sanc.youranswer', 'Answer')} ({s.contestOutcome}): </span>{s.contestAnswer}
                </div>
              )}
              {!s.contestOutcome && (
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="ghost" onClick={() => onAnswer(s, 'upheld')}>{t('sanc.uphold', 'Uphold')}</Button>
                  <Button size="sm" variant="primary" onClick={() => onAnswer(s, 'overturned')}>{t('sanc.overturn', 'Overturn & lift')}</Button>
                </div>
              )}
            </Card>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {s.status === 'active' && <Button size="sm" variant="ghost" onClick={() => onLift(s)}><Undo2 size={12} /> {t('sanc.lift', 'Lift')}</Button>}
            <Button size="sm" variant="ghost" onClick={() => onResend(s)}><Send size={12} /> {t('sanc.resend', 'Re-send the notice')}</Button>
            {s.user && <Link to={`/admin?s=users&u=${s.user.id}`}><Button size="sm" variant="ghost"><ExternalLink size={12} /> {t('sanc.openuser', 'Open the account')}</Button></Link>}
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminSanctions() {
  const { t } = useI18n(); const toast = useToast(); const dialog = useDialog();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const { data, loading, reload } = useAsync(
    () => api.get(`/admin/sanctions?q=${encodeURIComponent(term)}&status=${status}&kind=${kind}`),
    [term, status, kind],
  );

  const list = data?.sanctions || [];

  const lift = async (s) => {
    const reason = await dialog.prompt({
      title: t('sanc.lift.t', 'Lift {c}?').replace('{c}', s.code),
      message: t('sanc.lift.m', 'The person is told. For a takedown the content goes back online in the same action; for an account sanction, reactivating the account is a separate decision on the account screen.'),
      label: t('sanc.lift.l', 'Why (they see this)'), okLabel: t('sanc.lift', 'Lift'),
    });
    if (reason === null || reason === undefined || reason === false) return;
    try { await api.post(`/admin/sanctions/${s.id}/lift`, { reason: reason || undefined }); toast.success(t('sanc.lifted.ok', 'Lifted.')); reload(); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const resend = async (s) => {
    try { const r = await api.post(`/admin/sanctions/${s.id}/resend`, {}); toast.success(r.sent ? t('sanc.resent', 'Sent again.') : t('sanc.nomail', 'Mail is off on this server — the in-app notice was still written.')); }
    catch { toast.error(t('common.failed', 'Failed.')); }
  };

  const answer = async (s, outcome) => {
    const body = await dialog.prompt({
      title: outcome === 'overturned' ? t('sanc.ov.t', 'Overturn {c}').replace('{c}', s.code) : t('sanc.up.t', 'Uphold {c}').replace('{c}', s.code),
      message: outcome === 'overturned'
        ? t('sanc.ov.m', 'The sanction is lifted in the same action — an answer that says “you were right” while the sanction stands is not an answer. Content taken down goes back online.')
        : t('sanc.up.m', 'The sanction stands. Say why: this is the whole of what they get back, and “reviewed” is not a reason.'),
      label: t('sanc.answer.l', 'Your answer (they receive this)'),
      okLabel: outcome === 'overturned' ? t('sanc.overturn', 'Overturn & lift') : t('sanc.uphold', 'Uphold'),
      danger: outcome !== 'overturned',
    });
    if (!body) return;
    try { await api.post(`/admin/sanctions/${s.id}/contest`, { outcome, answer: body }); toast.success(t('sanc.answered', 'Answered.')); reload(); }
    catch (x) { toast.error(x?.data?.error === 'not_contested' ? t('sanc.notcontested', 'Nobody contested this one.') : t('common.failed', 'Failed.')); }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2 mr-2"><Gavel size={16} className="text-[var(--primary-2)]" /> {t('sanc.title', 'Sanctions')}</h2>
        {data?.openContests > 0 && (
          <button onClick={() => setStatus('contested')} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-warning/15 text-warning hover:bg-warning/25">
            <Scale size={12} /> {t('sanc.opencontests', '{n} waiting for an answer').replace('{n}', String(data.openContests))}
          </button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={reload}><RefreshCw size={13} /> {t('common.refresh', 'Refresh')}</Button>
      </div>

      <Card className="p-3 mb-3">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
          <div className="flex gap-2 flex-1 min-w-[220px]">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('sanc.search', 'Reference, reason, item or account')} />
            <Button type="submit"><Search size={14} /></Button>
          </div>
          <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('sanc.f.anystatus', 'Any status')}</option>
            <option value="active">{t('sanc.s.active', 'active')}</option>
            <option value="contested">{t('sanc.contested', 'contested')}</option>
            <option value="lifted">{t('sanc.s.lifted', 'lifted')}</option>
            <option value="expired">{t('sanc.s.expired', 'expired')}</option>
          </Select>
          <Select className="w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t('sanc.f.anykind', 'Any kind')}</option>
            {(data?.kinds || []).map((k) => <option key={k} value={k}>{t(`sanc.k.${k}`, k)}</option>)}
          </Select>
        </form>
        <p className="text-[11px] text-[var(--muted)] mt-2">
          {t('sanc.sub', 'Issued from the account screen and the content screens, where the context is. This is where they are found afterwards — and where a contest is answered.')}
        </p>
      </Card>

      {loading && !data ? <Loading /> : !list.length ? (
        <EmptyState icon={Gavel} title={t('sanc.none', 'Nothing here')}
          sub={t('sanc.none.s', 'No decision matches this filter. With no filter at all, an empty list means nobody has been sanctioned yet.')} />
      ) : (
        <Card className="p-0 overflow-hidden">
          {list.map((s) => <Row key={s.id} s={s} onLift={lift} onResend={resend} onAnswer={answer} />)}
        </Card>
      )}
      {data?.total > list.length && (
        <p className="text-[11px] text-[var(--faint)] mt-2">{t('sanc.more', 'Showing {n} of {t} — narrow the search to see the rest.').replace('{n}', String(list.length)).replace('{t}', String(data.total))}</p>
      )}
    </div>
  );
}

/** The takedown/warning form, used from a repo or catalog screen where the target is known.
 *  Exported so the content screens can drop it in rather than re-deriving the shape. */
export function ContentSanctionForm({ targetType, targetId, targetName, onDone }) {
  const { t } = useI18n(); const toast = useToast();
  const [f, setF] = useState({ kind: 'warning', reason: '', request: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (f.reason.trim().length < 3) return toast.error(t('sanc.needreason', 'A reason is required — it is what they receive.'));
    setBusy(true);
    try {
      const r = await api.post('/admin/sanctions/content', {
        targetType, targetId, kind: f.kind,
        reason: f.reason.trim(), request: f.request.trim() || undefined,
      });
      toast.success(t('sanc.issued', 'Issued — {c}').replace('{c}', r.sanction.code));
      setF({ kind: 'warning', reason: '', request: '' });
      onDone?.(r.sanction);
    } catch (x) {
      toast.error(x?.data?.error === 'cannot_moderate_own_content' ? t('sanc.own', 'This is your own content.') : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="text-[12px] text-[var(--muted)]">
        {t('sanc.form.s', 'The notice goes to whoever answers for “{n}” — a repo cannot read its e-mail.').replace('{n}', targetName || targetId)}
      </div>
      <Field label={t('sanc.form.kind', 'What this is')}>
        <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="warning">{t('sanc.k.warning', 'Warning — the content stays up')}</option>
          <option value="takedown">{t('sanc.k.takedown', 'Takedown — it stops being served now')}</option>
        </Select>
      </Field>
      <Field label={t('sanc.form.reason', 'Reason (they read this)')}>
        <Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
      <Field label={t('sanc.form.request', 'What you are asking them to do (optional)')}
        hint={t('sanc.form.request.h', 'A warning with no request is just an insult with a reference number.')}>
        <Textarea rows={2} value={f.request} onChange={(e) => setF({ ...f, request: e.target.value })} />
      </Field>
      <Button type="submit" variant={f.kind === 'takedown' ? 'danger' : 'primary'} disabled={busy}>
        <Gavel size={13} /> {f.kind === 'takedown' ? t('sanc.form.take', 'Take it down') : t('sanc.form.warn', 'Send the warning')}
      </Button>
    </form>
  );
}
