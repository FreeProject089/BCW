// N-hosting (agent-hosting-N): the loyalty (tenure) pricing editor, shown in Admin → Hosting →
// Plans under the plan list. One site-wide policy: steps like "after 3 months without a break,
// 5 % off each renewal", and a hard maximum the discount never goes past.
//
// The server owns the rule (apps/api/src/lib/loyalty.mjs: what "without a break" means, when the
// discount is applied, how it reaches Stripe). This screen only edits the numbers, and says in
// one place what they will do, so an admin never has to read the code to know what they sold.
//
// hosting2 (agent-hosting): two more choices (which subscriptions earn it, and whether a lapse
// resets the count or only pauses it), and the prepaid duration's own card (TermEditor, below).
import { useEffect, useState } from 'react';
import { Plus, Trash2, TrendingDown, Save, CalendarClock } from 'lucide-react';
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
      const r = await api.put('/admin/hosting/loyalty', { enabled: !!pol.enabled, tiers: sorted, maxPct: max, appliesTo: pol.appliesTo || 'repos', lapseResets: pol.lapseResets !== false });
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
            {t('adm.loyal.rule2', 'The count is in calendar months from the day the subscription is first paid (a prepaid term of N months ends the same day N months later, so a subscription paid without a gap has exactly as many months as it paid for). What a gap does is the choice below. Automatic renewals get the discount as a Stripe coupon placed on the subscription before it renews (checked every hour, and right after each renewal), for future invoices only; renewals paid by hand get it priced in, at the step reached on the day the new term starts. Bot-only plans are not included.')}
          </Explain>
        </div>
      </div>

      <label className="mt-5 flex items-center gap-2 text-sm font-medium cursor-pointer w-fit">
        <input type="checkbox" checked={!!pol.enabled} onChange={(e) => setPol((p) => ({ ...p, enabled: e.target.checked }))} />
        {t('adm.loyal.on', 'Offer loyalty discounts')}
      </label>

      {/* hosting2 (agent-hosting): which subscriptions earn it. */}
      <fieldset className="mt-4 max-w-xl">
        <legend className="text-sm font-medium mb-1.5">{t('adm.loyal2.scope', 'Who gets it')}</legend>
        <div className="grid gap-1.5 text-[13px]">
          {[
            ['repos', t('adm.loyal2.repos', 'Storage hosting: the pools and repos sold on the Hosting page')],
            ['catalogs', t('adm.loyal2.catalogs', 'Catalogue file hosting: the monthly subscription of a paid catalogue upload')],
            ['both', t('adm.loyal2.both', 'Both')],
          ].map(([v, label]) => (
            <label key={v} className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="loyal-scope" className="mt-[3px]" checked={(pol.appliesTo || 'repos') === v} onChange={() => setPol((p) => ({ ...p, appliesTo: v }))} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* hosting2 (agent-hosting): what a gap does to the count. */}
      <fieldset className="mt-4 max-w-xl">
        <legend className="text-sm font-medium mb-1.5">{t('adm.loyal2.lapse', 'When a renewal comes late, or after a cancellation')}</legend>
        <div className="grid gap-1.5 text-[13px]">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="loyal-lapse" className="mt-[3px]" checked={pol.lapseResets !== false} onChange={() => setPol((p) => ({ ...p, lapseResets: true }))} />
            <span>{t('adm.loyal2.reset', 'The count starts again from zero (continuous): after a cancellation, or a renewal later than the grace period (Hosting settings, 72 hours by default for a term renewed by hand, a week after a failed card).')}</span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="loyal-lapse" className="mt-[3px]" checked={pol.lapseResets === false} onChange={() => setPol((p) => ({ ...p, lapseResets: false }))} />
            <span>{t('adm.loyal2.pause', 'The count only pauses (cumulative): the unpaid months are not counted, and it resumes where it stopped at the next renewal.')}</span>
          </label>
        </div>
      </fieldset>

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
                <span className="text-[var(--muted)]">{pol.lapseResets === false ? t('adm.loyal2.rowpaid', 'After {n} months paid for').replace('{n}', x.months) : t('adm.loyal.row', 'After {n} months without a break').replace('{n}', x.months)}</span>
                <span className="font-semibold">{`−${Math.min(x.pct, max)}%`}{x.pct > max ? ` ${t('adm.loyal.capped', '(capped)')}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The Payments policy treats a lower or removed step as a price increase: said here,
          where the change is made, because nothing on the server holds the change back. */}
      <p className="mt-4 text-[12px] text-[var(--muted)] max-w-xl leading-relaxed">
        {t('adm.loyal2.warn', 'Lowering a step, narrowing who gets it, switching to the continuous rule or turning it off is a price increase for those who would have got it: the Payments & Refunds policy promises them the same notice as any price change. Announce it first.')}
      </p>

      <div className="mt-5 flex items-center gap-3">
        <Button variant="primary" disabled={busy || !dirty} onClick={save}>{busy ? <Spinner /> : <Save size={15} />} {t('common.save', 'Save')}</Button>
        {dirty && <span className="text-[12px] text-[var(--muted)]">{t('adm.loyal.dirty', 'Unsaved changes')}</span>}
      </div>
    </Card>
  );
}

// hosting2 (agent-hosting)
/**
 * The prepaid duration: the three numbers that bound the field members type on /hosting and in
 * Billing (minimum, maximum, step), saved together through PUT /admin/hosting/term, which the
 * checkout reads live. Its own card beside the plans, because it is a price decision like they
 * are; the Hosting settings screen no longer lists the same three numbers a second time.
 *
 * The ceiling is 12 and stays 12 (the owner's decision, Sept 26): the Terms promise nothing
 * beyond the term paid and say no term longer than a year is sold. The card says which two
 * texts would have to change before that number could, and the server refuses more anyway.
 */
export function TermEditor() {
  const { t } = useI18n(); const toast = useToast();
  const [v, setV] = useState(null);
  const [saved, setSaved] = useState(null);
  const [limit, setLimit] = useState(12);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  useEffect(() => {
    api.get('/admin/hosting/term')
      .then((r) => { const x = { min: r.term.min, max: r.term.max, step: r.term.step }; setV(x); setSaved(JSON.stringify(x)); setLimit(r.limit || 12); })
      .catch(() => setErr(true));
  }, []);
  if (err) return <Card className="p-5 mt-6 text-sm text-[var(--muted)]">{t('adm.term.err', 'Could not load the prepaid duration settings.')}</Card>;
  if (!v) return <div className="py-6 grid place-items-center"><Spinner /></div>;
  const num = (x) => (x === '' ? '' : Math.round(Number(x)));
  const valid = [v.min, v.max, v.step].every((x) => Number.isInteger(x) && x >= 1 && x <= limit) && v.min <= v.max;
  const dirty = JSON.stringify(v) !== saved;
  const grid = [];
  if (valid) for (let m = v.min; m <= v.max && grid.length < 13; m += v.step) grid.push(m);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/admin/hosting/term', v);
      const x = { min: r.term.min, max: r.term.max, step: r.term.step };
      setV(x); setSaved(JSON.stringify(x));
      toast.success(t('adm.term.saved', 'Saved. The Hosting page and every checkout use these bounds now.'));
    } catch (e) {
      toast.error(e?.data?.error === 'term_above_legal_cap'
        ? t('adm.term.cap', 'Refused: nothing longer than {n} months can be sold while the Terms say so.').replace('{n}', limit)
        : e?.data?.error === 'term_min_above_max' ? t('adm.term.minmax', 'The minimum is above the maximum.') : t('common.failed', 'Failed.'));
    } finally { setBusy(false); }
  };
  const field = (k, label) => (
    <label className="text-sm flex flex-col gap-1 min-w-0">
      <span className="font-medium">{label}</span>
      <Input type="number" min={1} max={limit} step={1} value={v[k]} className="!w-40" onChange={(e) => setV((p) => ({ ...p, [k]: num(e.target.value) }))} />
    </label>
  );
  return (
    <Card className="p-5 sm:p-6 mt-6">
      <div className="flex items-start gap-2.5">
        <CalendarClock size={18} className="text-[var(--accent-ink)] shrink-0 mt-[2px]" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-[15px]">{t('adm.term.t', 'Prepaid duration')}</h3>
          <p className="text-[13px] text-[var(--muted)] mt-1 leading-relaxed max-w-3xl">
            {t('adm.term.s', 'Members type how many months they pay for, on the Hosting page and when they renew. These three numbers bound that field. The server refuses any other length, whatever a page sends, and prices the one it accepts itself.')}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-4">
        {field('min', t('adm.term.min', 'Shortest (months)'))}
        {field('max', t('adm.term.max', 'Longest (months)'))}
        {field('step', t('adm.term.step', 'Step (months)'))}
      </div>
      <ul className="mt-3 text-[12.5px] text-[var(--muted)] max-w-3xl leading-relaxed list-disc ps-5 space-y-1">
        <li>{t('adm.term.h.min', 'Shortest: the smallest number a member can type. 1 lets people pay month by month.')}</li>
        <li>{t('adm.term.h.step', 'Step: which lengths in between are sold, counted from the shortest. 1 sells every length; shortest 3 with step 3 sells 3, 6, 9 and 12.')}</li>
        <li>{t('adm.term.h.disc', 'The term discount does not depend on these: 6 months or more is −10 %, 12 months is −20 %. The page offers those two as shortcuts when they are sold.')}</li>
      </ul>
      <div className="mt-4 text-[13px] rounded-lg border border-[var(--line)] p-3 max-w-xl">
        <div className="font-medium mb-1">{t('adm.term.preview', 'What members will be able to buy')}</div>
        {valid
          ? <div className="text-[var(--muted)] tabular-nums">{grid.join(', ')} {t('hosting.term2.unit', 'months')}</div>
          : <div className="text-error">{t('adm.term.invalid', 'Whole months from 1 to {n}, the shortest not above the longest.').replace('{n}', limit)}</div>}
      </div>
      {/* The legal ceiling, where the number is set. */}
      <div className="mt-4 text-[12.5px] rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 max-w-3xl leading-relaxed">
        <div className="font-medium text-[13px] mb-1">{t('adm.term.cap.t', 'Why the longest is at most {n} months').replace('{n}', limit)}</div>
        {t('adm.term.cap.s', 'Paying ahead is a promise to run the service until the last day paid for. The Terms of Service ("Prepaid terms: what we commit to") and the Payments & Refunds policy ("Prepaid terms") say that nothing longer than 12 months is sold and that no availability is promised beyond the term paid. To sell longer terms, those two articles must be rewritten first (and announced, since they are terms people accepted), then TERM_LIMIT_MONTHS raised in the API. Until then the server refuses anything above {n}.').replace('{n}', limit)}
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Button variant="primary" disabled={busy || !dirty || !valid} onClick={save}>{busy ? <Spinner /> : <Save size={15} />} {t('common.save', 'Save')}</Button>
        {dirty && <span className="text-[12px] text-[var(--muted)]">{t('adm.loyal.dirty', 'Unsaved changes')}</span>}
      </div>
    </Card>
  );
}
// fin hosting2 (agent-hosting)
