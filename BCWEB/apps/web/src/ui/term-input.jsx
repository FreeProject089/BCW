// hosting2 (agent-hosting): the prepaid duration, as a number the member types.
//
// The owner's call, after the N pass had turned it into three fixed choices: "a field where the
// user enters the duration, with a minimum and a maximum" is simpler than a list. So this is
// the field — a number with its − / + buttons (ui.jsx NumberInput), and a slider under it for
// the sweep — bounded by what the server sells (`term.min/max/step`, set by an admin).
//
// While somebody types, the field shows what they typed, even when it is not a term the site
// sells (a half-typed "1" on the way to "12" must not jump to anything). The price follows
// only valid numbers; an invalid one is named under the field, in the server's own words
// (termError mirrors termCheck), and snapped to the nearest valid term when the field is left.
// The server refuses anything else anyway: this only keeps the page from promising it.
import { useEffect, useId, useState } from 'react';
import { Input } from './ui.jsx';
import { useI18n } from '../i18n.jsx';
import { termError, snapTerm } from '../lib/hosting-term.js';

/** "1 month" / "7 months". */
export function monthsLabel(t, m) {
  return m === 1 ? t('hosting.term2.one', '1 month') : t('hosting.term2.n', '{n} months').replace('{n}', m);
}

/** The valid terms of a stepped range, for the hint ("3, 6, 9 or 12 months"). */
function gridOf(term) {
  const out = [];
  for (let m = term.min; m <= term.max && out.length < 13; m += term.step) out.push(m);
  return out;
}

/** The one sentence under the field: the range, and the grid when there is a step. */
export function termHint(t, term) {
  if (term.min === term.max) return t('hosting.term2.only', 'Sold for exactly {n}.').replace('{n}', monthsLabel(t, term.min));
  if (term.step > 1) return t('hosting.term2.grid', 'Choose {list} months.').replace('{list}', gridOf(term).join(', '));
  return t('hosting.term2.range', 'Any whole number of months from {min} to {max}.').replace('{min}', term.min).replace('{max}', term.max);
}

export default function TermInput({ months, onChange, term, slider = true, className = '', label }) {
  const { t } = useI18n();
  const id = useId();
  const [raw, setRaw] = useState(String(months));
  useEffect(() => { setRaw(String(months)); }, [months]);
  const err = raw.trim() === '' ? { reason: 'empty' } : termError(term, Number(raw));
  const commit = (v) => { const n = snapTerm(term, v); setRaw(String(n)); if (n !== months) onChange(n); };
  const fixed = term.min === term.max;
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className="text-sm text-[var(--muted)] block mb-1.5">{label || t('hosting.term2.label', 'Duration, in months')}</label>
      <div className="flex items-center gap-2">
        {/* w-40: wide enough that NumberInput keeps its − and + beside the value, each a full
            touch target (under 9rem they stack into one column of half-height buttons). */}
        <Input id={id} type="number" inputMode="numeric" min={term.min} max={term.max} step={term.step} value={raw}
          disabled={fixed} className="!w-40 tabular-nums" aria-invalid={err && err.reason !== 'empty' ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(e) => { const v = e.target.value; setRaw(v); if (v.trim() !== '' && !termError(term, Number(v))) onChange(Number(v)); }}
          onBlur={() => commit(raw)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(raw); }} />
        <span className="text-sm text-[var(--muted)] whitespace-nowrap">{t('hosting.term2.unit', 'months')}</span>
      </div>
      {slider && !fixed && (
        <div className="mt-3">
          <input type="range" min={term.min} max={term.max} step={term.step} value={err ? snapTerm(term, raw) : Number(raw)} className="bcw-range w-full"
            aria-label={label || t('hosting.term2.label', 'Duration, in months')} aria-valuetext={monthsLabel(t, err ? snapTerm(term, raw) : Number(raw))}
            onChange={(e) => commit(e.target.value)} />
          <div className="flex justify-between text-[11px] text-[var(--faint)] mt-1 tabular-nums" aria-hidden>
            <span>{monthsLabel(t, term.min)}</span><span>{monthsLabel(t, term.max)}</span>
          </div>
        </div>
      )}
      <p id={`${id}-hint`} className={`text-[12px] mt-1.5 ${err && err.reason !== 'empty' ? 'text-error' : 'text-[var(--muted)]'}`} role={err && err.reason !== 'empty' ? 'alert' : undefined}>
        {err && err.reason !== 'empty'
          ? t('hosting.term2.bad', '{typed} is not a length we sell. {hint}').replace('{typed}', raw).replace('{hint}', termHint(t, term))
          : termHint(t, term)}
      </p>
    </div>
  );
}
