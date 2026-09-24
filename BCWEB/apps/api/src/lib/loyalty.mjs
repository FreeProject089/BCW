// Loyalty (tenure) pricing for hosting: the longer a subscription has run WITHOUT a break,
// the less its renewals cost. N-hosting (agent-hosting-N).
//
// Everything here is pure except `ensureLoyaltyCoupon` / `syncLoyaltyCoupon`, which take the
// Stripe client and the Prisma client as arguments, so the rules are testable with no database
// and no network.
//
// ── The policy ─────────────────────────────────────────────────────────────────────────────
// One site-wide AdminSetting, `hosting.loyalty`:
//   { enabled: bool, tiers: [{ months, pct }], maxPct }
// "After 3 months: −5 %, after 6: −10 %, after 12: −15 %", and a hard ceiling the admin sets.
// The ceiling wins over any tier (a tier above it is sold AT the ceiling), and the server
// clamps it to 90 % whatever is stored, so no setting can make a renewal free.
// Off by default: turning it on is a pricing decision, and a price must never move on its own
// because a release shipped.
//
// ── Continuous tenure, exactly ─────────────────────────────────────────────────────────────
// A subscription's tenure runs from `tenureStartAt` (its creation date when that is unset:
// every subscription that existed before this column started with its purchase).
// It is counted in whole calendar months (12 Jan → 12 Apr is 3; 12 Jan → 11 Apr is 2).
// It is BROKEN, and restarts from zero, when:
//   1. the subscription was cancelled or ended (`status === 'canceled'`: the owner cancelled
//      it, or Stripe ended it after its payment retries failed); or
//   2. it lapsed beyond the grace period: the paid-up date (`currentPeriodEnd`) is further
//      back than the grace window when the renewal arrives. The window is the one the site
//      already uses before deleting content: `hosting.graceUnpaidHours` (7 days by default)
//      for an automatic renewal whose card failed, `hosting.graceLapseHours` (72 hours) for a
//      prepaid term renewed by hand.
// A renewal that lands INSIDE the grace keeps the count: a card that failed on Monday and
// was fixed on Wednesday is still the same customer.
// A new purchase is a new subscription, so it starts at zero; merging pools does not add
// tenures together (each subscription keeps its own).
//
// ── When the discount applies ─────────────────────────────────────────────────────────────
// At renewal, never mid-term and never retroactively. The percentage is the tier the tenure
// has reached ON THE RENEWAL DATE:
//   · an automatic (Stripe) renewal: a `forever` coupon `bcw-loyalty-<pct>` is put on the
//     Stripe subscription ahead of the renewal (the sweeper checks every hour, and again
//     right after each renewal is paid), so the renewal invoice carries it. It is swapped
//     when the next tier is reached, and removed if the admin turns the policy off.
//   · a renewal paid by hand (a prepaid term): priced in on the spot, from the tenure on the
//     day it is paid.

export const LOYALTY_KEY = 'hosting.loyalty';
export const LOYALTY_HARD_MAX_PCT = 90;
export const LOYALTY_DEFAULT = Object.freeze({
  enabled: false,
  tiers: Object.freeze([{ months: 3, pct: 5 }, { months: 6, pct: 10 }, { months: 12, pct: 15 }]),
  maxPct: 15,
});

const clampInt = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** The stored setting, made safe: integer months 1..120 and percentages 0..90, one tier per
 *  month count (the last one written wins), sorted by months, at most 12 tiers. Anything
 *  missing falls back to the default rather than to "no policy". */
export function normaliseLoyalty(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const byMonths = new Map();
  for (const t of Array.isArray(r.tiers) ? r.tiers : LOYALTY_DEFAULT.tiers) {
    const months = clampInt(t?.months, 1, 120, NaN);
    const pct = clampInt(t?.pct, 0, LOYALTY_HARD_MAX_PCT, NaN);
    if (Number.isFinite(months) && Number.isFinite(pct)) byMonths.set(months, pct);
  }
  const tiers = [...byMonths].map(([months, pct]) => ({ months, pct })).sort((a, b) => a.months - b.months).slice(0, 12);
  return {
    enabled: r.enabled === true,
    tiers,
    maxPct: clampInt(r.maxPct, 0, LOYALTY_HARD_MAX_PCT, LOYALTY_DEFAULT.maxPct),
  };
}

