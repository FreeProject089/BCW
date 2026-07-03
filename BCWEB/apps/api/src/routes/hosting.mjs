import { z } from 'zod';
import { statfsSync } from 'node:fs';
import { db, requireRole, notify, hasFreeTierClaim, recordFreeTierClaim } from '../lib.mjs';
import { validatePromo, redeemPromoAtomic } from './promo.mjs';

const GiB = 1024 ** 3;

// Real, live disk stats for the volume backing the API container — the best
// available proxy for "what can this machine actually store" without needing
// MinIO's own admin API. Same physical host disk as the object-storage volume
// in a single-host deployment. Never faked: if the stat call fails for any
// reason, we report null rather than invent a number.
export function realDiskStats() {
  try {
    const s = statfsSync('/');
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch { return { totalBytes: null, freeBytes: null }; }
}
let _stripe = null;
export async function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) { const Stripe = (await import('stripe')).default; _stripe = new Stripe(process.env.STRIPE_SECRET_KEY); }
  return _stripe;
}

export async function settings(p) {
  return Object.fromEntries((await p.adminSetting.findMany()).map((r) => [r.key, r.value]));
}

// Ensure the user has a Stripe customer (so subscriptions + the billing portal work).
export async function ensureCustomer(p, sk, userId) {
  const u = await p.user.findUnique({ where: { id: userId } });
  if (u?.stripeCustomerId) return u.stripeCustomerId;
  const c = await sk.customers.create({ email: u.email, name: u.displayName, metadata: { userId } });
  await p.user.update({ where: { id: userId }, data: { stripeCustomerId: c.id } });
  return c.id;
}

/** Global storage capacity status. The host must always keep `reservedFreeGB` free.
 *  `allocatedGB` (against Total capacity) = hosted-repo quotas + APPROVED catalog
 *  submissions' payload bytes. Submissions awaiting moderation draw from their
 *  own separate temp margin instead — until approved they're not "real" usage
 *  of the site's capacity, they're provisional and may still be rejected. Once
 *  approved they become permanent content and must count for real. */
export async function capacityStatus(p) {
  const s = await settings(p);
  const totalGB = Number(s['hosting.totalCapacityGB'] ?? 0);
  const reservedGB = Number(s['hosting.reservedFreeGB'] ?? 0);
  const [hostedAgg, publishedAgg, tempAgg] = await Promise.all([
    p.serverRepo.aggregate({ where: { hosted: true }, _sum: { storageQuotaBytes: true } }),
    // Approved submissions — their payload now counts as permanent site content.
    p.catalogItem.aggregate({ where: { payloadKey: { not: null }, status: 'PUBLISHED' }, _sum: { payloadSize: true } }),
    // Only PENDING submissions occupy the dedicated temp margin — approved/rejected
    // items must not keep blocking new uploads forever (the original bug: this used
    // to sum every payloadKey regardless of status, so approved work never "left").
    p.catalogItem.aggregate({ where: { payloadKey: { not: null }, status: 'PENDING' }, _sum: { payloadSize: true } }),
  ]);
  const hostingAllocatedGB = Number(hostedAgg._sum.storageQuotaBytes || 0n) / GiB;
  const submissionsPublishedGB = Number(publishedAgg._sum.payloadSize || 0) / GiB;
  const allocatedGB = hostingAllocatedGB + submissionsPublishedGB;
  const usableGB = Math.max(0, totalGB - reservedGB);
  const tempMarginGB = Number(s['hosting.tempMarginGB'] ?? 20);
  const tempUsedGB = Number(tempAgg._sum.payloadSize || 0) / GiB;
  const disk = realDiskStats();

  // Free-tier pool: total storage currently held by repos that were provisioned
  // for $0 (no HOSTING Payment on file — includes promo-granted and admin-free
  // repos too, not just the seeded Free plan). Tracked separately from the paid
  // pool above: a paid repo NEVER counts against this, and this cap (when on)
  // is what makes the Free plan itself go "sold out" independent of Total capacity.
  const freeTierCapEnabled = !!s['hosting.freeTierCapEnabled'];
  let freeTierUsedGB = 0;
  if (freeTierCapEnabled) {
    const [hostedRepos, paidRepoPayments] = await Promise.all([
      p.serverRepo.findMany({ where: { hosted: true }, select: { id: true, storageQuotaBytes: true } }),
      p.payment.findMany({ where: { kind: 'HOSTING', serverRepoId: { not: null } }, select: { serverRepoId: true } }),
    ]);
    const paidRepoIds = new Set(paidRepoPayments.map((x) => x.serverRepoId));
    freeTierUsedGB = hostedRepos.filter((r) => !paidRepoIds.has(r.id)).reduce((a, r) => a + Number(r.storageQuotaBytes) / GiB, 0);
  }
  const freeTierCapGB = Number(s['hosting.freeTierCapGB'] ?? 50);

  return {
    totalGB, reservedGB, usableGB, allocatedGB, hostingAllocatedGB, submissionsPublishedGB,
    freeGB: Math.max(0, usableGB - allocatedGB), tempMarginGB, tempUsedGB,
    diskTotalGB: disk.totalBytes != null ? disk.totalBytes / GiB : null,
    diskFreeGB: disk.freeBytes != null ? disk.freeBytes / GiB : null,
    enabled: s['features.hostingEnabled'] !== false,
    freeTierCapEnabled, freeTierCapGB, freeTierUsedGB,
    freeTierFreeGB: freeTierCapEnabled ? Math.max(0, freeTierCapGB - freeTierUsedGB) : null,
  };
}

