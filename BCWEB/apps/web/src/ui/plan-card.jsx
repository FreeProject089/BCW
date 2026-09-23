// One offer in a row of offers, laid out to be COMPARED: the name, the price, what the price
// covers, the two actions, then what is included.
//
// Extracted from /hosting when the page was reorganised (it was inline there, and the next
// pricing grid would have been a copy of it). Purely presentational: the caller works out the
// numbers, the strings and the actions; this decides only how an offer reads. /hosting uses it
// twice now, for the storage plans and for the Discord bot plans.
//
// The shape follows the pricing pages people already know how to read (the owner pointed at
// Odoo's): a coloured band on top that tells the cards apart before a word is read, the price
// as the biggest thing on the card with its cents set small, the primary action straight under
// the price with a quieter second one beside it, and the feature list last, as the detail.
//
// The rules it keeps, each one a complaint that was fixed once:
//   · every card has the same rows at the same heights (the label slot, the "was" line and the
//     price note all keep their height when empty), so four cards read across as a table and
//     their buttons line up;
//   · the recommended card stands forward (a lift and a wash), and never when it cannot be
//     bought;
//   · no pill badges: the saving and the "recommended" label are coloured TEXT. The pills were
//     reported as noise, five of them on one screen all shouting the same green;
//   · nothing is truncated except the plan name, which carries its full text in `title`.
import { Check } from 'lucide-react';
import './plan-card.css';

/** "$12.50" → ['$', '12', '.50', ''] so the cents can be set small. Anything that does not
 *  look like a price is returned whole, so a caller passing "Free" still reads "Free". */
function splitPrice(s) {
  const m = /^([^\d]*)(\d[\d\s]*)(?:([.,])(\d+))?(.*)$/.exec(String(s ?? ''));
  if (!m) return [String(s ?? ''), '', '', ''];
  return [m[1], m[2], m[3] ? `${m[3]}${m[4]}` : '', m[5]];
}

/**
 * @param {object}  p
 * @param {string}  p.name
 * @param {string} [p.tagline]      one line under the name ("For a first repo")
 * @param {string} [p.pill]         e.g. "Recommended"; shown as coloured text, slot kept without
 * @param {boolean}[p.featured]     stands forward
 * @param {boolean}[p.disabled]     greyed; `featured` is ignored
 * @param {string} [p.accent]       the band colour, any CSS colour (a var() is the usual)
 * @param {{ now: string, per?: string, was?: string, save?: string }} p.price
 * @param {string} [p.priceNote]    the line under the price (what is actually charged)
 * @param {Array<{ icon?: any, label: string, yes: boolean, note?: string }>} p.features
 * @param {import('react').ReactNode} p.action      the primary action (a full-width button)
 * @param {import('react').ReactNode} [p.secondary] the quieter one under it (a link)
 */
export default function PlanCard({ name, tagline, pill, featured = false, disabled = false, accent, price, priceNote, features = [], action, secondary }) {
  const forward = featured && !disabled;
  const [cur, whole, cents, tail] = splitPrice(price.now);
  const band = accent || (forward ? 'var(--primary)' : 'var(--line-strong)');
  return (
    <div className={`card plan-hover plan-card relative flex flex-col min-w-0 overflow-hidden ${disabled ? 'plan-dead opacity-60' : ''} ${forward ? 'plan-reco z-10 lg:scale-[1.03]' : ''}`}
      style={{ '--plan-accent': band }}>
      <div aria-hidden className="plan-band" />
      <div className="p-5 sm:p-6 flex flex-col flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3 min-w-0">
          <div className="text-[17px] font-bold tracking-tight truncate min-w-0" title={name}>{name}</div>
          <span className={`plan-flag shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] ${forward && pill ? '' : 'invisible'}`} aria-hidden={!(forward && pill)}>
            {pill || ' '}
          </span>
        </div>
        {/* The slot exists only when the grid uses taglines at all (a caller passes '' for a
            plan without one), so the rows still line up across the cards of one grid. */}
        {tagline !== undefined && <div className="text-[12.5px] text-[var(--muted)] mt-1 min-h-[2.5rem] leading-snug">{tagline}</div>}

        {/* The old price, struck, and the saving in words: one line, kept even when empty so
            a card without a discount does not sit higher than its neighbours. */}
        <div className="mt-4 min-h-[18px] flex items-center gap-2 text-[12.5px] tabular-nums">
          {price.was && <span className="text-[var(--muted)] line-through">{price.was}</span>}
          {price.save && <span className="text-success font-semibold">{price.save}</span>}
        </div>
        <div className="plan-price mt-1 flex items-start gap-0.5 flex-wrap leading-none">
          {cur && <span className="text-[1.15rem] font-bold mt-1.5">{cur}</span>}
          <span className="text-[2.9rem] font-extrabold tracking-tight tabular-nums">{whole}</span>
          {cents && <span className="text-[1.15rem] font-bold mt-1.5 tabular-nums">{cents}</span>}
          {tail && <span className="text-[1.15rem] font-bold mt-1.5">{tail}</span>}
          {price.per && <span className="self-end text-[13px] text-[var(--muted)] font-medium ms-1 mb-1.5">{price.per}</span>}
        </div>
        <div className="text-[12px] text-[var(--muted)] mt-2 tabular-nums leading-snug min-h-[2rem]">{priceNote || ''}</div>

        <div className="mt-4 flex flex-col gap-2">
          {action}
          {secondary && <div className="text-center text-[13px]">{secondary}</div>}
        </div>

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
      </div>
    </div>
  );
}
