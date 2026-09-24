// N-hosting (agent-hosting-N): the loyalty (tenure) pricing editor, shown in Admin → Hosting →
// Plans under the plan list. One site-wide policy: steps like "after 3 months without a break,
// 5 % off each renewal", and a hard maximum the discount never goes past.
//
// The server owns the rule (apps/api/src/lib/loyalty.mjs: what "without a break" means, when the
// discount is applied, how it reaches Stripe). This screen only edits the numbers, and says in
// one place what they will do, so an admin never has to read the code to know what they sold.
import { useEffect, useState } from 'react';
import { Plus, Trash2, TrendingDown, Save } from 'lucide-react';
import { Button, Card, Input, Spinner, Explain, useToast } from '../ui/ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

const HARD_MAX = 90;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));

export default function HostingLoyaltyEditor() {
  const { t } = useI18n(); const toast = useToast();
  const [pol, setPol] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.get('/admin/hosting/loyalty')
      .then((r) => { setPol(r.loyalty); setSaved(JSON.stringify(r.loyalty)); })
      .catch(() => setErr(true));
  }, []);

  if (err) return <Card className="p-5 mt-6 text-sm text-[var(--muted)]">{t('adm.loyal.err', 'Could not load the loyalty pricing settings.')}</Card>;
  if (!pol) return <div className="py-6 grid place-items-center"><Spinner /></div>;

  const dirty = JSON.stringify(pol) !== saved;
  const setTier = (i, k, v) => setPol((p) => ({ ...p, tiers: p.tiers.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  const addTier = () => setPol((p) => {
    const last = p.tiers[p.tiers.length - 1];
    return { ...p, tiers: [...p.tiers, { months: last ? Math.min(120, last.months + 6) : 3, pct: last ? Math.min(HARD_MAX, last.pct + 5) : 5 }] };
  });
  const dropTier = (i) => setPol((p) => ({ ...p, tiers: p.tiers.filter((_, j) => j !== i) }));

  // What the policy will actually charge, step by step, with the cap applied: the sentence an
  // admin checks before saving, in the same terms the public page prints.
  const sorted = [...pol.tiers].map((x) => ({ months: clamp(x.months, 1, 120), pct: clamp(x.pct, 0, HARD_MAX) })).sort((a, b) => a.months - b.months);
  const max = clamp(pol.maxPct, 0, HARD_MAX);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/admin/hosting/loyalty', { enabled: !!pol.enabled, tiers: sorted, maxPct: max });
      setPol(r.loyalty); setSaved(JSON.stringify(r.loyalty));
      toast.success(t('adm.loyal.saved', 'Loyalty pricing saved. It applies from each subscription\'s next renewal.'));
    } catch { toast.error(t('common.failed', 'Failed.')); }
    finally { setBusy(false); }
  };

  return (
    <Card className="p-5 sm:p-6 mt-6">
      <div className="flex items-start gap-2.5">
        <TrendingDown size={18} className="text-[var(--accent-ink)] shrink-0 mt-[2px]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[15px]">{t('adm.loyal.t', 'Loyalty pricing')}</h3>
          <p className="text-[13px] text-[var(--muted)] mt-1 leading-relaxed max-w-3xl">
            {t('adm.loyal.s', 'The longer a hosting subscription runs without a break, the less its renewals cost. The discount comes on top of the term price and is applied at renewal, never to a term already paid.')}
          </p>
          <Explain className="text-[12.5px] mt-1.5 max-w-3xl" label={t('adm.loyal.how', 'What "without a break" means')}>
            {t('adm.loyal.rule', 'The count starts on the day the subscription is first paid. It starts again from zero when the subscription is cancelled (by its owner, or by Stripe after failed payment retries), or when a renewal arrives later than the grace period after the paid-up date: the Hosting settings grace windows, 72 hours by default for a term renewed by hand and a week after a failed card payment. Automatic renewals get the discount as a Stripe coupon placed on the subscription before it renews (checked every hour); renewals paid by hand get it priced in. Bot-only plans are not included.')}
          </Explain>
        </div>
      </div>

      <label className="mt-5 flex items-center gap-2 text-sm font-medium cursor-pointer w-fit">
        <input type="checkbox" checked={!!pol.enabled} onChange={(e) => setPol((p) => ({ ...p, enabled: e.target.checked }))} />
        {t('adm.loyal.on', 'Offer loyalty discounts')}
      </label>

      <div className="mt-4 grid gap-2 max-w-xl">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)]">
          <span>{t('adm.loyal.months', 'After (months)')}</span>
          <span>{t('adm.loyal.pct', 'Discount (%)')}</span>
          <span className="w-9" aria-hidden />
        </div>
        {pol.tiers.map((x, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
            <Input type="number" min={1} max={120} value={x.months} aria-label={t('adm.loyal.months', 'After (months)')}
              onChange={(e) => setTier(i, 'months', e.target.value)} />
            <Input type="number" min={0} max={HARD_MAX} value={x.pct} aria-label={t('adm.loyal.pct', 'Discount (%)')}
              onChange={(e) => setTier(i, 'pct', e.target.value)} />
            <Button size="sm" variant="ghost" className="!w-9 !px-0" onClick={() => dropTier(i)} aria-label={t('adm.loyal.drop', 'Remove this step')} title={t('adm.loyal.drop', 'Remove this step')}>
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        {pol.tiers.length < 12 && (
          <Button size="sm" className="w-fit" onClick={addTier}><Plus size={14} /> {t('adm.loyal.add', 'Add a step')}</Button>
        )}
      </div>

      <label className="mt-5 text-sm flex flex-col gap-1 max-w-xs">
        <span className="font-medium">{t('adm.loyal.max', 'Maximum discount (%)')}</span>
        <Input type="number" min={0} max={HARD_MAX} value={pol.maxPct} onChange={(e) => setPol((p) => ({ ...p, maxPct: e.target.value }))} />
        <span className="text-[12px] text-[var(--muted)]">{t('adm.loyal.max.h', 'A hard ceiling: a step above it is sold at this figure. The server never goes past {n}%, whatever is set.').replace('{n}', HARD_MAX)}</span>
      </label>

      <div className="mt-5 text-[13px] rounded-lg border border-[var(--line)] p-3 max-w-xl">
        <div className="font-medium mb-1.5">{t('adm.loyal.preview', 'What renewals will get')}</div>
        {!pol.enabled ? (
          <div className="text-[var(--muted)]">{t('adm.loyal.off', 'Off: every renewal is billed at the normal term price, and the public page shows no loyalty steps.')}</div>
        ) : !sorted.some((x) => x.pct > 0) ? (
          <div className="text-[var(--muted)]">{t('adm.loyal.none', 'No step gives a discount yet.')}</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {sorted.map((x) => (
              <li key={x.months} className="flex justify-between gap-3 tabular-nums">
                <span className="text-[var(--muted)]">{t('adm.loyal.row', 'After {n} months without a break').replace('{n}', x.months)}</span>
                <span className="font-semibold">{`−${Math.min(x.pct, max)}%`}{x.pct > max ? ` ${t('adm.loyal.capped', '(capped)')}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The Payments policy treats a lower or removed step as a price increase: said here,
          where the change is made, because nothing on the server holds the change back. */}
      <p className="mt-4 text-[12px] text-[var(--muted)] max-w-xl leading-relaxed">
        {t('adm.loyal.warn', 'Lowering a step, or turning the discount off, is a price increase for the people who would have got it: the Payments policy promises them the same notice as any price change, so announce it before saving.')}
      </p>

      <div className="mt-5 flex items-center gap-3">
        <Button variant="primary" disabled={busy || !dirty} onClick={save}>{busy ? <Spinner /> : <Save size={15} />} {t('common.save', 'Save')}</Button>
        {dirty && <span className="text-[12px] text-[var(--muted)]">{t('adm.loyal.dirty', 'Unsaved changes')}</span>}
      </div>
    </Card>
  );
}
