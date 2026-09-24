// The prepaid hosting term, on the client.
//
// The server owns the rule (routes/hosting.mjs: termBounds / termCheck / termDiscount) and
// SENDS it — `GET /hosting/plans` returns `term: { min, max, step, presets, tiers }`. Nothing
// here decides what a valid term is or what a discount is worth; these helpers only read what
// the server sent, so the page and the checkout can never disagree about a number. The one
// table that used to live in this file (1/3/6/12/24 → 0/5/10/20/35 %) was the second copy of
// the server's, and a second copy is a rule that drifts.

// N-hosting (agent-hosting-N): the server's defaults since the offer became monthly / 6 / 12
// months (nothing longer is prepaid; see TERM_LIMIT_MONTHS in routes/hosting.mjs).
export const TERM_FALLBACK = Object.freeze({ min: 1, max: 12, step: 1, presets: [1, 6, 12], tiers: [{ from: 12, off: 0.20 }, { from: 6, off: 0.10 }] });

/** The bounds as the server sent them, or the fallback when the request has not answered yet
 *  (the page must still render a control). Always integers, always min ≤ max, step ≥ 1. */
export function normaliseTerm(term) {
  const int = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : d; };
  const min = int(term?.min, TERM_FALLBACK.min);
  const max = Math.max(min, int(term?.max, TERM_FALLBACK.max));
  const step = int(term?.step, TERM_FALLBACK.step);
  const tiers = Array.isArray(term?.tiers) && term.tiers.length
    ? term.tiers.map((x) => ({ from: Number(x.from), off: Number(x.off) })).filter((x) => Number.isFinite(x.from) && Number.isFinite(x.off)).sort((a, b) => b.from - a.from)
    : TERM_FALLBACK.tiers;
  const presets = (Array.isArray(term?.presets) ? term.presets : TERM_FALLBACK.presets).map(Number).filter((m) => Number.isInteger(m) && m >= min && m <= max && (m - min) % step === 0);
  return { min, max, step, tiers, presets: presets.length ? presets : [min] };
}

/** The discount fraction for `months` under these tiers: the highest tier whose `from` the
 *  term reaches (7 months earns the 6-month rate). 0 when none does. */
export function discountFor(tiers, months) {
  const m = Number(months) || 0;
  for (const { from, off } of [...(tiers || [])].sort((a, b) => b.from - a.from)) if (m >= from) return off;
  return 0;
}

/** The nearest term the site actually sells: integer, clamped to [min, max], on the step
 *  grid counted from min. A slider never needs this (its own min/max/step do it); a typed
 *  number does — 0, 500, "7" on a step of 3. */
export function snapTerm(bounds, months) {
  const { min, max, step } = bounds;
  const n = Number(months);
  if (!Number.isFinite(n)) return min;
  const clamped = Math.min(max, Math.max(min, Math.round(n)));
  const onGrid = min + Math.round((clamped - min) / step) * step;
  return onGrid > max ? onGrid - step : onGrid;
}

/** Whole-term total in cents: months × monthly, less the tier discount, then a promo — the
 *  same order the server prices in (termTotalCents in routes/hosting.mjs), so the number on
 *  the card is the number on the invoice. */
export function termTotalCents(monthlyCents, months, tiers, promoPct = 0) {
  let total = Math.round((Number(monthlyCents) || 0) * months * (1 - discountFor(tiers, months)));
  if (promoPct) total = Math.round(total * (1 - promoPct / 100));
  return total;
}

/** The next tier above `months`, if the bounds allow reaching it — so the control can say
 *  "3 more months and it is −20 %". null when the term already has the top rate or the
 *  next tier is out of range. */
export function nextTier(bounds, months) {
  const m = Number(months) || 0;
  const above = [...bounds.tiers].filter((x) => x.from > m).sort((a, b) => a.from - b.from)[0];
  if (!above) return null;
  const at = snapTerm(bounds, above.from);
  return at >= above.from && at <= bounds.max ? { months: at, off: above.off } : null;
}