/** Flexible base price (cents/month) from the admin-tunable knobs. The first
 *  `hostingFreeGB` of STORAGE are free (small personal repos cost nothing) —
 *  only upload/CPU allotments and storage above that floor are ever billed. */
export function priceCents(s, storageGB, uploadMbps, cpuShare) {
  const freeGB = Number(s['pricing.hostingFreeGB'] ?? 1);
  const billableGB = Math.max(0, storageGB - freeGB);
  return Math.round(Number(s['pricing.perGBCents'] ?? 0) * billableGB
    + Number(s['pricing.perUploadMbpsCents'] ?? 0) * uploadMbps
    + Number(s['pricing.perCpuShareCents'] ?? 0) * cpuShare);
}

// Shared by the checkout webhook AND the free-tier (no-Stripe) path below, so a
// $0 "custom" plan and a paid one are provisioned identically instead of two
// diverging code paths that could drift out of sync.
export async function provisionHostedRepo(p, { userId, plan, repoName, hostMode, months, stripeSubId = null }) {
  let groupId = null;
  if (hostMode === 'multi') {
    const group = await p.hostingGroup.create({ data: {
      ownerId: userId, name: repoName || 'pool', poolBytes: BigInt(plan.storageGB) * BigInt(GiB),
      uploadLimitKbps: plan.uploadLimitKbps, cpuShare: plan.cpuShare,
    } });
    groupId = group.id;
  }
  const firstGB = hostMode === 'multi' ? Math.max(1, Math.ceil(plan.storageGB / 2)) : plan.storageGB;
  const repo = await p.serverRepo.create({ data: {
    ownerId: userId, name: hostMode === 'multi' ? `${repoName || 'repo'}-1` : (repoName || 'repo'), hosted: true, status: 'PROVISIONING',
    storageQuotaBytes: BigInt(firstGB) * BigInt(GiB),
    uploadLimitKbps: plan.uploadLimitKbps, cpuShare: plan.cpuShare, groupId,
  } });
  await p.subscription.create({ data: {
    userId, serverRepoId: repo.id, planId: plan.id, stripeSubId, status: 'active',
    currentPeriodEnd: new Date(Date.now() + months * 30 * 864e5),
  } });
  return repo;
}

// Prepaid term options: more months → bigger discount (1yr recommended).
export const TERM_MONTHS = [1, 3, 6, 12, 24];
const TERM_DISCOUNT = { 1: 0, 3: 0.05, 6: 0.10, 12: 0.20, 24: 0.35 };
// Scarcity: as allocated storage nears usable capacity, prices rise slightly and the
// per-repo CPU / upload caps offered to new customers tighten.
export function capacityFactors(cap) {
  const fill = cap.usableGB ? Math.min(1, cap.allocatedGB / cap.usableGB) : 0;
  const priceMult = fill < 0.6 ? 1 : +(1 + (fill - 0.6) * 0.9).toFixed(3); // up to ~1.36x when full
  const maxUploadMbps = fill > 0.9 ? 100 : fill > 0.75 ? 250 : 1000;
  const maxCpuShare = fill > 0.9 ? 1 : fill > 0.75 ? 2 : 8;
  return { fill: +fill.toFixed(3), priceMult, maxUploadMbps, maxCpuShare };
}
export function termTotalCents(monthlyCents, months, priceMult) {
  return Math.round(monthlyCents * months * (1 - (TERM_DISCOUNT[months] ?? 0)) * priceMult);
}

