// Admin: the in-flight Stripe checkouts, and the button that finishes the stuck ones.
//
// A row here is a checkout somebody opened that the webhook has not yet finished. Most are
// people still on Stripe's page and vanish on their own; the ones that matter are old AND
// paid — the API was down when Stripe called, and the buyer has been charged for something
// that was never handed over. The reconciler (boot, every ten minutes, or this button) asks
// Stripe what happened and finishes it. Read-only apart from that button.
import { useState } from 'react';
import { RefreshCw, Clock, CheckCircle2, XCircle, AlertTriangle, CreditCard } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { Card, Button, Badge, useToast, Explain } from '../ui/ui.jsx';
import { useAsync, Loading } from './pages.jsx';

const TONE = { pending: '', paid: 'warning', delivered: 'success', failed: 'error' };

export function AdminPendingPayments() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => api.get('/admin/payments/pending?limit=200'), []);
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState(null);

  const run = async (olderThanMin) => {
    setRunning(true);
    try {
      const r = await api.post('/admin/payments/reconcile', { olderThanMin });
      setLast(r.summary);
      const s = r.summary || {};
      toast.success(t('adpay.ran', 'Checked {n}, delivered {d}, failed {f}, still open {o}.').replace('{n}', s.scanned ?? 0).replace('{d}', s.delivered ?? 0).replace('{f}', s.failed ?? 0).replace('{o}', s.stillPending ?? 0));
      reload();
    } catch (e) {
      toast.error(e?.data?.error === 'stripe_not_configured' ? t('adpay.nostripe', 'Stripe is not configured on this server.') : t('common.failed', 'Failed.'));
    } finally { setRunning(false); }
  };

  const statusLabel = (s) => ({
    pending: t('adpay.st.pending', 'open'),
    paid: t('adpay.st.paid', 'paid, clearing'),
    delivered: t('adpay.st.delivered', 'delivered'),
    failed: t('adpay.st.failed', 'expired'),
  }[s] || s);

  if (loading) return <Loading />;
  const open = data?.open || [];
  const finished = data?.finished || [];
  const stale = open.filter((r) => r.ageMin >= 15);

  const Row = ({ r }) => (
    <div className="flex items-center gap-3 flex-wrap text-sm rounded-lg bg-[var(--surface-2)] px-3 py-2">
      <Badge tone={TONE[r.status] || ''}>{statusLabel(r.status)}</Badge>
      <span className="font-medium">{r.kind}</span>
      <span className="font-mono text-[11px] text-[var(--faint)] truncate max-w-[220px]" title={r.sessionId}>{r.sessionId}</span>
      <span className="text-[11px] text-[var(--faint)] flex items-center gap-1"><Clock size={11} /> {t('adpay.age', '{n} min ago').replace('{n}', r.ageMin)}</span>
      {r.userId && <span className="text-[11px] text-[var(--faint)] font-mono">{r.userId}</span>}
    </div>
  );

  // One card for the whole screen. It was a bare <div>: the title, the explanation, the
  // counters and both lists sat straight on the page backdrop, which is why "Translucent
  // surfaces" looked ignored here: there was no surface for it to govern.
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-semibold flex items-center gap-2"><CreditCard size={16} className="text-[var(--accent-ink)]" /> {t('adpay.title', 'Pending payments')}</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={reload} title={t('common.refresh', 'Refresh')}><RefreshCw size={13} /></Button>
          <Button size="sm" variant="primary" disabled={running} onClick={() => run(15)} title={t('adpay.run.h', 'Ask Stripe about every checkout older than 15 minutes and finish what the webhook missed.')}>{running ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />} {t('adpay.run', 'Reconcile now')}</Button>
          <Button size="sm" variant="ghost" disabled={running} onClick={() => run(0)} title={t('adpay.runall.h', 'Same, including checkouts opened seconds ago. Use it when you know the webhook was down.')}>{t('adpay.runall', 'Include recent')}</Button>
        </div>
      </div>
      <Explain className="text-sm mb-4 max-w-2xl">{t('adpay.sub', 'Every Stripe checkout is written here when it opens and finished by the webhook. A row that stays open after payment means the webhook never ran; the reconciler (at boot, every ten minutes, or the button) asks Stripe and delivers what was paid for. Paid-but-undelivered cases also raise an alert on the Errors page and notify super-admins.')}</Explain>

      {stale.length > 0 && (
        <div className="p-3 mb-4 rounded-lg border b-warning tint-warning-soft">
          <div className="flex items-center gap-2 text-sm"><AlertTriangle size={14} className="text-[var(--warning)]" /> {t('adpay.stale', '{n} checkout(s) open for more than 15 minutes.').replace('{n}', stale.length)}</div>
        </div>
      )}

      {last && (
        <div className="text-xs text-[var(--muted)] mb-4 flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1"><CheckCircle2 size={12} className="text-[var(--success)]" /> {t('adpay.last.delivered', 'delivered {n}').replace('{n}', last.delivered)}</span>
          <span className="flex items-center gap-1"><XCircle size={12} className="text-[var(--faint)]" /> {t('adpay.last.failed', 'expired {n}').replace('{n}', last.failed)}</span>
          <span>{t('adpay.last.already', 'already delivered {n}').replace('{n}', last.alreadyDelivered ?? 0)}</span>
          <span>{t('adpay.last.open', 'still open {n}').replace('{n}', last.stillPending)}</span>
          {last.errors > 0 && <span className="text-error">{t('adpay.last.errors', 'errors {n}, see the Errors page').replace('{n}', last.errors)}</span>}
        </div>
      )}

      <h3 className="text-sm font-medium mb-2">{t('adpay.open', 'Open')} <Badge tone="">{open.length}</Badge></h3>
      {!open.length ? <div className="text-sm text-[var(--muted)] mb-6">{t('adpay.none', 'Nothing in flight.')}</div> : (
        <div className="space-y-1.5 mb-6">{open.map((r) => <Row key={r.id} r={r} />)}</div>
      )}
      <h3 className="text-sm font-medium mb-2">{t('adpay.finished', 'Recently finished')}</h3>
      {!finished.length ? <div className="text-sm text-[var(--muted)]">{t('adpay.nonefinished', 'None yet.')}</div> : (
        <div className="space-y-1.5">{finished.map((r) => <Row key={r.id} r={r} />)}</div>
      )}
    </Card>
  );
}
