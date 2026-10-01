// agent-bcw-pools: admin-made payment links ("custom payments").
//
// An admin describes a sale once: WHAT it provisions, its PRICE, ONE payment or a MONTHLY
// subscription, and HOW MANY accounts may use it. The link is /pay/<token>. A member opens it,
// signs in, pays through Stripe Checkout, and the webhook provisions what was sold.
//
// ── Kinds ────────────────────────────────────────────────────────────────────────────────
//   pool        a storage pool of N GB for the payer (the same pool the Hosting page sells,
//               through provisionHostingPool), optionally DEDICATED to a project
//               (HostingGroup.projectTarget, lib/project-pool.mjs). One payment buys a prepaid
//               term of `months`; a monthly link is a real Stripe subscription whose renewals
//               the existing hosting code handles (the Subscription row carries stripeSubId).
//   prerelease  early access to one pre-release: the payer's sign-up is created or moved to
//               `selected` (routes/prereleases.mjs serves the file only to selected members).
//               One payment only: access to a version is not a subscription.
//   custom      nothing but the payment and its receipt (a quote, an invoice for work done).
//
// ── Price ────────────────────────────────────────────────────────────────────────────────
//   custom      the amount the admin typed, in cents.
//   auto        pool only: the site's usual tariff for these specs (hosting.mjs priceCents, the
//               function the Hosting page prices with), times the months for a one-off term.
// The amount is fixed when the link is SAVED, not re-read at checkout: a payer is charged what
// the link said when it was sent to them, whatever the tariff does afterwards.
//
// ── Uses ─────────────────────────────────────────────────────────────────────────────────
// A Checkout session HOLDS a place (PaymentLinkUse, status pending) until it expires (30
// minutes, the session's own expiry), so two people cannot both pay for the last place. Paid
// uses and live holds count against maxUses; expired holds do not.
//
// ── Idempotency ──────────────────────────────────────────────────────────────────────────
// Stripe delivers at least once and the reconciler replays. A use is CLAIMED (pending or
// expired -> paid) by one conditional write; only the delivery that wins the claim provisions.
// With a real database the claim and the provisioning run in one transaction, so a crash
// between the two leaves the use unclaimed and the next delivery does the whole thing.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const KINDS = ['pool', 'prerelease', 'custom'];
export const INTERVALS = ['once', 'month'];
export const PRICE_MODES = ['auto', 'custom'];
export const HOLD_MINUTES = 30;
export const LIMITS = Object.freeze({ title: 120, description: 2000, maxCents: 1_000_000_00, maxGB: 4000, maxMonths: 12, maxUses: 10_000 });

export const newToken = () => randomBytes(18).toString('base64url');

const GiB = 1024 ** 3;

