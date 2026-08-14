import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Gavel, Clock, Ban, AlertTriangle, FileText, Scale, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Textarea, Badge, Spinner, useToast } from '../ui/ui.jsx';
import { useAuth } from './auth.jsx';

// /sanctions/:code — the page every moderation e-mail has been linking to.
//
// It did not exist. The notice went out with a reference and a "read it and contest" button
// that landed on the 404 page, which is the worst possible first impression for the one
// message where being taken seriously matters most.
//
// What it is: the decision as the person it landed on sees it — never who issued it, because
// a moderator's name is not owed to the person they moderated — and the form to argue with it.

const ICON = { warning: AlertTriangle, suspension: Clock, ban: Ban, closure: FileText, takedown: Scale };

export default function SanctionPage() {
  const { code } = useParams();
  const { t } = useI18n(); const toast = useToast();
  const { user, loading: authLoading } = useAuth();
  const [s, setS] = useState(null);
  const [state, setState] = useState('loading'); // loading | ok | missing
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/me/sanctions/${encodeURIComponent(code)}`)
    .then((r) => { setS(r.sanction); setState('ok'); })
    .catch(() => setState('missing'));
  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user, code]);

  if (authLoading) return null;
  if (!user) {
    return (
      <div className="max-w-lg mx-auto py-14">
        <Card className="p-7 text-center">
          <Gavel size={22} className="text-[var(--primary-2)] mx-auto mb-3" />
          <p className="text-sm text-[var(--muted)] mb-4">
            {t('sanp.signin', 'Sign in to read {c}. A decision is only shown to the account it was made about.').replace('{c}', code)}
          </p>
          <Link to={`/auth?next=/sanctions/${encodeURIComponent(code)}`}><Button variant="primary">{t('nav.signin', 'Sign in')}</Button></Link>
        </Card>
      </div>
    );
  }

  if (state === 'loading') return <div className="py-14 text-center"><Spinner /></div>;
  if (state === 'missing') {
    return (
      <div className="max-w-lg mx-auto py-14">
        <Card className="p-7 text-center">
          <p className="text-sm font-medium mb-1">{t('sanp.none', 'No decision with that reference')}</p>
          {/* Same answer whether it never existed or belongs to somebody else: a reference is
              short enough to guess at, and confirming that one is real is a way of confirming
              somebody was sanctioned. */}
          <p className="text-sm text-[var(--muted)]">{t('sanp.none.s', 'Check the reference in your e-mail. It is shown only to the account it concerns.')}</p>
        </Card>
      </div>
    );
  }

  const Icon = ICON[s.kind] || Gavel;
  const over = s.status !== 'active';

  const contest = async () => {
    if (body.trim().length < 20) return toast.error(t('sanp.short', 'Say what is wrong, in a couple of sentences at least.'));
    setBusy(true);
    try { await api.post(`/me/sanctions/${encodeURIComponent(code)}/contest`, { body: body.trim() }); toast.success(t('sanp.sent', 'Sent. A person reads every contest.')); load(); }
    catch (x) { toast.error(x?.data?.error === 'already_contested' ? t('sanp.already', 'You have already contested this one.') : t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-2xl mx-auto py-8 space-y-4">
      <Card className="p-6">
        <div className="flex items-start gap-3">
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-[var(--surface-2)] border border-[var(--line)] shrink-0">
            <Icon size={19} className={over ? 'text-[var(--faint)]' : 'text-warning'} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">{t(`sanc.k.${s.kind}`, s.kind)}</h1>
              {over && <Badge tone="green">{t(`sanp.s.${s.status}`, s.status)}</Badge>}
            </div>
            <code className="text-[12px] font-mono text-[var(--primary-2)]">{s.code}</code>
          </div>
        </div>

        <dl className="mt-4 space-y-2 text-[14px]">
          <div><dt className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('sanp.reason', 'Reason')}</dt>
            <dd className="break-words">{s.reason}</dd></div>
          {s.targetName && (
            <div><dt className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('sanp.about', 'What it is about')}</dt>
              <dd>{s.targetName}</dd></div>
          )}
          {s.request && (
            <div><dt className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('sanp.asked', 'What we are asking you to do')}</dt>
              <dd className="break-words">{s.request}</dd></div>
          )}
          <div><dt className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('sanp.when', 'Issued')}</dt>
            <dd>{new Date(s.issuedAt).toLocaleString()}{s.expiresAt ? ` · ${t('sanp.until', 'ends {d}').replace('{d}', new Date(s.expiresAt).toLocaleString())}` : ''}</dd></div>
          {s.liftedAt && (
            <div><dt className="text-[11px] uppercase tracking-wider text-[var(--faint)]">{t('sanp.lifted', 'Lifted')}</dt>
              <dd>{new Date(s.liftedAt).toLocaleString()}{s.liftReason ? ` — ${s.liftReason}` : ''}</dd></div>
          )}
        </dl>

        {/* The subscriptions this cost them, and the ones it did not. Said here because the
            billing page shows what you have, not what a sanction took. */}
        {s.cancelledSubs?.length > 0 && (
          <div className="mt-4 pt-3 border-t border-[var(--line)] text-[13px]">
            <div className="text-[11px] uppercase tracking-wider text-[var(--faint)] mb-1">{t('sanp.subs', 'Subscriptions')}</div>
            <p className="text-[var(--muted)]">
              {t('sanp.subs.s', '{n} cancelled, because their term ended before the sanction did. Nothing was taken out again on your behalf.').replace('{n}', String(s.cancelledSubs.length))}
              {s.keptSubs?.length > 0 && ' ' + t('sanp.subs.k', '{n} kept — their term outlasts it.').replace('{n}', String(s.keptSubs.length))}
            </p>
            <Link to="/dashboard?s=billing" className="text-[var(--primary-2)] hover:underline">{t('sanp.billing', 'Open billing')}</Link>
          </div>
        )}
      </Card>

      {/* The contest. Says plainly what it does and does not do — a form that quietly changes
          nothing is how people conclude nobody read it. */}
      <Card className="p-6">
        <div className="text-sm font-semibold mb-1 flex items-center gap-2"><Scale size={15} className="text-[var(--primary-2)]" /> {t('sanp.contest', 'Contest this')}</div>
        {s.contestedAt ? (
          <>
            <p className="text-[12px] text-[var(--muted)] mb-2">{t('sanp.filed', 'Filed {d}.').replace('{d}', new Date(s.contestedAt).toLocaleString())}</p>
            <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--line)] p-3 text-[13px] whitespace-pre-wrap break-words">{s.contestBody}</div>
            {s.contestOutcome ? (
              <div className="mt-3 pt-3 border-t border-[var(--line)]">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 size={14} className={s.contestOutcome === 'overturned' ? 'text-success' : 'text-[var(--faint)]'} />
                  <span className="text-[13px] font-medium">{t(`sanc.o.${s.contestOutcome}`, s.contestOutcome)}</span>
                  <span className="text-[11px] text-[var(--faint)]">{new Date(s.contestAnsweredAt).toLocaleString()}</span>
                </div>
                <p className="text-[13px] whitespace-pre-wrap break-words">{s.contestAnswer}</p>
              </div>
            ) : (
              <p className="text-[12px] text-[var(--muted)] mt-2">{t('sanp.waiting', 'Waiting for an answer. A person reads it — this is not automated.')}</p>
            )}
          </>
        ) : (
          <>
            <p className="text-[12px] text-[var(--muted)] mb-3">
              {t('sanp.contest.s', 'Once, and it does not pause anything: the decision stands while it is read. Say what is wrong with it — new facts help more than a second opinion on the same ones.')}
            </p>
            <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder={t('sanp.ph', 'What do we have wrong?')} />
            <Button className="mt-2" variant="primary" disabled={busy} onClick={contest}>
              {busy ? <Spinner /> : <><Scale size={14} /> {t('sanp.send', 'Send it')}</>}
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