export default async function hostingRoutes(app) {
  app.get('/hosting/plans', async () => {
    const p = await db();
    return { plans: await p.hostingPlan.findMany({ where: { active: true }, orderBy: { storageGB: 'asc' } }) };
  });

  app.get('/hosting/capacity', async () => ({ capacity: await capacityStatus(await db()) }));

  // Live price preview for arbitrary specs: base + capacity-adjusted monthly, per-term
  // totals with discounts, and the current CPU/upload caps.
  app.get('/hosting/price', async (req) => {
    const p = await db();
    const s = await settings(p);
    const q = req.query || {};
    const monthly = priceCents(s, Number(q.storageGB || 0), Number(q.uploadMbps || 0), Number(q.cpuShare || 0));
    const cf = capacityFactors(await capacityStatus(p));
    const byTerm = Object.fromEntries(TERM_MONTHS.map((m) => {
      const total = termTotalCents(monthly, m, cf.priceMult);
      return [m, { months: m, totalCents: total, perMonthCents: Math.round(total / m), discount: TERM_DISCOUNT[m] }];
    }));
    return { baseMonthlyCents: monthly, priceMonthlyCents: Math.round(monthly * cf.priceMult), factors: cf, terms: TERM_MONTHS, byTerm };
  });

  // Start a hosting subscription → Stripe Checkout. Capacity-guarded.
  app.post('/hosting/checkout', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      planId: z.string().optional(),
      repoName: z.string().min(2).max(60),
      // single = one repo with the full quota; multi = a shared storage pool.
      mode: z.enum(['single', 'multi']).default('single'),
      // Custom plan: user picks their own size / upload / cpu.
      custom: z.object({ storageGB: z.number().int().min(1).max(500), uploadMbps: z.number().min(1).max(1000), cpuShare: z.number().min(0.1).max(8) }).optional(),
      // Prepaid term (months): 1 (min), 12 (recommended), or 3/6/24 for bigger discounts.
      months: z.number().int().refine((m) => TERM_MONTHS.includes(m), 'invalid_term').default(1),
      // Optional admin promo code (a 'discount' code — % off and/or first months free).
      promoCode: z.string().max(40).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // Must have at least one linked creator id (any — need not match the repo).
    if (await p.creatorLink.count({ where: { userId: req.user.uid } }) === 0) return reply.code(403).send({ error: 'creator_link_required' });
    const cap = await capacityStatus(p);
    if (!cap.enabled) return reply.code(403).send({ error: 'hosting_disabled' });

    // Resolve the plan: an existing one, or a hidden plan minted from custom specs.
    let plan;
    if (b.data.custom) {
      const cu = b.data.custom;
      const s = await settings(p);
      plan = await p.hostingPlan.create({ data: {
        name: `Custom ${cu.storageGB}GB`, storageGB: cu.storageGB,
        uploadLimitKbps: Math.round(cu.uploadMbps * 1024), cpuShare: cu.cpuShare,
        priceMonthlyCents: priceCents(s, cu.storageGB, cu.uploadMbps, cu.cpuShare), active: false,
      } });
    } else {
      plan = await p.hostingPlan.findUnique({ where: { id: b.data.planId } });
      if (!plan || !plan.active) return reply.code(404).send({ error: 'unknown_plan' });
    }
    // Refuse if provisioning this plan would eat into the reserved free margin.
    if (cap.allocatedGB + plan.storageGB > cap.usableGB) return reply.code(409).send({ error: 'capacity_full', freeGB: cap.freeGB });

    const siteUrl = process.env.SITE_URL || 'http://localhost';
    // Prepaid: charge the whole term once, with the capacity multiplier + term discount.
    const cf = capacityFactors(cap);
    const months = b.data.months;
    let total = termTotalCents(plan.priceMonthlyCents, months, cf.priceMult);

    // The plan itself (before any promo) already prices to zero — e.g. a small repo
    // fully within pricing.hostingFreeGB with no extra Mbps/CPU cost. Provision it
    // directly, the same way a free-hosting promo grant does, instead of routing a
    // $0 charge through Stripe (which wouldn't accept it below its own minimum).
    if (total <= 0 && !b.data.promoCode) {
      if (cap.freeTierCapEnabled && cap.freeTierUsedGB + plan.storageGB > cap.freeTierCapGB) return reply.code(409).send({ error: 'free_tier_full', freeTierFreeGB: cap.freeTierFreeGB });
      if (await hasFreeTierClaim(p, 'REPO', req.user.uid)) return reply.code(409).send({ error: 'free_tier_already_used' });
      const repo = await provisionHostedRepo(p, { userId: req.user.uid, plan, repoName: b.data.repoName, hostMode: b.data.mode, months });
      await recordFreeTierClaim(p, 'REPO', req.user.uid);
      await notify(p, req.user.uid, 'hosting_started', `Your hosted repo "${repo.name}" is provisioning — free tier, no charge.`);
      return { ok: true, free: true, repoId: repo.id };
    }

    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const customer = await ensureCustomer(p, sk, req.user.uid);
    // Optional discount promo: % off and/or first N months free (applied to the prepaid
    // total). A fully-free result is rejected here — use a free-hosting grant code for that.
    let promo = null; let promoLabel = '';
    if (b.data.promoCode) {
      const v = await validatePromo(p, b.data.promoCode, req.user.uid);
      if (v.error) return reply.code(400).send({ error: `promo_${v.error}` });
      if (v.promo.kind !== 'discount') return reply.code(400).send({ error: 'promo_not_discount' });
      if (v.promo.minMonths && months < v.promo.minMonths) return reply.code(400).send({ error: 'promo_min_months', minMonths: v.promo.minMonths });
      promo = v.promo;
      if (promo.percentOff) total = Math.round(total * (1 - promo.percentOff / 100));
      if (promo.freeMonths) total = Math.max(0, total - Math.round((termTotalCents(plan.priceMonthlyCents, months, cf.priceMult) / months) * promo.freeMonths));
      if (total < 50) return reply.code(400).send({ error: 'promo_makes_free', detail: 'This code makes it free — an admin should issue a free-hosting code instead.' });
      promoLabel = promo.percentOff ? ` · −${promo.percentOff}% (${promo.code})` : promo.freeMonths ? ` · ${promo.freeMonths}mo free (${promo.code})` : ` · ${promo.code}`;
    }
    const session = await sk.checkout.sessions.create({
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: {
        currency: 'usd', unit_amount: total,
        product_data: { name: `${plan.name} hosting — ${months} month${months > 1 ? 's' : ''}${TERM_DISCOUNT[months] ? ` (−${Math.round(TERM_DISCOUNT[months] * 100)}%)` : ''}${promoLabel}` },
      } }],
      metadata: { userId: req.user.uid, planId: plan.id, repoName: b.data.repoName, hostMode: b.data.mode, months: String(months), promoCode: promo?.code || '' },
      success_url: `${siteUrl}/dashboard?hosting=ok`,
      cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    });
    // Record the redemption atomically (same maxRedemptions race-guard as the
    // grant-code endpoint) — best-effort in the sense that a lost race here just
    // means the code shows as exhausted for this checkout; the Stripe session
    // this user already got still honours the discount they saw at checkout time.
    if (promo) await redeemPromoAtomic(p, promo.code, req.user.uid, async () => ({ detail: `discount at hosting checkout (${plan.name})` })).catch(() => {});
    return { url: session.url };
  });

  // ── Featured listing (paid promotion by duration) ──
  const featurePrice = (s, days) => Math.round(Number(s['pricing.featurePerDayCents'] ?? 50) * days);

  app.get('/hosting/feature-price', async (req) => {
    const s = await settings(await db());
    const days = Math.max(1, Math.min(365, Number(req.query?.days || 7)));
    return { days, priceCents: featurePrice(s, days) };
  });

  app.post('/repos/:id/feature/checkout', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ days: z.number().int().min(1).max(365) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    if (repo.ownerId !== req.user.uid && req.user.role === 'USER') return reply.code(403).send({ error: 'forbidden' });
    const s = await settings(p);
    const amount = featurePrice(s, b.data.days);
    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const customer = await ensureCustomer(p, sk, req.user.uid);
    const siteUrl = process.env.SITE_URL || 'http://localhost';
    const session = await sk.checkout.sessions.create({
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, product_data: { name: `Feature "${repo.name}" for ${b.data.days} days` } } }],
      metadata: { type: 'feature', userId: req.user.uid, repoId: repo.id, days: String(b.data.days) },
      success_url: `${siteUrl}/dashboard?feature=ok`,
      cancel_url: `${siteUrl}/dashboard?feature=cancel`,
    });
    return { url: session.url };
  });

  // ── Stripe customer portal: manage subscriptions, cards, download receipts ──
  app.post('/me/billing/portal', { preHandler: requireRole() }, async (req, reply) => {
    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid } });
    if (!u?.stripeCustomerId) return reply.code(400).send({ error: 'no_customer' });
    const siteUrl = process.env.SITE_URL || 'http://localhost';
    const session = await sk.billingPortal.sessions.create({ customer: u.stripeCustomerId, return_url: `${siteUrl}/dashboard` });
    return { url: session.url };
  });

  // ── Billing history / invoices ──
  app.get('/me/payments', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    return { payments: await p.payment.findMany({ where: { userId: req.user.uid }, orderBy: { createdAt: 'desc' } }) };
  });

  app.get('/me/payments/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const pay = await p.payment.findUnique({ where: { id: req.params.id } });
    if (!pay || pay.userId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    const user = await p.user.findUnique({ where: { id: pay.userId }, select: { email: true, displayName: true } });
    return { invoice: { ...pay, user, number: `BCW-${pay.id.slice(-8).toUpperCase()}` } };
  });
}
