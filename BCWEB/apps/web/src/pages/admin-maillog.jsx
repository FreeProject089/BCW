// Admin → Accounts → Sent e-mails: every mail the platform tried to send.
//
// Reads routes/mail-log.mjs (manage_users, like every /admin/users route). The list shows
// recipients MASKED and cannot be searched by address; opening a row fetches it on its own and
// shows the whole address and the account it belonged to. There is no body to show: the log
// never stores one (lib/mail-log.mjs says why), only the template id and a redacted subject.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Search, X, Paperclip, CheckCircle2, AlertTriangle, PowerOff, User as UserIcon, Mail } from 'lucide-react';
import { Card, Badge, Button, Input, Dropdown, Spinner, EmptyState, Modal, Explain, useToast, copyText } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

const STATUS_TONE = { sent: 'green', failed: 'red', disabled: 'amber' };
const STATUS_ICON = { sent: CheckCircle2, failed: AlertTriangle, disabled: PowerOff };

function StatusBadge({ status, t }) {
  const I = STATUS_ICON[status] || AlertTriangle;
  const label = status === 'sent' ? t('ml.s.sent', 'sent') : status === 'disabled' ? t('ml.s.disabled', 'not sent, mail off') : t('ml.s.failed', 'failed');
  return <Badge tone={STATUS_TONE[status] || ''} className="shrink-0"><I size={10} /> {label}</Badge>;
}

function Detail({ id, onClose }) {
  const { t } = useI18n(); const toast = useToast();
  const [row, setRow] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let on = true;
    api.get(`/admin/mail/log/${encodeURIComponent(id)}`).then((r) => on && setRow(r.row)).catch(() => on && setErr(true));
    return () => { on = false; };
  }, [id]);
  return (
    <Modal open onClose={onClose} title={t('ml.detail', 'Sent e-mail')} icon={Mail} width="max-w-lg">
      {err ? <div className="text-sm text-error">{t('ml.loadfail', 'Could not load it.')}</div> : !row ? <Spinner /> : (
        <div className="space-y-3 text-sm" data-maillog-detail>
          <div className="flex items-center gap-2 flex-wrap"><StatusBadge status={row.status} t={t} /><span className="text-xs text-[var(--faint)]">{new Date(row.createdAt).toLocaleString()}</span></div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--faint)] font-semibold mb-0.5">{t('ml.to', 'To')}</div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[13px] break-all">{row.to}</span>
              <Button size="sm" variant="ghost" onClick={() => { copyText(row.to); toast.success(t('common.copied', 'Copied.')); }}>{t('common.copy', 'Copy')}</Button>
            </div>
            {row.user && <Link to={`/u/${row.user.id}`} className="text-xs text-[var(--accent-ink)] hover:underline inline-flex items-center gap-1 mt-0.5"><UserIcon size={11} /> {row.user.displayName}</Link>}
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--faint)] font-semibold mb-0.5">{t('ml.subject', 'Subject')}</div>
            <div className="break-words">{row.subject || '—'}</div>
          </div>
          <div className="flex gap-4 flex-wrap text-xs text-[var(--muted)]">
            <span>{t('ml.template', 'Template')}: <code className="font-mono">{row.mailId || t('ml.untagged', 'untagged')}</code></span>
            {row.attachments > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={11} /> {row.attachments}</span>}
          </div>
          {row.error && <div className="rounded-lg border border-error-border tint-error p-2.5 text-xs break-words">{row.error}</div>}
          <div className="text-[11px] text-[var(--faint)]">{t('ml.nobody', 'The content of a mail is never kept, only what is above.')}</div>
        </div>
      )}
    </Modal>
  );
}

