// Boosts that come with a plan: when they are granted, and what spending one does.
//
// Two decisions worth keeping out of the sweeper, because both are the sort that get written
// twice and drift: which period a date falls in, and where a boost's new end date comes from.
//
// The second one is the one that costs money if it is wrong. Extending from NOW on a repo that
// is already featured silently throws away whatever was left of the current boost; extending
// from the current end date is what somebody stacking two of them means. It has to be one
// function, and it has to be the same one the paid boost flow uses.

/** Months, in ms, only for comparisons that do not care about calendar edges. */
const MONTH_MS = 30 * 24 * 3600 * 1000;

/**
 * The start of the period `at` falls in, counting from `anchor` in `months` steps.
 *
 * Anchored to the subscription rather than to the calendar: somebody who bought on the 20th
 * gets their boosts on the 20th, not on whatever day a calendar month happens to turn over —
 * which would hand a new buyer a second month's worth ten days after the first.
 *
 * Returned as a Date so it can go straight into the unique index that makes granting
 * idempotent.
 */
export function periodStartFor(anchor, at, months = 1) {
  const a = new Date(anchor).getTime();
  const t = new Date(at).getTime();
  const step = Math.max(1, Math.round(months)) * MONTH_MS;
  if (!Number.isFinite(a) || !Number.isFinite(t) || t < a) return new Date(a);
  return new Date(a + Math.floor((t - a) / step) * step);
}

/**
 * How many credits are owed for the current period, given what is already there.
 *
 * Never negative, and never more than the plan grants — a plan edited downward mid-period must
 * not ask for credits back, and one edited upward grants the difference rather than a fresh
 * full batch on top of what was already given.
 */
export function owedThisPeriod(plan, alreadyGranted) {
  const want = Math.max(0, Math.min(50, Math.round(Number(plan?.boostsPerPeriod) || 0)));
  return Math.max(0, want - Math.max(0, Number(alreadyGranted) || 0));
}

/**
 * Where a boost of `days` ends, applied to something whose current end is `currentUntil`.
 *
 * From the LATER of now and the current end. A repo that is featured for another three days
 * and receives a seven-day boost is featured for ten, not seven — measuring from now would
 * quietly destroy the remainder, and the person doing it is stacking them precisely because
 * they do not want a gap.
 */
export function boostEndFrom(currentUntil, days, now = new Date()) {
  const n = new Date(now).getTime();
  const cur = currentUntil ? new Date(currentUntil).getTime() : 0;
  const base = Number.isFinite(cur) && cur > n ? cur : n;
  const d = Math.max(1, Math.min(365, Math.round(Number(days) || 0)));
  return new Date(base + d * 24 * 3600 * 1000);
}

/** Is this credit spendable right now? Used and expired are the same "no" to a caller, but
 *  the panel distinguishes them, so both are reported. */
export function creditState(c, now = new Date()) {
  if (!c) return 'missing';
  if (c.usedAt) return 'used';
  if (c.expiresAt && new Date(c.expiresAt).getTime() <= new Date(now).getTime()) return 'expired';
  return 'available';
}

/**
 * Pick the credit to spend.
 *
 * The one expiring SOONEST, not the oldest granted: with expiry in play those differ, and
 * spending the oldest can leave a credit that expires tonight sitting unused. Ties broken by
 * grant order so the choice is deterministic.
 */
export function pickCredit(credits, now = new Date()) {
  const usable = (credits || []).filter((c) => creditState(c, now) === 'available');
  if (!usable.length) return null;
  return usable.slice().sort((a, b) => {
    const ax = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
    const bx = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
    if (ax !== bx) return ax - bx;
    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
  })[0];
}
