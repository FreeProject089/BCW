// Loyalty (tenure) pricing for hosting: the longer a subscription has been paid for, the less
// its renewals cost. N-hosting (agent-hosting-N), completed by hosting2 (agent-hosting).
//
// Everything here is pure except the `sync*` / `sweep*` / `ensure*` functions, which take the
// Stripe client and the Prisma client as arguments, so the rules are testable with no database
// and no network.
//
// ── The policy ─────────────────────────────────────────────────────────────────────────────
// One site-wide AdminSetting, `hosting.loyalty`:
//   { enabled, tiers: [{ months, pct }], maxPct, appliesTo, lapseResets }
// "After 3 months: −5 %, after 6: −10 %, after 12: −15 %", and a hard ceiling the admin sets.
// The ceiling wins over any tier (a tier above it is sold AT the ceiling), and the server
// clamps it to 90 % whatever is stored, so no setting can make a renewal free.
// Off by default: turning it on is a pricing decision, and a price must never move on its own
// because a release shipped.
//
// `appliesTo` (hosting2) — which subscriptions earn it:
//   'repos'    storage hosting: the pools and solo repos sold on the Hosting page (a
//              Subscription row with a pool or a repo). The default, because that is all the
//              first version covered, so a policy saved before this field keeps its meaning.
//   'catalogs' catalogue FILE hosting: the monthly Stripe subscription a paid catalogue upload
//              carries (CatalogItem.meta._hostingSubId, routes/catalog.mjs).
//   'both'     both of the above.
// A bot-only plan (no repo, no pool) is never part of it.
//
// ── How tenure is counted (hosting2: decided and written down) ─────────────────────────────
// Tenure is counted in whole CALENDAR months (12 Jan → 12 Apr is 3; 12 Jan → 11 Apr is 2) from
// `tenureStartAt` (its creation date when that is unset: every subscription that existed
// before the column started with its purchase). Prepaid terms now end on the same calendar day
// N months later (`addMonths`), so a subscription that has been paid without a gap has exactly
// as many months of tenure as months paid — "from the start" and "paid months" are the same
// number until something is not paid. What happens then is the admin's `lapseResets` switch:
//
//   lapseResets: true  (default) CONTINUOUS. The count restarts from zero when
//     1. the subscription was cancelled or ended (`status === 'canceled'`: the owner cancelled
//        it, or Stripe ended it after its payment retries failed); or
//     2. it lapsed beyond the grace period: the paid-up date (`currentPeriodEnd`) is further
//        back than the grace window when the renewal arrives. The window is the one the site
//        already uses before deleting content: `hosting.graceUnpaidHours` (7 days by default)
//        for an automatic renewal whose card failed, `hosting.graceLapseHours` (72 hours) for a
//        prepaid term renewed by hand.
//     A renewal that lands INSIDE the grace keeps the count: a card that failed on Monday and
//     was fixed on Wednesday is still the same customer.
//
//   lapseResets: false  CUMULATIVE. Nothing restarts the count; the time that was NOT paid
//     for is simply not counted. At a renewal after a gap, `tenureStartAt` moves forward by the
//     length of the gap (renewal date − paid-up date), so the count resumes where it stopped.
//     The count is then exactly the number of months paid for.
//
// Either way a new purchase is a new subscription and starts at zero; merging pools does not
// add tenures together (each subscription keeps its own).
//
// ── When the discount applies ─────────────────────────────────────────────────────────────
// At renewal, never mid-term and never retroactively: no past invoice is ever touched. The
// percentage is the tier the tenure has reached ON THE FIRST DAY OF THE TERM BEING BOUGHT:
//   · an automatic (Stripe) renewal: a `forever` coupon `bcw-loyalty-<pct>` is put on the
//     Stripe subscription ahead of the renewal, with `proration_behavior: 'none'` (the sweeper
//     checks every hour, and again right after each renewal is paid), so the NEXT invoice
//     carries it. It is swapped when the next tier is reached, and removed if the admin turns
//     the policy off or takes that kind of subscription out of it.
//   · a renewal paid by hand (a prepaid term): priced in on the spot, from the tenure on the
//     day the new term starts (the paid-up date when renewing early, today when late).
// Idempotent by construction: `Subscription.loyaltyPct` (or `meta._loyaltyPct` for a
// catalogue) records what is on Stripe, and Stripe is called only when it differs.