export function AdminMailLog() {
  const { t } = useI18n();
  const [status, setStatus] = useState('');
  const [mailId, setMailId] = useState('');
  const [q, setQ] = useState(''); const [qApplied, setQApplied] = useState('');
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  const url = useCallback((c) => {
    const sp = new URLSearchParams();
    if (status) sp.set('status', status);
    if (mailId) sp.set('mailId', mailId);
    if (qApplied) sp.set('q', qApplied);
    if (c) sp.set('cursor', c);
    return `/admin/mail/log?${sp}`;
  }, [status, mailId, qApplied]);

  useEffect(() => {
    let on = true;
    setRows(null);
    api.get(url(null)).then((r) => { if (!on) return; setRows(r.rows); setMeta(r); setCursor(r.nextCursor); }).catch(() => on && setRows([]));
    return () => { on = false; };
  }, [url]);

  const more = async () => {
    if (!cursor) return;
    setBusy(true);
    try { const r = await api.get(url(cursor)); setRows((s) => [...(s || []), ...r.rows]); setCursor(r.nextCursor); }
    finally { setBusy(false); }
  };

  const facets = meta?.facets || { status: {}, templates: [] };
  const statusOpts = [
    { value: '', label: t('ml.allstatus', 'All statuses') },
    { value: 'sent', label: `${t('ml.s.sent', 'sent')} (${facets.status.sent || 0})` },
    { value: 'failed', label: `${t('ml.s.failed', 'failed')} (${facets.status.failed || 0})` },
    { value: 'disabled', label: `${t('ml.s.disabled', 'not sent, mail off')} (${facets.status.disabled || 0})` },
  ];
  const tplOpts = [
    { value: '', label: t('ml.alltpl', 'All templates') },
    ...facets.templates.map((x) => ({ value: x.mailId, label: `${x.mailId || t('ml.untagged', 'untagged')} (${x.count})` })),
  ];
  const filtered = !!(status || mailId || qApplied);

  return (
    <div className="space-y-3" data-maillog>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="font-semibold flex items-center gap-2 flex-1"><Send size={16} className="text-[var(--accent-ink)]" /> {t('ml.title', 'Sent e-mails')}
          {meta && <span className="text-xs text-[var(--faint)] font-normal">{meta.total}</span>}</h2>
      </div>
      <Explain summary={t('ml.what', 'Every mail the site tried to send, whether it left or not.')}>
        <p className="text-sm text-[var(--muted)]">{t('ml.what.more', 'Addresses are masked in the list; open a row to see the whole address. The content of a mail is never stored, because that is where links and codes are: only the template, a subject with links and codes removed, and the status. Kept {d} days, {n} mails at most.').replace('{d}', String(meta?.retention?.days ?? 90)).replace('{n}', String(meta?.retention?.rows ?? 20000))}</p>
      </Explain>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)] pointer-events-none" />
          <Input className="!ps-9" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQApplied(q.trim())}
            placeholder={t('ml.search', 'Search a subject or a template…')} aria-label={t('ml.search', 'Search a subject or a template…')} />
          {q && <button type="button" onClick={() => { setQ(''); setQApplied(''); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)] hover:text-[var(--text)]" title={t('common.clear', 'Clear')}><X size={15} /></button>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Dropdown value={status} onChange={setStatus} options={statusOpts} />
          <Dropdown value={mailId} onChange={setMailId} options={tplOpts} />
        </div>
      </div>

      {rows === null ? <Spinner /> : !rows.length ? (
        filtered
          ? <EmptyState icon={Search} title={t('ml.nomatch', 'No mail matches these filters')} action={{ label: t('ml.reset', 'Clear the filters'), icon: X, onClick: () => { setStatus(''); setMailId(''); setQ(''); setQApplied(''); } }} />
          : <EmptyState icon={Send} title={t('ml.none', 'No mail sent yet')} sub={t('ml.none.s', 'The first confirmation, reset or notice sent will appear here.')} />
      ) : (
        <Card className="divide-y divide-[var(--line)] overflow-hidden">
          {rows.map((r) => (
            <button key={r.id} type="button" onClick={() => setOpen(r.id)} className="w-full text-start px-3 py-2.5 hover:bg-[var(--surface-2)] flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
              <span className="flex items-center gap-2 min-w-0 flex-1">
                <StatusBadge status={r.status} t={t} />
                <span className="truncate text-sm min-w-0" title={r.subject}>{r.subject || '—'}</span>
                {r.attachments > 0 && <Paperclip size={12} className="text-[var(--faint)] shrink-0" />}
              </span>
              <span className="flex items-center gap-2 text-xs text-[var(--muted)] min-w-0 sm:shrink-0">
                <code className="font-mono text-[11px] text-[var(--faint)] truncate max-w-[10rem]" title={r.mailId}>{r.mailId || t('ml.untagged', 'untagged')}</code>
                <span className="font-mono truncate max-w-[12rem]" title={r.to}>{r.to}</span>
                <span className="text-[var(--faint)] tabular-nums shrink-0 ms-auto sm:ms-0">{new Date(r.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
              </span>
            </button>
          ))}
        </Card>
      )}
      {cursor && <div className="flex justify-center"><Button size="sm" disabled={busy} onClick={more}>{busy ? <Spinner /> : t('ml.more', 'Load more')}</Button></div>}
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
