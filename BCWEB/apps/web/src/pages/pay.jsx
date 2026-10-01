// agent-bcw-pools: /pay/:token, the payer's side of an admin-made payment link.
//
// Says what the link sells, what it costs, and one button. Paying opens Stripe Checkout; the
// webhook delivers. Coming back with ?paid=1 the page only READS whether the delivery landed
// (it polls the link a few times); nothing on this side grants anything.
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CreditCard, LogIn, CheckCircle2, HardDrive, FlaskConical, Receipt, Clock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from './auth.jsx';
import { useAsync } from './pages.jsx';
import { Button, Card, Badge, EmptyState, Spinner, useToast } from '../ui/ui.jsx';

const money = (c, cur = 'usd') => `${(Number(c || 0) / 100).toFixed(2)} ${String(cur).toUpperCase()}`;
const ICON = { pool: HardDrive, prerelease: FlaskConical, custom: Receipt };

export function PayPage() {
  const { t, lang } = useI18n();
  const { token } = useParams();
  const [sp] = useSearchParams();
  const { user } = useAuth() || {};
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [tries, setTries] = useState(0);
  const q = useAsync(() => api.get(`/pay/${encodeURIComponent(token || '')}`), [token, tries]);
  const back = sp.get('paid') === '1';
  // Back from Stripe: the webhook may land a few seconds after the redirect. Ask again, a few times.
  useEffect(() => {
    if (!back || q.data?.paid || tries >= 6) return undefined;
    const id = setTimeout(() => setTries((n) => n + 1), 2500);
    return () => clearTimeout(id);
  }, [back, q.data?.paid, tries]);

  if (q.loading && !q.data) return <div className="py-16 grid place-items-center"><Spinner /></div>;
  if (!q.data?.link) return <div className="max-w-xl mx-auto px-4 py-12"><EmptyState icon={Receipt} title={t('pay.none', 'This link does not exist')} sub={t('pay.none.s', 'Check the address, or ask whoever sent it.')} /></div>;
  const { link, available, why, paid } = q.data;
  const I = ICON[link.kind] || Receipt;
  const whyText = {
    revoked: t('pay.why.revoked', 'This link was stopped.'), expired: t('pay.why.expired', 'This link has expired.'),
    sold_out: t('pay.why.soldout', 'No places left.'), wrong_account: t('pay.why.account', 'This link is for another account.'),
    already_paid: t('pay.why.paid', 'You already paid through this link.'),
  }[why];
  const pay = async () => {
    setBusy(true);
    try { const r = await api.post(`/pay/${encodeURIComponent(token)}/checkout`); if (r.url) window.location.assign(r.url); }
    catch (x) {
      toast.error(({ payments_disabled: t('pay.err.off', 'Payments are paused for now.'), stripe_not_configured: t('pay.err.off', 'Payments are paused for now.'), sold_out: t('pay.why.soldout', 'No places left.'), already_paid: t('pay.why.paid', 'You already paid through this link.'), prerelease_closed: t('pay.err.closed', 'This early access has ended.') })[x?.data?.error] || t('common.failed', 'Failed.'));
      setBusy(false);
    }
  };
  const what = link.kind === 'pool'
    ? t('pay.pool', '{g} GB storage pool').replace('{g}', String(link.pool?.storageGB ?? '')) + (link.interval === 'once' && link.pool?.months ? ` · ${t('pay.months', '{n} month(s)').replace('{n}', String(link.pool.months))}` : '') + (link.pool?.project ? ` · ${link.pool.project}` : '')
    : link.kind === 'prerelease' ? t('pay.pre', 'Early access: {t}').replace('{t}', link.prerelease?.title || '') : null;
  return (
    <div className="max-w-xl mx-auto px-4 py-10" data-testid="pay-page">
      <Card className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <I size={20} className="text-[var(--accent-ink)] shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold break-words">{link.title}</h1>
            {what && <p className="text-sm text-[var(--muted)] mt-0.5">{what}</p>}
          </div>
        </div>
        {link.description && <p className="text-sm whitespace-pre-line break-words">{link.description}</p>}
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">{money(link.amountCents, link.currency)}</span>
          <span className="text-sm text-[var(--muted)]">{link.interval === 'month' ? t('pay.month', 'per month, cancel any time') : t('pay.once', 'one payment')}</span>
          {link.left != null && <Badge className="ms-auto">{t('pay.left', '{n} left').replace('{n}', String(link.left))}</Badge>}
        </div>
        {link.expiresAt && <p className="text-xs text-[var(--muted)] flex items-center gap-1"><Clock size={12} aria-hidden /> {t('pay.until', 'Until {d}').replace('{d}', new Date(link.expiresAt).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB'))}</p>}

        {paid ? (
          <p className="text-sm text-success flex items-center gap-1.5" data-testid="pay-done"><CheckCircle2 size={15} aria-hidden /> {t('pay.done', 'Paid. It is in your dashboard.')}</p>
        ) : back ? (
          <p className="text-sm text-[var(--muted)] flex items-center gap-2"><Spinner /> {t('pay.wait', 'Payment received, delivering…')}</p>
        ) : !user ? (
          <Link to={`/auth?next=${encodeURIComponent(`/pay/${token}`)}`}><Button variant="primary"><LogIn size={15} /> {t('pay.signin', 'Sign in to pay')}</Button></Link>
        ) : available ? (
          <Button variant="primary" disabled={busy} onClick={pay}>{busy ? <Spinner /> : <CreditCard size={15} />} {t('pay.pay', 'Pay with Stripe')}</Button>
        ) : (
          <p className="text-sm text-warning">{whyText || t('pay.why.other', 'This link cannot be used now.')}</p>
        )}
        <p className="text-xs text-[var(--faint)]">{t('pay.legal', 'Secure payment by Stripe. A receipt is e-mailed and kept in Billing.')} <Link to="/legal/refunds" className="underline">{t('pay.terms', 'Payment terms')}</Link></p>
      </Card>
    </div>
  );
}

export default PayPage;