export const LOYALTY_KEY = 'hosting.loyalty';
export const LOYALTY_HARD_MAX_PCT = 90;
export const LOYALTY_SCOPES = Object.freeze(['repos', 'catalogs', 'both']);
export const LOYALTY_DEFAULT = Object.freeze({
  enabled: false,
  tiers: Object.freeze([{ months: 3, pct: 5 }, { months: 6, pct: 10 }, { months: 12, pct: 15 }]),
  maxPct: 15,
  appliesTo: 'repos',
  lapseResets: true,
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
    appliesTo: LOYALTY_SCOPES.includes(r.appliesTo) ? r.appliesTo : LOYALTY_DEFAULT.appliesTo,
    // Only a literal false turns the continuous rule off: a missing field keeps the rule the
    // first version shipped with.
    lapseResets: r.lapseResets !== false,
  };
}

/** Does the policy cover this kind of subscription? kind: 'repos' | 'catalogs'. */
export function loyaltyCovers(policy, kind) {
  const pol = normaliseLoyalty(policy);
  return pol.appliesTo === 'both' || pol.appliesTo === kind;
}

/** The tiers as they will actually be charged: capped at the maximum, zero steps and steps
 *  that do not raise the discount dropped (a later, lower step can never apply, since the
 *  highest tier reached wins). What the public table and the member's status show. */
export function effectiveTiers(policy) {
  const pol = normaliseLoyalty(policy);
  const out = [];
  let best = 0;
  for (const t of pol.tiers) {
    const pct = Math.min(t.pct, pol.maxPct, LOYALTY_HARD_MAX_PCT);
    if (pct > best) { out.push({ months: t.months, pct }); best = pct; }
  }
  return out;
}

/** `date` plus `n` calendar months, in UTC, clamped to the last day of a shorter month
 *  (31 Jan + 1 → 28/29 Feb), which is what Stripe does with a monthly interval. Used for the
 *  end of a prepaid term too, so "12 months" is a year and not 360 days. */
export function addMonths(date, n) {
  const d = new Date(date);
  const months = Math.trunc(Number(n) || 0);
  const y = d.getUTCFullYear(); const m = d.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return target;
}

// hosting2 (agent-hosting): where a renewal's new term ends. Paid by hand (a one-time payment),
// it starts on the paid-up date when that is still ahead, so renewing early never throws away
// the days already paid for (it used to restart from today). A renewal that is a new Stripe
// subscription starts today, because Stripe bills it from today. Calendar months either way.
export function renewedEnd(prev, months, isSubscription, now = new Date()) {
  const from = !isSubscription && prev?.currentPeriodEnd && new Date(prev.currentPeriodEnd) > now ? new Date(prev.currentPeriodEnd) : now;
  return addMonths(from, months);
}

// followups (agent-bcw-followups): automatic renewal armed BEFORE the paid-up date.
// A new Stripe subscription bills the day it is created, so arming auto-renew two months
// before a prepaid term ends used to charge today and restart the term from today: the two
// months already paid were lost. The subscription now starts on the paid-up date instead,
// through Checkout's `subscription_data.trial_end` (no charge until then; the first invoice,
// full price with the loyalty coupon on it, is a 'subscription_cycle' one on that date, which
// the invoice.paid branch already turns into the next term from Stripe's own period).
// `billing_cycle_anchor` is NOT the right tool: Checkout would bill a prorated first period
// today, which is a charge for days already paid for.
// Stripe refuses a Checkout trial_end less than 48 hours ahead; with less left than that the
// subscription bills today, as before (the Payments policy says so).
export const STRIPE_MIN_TRIAL_MS = 48 * 3600 * 1000;
/** The unix second an auto-renew subscription's first charge should wait for (the paid-up
 *  date), or null to bill today: no term, a term already over, or under 48 h left. */
export function autoRenewTrialEnd(prev, now = new Date()) {
  const end = prev?.currentPeriodEnd ? new Date(prev.currentPeriodEnd) : null;
  if (!end || !Number.isFinite(end.getTime())) return null;
  if (end.getTime() - new Date(now).getTime() < STRIPE_MIN_TRIAL_MS + 60e3) return null; // a minute of slack for the checkout itself
  return Math.floor(end.getTime() / 1000);
}
/** Where the paid-up date stands once a renewal checkout completes. A subscription that
 *  waits for the paid-up date (`trialEndSec`) has charged nothing yet, so the date does not
 *  move: the next term is Stripe's, recorded when its first invoice is paid. */
