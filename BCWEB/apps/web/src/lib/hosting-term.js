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

/** Whole-term total in cents: months × monthly, less the tier discount, times the scarcity
 *  multiplier (`priceMult`, sent by GET /hosting/plans), then a promo — the same order the
 *  server prices in (termTotalCents in routes/hosting.mjs), so the number on the card is the
 *  number on the invoice. hosting2: the multiplier was missing, so a nearly full disk made the
 *  page cheaper than the checkout. */
export function termTotalCents(monthlyCents, months, tiers, promoPct = 0, priceMult = 1) {
  const mult = Number(priceMult) > 0 ? Number(priceMult) : 1;
  let total = Math.round((Number(monthlyCents) || 0) * months * (1 - discountFor(tiers, months)) * mult);
  if (promoPct) total = Math.round(total * (1 - promoPct / 100));
  return total;
}

// ── hosting2 (agent-hosting) ───────────────────────────────────────────────────────────────
// The duration is a number the member types again (the owner's call). These are the page's
// copies of three server rules, each pinned to its original by
// apps/api/test/hosting-term-hosting2.test.mjs and loyalty-hosting2.test.mjs:
//   termError      ≡ termCheck      (routes/hosting.mjs)   which numbers are refused, and why
//   termEndDate    ≡ addMonths      (lib/loyalty.mjs)      the day a term ends
//   loyaltyPctFor  ≡ loyaltyPct     (lib/loyalty.mjs)      the renewal discount a tenure earns

/** Why `months` is not a term this site sells, or null when it is. Same reasons, in the same
 *  order, as the server's termCheck: not_integer, below_min, above_max, off_step. */
export function termError(bounds, months) {
  const m = Number(months);
  const bad = (reason) => ({ error: 'invalid_term', reason, min: bounds.min, max: bounds.max, step: bounds.step });
  if (!Number.isInteger(m)) return bad('not_integer');
  if (m < bounds.min) return bad('below_min');
  if (m > bounds.max) return bad('above_max');
  if ((m - bounds.min) % bounds.step !== 0) return bad('off_step');
  return null;
}

/** The day a term of `months` bought at `from` ends: the same calendar day N months later,
 *  clamped to a shorter month's last day (31 Jan + 1 → 28 Feb), in UTC, as the server stores. */
export function termEndDate(from, months) {
  const d = new Date(from);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.trunc(Number(months) || 0), 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return target;
}

/** The loyalty discount (whole %) earned by `months` of tenure, from the `loyalty` object
 *  GET /hosting/plans sends ({ enabled, maxPct, tiers }, tiers already capped). */
export function loyaltyPctFor(loyalty, months) {
  if (!loyalty?.enabled) return 0;
  let pct = 0;
  for (const t of loyalty.tiers || []) if (months >= t.months) pct = Math.max(pct, Number(t.pct) || 0);
  return Math.min(pct, Number(loyalty.maxPct) || 0, 90);
}

/** The renewals a term of `months` would get if it auto-renews: the first `count` renewal
 *  dates, each with the loyalty step the tenure reaches on that day and what it would cost
 *  (the term price less that step, rounded once, as the server applies it). */
export function renewalsFor({ from, months, termCents, loyalty, count = 3 }) {
  const out = [];
  for (let k = 1; k <= count; k++) {
    const pct = loyaltyPctFor(loyalty, months * k);
    out.push({ at: termEndDate(from, months * k), tenure: months * k, pct, cents: Math.round((Number(termCents) || 0) * (1 - pct / 100)) });
  }
  return out;
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