/** Whole calendar months from `from` to `to` (0 when `to` is before `from`). */
export function monthsBetween(from, to) {
  const a = new Date(from); const b = new Date(to);
  if (!(a.getTime() <= b.getTime())) return 0;
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  // Not a full month yet when the day (or, on the same day, the time) has not come round.
  const aRest = ((a.getUTCDate() * 24 + a.getUTCHours()) * 60 + a.getUTCMinutes()) * 60e3 + a.getUTCSeconds() * 1e3 + a.getUTCMilliseconds();
  const bRest = ((b.getUTCDate() * 24 + b.getUTCHours()) * 60 + b.getUTCMinutes()) * 60e3 + b.getUTCSeconds() * 1e3 + b.getUTCMilliseconds();
  if (bRest < aRest) m -= 1;
  return Math.max(0, m);
}

/** Which grace window applies to this subscription (see the header). */
export function graceHoursFor(sub, grace) {
  const g = grace || {};
  return sub?.stripeSubId ? (Number(g.unpaidHours) || 168) : (Number(g.lapseHours) || 72);
}

/** Is the continuity broken at `at`? Cancelled, or paid-up date further back than the grace. */
export function tenureBroken(sub, at, graceHours) {
  if (!sub) return true;
  if (sub.status === 'canceled') return true;
  if (sub.currentPeriodEnd) {
    const gapMs = new Date(at).getTime() - new Date(sub.currentPeriodEnd).getTime();
    if (gapMs > Number(graceHours) * 3600e3) return true;
  }
  return false;
}

/** When the tenure started (the column, else the purchase). */
export function tenureStart(sub) {
  return sub?.tenureStartAt || sub?.createdAt || null;
}

/** Continuous tenure in whole months at `at`; 0 when the continuity is broken. */
export function tenureMonthsAt(sub, at, graceHours) {
  if (tenureBroken(sub, at, graceHours)) return 0;
  const start = tenureStart(sub);
  return start ? monthsBetween(start, at) : 0;
}

/** The start date to store when a renewal is applied at `at`: kept when unbroken, else `at`. */
export function nextTenureStart(sub, at, graceHours) {
  if (!sub || tenureBroken(sub, at, graceHours)) return new Date(at);
  return new Date(tenureStart(sub) || at);
}

/** The loyalty percentage (integer) earned by `months` of tenure under `policy`. */
export function loyaltyPct(policy, months) {
  const pol = normaliseLoyalty(policy);
  if (!pol.enabled) return 0;
  let pct = 0;
  for (const t of pol.tiers) if (months >= t.months) pct = Math.max(pct, t.pct);
  return Math.min(pct, pol.maxPct, LOYALTY_HARD_MAX_PCT);
}

/** `cents` less `pct` %, rounded to the cent once. */
export function applyLoyalty(cents, pct) {
  const p = clampInt(pct, 0, LOYALTY_HARD_MAX_PCT, 0);
  return Math.round((Number(cents) || 0) * (1 - p / 100));
}

/** The percentage a subscription's NEXT renewal earns: the tier its tenure reaches on its
 *  paid-up date, assuming it renews then (a subscription that is cancelled has no renewal). */
export function pctForNextRenewal(policy, sub, now, graceHours) {
  if (!sub || sub.status === 'canceled') return 0;
  if (tenureBroken(sub, now, graceHours)) return 0;
  const at = sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > new Date(now) ? sub.currentPeriodEnd : now;
  const start = tenureStart(sub);
  return start ? loyaltyPct(policy, monthsBetween(start, at)) : 0;
}

/** A renewal paid NOW by hand: the tier the tenure has reached today (0 when broken). */
export function pctForRenewalNow(policy, sub, now, grace) {
  if (!sub) return 0;
  return loyaltyPct(policy, tenureMonthsAt(sub, now, graceHoursFor(sub, grace)));
}