export function checkoutRenewedEnd(prev, months, isSubscription, trialEndSec, now = new Date()) {
  const t = Number(trialEndSec);
  if (isSubscription && Number.isFinite(t) && t > 0) {
    const trial = new Date(t * 1000);
    const paid = prev?.currentPeriodEnd ? new Date(prev.currentPeriodEnd) : null;
    return paid && paid > trial ? paid : trial;
  }
  return renewedEnd(prev, months, isSubscription, now);
}
// fin followups

/** Whole calendar months from `from` to `to` (0 when `to` is before `from`): the largest k
 *  with addMonths(from, k) ≤ to. Defined through addMonths on purpose (hosting2), so a month
 *  of tenure ends exactly when a month of prepaid term does — including from a month-end
 *  start: 31 Jan → 28 Feb is one month, as Stripe bills it. */
export function monthsBetween(from, to) {
  const a = new Date(from); const b = new Date(to);
  if (!(a.getTime() <= b.getTime())) return 0;
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  while (m > 0 && addMonths(a, m) > b) m -= 1;
  while (addMonths(a, m + 1) <= b) m += 1;
  return Math.max(0, m);
}

/** Which grace window applies to this subscription (see the header). */
export function graceHoursFor(sub, grace) {
  const g = grace || {};
  return sub?.stripeSubId ? (Number(g.unpaidHours) || 168) : (Number(g.lapseHours) || 72);
}

/** Is the continuity broken at `at`? Cancelled, or paid-up date further back than the grace.
 *  (The CONTINUOUS rule; the cumulative one is never broken, see `effectiveStart`.) */
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

/** `start` moved forward by the unpaid gap between the paid-up date and `at`, the gap taken in
 *  whole calendar months first and the rest in time — so two unpaid months of 31 days move the
 *  start by two months, not by 62 days (which from 1 January would cost the member a month). */
function shiftByGap(start, sub, at) {
  const end = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const a = new Date(at);
  if (!end || !(a > end)) return new Date(start);
  const gapMonths = monthsBetween(end, a);
  const restMs = a.getTime() - addMonths(end, gapMonths).getTime();
  return new Date(addMonths(start, gapMonths).getTime() + restMs);
}

/** The start the count runs from at `at`, or null when the count is at zero (continuous rule
 *  broken). Cumulative: the stored start, moved forward by the unpaid gap. */
function effectiveStart(sub, at, graceHours, lapseResets) {
  const start = tenureStart(sub);
  if (!sub || !start) return null;
  if (lapseResets !== false) return tenureBroken(sub, at, graceHours) ? null : new Date(start);
  return shiftByGap(start, sub, at);
}

/** Tenure in whole months at `at`; 0 when the continuous count is broken. */
export function tenureMonthsAt(sub, at, graceHours, lapseResets = true) {
  const start = effectiveStart(sub, at, graceHours, lapseResets);
  return start ? monthsBetween(start, at) : 0;
}

/** The start date to store when a renewal is applied at `at`: kept when unbroken, `at` when
 *  the continuous count broke, moved forward by the unpaid gap under the cumulative rule. */
