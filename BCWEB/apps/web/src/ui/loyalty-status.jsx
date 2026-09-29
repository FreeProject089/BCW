// hosting2 (agent-hosting): where each of MY subscriptions stands on the loyalty steps, in the
// dashboard's Billing tab. "Step 2 of 3, −10 % on renewals; the next step (−15 %) in 2 months,
// on 10 January 2027."
//
// Everything comes from GET /me/hosting/loyalty, which computes it with the same functions the
// renewal is charged with (apps/api/src/lib/loyalty.mjs loyaltyStatus): nothing is derived here,
// so this line cannot promise what the invoice will not do. Hidden when the site does not run
// loyalty pricing or when nothing of mine is covered by it.
import { useEffect, useState } from 'react';
import { TrendingDown, Server, Boxes, FileBox } from 'lucide-react';
import { Card } from './ui.jsx';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

const ICON = { pool: Boxes, repo: Server, catalog: FileBox };

export default function LoyaltyStatus() {
  const { t, lang } = useI18n();
  const [data, setData] = useState(null);
  useEffect(() => { api.get('/me/hosting/loyalty').then(setData).catch(() => setData(null)); }, []);
  const items = (data?.items || []).filter((x) => x.covered);
  if (!data?.policy?.enabled || !items.length) return null;
  const day = (iso) => new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const months = (n) => (n === 1 ? t('hosting.term2.one', '1 month') : t('hosting.term2.n', '{n} months').replace('{n}', n));
  const kind = (k) => (k === 'pool' ? t('bill.loyal.pool', 'Pool') : k === 'repo' ? t('bill.loyal.repo', 'Repo') : t('bill.loyal.catalog', 'Catalogue file'));
  return (
    <div className="mb-8">
      <h2 className="font-semibold flex items-center gap-2 mb-1"><TrendingDown size={16} className="text-[var(--accent-ink)]" /> {t('bill.loyal.t', 'Loyalty discount')}</h2>
      <p className="text-[12px] text-[var(--muted)] mb-3 max-w-2xl">
        {data.policy.lapseResets
          ? t('bill.loyal.s', 'Renewals get cheaper the longer each subscription runs without a break. The discount is applied at renewal, never to a term already paid.')
          : t('bill.loyal.s2', 'Renewals get cheaper the more months each subscription has been paid for; a gap only pauses the count. The discount is applied at renewal, never to a term already paid.')}
      </p>
      <Card className="overflow-hidden p-0">
        {items.map((x) => {
          const Icon = ICON[x.kind] || Server;
          const step = x.tierIndex > 0
            ? t('bill.loyal.step', 'Step {i} of {n}: −{pct}% on renewals').replace('{i}', x.tierIndex).replace('{n}', x.tierCount).replace('{pct}', x.pct)
            : t('bill.loyal.step0', 'No step reached yet');
          const next = x.nextTier
            ? t('bill.loyal.next', 'Next step (−{pct}%) in {m}, on {d}.').replace('{pct}', x.nextTier.pct).replace('{m}', months(x.nextTier.inMonths)).replace('{d}', day(x.nextTier.at))
            : x.tierIndex > 0 ? t('bill.loyal.top', 'You are on the top step.') : '';
          const renewal = x.active && x.nextRenewalAt
            ? (x.nextRenewalPct > 0
              ? t('bill.loyal.renew', 'Next renewal, {d}: −{pct}%.').replace('{d}', day(x.nextRenewalAt)).replace('{pct}', x.nextRenewalPct)
              : t('bill.loyal.renew0', 'Next renewal, {d}: no discount yet.').replace('{d}', day(x.nextRenewalAt)))
            : '';
          return (
            <div key={`${x.kind}:${x.id}`} className="flex items-start gap-3 px-4 py-3 text-sm border-t border-[var(--line)] first:border-t-0">
              <Icon size={15} className="text-[var(--accent-ink)] shrink-0 mt-[3px]" aria-hidden />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate" title={x.name}>{kind(x.kind)} · {x.name || '—'}</div>
                <div className="text-[12.5px] mt-0.5"><span className={x.pct > 0 ? 'text-success font-semibold' : 'text-[var(--muted)]'}>{step}</span></div>
                <div className="text-[12px] text-[var(--muted)] mt-0.5">
                  {t('bill.loyal.tenure', 'Counted: {m}.').replace('{m}', months(x.tenureMonths))} {next} {renewal}
                </div>
                {x.broken && <div className="text-[12px] text-warning mt-0.5">{t('bill.loyal.broken', 'The count stopped after a lapse; it starts again from your next renewal.')}</div>}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