/** Read the policy from the settings map `settings(p)` returns. */
export function loyaltyFromSettings(s) {
  return normaliseLoyalty(s?.[LOYALTY_KEY]);
}

export const loyaltyCouponId = (pct) => `bcw-loyalty-${pct}`;

/** The Stripe coupon for `pct` %, created once and reused (a fixed id makes it idempotent). */
export async function ensureLoyaltyCoupon(stripe, pct) {
  const id = loyaltyCouponId(pct);
  try { return (await stripe.coupons.retrieve(id)).id; } catch { /* not there yet */ }
  try {
    return (await stripe.coupons.create({ id, percent_off: pct, duration: 'forever', name: `Loyalty −${pct}%` })).id;
  } catch (e) {
    // Two sweeps racing to create it: the loser reads the winner's.
    try { return (await stripe.coupons.retrieve(id)).id; } catch { throw e; }
  }
}

/**
 * Put the right coupon on one Stripe-billed subscription (or take it off), and record what is
 * applied in `Subscription.loyaltyPct`. A no-op when the recorded value is already right, so
 * a sweep costs nothing in Stripe calls once everyone is in step.
 */
export async function syncLoyaltyCoupon({ p, stripe, sub, policy, grace, now = new Date() }) {
  if (!sub?.stripeSubId || sub.status === 'canceled') return { changed: false };
  // Hosting only: a bot-only plan (no repo, no pool) is not part of the loyalty offer.
  if (!sub.hostingGroupId && !sub.serverRepoId) return { changed: false };
  const want = pctForNextRenewal(policy, sub, now, graceHoursFor(sub, grace));
  if (want === (sub.loyaltyPct || 0)) return { changed: false, pct: want };
  if (want > 0) {
    const coupon = await ensureLoyaltyCoupon(stripe, want);
    await stripe.subscriptions.update(sub.stripeSubId, { discounts: [{ coupon }], proration_behavior: 'none' });
  } else {
    await stripe.subscriptions.deleteDiscount(sub.stripeSubId).catch(() => {});
  }
  await p.subscription.update({ where: { id: sub.id }, data: { loyaltyPct: want } });
  return { changed: true, pct: want };
}

/**
 * The sweeper's pass: bring every Stripe-billed hosting subscription's coupon in step with the
 * policy. At most once an hour (`hosting.loyaltySyncAt`), and cheap once in step: only a
 * subscription whose tier CHANGED costs a Stripe call. One failure never stops the others.
 */
export async function sweepLoyaltyCoupons(p, { stripe, grace, log, now = new Date(), force = false }) {
  if (!stripe) return 0;
  if (!force) {
    const last = await p.adminSetting.findUnique({ where: { key: 'hosting.loyaltySyncAt' } }).catch(() => null);
    if (last?.value && now.getTime() - new Date(last.value).getTime() < 55 * 60e3) return 0;
    await p.adminSetting.upsert({ where: { key: 'hosting.loyaltySyncAt' }, create: { key: 'hosting.loyaltySyncAt', value: now.toISOString() }, update: { value: now.toISOString() } });
  }
  const row = await p.adminSetting.findUnique({ where: { key: LOYALTY_KEY } }).catch(() => null);
  const policy = normaliseLoyalty(row?.value);
  const subs = await p.subscription.findMany({
    where: {
      status: 'active', stripeSubId: { not: null },
      OR: [{ hostingGroupId: { not: null } }, { serverRepoId: { not: null } }],
      // Off: only the ones still carrying a coupon have anything to change.
      ...(policy.enabled ? {} : { loyaltyPct: { gt: 0 } }),
    },
    select: { id: true, status: true, stripeSubId: true, hostingGroupId: true, serverRepoId: true, createdAt: true, tenureStartAt: true, currentPeriodEnd: true, loyaltyPct: true },
    take: 5000,
  });
  let changed = 0;
  for (const sub of subs) {
    try { if ((await syncLoyaltyCoupon({ p, stripe, sub, policy, grace, now })).changed) changed++; }
    catch (e) { log?.warn?.({ sub: sub.id, err: String(e?.message || e) }, 'loyalty coupon not synced'); }
  }
  return changed;
}