export function nextTenureStart(sub, at, graceHours, lapseResets = true) {
  if (!sub) return new Date(at);
  return effectiveStart(sub, at, graceHours, lapseResets) || new Date(at);
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

/** The day the next term starts: the paid-up date when it is still ahead, else `now`. */
export function renewalDate(sub, now) {
  const n = new Date(now);
  return sub?.currentPeriodEnd && new Date(sub.currentPeriodEnd) > n ? new Date(sub.currentPeriodEnd) : n;
}

/** Is this Subscription row a kind the loyalty offer can cover at all? A pool or a solo repo
 *  (storage hosting); a bot-only plan is not. */
const isStorageSub = (sub) => !!(sub?.hostingGroupId || sub?.serverRepoId);

/** The percentage a subscription's NEXT automatic renewal earns: the tier its tenure reaches
 *  on its paid-up date (a cancelled subscription has no renewal). `kind` is the scope it
 *  belongs to ('repos' for a Subscription row, 'catalogs' for a catalogue file). */
export function pctForNextRenewal(policy, sub, now, graceHours, kind = 'repos') {
  if (!sub || sub.status === 'canceled') return 0;
  if (!loyaltyCovers(policy, kind)) return 0;
  const pol = normaliseLoyalty(policy);
  const at = renewalDate(sub, now);
  return loyaltyPct(pol, tenureMonthsAt(sub, at, graceHours, pol.lapseResets));
}

/** A renewal paid NOW by hand: the tier the tenure reaches on the day the new term starts
 *  (the paid-up date when renewing early). 0 when the continuous count is broken. */
export function pctForRenewalNow(policy, sub, now, grace, kind = 'repos') {
  if (!sub || !loyaltyCovers(policy, kind)) return 0;
  if (kind === 'repos' && !isStorageSub(sub)) return 0; // a bot-only plan is not part of it
  const pol = normaliseLoyalty(policy);
  return loyaltyPct(pol, tenureMonthsAt(sub, renewalDate(sub, now), graceHoursFor(sub, grace), pol.lapseResets));
}

/**
 * Where one subscription stands, for the member's own screen: "you are at step 2 of 3, −10 %;
 * the next step (−15 %) is in 2 months". Everything is computed from the same functions the
 * renewal charges with, so the screen cannot promise what the invoice will not do.
 */
export function loyaltyStatus(policy, sub, now, grace, kind = 'repos') {
  const pol = normaliseLoyalty(policy);
  const tiers = effectiveTiers(pol);
  const covered = pol.enabled && tiers.length > 0 && loyaltyCovers(pol, kind) && (kind !== 'repos' || isStorageSub(sub));
  const gh = graceHoursFor(sub, grace);
  const active = !!sub && sub.status !== 'canceled';
  const start = effectiveStart(sub, now, gh, pol.lapseResets);
  const tenure = start ? monthsBetween(start, now) : 0;
  const pct = covered ? loyaltyPct(pol, tenure) : 0;
  const tierIndex = covered ? tiers.filter((x) => tenure >= x.months).length : 0;
  const next = covered ? tiers.find((x) => x.months > tenure) || null : null;
  const at = renewalDate(sub, now);
  return {
    covered, active, tenureMonths: tenure, pct, tierIndex, tierCount: tiers.length,
    // The continuous count is broken right now: a renewal would start it again from zero.
    broken: pol.lapseResets && !start,
    nextRenewalAt: active ? at.toISOString() : null,
    nextRenewalPct: covered && active ? pctForNextRenewal(pol, sub, now, gh, kind) : 0,
    nextTier: next && start ? { months: next.months, pct: next.pct, inMonths: next.months - tenure, at: addMonths(start, next.months).toISOString() } : null,
  };
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

/** Put `want` % on a Stripe subscription (or take the discount off). Future invoices only:
 *  `proration_behavior: 'none'`, and nothing here ever edits an invoice. */
async function applyCoupon(stripe, stripeSubId, want) {
  if (want > 0) {
    const coupon = await ensureLoyaltyCoupon(stripe, want);
    await stripe.subscriptions.update(stripeSubId, { discounts: [{ coupon }], proration_behavior: 'none' });
  } else {
    await stripe.subscriptions.deleteDiscount(stripeSubId).catch(() => {});
  }
}

/**
 * Put the right coupon on one Stripe-billed hosting subscription (or take it off), and record
 * what is applied in `Subscription.loyaltyPct`. A no-op when the recorded value is already
 * right, so a sweep — or a replayed webhook — costs nothing in Stripe calls once in step.
 */
export async function syncLoyaltyCoupon({ p, stripe, sub, policy, grace, now = new Date() }) {
  if (!sub?.stripeSubId || sub.status === 'canceled') return { changed: false };
  // Storage hosting only: a bot-only plan (no repo, no pool) is not part of the loyalty offer.
  if (!isStorageSub(sub)) return { changed: false };
  const want = pctForNextRenewal(policy, sub, now, graceHoursFor(sub, grace), 'repos');
  if (want === (sub.loyaltyPct || 0)) return { changed: false, pct: want };
  await applyCoupon(stripe, sub.stripeSubId, want);
  await p.subscription.update({ where: { id: sub.id }, data: { loyaltyPct: want } });
  return { changed: true, pct: want };
}

// ── Catalogue file hosting (hosting2) ──────────────────────────────────────────────────────
// A paid catalogue upload is a monthly Stripe subscription with no Subscription row: its state
// lives in CatalogItem.meta (routes/catalog.mjs, stripe-webhook.mjs). The loyalty fields sit
// beside `_hostingSubId` there, with no migration:
//   _hostingSince      ISO date the tenure counts from (set when hosting is first paid)
//   _hostingPeriodEnd  ISO paid-up date (checkout: one month on; each renewal: Stripe's period)
//   _loyaltyPct        the discount currently on the Stripe subscription
// `catalogLoyaltyView` turns that into the same shape as a Subscription row, so every rule
// above applies to it unchanged.

export function catalogLoyaltyView(item) {
  const m = item?.meta && typeof item.meta === 'object' ? item.meta : {};
  return {
    id: item?.id,
    stripeSubId: m._hostingSubId || null,
    // No live subscription (never paid, cancelled, or ended by Stripe) reads as cancelled.
    status: m._hostingSubId ? 'active' : 'canceled',
    createdAt: item?.createdAt || null,
    tenureStartAt: m._hostingSince ? new Date(m._hostingSince) : null,
    currentPeriodEnd: m._hostingPeriodEnd ? new Date(m._hostingPeriodEnd) : null,
    loyaltyPct: Number(m._loyaltyPct) || 0,
  };
}

/** The meta fields to write when catalogue hosting is paid at `at` (a new subscription, a
 *  re-upload that replaces it, or hosting resumed after it ended). */
export function catalogTenureOnPayment(item, at, grace, policy) {
  const pol = normaliseLoyalty(policy);
  const view = catalogLoyaltyView(item);
  const since = (item?.meta?._hostingSince || item?.meta?._hostingSubId)
    ? nextTenureStart(view, at, graceHoursFor({ stripeSubId: 'x' }, grace), pol.lapseResets)
    : new Date(at);
  return { _hostingSince: since.toISOString(), _hostingPeriodEnd: addMonths(at, 1).toISOString(), _loyaltyPct: 0 };
}

/** Same as syncLoyaltyCoupon, for one catalogue item's hosting subscription. */
export async function syncCatalogLoyaltyCoupon({ p, stripe, item, policy, grace, now = new Date() }) {
  const view = catalogLoyaltyView(item);
  if (!view.stripeSubId) return { changed: false };
  const want = pctForNextRenewal(policy, view, now, graceHoursFor(view, grace), 'catalogs');
  if (want === view.loyaltyPct) return { changed: false, pct: want };
  await applyCoupon(stripe, view.stripeSubId, want);
  await p.catalogItem.update({ where: { id: item.id }, data: { meta: { ...(item.meta || {}), _loyaltyPct: want } } });
  return { changed: true, pct: want };
}

/**
 * The sweeper's pass: bring every Stripe-billed subscription's coupon in step with the policy.
 * At most once an hour (`hosting.loyaltySyncAt`), and cheap once in step: only a subscription
 * whose tier CHANGED costs a Stripe call. One failure never stops the others.
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
  const repos = policy.enabled && loyaltyCovers(policy, 'repos');
  const catalogs = policy.enabled && loyaltyCovers(policy, 'catalogs');
  const subs = await p.subscription.findMany({
    where: {
      status: 'active', stripeSubId: { not: null },
      OR: [{ hostingGroupId: { not: null } }, { serverRepoId: { not: null } }],
      // Not covered: only the ones still carrying a coupon have anything to change.
      ...(repos ? {} : { loyaltyPct: { gt: 0 } }),
    },
    select: { id: true, status: true, stripeSubId: true, hostingGroupId: true, serverRepoId: true, createdAt: true, tenureStartAt: true, currentPeriodEnd: true, loyaltyPct: true },
    take: 5000,
  });
  let changed = 0;
  for (const sub of subs) {
    try { if ((await syncLoyaltyCoupon({ p, stripe, sub, policy, grace, now })).changed) changed++; }
    catch (e) { log?.warn?.({ sub: sub.id, err: String(e?.message || e) }, 'loyalty coupon not synced'); }
  }
  // hosting2: catalogue file hosting. Every item with a live hosting subscription when the
  // policy covers them; otherwise only the ones still carrying a coupon.
  const items = await p.catalogItem.findMany({
    where: catalogs
      ? { meta: { path: ['_hostingSubId'], string_starts_with: 'sub' } }
      : { meta: { path: ['_loyaltyPct'], gt: 0 } },
    select: { id: true, meta: true, createdAt: true },
    take: 5000,
  }).catch(() => []);
  for (const item of items) {
    try { if ((await syncCatalogLoyaltyCoupon({ p, stripe, item, policy, grace, now })).changed) changed++; }
    catch (e) { log?.warn?.({ item: item.id, err: String(e?.message || e) }, 'catalog loyalty coupon not synced'); }
  }
  return changed;
}