/** The body an admin sends to create (or, partially, edit) a link. */
export const paylinkSchema = z.object({
  title: z.string().trim().min(2).max(LIMITS.title),
  description: z.string().max(LIMITS.description).default(''),
  kind: z.enum(KINDS).default('custom'),
  pool: z.object({
    storageGB: z.number().min(0.1).max(LIMITS.maxGB),
    uploadMbps: z.number().min(0.5).max(1000).default(8),
    months: z.number().int().min(1).max(LIMITS.maxMonths).default(1),
    // A project REF (key or sc:<slug>) the pool is dedicated to; resolved to a target by the route.
    projectRef: z.string().max(90).nullable().optional(),
  }).optional(),
  prereleaseId: z.string().max(40).optional(),
  priceMode: z.enum(PRICE_MODES).default('custom'),
  amountCents: z.number().int().min(0).max(LIMITS.maxCents).optional(),
  currency: z.enum(['usd', 'eur']).default('usd'),
  interval: z.enum(INTERVALS).default('once'),
  maxUses: z.number().int().min(1).max(LIMITS.maxUses).nullable().optional(),
  onlyEmail: z.string().trim().max(200).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

/** What is wrong with a parsed body beyond its shape, or null. */
export function paylinkProblem(d) {
  if (d.kind === 'pool' && !d.pool) return 'pool_specs_required';
  if (d.kind === 'prerelease' && !d.prereleaseId) return 'prerelease_required';
  if (d.kind === 'prerelease' && d.interval !== 'once') return 'prerelease_is_one_payment';
  if (d.priceMode === 'auto' && d.kind !== 'pool') return 'auto_price_is_for_pools';
  if (d.priceMode === 'custom' && !(d.amountCents >= 50)) return 'amount_required'; // Stripe's own minimum is 50 cents
  if (d.onlyEmail && !/^[^\s@]+@[^\s@]+$/.test(d.onlyEmail)) return 'invalid_email';
  return null;
}

/**
 * The amount a link charges, in cents. `priceCents(storageGB, uploadMbps)` is the site's monthly
 * tariff for those specs (hosting.mjs priceCents with the settings bound), passed in so this
 * file needs neither the settings nor the route module.
 *   auto + once   the monthly tariff times the months of the term
 *   auto + month  the monthly tariff
 *   custom        what was typed
 */
export function amountFor(d, priceCents) {
  if (d.priceMode !== 'auto') return Math.max(0, Math.round(Number(d.amountCents) || 0));
  const monthly = Math.max(0, Math.round(Number(priceCents(d.pool.storageGB, d.pool.uploadMbps)) || 0));
  return d.interval === 'month' ? monthly : monthly * (d.pool.months || 1);
}

/** Uses that count against maxUses: paid ones, and holds that have not expired yet. */
export function countingUses(uses, now = Date.now()) {
  return (uses || []).filter((u) => u.status === 'paid' || (u.status === 'pending' && new Date(u.holdUntil).getTime() > now)).length;
}

/**
 * May this account pay through this link now? `null` when yes, else the reason:
 * revoked | expired | sold_out | wrong_account | already_paid.
 * `uses` is the link's uses (for the count), `email` the payer's address when known.
 */
export function unavailable(link, { uses = [], now = Date.now(), email = null, userId = null } = {}) {
  if (!link || link.revokedAt) return 'revoked';
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now) return 'expired';
  if (link.onlyEmail && email != null && String(email).toLowerCase() !== String(link.onlyEmail).toLowerCase()) return 'wrong_account';
  // One use per account: a link sold "to 20 people" is 20 people, not one person twenty times.
  if (userId && uses.some((u) => u.userId === userId && (u.status === 'paid' || (u.status === 'pending' && new Date(u.holdUntil).getTime() > now)))) return 'already_paid';
  if (link.maxUses != null && countingUses(uses, now) >= link.maxUses) return 'sold_out';
  return null;
}

/** The public face of a link: never the creator, never who paid. */
export function serPublic(link, { uses = [], now = Date.now() } = {}) {
  const pv = link.provision || {};
  return {
    token: link.token, title: link.title, description: link.description, kind: link.kind,
    amountCents: link.amountCents, currency: link.currency, interval: link.interval,
    pool: link.kind === 'pool' ? { storageGB: pv.storageGB, uploadMbps: pv.uploadMbps, months: pv.months, project: pv.projectName || null } : null,
    prerelease: link.kind === 'prerelease' ? { title: pv.prereleaseTitle || '', slug: pv.prereleaseSlug || '' } : null,
    left: link.maxUses != null ? Math.max(0, link.maxUses - countingUses(uses, now)) : null,
    expiresAt: link.expiresAt || null,
    restricted: !!link.onlyEmail,
  };
}

/** The admin's view: everything, with the counts. */
export function serAdmin(link, { uses = [], now = Date.now() } = {}) {
  return {
    ...serPublic(link, { uses, now }),
    id: link.id, provision: link.provision, priceMode: link.priceMode, maxUses: link.maxUses, onlyEmail: link.onlyEmail,
    revokedAt: link.revokedAt || null, createdAt: link.createdAt,
    paid: uses.filter((u) => u.status === 'paid').length,
    holding: uses.filter((u) => u.status === 'pending' && new Date(u.holdUntil).getTime() > now).length,
    revenueCents: uses.filter((u) => u.status === 'paid').reduce((a, u) => a + (u.amountCents || 0), 0),
  };
}

/** The Stripe Checkout parameters for one use. Pure: the route adds the customer and sends it. */
export function checkoutParams(link, { useId, userId, siteUrl }) {
  const metadata = { type: 'paylink', linkId: link.id, useId, userId };
  const name = String(link.title).slice(0, 200);
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const back = { success_url: `${base}/pay/${link.token}?paid=1`, cancel_url: `${base}/pay/${link.token}?cancel=1` };
  // Stripe wants 30 minutes at least; one more so the clock between here and Stripe cannot undercut it.
  const expires_at = Math.floor(Date.now() / 1000) + (HOLD_MINUTES + 1) * 60;
  if (link.interval === 'month') {
    return {
      mode: 'subscription', metadata, subscription_data: { metadata }, expires_at,
      line_items: [{ quantity: 1, price_data: { currency: link.currency, unit_amount: link.amountCents, recurring: { interval: 'month' }, product_data: { name } } }],
      ...back,
    };
  }
  return {
    mode: 'payment', metadata, invoice_creation: { enabled: true }, expires_at,
    line_items: [{ quantity: 1, price_data: { currency: link.currency, unit_amount: link.amountCents, product_data: { name } } }],
    ...back,
  };
}

/**
 * Deliver a paid Checkout session of type `paylink`. Idempotent (see the header). `deps`:
 *   provisionPool(p, { userId, plan, poolName, months, stripeSubId })  hosting.mjs provisionHostingPool
 *   notify(p, userId, kind, body, opts)                                 lib.mjs notify
 *   receipt({ to, link, amountCents, currency })                        best-effort mail, may be absent
 * Returns { done: true, result } when this delivery provisioned, { done: false, why } otherwise.
 */
export async function fulfilPaylink(p, s, deps) {
  const meta = s?.metadata || {};
  if (s.payment_status && s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') return { done: false, why: 'unpaid' };
  const use = await p.paymentLinkUse.findUnique({ where: { sessionId: s.id } });
  if (!use || use.id !== meta.useId || use.userId !== meta.userId) return { done: false, why: 'unknown_use' };
  if (use.status === 'paid' || use.status === 'revoked') return { done: false, why: 'already' };
  const link = await p.paymentLink.findUnique({ where: { id: use.linkId } });
  if (!link) return { done: false, why: 'unknown_link' };

  const run = async (tx) => {
    // THE CLAIM: only the delivery that moves the use to `paid` goes on. A payment that lands
    // after its hold expired is still honoured: the money was taken.
    const claim = await tx.paymentLinkUse.updateMany({ where: { id: use.id, status: { in: ['pending', 'expired'] } }, data: { status: 'paid', paidAt: new Date() } });
    if (!claim.count) return { done: false, why: 'already' };
    const amountCents = Number(s.amount_total ?? link.amountCents) || 0;
    const currency = String(s.currency || link.currency || 'usd');
    const stripeSubId = typeof s.subscription === 'string' ? s.subscription : (s.subscription?.id || null);
    const pv = link.provision || {};
    let result = {};
    if (link.kind === 'pool') {
      const plan = pv.planId ? await tx.hostingPlan.findUnique({ where: { id: pv.planId } }) : null;
      const usePlan = plan || await tx.hostingPlan.create({ data: { name: `Payment link: ${link.title}`.slice(0, 120), storageGB: Number(pv.storageGB) || 1, uploadLimitKbps: Math.round((Number(pv.uploadMbps) || 8) * 1024), cpuShare: 0.25, priceMonthlyCents: link.amountCents, active: false } });
      const group = await deps.provisionPool(tx, { userId: use.userId, plan: usePlan, poolName: String(pv.poolName || link.title).slice(0, 80), months: link.interval === 'month' ? 1 : (Number(pv.months) || 1), stripeSubId });
      result = { poolId: group.id };
      if (pv.projectTarget) {
        // One pool per project: when the project already has one, the pool is still the
        // payer's, just not dedicated. Said in the result rather than failing a paid order.
        const taken = await tx.hostingGroup.findUnique({ where: { projectTarget: pv.projectTarget } }).catch(() => null);
        if (!taken) { await tx.hostingGroup.update({ where: { id: group.id }, data: { projectTarget: pv.projectTarget } }); result.projectTarget = pv.projectTarget; }
        else result.projectTaken = true;
      }
      await tx.payment.create({ data: { userId: use.userId, hostingGroupId: group.id, kind: 'HOSTING', description: `${link.title} (payment link)`.slice(0, 300), amountCents, currency, stripeSessionId: s.id } });
    } else if (link.kind === 'prerelease') {
      const had = await tx.preReleaseSignup.findUnique({ where: { prereleaseId_userId: { prereleaseId: pv.prereleaseId, userId: use.userId } } });
      const signup = had
        ? await tx.preReleaseSignup.update({ where: { id: had.id }, data: { status: 'selected', decidedAt: new Date() } })
        : await tx.preReleaseSignup.create({ data: { prereleaseId: pv.prereleaseId, userId: use.userId, status: 'selected', decidedAt: new Date(), message: '' } });
      result = { signupId: signup.id };
      await tx.payment.create({ data: { userId: use.userId, kind: 'CUSTOM', description: `${link.title} (payment link)`.slice(0, 300), amountCents, currency, stripeSessionId: s.id } });
    } else {
      await tx.payment.create({ data: { userId: use.userId, kind: 'CUSTOM', description: `${link.title} (payment link)`.slice(0, 300), amountCents, currency, stripeSessionId: s.id } });
    }
    await tx.paymentLinkUse.update({ where: { id: use.id }, data: { result, amountCents, currency, ...(stripeSubId ? { stripeSubId } : {}) } });
    return { done: true, result, amountCents, currency };
  };
  const out = typeof p.$transaction === 'function' ? await p.$transaction(run) : await run(p);
  if (!out.done) return out;
  // After the transaction: a notification and a mail cannot be rolled back, rows can.
  const what = link.kind === 'pool' ? 'Your storage pool is ready.' : link.kind === 'prerelease' ? 'Your early access is ready.' : 'Payment received, thank you.';
  const whatFr = link.kind === 'pool' ? 'Ton pool de stockage est prêt.' : link.kind === 'prerelease' ? 'Ton accès anticipé est prêt.' : 'Paiement reçu, merci.';
  const href = link.kind === 'pool' ? '/dashboard?s=repos' : link.kind === 'prerelease' && link.provision?.prereleaseSlug ? `/prereleases/${link.provision.prereleaseSlug}` : '/dashboard?s=billing';
  await deps.notify?.(p, use.userId, 'purchase', `${link.title}: ${what}`, { bodyFr: `${link.title} : ${whatFr}`, href }).catch?.(() => {});
  try { await deps.receipt?.({ userId: use.userId, link, amountCents: out.amountCents, currency: out.currency }); } catch { /* best effort */ }
  return out;
}

/** A Checkout session Stripe expired: its hold is released (the place is free again). */
export async function expirePaylinkHold(p, sessionId) {
  if (!sessionId) return 0;
  const r = await p.paymentLinkUse.updateMany({ where: { sessionId, status: 'pending' }, data: { status: 'expired' } }).catch(() => ({ count: 0 }));
  return r.count || 0;
}

/** Bytes, from GB, for a pool spec (BigInt, like poolBytes). */
export const poolBytesOf = (gb) => BigInt(Math.round(Number(gb || 0) * GiB));
