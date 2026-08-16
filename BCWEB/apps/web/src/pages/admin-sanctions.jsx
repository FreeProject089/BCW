import { useState } from 'react';
import { Gavel, Search, RefreshCw, Send, Undo2, Scale, AlertTriangle, Ban, Clock, FileText, ExternalLink,
  Pencil, Archive, ArchiveRestore, RotateCcw, Paperclip, Trash2 } from 'lucide-react';
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
const fmtBytes = (n) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Evidence attached to a decision: screenshots, recordings, files, links.
 *
 * Staff-only, and the API enforces that — nothing here is reachable from the page the person
 * sanctioned sees, because a report's evidence routinely names whoever filed it.
 *
 * Files are never linked directly. The server holds the storage key and hands out a short
 * signed URL on request, so the staff check runs on every fetch rather than once when this
 * page was built.
 */
// Exported so the user detail screen can attach evidence to a sanction without sending
// somebody to the Sanctions tab to find the row again.
export function Evidence({ s, onChanged }) {
  const { t } = useI18n(); const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');

  const addLink = async () => {
    const url = linkUrl.trim();
    // Checked here as well as on the server. The server is the one that matters — this only
    // saves a round trip and gives the reason in the right place.
    if (!/^https?:\/\//i.test(url)) { toast.error(t('sanc.ev.badurl', 'Links must start with http:// or https://')); return; }
    setBusy(true);
    try {
      await api.post(`/admin/sanctions/${s.id}/evidence`, { kind: 'link', name: linkName.trim() || url.slice(0, 80), url });
      setLinkUrl(''); setLinkName(''); onChanged?.();
    } catch (e) { toast.error(String(e?.message || e)); } finally { setBusy(false); }
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const { url, storageKey } = await api.post(`/admin/sanctions/${s.id}/evidence/presign`, {
        filename: file.name, contentType: file.type || 'application/octet-stream',
      });
      const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      // Recording the row only after the PUT succeeded. The other order leaves a row
      // pointing at an object that was never stored, which reads as "evidence exists" to
      // the next moderator and 404s when they click it.
      if (!put.ok) throw new Error(`upload failed (${put.status})`);
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
      await api.post(`/admin/sanctions/${s.id}/evidence`, {
        kind, name: file.name, storageKey, mime: file.type || undefined, bytes: file.size,
      });
      onChanged?.();
    } catch (e) { toast.error(String(e?.message || e)); } finally { setBusy(false); }
  };

  const open = async (a) => {
    if (a.url) { window.open(a.url, '_blank', 'noopener,noreferrer'); return; }
    try {
      const { url } = await api.get(`/admin/sanctions/${s.id}/evidence/${a.id}`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) { toast.error(String(e?.message || e)); }
  };

  const remove = async (a) => {
    try { await api.del(`/admin/sanctions/${s.id}/evidence/${a.id}`); onChanged?.(); }
    catch (e) { toast.error(String(e?.message || e)); }
  };

  return (
    <Card className="p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] mb-2">
        {t('sanc.ev.title', 'Evidence')} <span className="normal-case font-normal">— {t('sanc.ev.staff', 'staff only; never shown to the person')}</span>
      </div>
      {s.attachments?.length > 0 ? (
        <ul className="space-y-1 mb-2">
          {s.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-[12px] min-w-0">
              <Badge tone="">{a.kind}</Badge>
              <button className="underline truncate text-left min-w-0" onClick={() => open(a)}>{a.name}</button>
              {a.bytes > 0 && <span className="text-[var(--faint)] shrink-0">{fmtBytes(a.bytes)}</span>}
              {a.note && <span className="text-[var(--faint)] truncate">— {a.note}</span>}
              <button className="ml-auto shrink-0 text-[var(--faint)] hover:text-[var(--danger)]" title={t('common.delete', 'Delete')} onClick={() => remove(a)}>
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : <div className="text-[12px] text-[var(--faint)] mb-2">{t('sanc.ev.none', 'Nothing attached.')}</div>}

      <div className="flex flex-wrap gap-2 items-center">
        <label className="inline-flex">
          <input type="file" className="hidden" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          <span className={`px-3 py-1.5 rounded-lg text-[12px] border border-[var(--line)] cursor-pointer ${busy ? 'opacity-50' : 'hover:border-[var(--line-strong)]'}`}>
            <Paperclip size={12} className="inline mr-1" />{t('sanc.ev.upload', 'Attach a file')}
          </span>
        </label>
        <Input className="flex-1 min-w-[180px]" placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
        <Input className="w-[150px]" placeholder={t('sanc.ev.label', 'label (optional)')} value={linkName} onChange={(e) => setLinkName(e.target.value)} />
        <Button size="sm" variant="ghost" disabled={busy || !linkUrl.trim()} onClick={addLink}>{t('sanc.ev.addlink', 'Add link')}</Button>
      </div>
    </Card>
  );
}

/** One row. Deliberately dense: this list is read by somebody scanning for a pattern, not
 *  reading one decision — the detail lives behind the row, not in it. */
function Row({ s, onLift, onResend, onAnswer, onEdit, onArchive, onReapply, onChanged }) {
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

          {/* What was changed after the fact, and by whom. Shown rather than kept in the
              database, because the reason here is quoted in the notice the person received:
              a moderator reading this row needs to know whether the wording in front of
              them is the wording that was sent. */}
          {s.edits?.length > 0 && (
            <details className="text-[11px] text-[var(--faint)]">
              <summary className="cursor-pointer">{t('sanc.edits', '{n} later change(s)').replace('{n}', String(s.edits.length))}</summary>
              <ul className="mt-1 space-y-0.5">
                {s.edits.map((e, i) => (
                  <li key={i} className="break-words">
                    {fmt(e.at)} · <b>{e.field}</b>: <span className="line-through opacity-70">{String(e.from ?? '—')}</span> → {String(e.to ?? '—')}
                    {e.note ? ` (${e.note})` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <Evidence s={s} onChanged={onChanged} />

          <div className="flex flex-wrap gap-2 pt-1">
            {s.status === 'active' && <Button size="sm" variant="ghost" onClick={() => onLift(s)}><Undo2 size={12} /> {t('sanc.lift', 'Lift')}</Button>}
            {/* Reinstating an overturned decision is refused by the API — the button is
                hidden here too, so it is not offered and then taken away. */}
            {s.status !== 'active' && s.contestOutcome !== 'overturned' && (
              <Button size="sm" variant="ghost" onClick={() => onReapply(s)}><RotateCcw size={12} /> {t('sanc.reapply', 'Put back in force')}</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => onEdit(s)}><Pencil size={12} /> {t('common.edit', 'Edit')}</Button>
            {/* Archiving needs the case to be settled. Offering it on an active sanction and
                answering 409 teaches people the button is broken; saying why is better. */}
            {s.archivedAt
              ? <Button size="sm" variant="ghost" onClick={() => onArchive(s, false)}><ArchiveRestore size={12} /> {t('sanc.unarchive', 'Take out of the archive')}</Button>
              : <Button size="sm" variant="ghost" disabled={s.status === 'active' || (s.contestedAt && !s.contestOutcome)}
                  title={s.status === 'active' ? t('sanc.arch.why', 'Still in force — lift it first.')
                       : (s.contestedAt && !s.contestOutcome) ? t('sanc.arch.why2', 'Somebody is waiting for an answer to their contest.') : ''}
                  onClick={() => onArchive(s, true)}><Archive size={12} /> {t('sanc.archive', 'Archive')}</Button>}
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

  // Editing asks for the new wording, then says what it is about to do with it. The person
  // is notified, and the change is recorded against the code they were given — neither is
  // obvious from a text box, so the dialog says both.
  const edit = async (s) => {
    const reason = await dialog.prompt({
      title: t('sanc.edit.t', 'Edit {c}').replace('{c}', s.code),
      message: t('sanc.edit.m', 'The person is told it changed, and the change is recorded against this code with the old wording beside the new. They were sent the current wording — if it was wrong, this is how it is corrected rather than quietly overwritten.'),
      label: t('sanc.edit.l', 'Reason (they see this)'),
      okLabel: t('common.save', 'Save'),
      defaultValue: s.reason,
      multiline: true,
    });
    if (reason == null) return;
    try {
      const r = await api.patch(`/admin/sanctions/${s.id}`, { reason });
      toast.success(r?.unchanged ? t('sanc.edit.same', 'Nothing changed.') : t('sanc.edit.ok', 'Updated.'));
      reload();
    } catch (e) { toast.error(String(e?.message || e)); }
  };

  const reapply = async (s) => {
    const reason = await dialog.prompt({
      title: t('sanc.re.t', 'Put {c} back in force?').replace('{c}', s.code),
      message: t('sanc.re.m', 'The same code comes back into force — not a new one, so the notice they already hold still matches. The lift stays in the record. For a takedown, the content is hidden again in the same action.'),
      label: t('sanc.re.l', 'Why (they see this)'),
      okLabel: t('sanc.reapply', 'Put back in force'),
    });
    if (reason == null) return;
    try { await api.post(`/admin/sanctions/${s.id}/reapply`, { reason: reason || undefined }); toast.success(t('sanc.re.ok', 'Back in force.')); reload(); }
    catch (e) { toast.error(String(e?.message || e)); }
  };

  const archive = async (s, archived) => {
    try {
      await api.post(`/admin/sanctions/${s.id}/archive`, { archived });
      // Named for what it is: nothing was deleted, and it is one filter away.
      toast.success(archived ? t('sanc.arch.ok', 'Filed away — find it again under “archived”.') : t('sanc.unarch.ok', 'Back in the list.'));
      reload();
    } catch (e) { toast.error(String(e?.message || e)); }
  };

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
            {/* Archived rows are out of every other view. Reachable, never deleted. */}
            <option value="archived">{t('sanc.s.archived', 'archived')}</option>
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
          {list.map((s) => <Row key={s.id} s={s} onLift={lift} onResend={resend} onAnswer={answer}
            onEdit={edit} onArchive={archive} onReapply={reapply} onChanged={reload} />)}
        </Card>
      )}
      {data?.total > list.length && (
        <p className="text-[11px] text-[var(--faint)] mt-2">{t('sanc.more', 'Showing {n} of {t} — narrow the search to see the rest.').replace('{n}', String(list.length)).replace('{t}', String(data.total))}</p>
      )}

      <ClosureSurveys />
    </div>
  );
}

/**
 * Why people left.
 *
 * The closure page asks a departing account for a reason, the answer has been stored since
 * that page shipped, and `/admin/closure-surveys` has served it the whole time to nobody: no
 * screen called it. So the site has been asking people a question on their way out and filing
 * the answers where no one could read them.
 *
 * Here rather than in its own tab because a closure IS a sanction kind on this screen — the
 * decisions are above, and this is what came back from them.
 */
function ClosureSurveys() {
  const { t } = useI18n();
  const [days, setDays] = useState(90);
  const [open, setOpen] = useState(false);
  const { data, loading } = useAsync(() => (open ? api.get(`/admin/closure-surveys?days=${days}`) : Promise.resolve(null)), [open, days]);

  // The reason codes come back as `outcome:reason` counts. Sorted by weight — the point of the
  // question is which answer comes up most.
  // Labelled with the closure page's own `acl.reason.*` keys, so staff read exactly the wording
  // the person was offered rather than a second, drifting set of names for the same answers.
  const reasons = Object.entries(data?.byReason || {})
    .map(([k, n]) => { const [outcome, reason] = k.split(':'); return { outcome, reason, n }; })
    .sort((x, y) => y.n - x.n);

  return (
    <Card className="p-4 mt-8">
      <button className="w-full flex items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
        <FileText size={15} className="text-[var(--primary-2)]" />
        <span className="font-semibold text-sm">{t('cls.title', 'Why people left')}</span>
        <span className="text-[11px] text-[var(--faint)] ml-auto">{open ? t('common.hide', 'Hide') : t('common.show', 'Show')}</span>
      </button>
      {!open ? (
        <p className="text-[11px] text-[var(--muted)] mt-1.5">
          {t('cls.sub', 'The reason given when an account is closed — and when a closure is called off. Asked on the closure page; this is where the answers are read.')}
        </p>
      ) : loading && !data ? <Loading /> : (
        <div className="mt-3">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <Select className="w-auto" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              <option value="30">{t('cls.d30', 'Last 30 days')}</option>
              <option value="90">{t('cls.d90', 'Last 90 days')}</option>
              <option value="365">{t('cls.d365', 'Last year')}</option>
            </Select>
            <span className="text-[12px] text-[var(--muted)]">
              {t('cls.counts', '{t} answers · {c} closed · {k} called off')
                .replace('{t}', String(data?.total ?? 0)).replace('{c}', String(data?.closed ?? 0)).replace('{k}', String(data?.cancelled ?? 0))}
            </span>
          </div>

          {!data?.total ? (
            <p className="text-[12px] text-[var(--muted)]">{t('cls.none', 'Nobody has answered in this window.')}</p>
          ) : (<>
            <div className="space-y-1.5 mb-4">
              {reasons.map((r) => (
                <div key={`${r.outcome}:${r.reason}`} className="flex items-center gap-2 text-[12px]">
                  <Badge tone={r.outcome === 'cancelled' ? 'green' : 'red'}>{t(`cls.o.${r.outcome}`, r.outcome)}</Badge>
                  <span className="flex-1 min-w-0 truncate">{t(`acl.reason.${r.reason}`, r.reason)}</span>
                  {/* Share of the window, so one answer out of three does not read like a trend. */}
                  <span className="h-1.5 rounded bg-[var(--primary)]" style={{ width: `${Math.round((r.n / data.total) * 120)}px` }} />
                  <span className="tabular-nums text-[var(--muted)] w-8 text-right">{r.n}</span>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {(data.recent || []).filter((r) => r.comment).slice(0, 25).map((r, i) => (
                <div key={i} className="text-[12px] border-l-2 border-[var(--line)] pl-2.5">
                  <div className="text-[var(--faint)] text-[11px]">
                    {new Date(r.createdAt).toLocaleDateString()} · {t(`cls.o.${r.outcome}`, r.outcome)} · {t(`acl.reason.${r.reason}`, r.reason || '—')}
                  </div>
                  <div className="text-[var(--muted)] whitespace-pre-wrap break-words">{r.comment}</div>
                </div>
              ))}
            </div>
          </>)}
        </div>
      )}
    </Card>
  );
}

/** The takedown/warning form, used from a repo or catalog screen where the target is known.
 *  Exported so the content screens can drop it in rather than re-deriving the shape. */
export function ContentSanctionForm({ targetType, targetId, targetName, onDone }) {
  const { t } = useI18n(); const toast = useToast();
  // `days` and `internalNote` were accepted by the API from the start and had no field
  // here, so every content sanction was permanent and no staff context could be recorded.
  const [f, setF] = useState({ kind: 'warning', reason: '', request: '', days: '', internalNote: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (f.reason.trim().length < 3) return toast.error(t('sanc.needreason', 'A reason is required — it is what they receive.'));
    setBusy(true);
    try {
      const r = await api.post('/admin/sanctions/content', {
        targetType, targetId, kind: f.kind,
        reason: f.reason.trim(), request: f.request.trim() || undefined,
        internalNote: f.internalNote.trim() || undefined,
        // Days from now, because "until when" is not how anybody decides a suspension —
        // they decide "a week". Empty means indefinite, which is what it always was.
        expiresAt: f.days ? new Date(Date.now() + Number(f.days) * 86400000).toISOString() : undefined,
      });
      toast.success(t('sanc.issued', 'Issued — {c}').replace('{c}', r.sanction.code));
      setF({ kind: 'warning', reason: '', request: '', days: '', internalNote: '' });
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
      <Field label={t('sanc.form.days', 'For how long')}
        hint={t('sanc.form.days.h', 'Leave empty for indefinite. A suspension with no end date is one somebody has to remember to lift.')}>
        <Select value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })}>
          <option value="">{t('sanc.form.d.none', 'Indefinite')}</option>
          <option value="1">{t('sanc.form.d.1', '24 hours')}</option>
          <option value="7">{t('sanc.form.d.7', '7 days')}</option>
          <option value="30">{t('sanc.form.d.30', '30 days')}</option>
          <option value="90">{t('sanc.form.d.90', '90 days')}</option>
        </Select>
      </Field>
      <Field label={t('sanc.form.request', 'What you are asking them to do (optional)')}
        hint={t('sanc.form.request.h', 'A warning with no request is just an insult with a reference number.')}>
        <Textarea rows={2} value={f.request} onChange={(e) => setF({ ...f, request: e.target.value })} />
      </Field>
      <Field label={t('sanc.form.note', 'Internal note (they never see this)')}
        hint={t('sanc.form.note.h', 'The reason above is quoted in their e-mail and in any contest. Anything you would not put there goes here.')}>
        <Textarea rows={2} value={f.internalNote} onChange={(e) => setF({ ...f, internalNote: e.target.value })} />
      </Field>
      <Button type="submit" variant={f.kind === 'takedown' ? 'danger' : 'primary'} disabled={busy}>
        <Gavel size={13} /> {f.kind === 'takedown' ? t('sanc.form.take', 'Take it down') : t('sanc.form.warn', 'Send the warning')}
      </Button>
    </form>
  );
}
