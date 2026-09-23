// One offer in a row of offers, laid out to be COMPARED: the name, the price, what the price
// covers, what is included, and one action pinned to the bottom.
//
// Extracted from /hosting when the page was reorganised (it was inline there, and the next
// pricing grid would have been a copy of it). Purely presentational: the caller works out the
// numbers, the strings and the action; this decides only how an offer reads.
//
// The rules it keeps, each one a complaint that was fixed once:
//   · every card has the same rows at the same heights (a pill slot even when there is no pill,
//     the action pinned with `mt-auto`), so four cards read across as a table;
//   · the recommended card stands forward (ring + lift), and never when it cannot be bought;
//   · nothing is truncated except the plan name, which carries its full text in `title`.
import { Check } from 'lucide-react';

/**
 * @param {object}  p
 * @param {string}  p.name
 * @param {string} [p.pill]         e.g. "RECOMMENDED"; the slot is kept (invisible) without one
 * @param {boolean}[p.featured]     stands forward
 * @param {boolean}[p.disabled]     greyed; `featured` is ignored
 * @param {{ now: string, per?: string, was?: string, save?: string }} p.price
 * @param {string} [p.priceNote]    the line under the price (what is actually charged)
 * @param {Array<{ icon?: any, label: string, yes: boolean, note?: string }>} p.features
 * @param {import('react').ReactNode} p.action
 */
export default function PlanCard({ name, pill, featured = false, disabled = false, price, priceNote, features = [], action }) {
  const forward = featured && !disabled;
  return (
    <div className={`card plan-hover relative flex flex-col p-5 sm:p-6 min-w-0 ${disabled ? 'plan-dead opacity-60' : ''} ${forward ? 'plan-reco z-10 lg:scale-[1.03]' : ''}`}>
      <div className="mb-3 min-h-[20px]">
        <span className={`inline-block text-[10px] font-bold uppercase tracking-[0.1em] rounded-full px-2 py-1 leading-none ${forward && pill ? 'bg-[var(--primary)] text-[var(--on-primary)]' : 'invisible'}`} aria-hidden={!(forward && pill)}>
          {pill || ' '}
        </span>
      </div>
      <div className="text-[15px] font-semibold truncate" title={name}>{name}</div>
      <div className="plan-price mt-2.5 flex items-end gap-1.5 flex-wrap">
        {price.was && <span className="text-[13px] text-[var(--muted)] line-through mb-0.5 tabular-nums">{price.was}</span>}
        <span className="text-[2.25rem] font-extrabold leading-none tabular-nums tracking-tight">{price.now}</span>
        {price.per && <span className="text-[13px] text-[var(--muted)] mb-0.5">{price.per}</span>}
        {price.save && <span className="text-[10px] font-bold text-success bg-success-bg border border-success-border rounded-full px-1.5 py-0.5 mb-0.5">{price.save}</span>}
      </div>
      {priceNote && <div className="text-[12px] text-[var(--muted)] mt-2 tabular-nums leading-snug">{priceNote}</div>}
      <ul className="mt-5 pt-5 border-t border-[var(--line)] flex flex-col gap-3">
        {features.map(({ icon: Icon, label, yes, note }) => (
          <li key={label} className={`flex items-start gap-2.5 text-[13.5px] leading-snug min-w-0 ${yes ? '' : 'text-[var(--faint)]'}`}>
            {yes ? <Check size={16} className="text-success shrink-0 mt-[1px]" aria-hidden />
              : Icon ? <Icon size={16} className="shrink-0 mt-[1px]" aria-hidden /> : <span className="w-4 shrink-0" aria-hidden />}
            <span className="min-w-0">
              {label}
              {yes && note && <span className="block text-[11.5px] text-[var(--muted)] mt-0.5">{note}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-6">{action}</div>
    </div>
  );
}
