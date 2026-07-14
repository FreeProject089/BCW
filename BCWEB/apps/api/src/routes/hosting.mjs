import { z } from 'zod';
import { statfsSync } from 'node:fs';
import { db, requireRole, notify, hasFreeTierClaim, recordFreeTierClaim } from '../lib/lib.mjs';
import { validatePromo, redeemPromoAtomic } from './promo.mjs';
import { getActiveCampaign } from './campaigns.mjs';

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

// Live on-disk size of the SEPARATE BMM telemetry Postgres, cached briefly so the
// capacity overview (polled on every admin visit) doesn't open a cross-DB connection
// each time. Returns null when TELEMETRY_DATABASE_URL isn't configured or the query fails.
let _teleSizeCache = { gb: null, at: 0 };
async function telemetryUsedGB() {
  if (Date.now() - _teleSizeCache.at < 30_000) return _teleSizeCache.gb;
  let gb = null;
  try {
    const { telemetryDb } = await import('./server-control.mjs');
    const pool = telemetryDb();
    if (pool) {
      const { rows } = await pool.query('SELECT pg_database_size(current_database())::bigint AS bytes');
      gb = Number(rows[0]?.bytes || 0) / GiB;
    }
  } catch { gb = null; }
  _teleSizeCache = { gb, at: Date.now() };
  return gb;
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
  const [hostedAgg, publishedAgg, tempAgg, rejectedAgg] = await Promise.all([
    p.serverRepo.aggregate({ where: { hosted: true }, _sum: { storageQuotaBytes: true } }),
    // Approved submissions — their payload now counts as permanent site content.
    p.catalogItem.aggregate({ where: { payloadKey: { not: null }, status: 'PUBLISHED' }, _sum: { payloadSize: true } }),
    // Only PENDING submissions occupy the dedicated temp margin — approved/rejected
    // items must not keep blocking new uploads forever (the original bug: this used
    // to sum every payloadKey regardless of status, so approved work never "left").
    p.catalogItem.aggregate({ where: { payloadKey: { not: null }, status: 'PENDING' }, _sum: { payloadSize: true } }),
    // Rejected payloads still in their purge grace — they occupy real bytes too, so
    // surface them (they leave the margin once the sweeper purges them).
    p.catalogItem.aggregate({ where: { payloadKey: { not: null }, status: 'REJECTED', payloadPurgeAt: { not: null } }, _sum: { payloadSize: true } }),
  ]);
  const hostingAllocatedGB = Number(hostedAgg._sum.storageQuotaBytes || 0n) / GiB;
  const submissionsPublishedGB = Number(publishedAgg._sum.payloadSize || 0) / GiB;
  const allocatedGB = hostingAllocatedGB + submissionsPublishedGB;
  const usableGB = Math.max(0, totalGB - reservedGB);
  const tempMarginGB = Number(s['hosting.tempMarginGB'] ?? 20);
  const tempPendingGB = Number(tempAgg._sum.payloadSize || 0) / GiB;
  const tempRejectedGB = Number(rejectedAgg._sum.payloadSize || 0) / GiB;
  const tempUsedGB = tempPendingGB + tempRejectedGB;
  const disk = realDiskStats();

  // Free-tier pool: storage provisioned through the actual $0 Free plan ONLY —
  // tracked by the explicit freePlan provenance flag set at checkout. Admin-provisioned
  // and promo-granted repos do NOT count (the old heuristic "no HOSTING Payment on
  // file" wrongly counted them — a 70 GB admin repo filled a 10 GB pool on its own).
  // Free multi pools count by poolBytes (splitting a pool across repos can't inflate
  // the number); solo free repos count by their own quota.
  const freeTierCapEnabled = !!s['hosting.freeTierCapEnabled'];
  let freeTierUsedGB = 0;
  if (freeTierCapEnabled) {
    const [freeGroups, freeSoloRepos] = await Promise.all([
      p.hostingGroup.aggregate({ where: { freePlan: true }, _sum: { poolBytes: true } }),
      p.serverRepo.aggregate({ where: { hosted: true, freePlan: true, groupId: null }, _sum: { storageQuotaBytes: true } }),
    ]);
    freeTierUsedGB = (Number(freeGroups._sum.poolBytes || 0n) + Number(freeSoloRepos._sum.storageQuotaBytes || 0n)) / GiB;
  }
  const freeTierCapGB = Number(s['hosting.freeTierCapGB'] ?? 50);

  // BMM telemetry storage (separate Postgres): live used vs. an admin-set allocation.
  const telemetryLimitGB = Number(s['telemetry.storageLimitGB'] ?? 0);
  const telemetryUsed = await telemetryUsedGB();

  return {
    totalGB, reservedGB, usableGB, allocatedGB, hostingAllocatedGB, submissionsPublishedGB,
    freeGB: Math.max(0, usableGB - allocatedGB), tempMarginGB, tempUsedGB, tempPendingGB, tempRejectedGB,
    diskTotalGB: disk.totalBytes != null ? disk.totalBytes / GiB : null,
    diskFreeGB: disk.freeBytes != null ? disk.freeBytes / GiB : null,
    enabled: s['features.hostingEnabled'] !== false,
    freeTierCapEnabled, freeTierCapGB, freeTierUsedGB,
    freeTierFreeGB: freeTierCapEnabled ? Math.max(0, freeTierCapGB - freeTierUsedGB) : null,
    telemetryLimitGB, telemetryUsedGB: telemetryUsed,
    telemetryFreeGB: telemetryLimitGB > 0 && telemetryUsed != null ? Math.max(0, telemetryLimitGB - telemetryUsed) : null,
    // Admin-set hard ceilings on what a single repo may request (capacityFactors clamps
    // its scarcity-based caps to these; checkout/resize enforce them).
    maxCpuShareCap: Number(s['hosting.maxCpuShare'] ?? 8),
    maxUploadMbpsCap: Number(s['hosting.maxUploadMbps'] ?? 1000),
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

// Shared by the checkout webhook AND the free-tier (no-Stripe) path below, so a $0
// "custom" plan and a paid one are provisioned identically. A purchase now buys an
// empty STORAGE POOL — the subscription anchors to the pool, and the owner fills it with
// repos and/or catalogs afterward (no forced first repo). Returns the created pool.
export async function provisionHostingPool(p, { userId, plan, poolName, months, stripeSubId = null, freePlan = false }) {
  const group = await p.hostingGroup.create({ data: {
    ownerId: userId, name: poolName || 'pool', poolBytes: BigInt(plan.storageGB) * BigInt(GiB),
    uploadLimitKbps: plan.uploadLimitKbps, cpuShare: plan.cpuShare, freePlan,
  } });
  await p.subscription.create({ data: {
    userId, hostingGroupId: group.id, planId: plan.id, stripeSubId, status: 'active',
    currentPeriodEnd: new Date(Date.now() + months * 30 * 864e5),
  } });
  return group;
}

// Prepaid term options: more months → bigger discount (1yr recommended).
export const TERM_MONTHS = [1, 3, 6, 12, 24];
const TERM_DISCOUNT = { 1: 0, 3: 0.05, 6: 0.10, 12: 0.20, 24: 0.35 };
// Scarcity: as allocated storage nears usable capacity, prices rise slightly and the
// per-repo CPU / upload caps offered to new customers tighten.
export function capacityFactors(cap) {
  const fill = cap.usableGB ? Math.min(1, cap.allocatedGB / cap.usableGB) : 0;
  const priceMult = fill < 0.6 ? 1 : +(1 + (fill - 0.6) * 0.9).toFixed(3); // up to ~1.36x when full
  // Scarcity caps, then clamped to the admin-set hard ceilings (hosting.maxUploadMbps /
  // hosting.maxCpuShare, surfaced via capacityStatus).
  const maxUploadMbps = Math.min(fill > 0.9 ? 100 : fill > 0.75 ? 250 : 1000, cap.maxUploadMbpsCap ?? 1000);
  const maxCpuShare = Math.min(fill > 0.9 ? 1 : fill > 0.75 ? 2 : 8, cap.maxCpuShareCap ?? 8);
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

  // Admin: what exactly occupies the Free-plan pool — every freePlan allocation
  // (pools by poolBytes, solo repos by quota) with its owner. Feeds the clickable
  // breakdown under the Free-plan gauge so the number is never a black box again.
  app.get('/admin/hosting/free-pool', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const [groups, soloRepos] = await Promise.all([
      p.hostingGroup.findMany({ where: { freePlan: true }, include: { owner: { select: { displayName: true, email: true } }, repos: { select: { name: true } } } }),
      p.serverRepo.findMany({ where: { hosted: true, freePlan: true, groupId: null }, include: { owner: { select: { displayName: true, email: true } } } }),
    ]);
    return { entries: [
      ...groups.map((g) => ({ id: g.id, type: 'pool', name: g.name, gb: Number(g.poolBytes) / GiB, owner: g.owner.displayName, email: g.owner.email, repoCount: g.repos.length, createdAt: g.createdAt })),
      ...soloRepos.map((r) => ({ id: r.id, type: 'repo', name: r.name, gb: Number(r.storageQuotaBytes) / GiB, owner: r.owner.displayName, email: r.owner.email, createdAt: r.createdAt })),
    ].sort((a, b) => b.gb - a.gb) };
  });

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
      // Custom plan: user picks their own size / upload. CPU is no longer a product
      // dimension — a fixed default share is applied server-side.
      custom: z.object({ storageGB: z.number().int().min(1).max(500), uploadMbps: z.number().min(1).max(1000), cpuShare: z.number().min(0.1).max(8).optional() }).optional(),
      // Prepaid term (months): 1 (min), 12 (recommended), or 3/6/24 for bigger discounts.
      months: z.number().int().refine((m) => TERM_MONTHS.includes(m), 'invalid_term').default(1),
      // Optional admin promo code (a 'discount' code — % off and/or first months free).
      promoCode: z.string().max(40).optional(),
      // Auto-renew: bill recurrently every `months` (a real Stripe subscription) so
      // the repo never lapses. Falls back to a one-time prepaid charge when off, when
      // a promo is used (a one-off discount can't recur cleanly), or for terms over
      // 12 months (Stripe caps a billing interval at 1 year).
      autoRenew: z.boolean().default(true),
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
      const cpuShare = cu.cpuShare ?? 0.5; // fixed default — CPU isn't user-selectable anymore
      // Enforce the admin upload ceiling server-side (the UI clamps too, but never trust it).
      const cf0 = capacityFactors(cap);
      if (cu.uploadMbps > cf0.maxUploadMbps) {
        return reply.code(409).send({ error: 'over_limit', maxUploadMbps: cf0.maxUploadMbps });
      }
      const s = await settings(p);
      plan = await p.hostingPlan.create({ data: {
        name: `Custom ${cu.storageGB}GB`, storageGB: cu.storageGB,
        uploadLimitKbps: Math.round(cu.uploadMbps * 1024), cpuShare,
        priceMonthlyCents: priceCents(s, cu.storageGB, cu.uploadMbps, cpuShare), active: false,
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
      const group = await provisionHostingPool(p, { userId: req.user.uid, plan, poolName: b.data.repoName, months, freePlan: true });
      await recordFreeTierClaim(p, 'REPO', req.user.uid);
      await notify(p, req.user.uid, 'hosting_started', `Your storage pool "${group.name}" is ready — free tier, no charge. Add repos or catalogs to it.`);
      return { ok: true, free: true, groupId: group.id };
    }

    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const customer = await ensureCustomer(p, sk, req.user.uid);
    // Site-wide promo CAMPAIGN — an auto-applied discount (no code) live right now. It
    // stacks with a personal discount code below; a campaign only ever DISCOUNTS (never
    // makes it free — that's what free-hosting grant codes are for), so we floor the
    // charge at Stripe's minimum further down.
    const camp = await getActiveCampaign(p);
    let campaignLabel = '';
    if (camp && (camp.appliesTo === 'all' || camp.appliesTo === 'hosting')) {
      total = Math.round(total * (1 - camp.percentOff / 100));
      campaignLabel = ` · −${camp.percentOff}% ${camp.kind === 'black_friday' ? 'Black Friday' : 'sale'}`;
    }
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
    // A campaign is a one-time sale: floor it at Stripe's minimum (never free) since
    // the code path above only rejects sub-minimum totals when an actual code is used.
    if (campaignLabel && total < 50) total = 50;
    // Recurring only when opted in, no one-off promo, no one-off campaign discount, and
    // the term fits Stripe's 1-year max interval. Otherwise a one-time prepaid charge.
    const recurring = b.data.autoRenew && !promo && !campaignLabel && months <= 12;
    const md = { userId: req.user.uid, planId: plan.id, repoName: b.data.repoName, hostMode: b.data.mode, months: String(months), promoCode: promo?.code || '' };
    const productName = `${plan.name} hosting — ${recurring ? `auto-renews every ${months} month${months > 1 ? 's' : ''}` : `${months} month${months > 1 ? 's' : ''}`}${TERM_DISCOUNT[months] ? ` (−${Math.round(TERM_DISCOUNT[months] * 100)}%)` : ''}${campaignLabel}${promoLabel}`;
    const session = await sk.checkout.sessions.create(recurring ? {
      mode: 'subscription', customer,
      line_items: [{ quantity: 1, price_data: {
        currency: 'usd', unit_amount: total,
        recurring: { interval: 'month', interval_count: months },
        product_data: { name: productName },
      } }],
      // Metadata on BOTH the session (first provision via checkout.session.completed)
      // and the subscription (so invoice.paid renewals can be attributed).
      subscription_data: { metadata: md },
      metadata: md,
      success_url: `${siteUrl}/dashboard?hosting=ok`,
      cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    } : {
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: {
        currency: 'usd', unit_amount: total,
        product_data: { name: productName },
      } }],
      // Generate a REAL Stripe invoice (with hosted page + PDF) for one-time
      // payments too, so Billing can offer the genuine Stripe invoice/receipt.
      invoice_creation: { enabled: true },
      metadata: md,
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
    const b = z.object({ days: z.number().int().min(1).max(365), autoRenew: z.boolean().default(false) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    if (repo.ownerId !== req.user.uid && req.user.role === 'USER') return reply.code(403).send({ error: 'forbidden' });
    const s = await settings(p);
    let amount = featurePrice(s, b.data.days);
    // Site-wide campaign discount (appliesTo all|boost) — one-time, floored at Stripe's min.
    const camp = await getActiveCampaign(p);
    let campLabel = '';
    if (camp && (camp.appliesTo === 'all' || camp.appliesTo === 'boost')) {
      amount = Math.max(50, Math.round(amount * (1 - camp.percentOff / 100)));
      campLabel = ` · −${camp.percentOff}% ${camp.kind === 'black_friday' ? 'Black Friday' : 'sale'}`;
    }
    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const customer = await ensureCustomer(p, sk, req.user.uid);
    const siteUrl = process.env.SITE_URL || 'http://localhost';
    const md = { type: 'feature', userId: req.user.uid, repoId: repo.id, days: String(b.data.days) };
    // A campaign discount forces a one-time charge so the sale never recurs.
    const recurring = b.data.autoRenew && !campLabel;
    // Auto-renew → a recurring subscription that re-extends featuredUntil every
    // `days` (Stripe caps a billing interval at 365 days, which is our max anyway).
    const session = await sk.checkout.sessions.create(recurring ? {
      mode: 'subscription', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, recurring: { interval: 'day', interval_count: b.data.days }, product_data: { name: `Feature "${repo.name}" — auto-renews every ${b.data.days} days` } } }],
      subscription_data: { metadata: md },
      metadata: md,
      success_url: `${siteUrl}/dashboard?feature=ok`,
      cancel_url: `${siteUrl}/dashboard?feature=cancel`,
    } : {
      mode: 'payment', customer,
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, product_data: { name: `Feature "${repo.name}" for ${b.data.days} days${campLabel}` } } }],
      invoice_creation: { enabled: true },
      metadata: md,
      success_url: `${siteUrl}/dashboard?feature=ok`,
      cancel_url: `${siteUrl}/dashboard?feature=cancel`,
    });
    return { url: session.url };
  });

  // ── Hosting shopping cart ──
  // Buy several repos + boosts in ONE prepaid checkout. One-time only (mode:'payment')
  // because Stripe forbids mixing one-time and recurring in a single session; auto-renew
  // stays available on the per-item Renew/Boost flows. `quote` prices the cart live
  // (incl. validating/combining promo codes); `checkout` opens Stripe. Multiple promo
  // codes are allowed only when EVERY code is `stackable`; a non-stackable code must be
  // used alone. Discount codes only (free-hosting/boost grants are redeemed separately).
  const cartItemSchema = z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('hosting'), mode: z.enum(['single', 'multi']).default('single'), repoName: z.string().min(2).max(60),
      months: z.number().int().refine((m) => TERM_MONTHS.includes(m), 'invalid_term').default(1),
      autoRenew: z.boolean().optional(),
      planId: z.string().optional(),
      custom: z.object({ storageGB: z.number().int().min(1).max(500), uploadMbps: z.number().min(1).max(1000) }).optional() }),
    z.object({ kind: z.literal('boost'), repoId: z.string(), days: z.number().int().min(1).max(365), autoRenew: z.boolean().optional() }),
  ])).min(1).max(20);

  // Resolve a cart to priced lines + combined discount. `persistPlans` = create the
  // custom hidden plan rows (checkout) vs. price them in memory (quote, no rows).
  async function resolveCart(p, req, data, { persistPlans }) {
    const cap = await capacityStatus(p);
    if (!cap.enabled) return { error: 'hosting_disabled' };
    const cf = capacityFactors(cap);
    const s = await settings(p);
    const featurePriceFn = (days) => Math.round(Number(s['pricing.featurePerDayCents'] ?? 50) * days);
    const lines = []; let neededStorageGB = 0;
    for (const it of data.items) {
      if (it.kind === 'hosting') {
        let plan;
        if (it.custom) {
          if (it.custom.uploadMbps > cf.maxUploadMbps) return { error: 'over_limit', maxUploadMbps: cf.maxUploadMbps };
          const planData = { name: `Custom ${it.custom.storageGB}GB`, storageGB: it.custom.storageGB, uploadLimitKbps: Math.round(it.custom.uploadMbps * 1024), cpuShare: 0.5, priceMonthlyCents: priceCents(s, it.custom.storageGB, it.custom.uploadMbps, 0.5), active: false };
          plan = persistPlans ? await p.hostingPlan.create({ data: planData }) : { id: null, ...planData };
        } else {
          plan = await p.hostingPlan.findUnique({ where: { id: it.planId } });
          if (!plan || !plan.active) return { error: 'unknown_plan' };
        }
        neededStorageGB += plan.storageGB;
        const baseCents = termTotalCents(plan.priceMonthlyCents, it.months, cf.priceMult);
        // Clean, human line name — just the plan, no internal jargon.
        const moLabel = `${it.months} month${it.months > 1 ? 's' : ''}`;
        const lineName = it.custom
          ? `Custom ${it.custom.storageGB}GB ${it.custom.uploadMbps}Mbps · ${moLabel}`
          : `${plan.storageGB}GB hosting · ${moLabel}`;
        lines.push({ kind: 'hosting', name: lineName, baseCents, monthlyCents: Math.round(baseCents / it.months), months: it.months, planId: plan.id, repoName: it.repoName, mode: it.mode, autoRenew: !!it.autoRenew });
      } else {
        const repo = await p.serverRepo.findUnique({ where: { id: it.repoId }, select: { id: true, name: true, ownerId: true } });
        if (!repo || repo.ownerId !== req.user.uid) return { error: 'boost_repo_not_found' };
        lines.push({ kind: 'boost', name: `Boost "${repo.name}" — ${it.days} d`, baseCents: featurePriceFn(it.days), monthlyCents: 0, months: 0, repoId: repo.id, days: it.days, autoRenew: !!it.autoRenew });
      }
    }
    if (cap.allocatedGB + neededStorageGB > cap.usableGB) return { error: 'capacity_full', freeGB: cap.freeGB };

    // Promo codes (discount kind only). Stacking rule enforced here.
    let combinedPct = 0, freeMonths = 0, minMonthsReq = 0; const appliedCodes = [];
    const uniq = [...new Set((data.promoCodes || []).map((c) => c.trim().toUpperCase()).filter(Boolean))];
    if (uniq.length) {
      const resolved = [];
      for (const code of uniq) {
        const v = await validatePromo(p, code, req.user.uid);
        if (v.error) return { error: `promo_${v.error}`, code };
        if (v.promo.kind !== 'discount') return { error: 'promo_not_discount', code };
        resolved.push(v.promo);
      }
      if (resolved.length > 1 && !resolved.every((r) => r.stackable)) return { error: 'promo_not_stackable' };
      for (const r of resolved) { if (r.percentOff) combinedPct += r.percentOff; if (r.freeMonths) freeMonths = Math.max(freeMonths, r.freeMonths); if (r.minMonths) minMonthsReq = Math.max(minMonthsReq, r.minMonths); appliedCodes.push(r.code); }
      combinedPct = Math.min(90, combinedPct);
      if (minMonthsReq && lines.some((l) => l.kind === 'hosting' && l.months < minMonthsReq)) return { error: 'promo_min_months', minMonths: minMonthsReq };
    }
    let subtotal = 0, total = 0;
    for (const l of lines) {
      let c = l.baseCents;
      if (l.kind === 'hosting' && freeMonths) c = Math.max(0, c - l.monthlyCents * freeMonths);
      if (combinedPct) c = Math.round(c * (1 - combinedPct / 100));
      l.finalCents = c; subtotal += l.baseCents; total += c;
    }
    return { lines, subtotal, total, discount: subtotal - total, combinedPct, freeMonths, appliedCodes };
  }

  app.post('/hosting/cart/quote', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ items: cartItemSchema, promoCodes: z.array(z.string().max(40)).max(10).default([]) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await resolveCart(p, req, b.data, { persistPlans: false });
    if (r.error) return reply.code(r.error.startsWith('promo_') ? 400 : 409).send(r);
    return { lines: r.lines.map((l) => ({ name: l.name, baseCents: l.baseCents, finalCents: l.finalCents, kind: l.kind })), subtotalCents: r.subtotal, discountCents: r.discount, totalCents: r.total, appliedCodes: r.appliedCodes, combinedPct: r.combinedPct, freeMonths: r.freeMonths };
  });

  app.post('/hosting/cart/checkout', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ items: cartItemSchema, promoCodes: z.array(z.string().max(40)).max(10).default([]), acceptedTerms: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    // Must accept the Terms + Payments policy to pay (recorded on the account).
    if (!b.data.acceptedTerms) return reply.code(400).send({ error: 'terms_not_accepted' });
    const p = await db();
    await p.user.update({ where: { id: req.user.uid }, data: { termsAcceptedAt: new Date() } }).catch(() => {});
    if (await p.creatorLink.count({ where: { userId: req.user.uid } }) === 0) return reply.code(403).send({ error: 'creator_link_required' });
    const r = await resolveCart(p, req, b.data, { persistPlans: true });
    if (r.error) return reply.code(r.error.startsWith('promo_') ? 400 : 409).send(r);
    if (r.total < 50) return reply.code(400).send({ error: 'cart_makes_free', detail: 'Total is free/too low — use a free-hosting grant code, or add paid items.' });
    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const customer = await ensureCustomer(p, sk, req.user.uid);
    const siteUrl = process.env.SITE_URL || 'http://localhost';
    const cart = await p.pendingCart.create({ data: { userId: req.user.uid, payload: { items: r.lines, promoCodes: r.appliedCodes } } });
    const suffix = (r.combinedPct || r.freeMonths) ? ` (${[r.combinedPct ? `−${r.combinedPct}%` : null, r.freeMonths ? `${r.freeMonths}mo free` : null].filter(Boolean).join(', ')})` : '';
    // If any hosting line opted into auto-renew, save the card off-session so the
    // webhook can start each such repo's subscription (anchored at its prepaid term end).
    const wantsRenew = r.lines.some((l) => l.autoRenew);
    const session = await sk.checkout.sessions.create({
      mode: 'payment', customer,
      line_items: r.lines.map((l) => ({ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.max(0, l.finalCents), product_data: { name: `${l.name}${suffix}` } } })).filter((li) => li.price_data.unit_amount > 0),
      invoice_creation: { enabled: true },
      ...(wantsRenew ? { payment_intent_data: { setup_future_usage: 'off_session' } } : {}),
      metadata: { type: 'cart', cartId: cart.id, userId: req.user.uid },
      success_url: `${siteUrl}/dashboard?hosting=ok`,
      cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    });
    // Promo redemption happens in the webhook AFTER payment succeeds (not here) so an
    // abandoned cart doesn't burn a redemption.
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

  // Resolve the REAL Stripe invoice / receipt URLs for a payment on demand (no
  // schema storage — always reflects Stripe's current links). Works for both the
  // recurring-invoice path (stripeSessionId = in_…) and one-time checkout
  // (stripeSessionId = cs_…, now created with invoice_creation enabled).
  app.get('/me/payments/:id/stripe-link', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const pay = await p.payment.findUnique({ where: { id: req.params.id } });
    if (!pay || pay.userId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const sid = pay.stripeSessionId || '';
    try {
      let hosted = null, pdf = null, receipt = null;
      if (sid.startsWith('in_')) {
        const inv = await sk.invoices.retrieve(sid);
        hosted = inv.hosted_invoice_url; pdf = inv.invoice_pdf;
      } else if (sid.startsWith('cs_')) {
        const sess = await sk.checkout.sessions.retrieve(sid, { expand: ['invoice', 'payment_intent.latest_charge'] });
        const inv = sess.invoice;
        if (inv && typeof inv === 'object') { hosted = inv.hosted_invoice_url; pdf = inv.invoice_pdf; }
        const charge = sess.payment_intent?.latest_charge;
        if (charge && typeof charge === 'object') receipt = charge.receipt_url;
      }
      if (!hosted && !pdf && !receipt) return reply.code(404).send({ error: 'no_stripe_document' });
      return { hosted, pdf, receipt };
    } catch (e) {
      req.log?.warn?.({ err: e?.message }, 'stripe-link lookup failed');
      return reply.code(502).send({ error: 'stripe_lookup_failed' });
    }
  });

  // Billing overview: active Stripe subscriptions (recurring hosting + boosts) for
  // this customer, so the dashboard can show what actually renews vs. one-off
  // prepaid terms. Empty list when Stripe/customer isn't set up.
  app.get('/me/billing/overview', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid } });
    const sk = await stripe();
    if (!sk || !u?.stripeCustomerId) return { subscriptions: [] };
    try {
      const subs = await sk.subscriptions.list({ customer: u.stripeCustomerId, status: 'all', limit: 20 });
      const active = subs.data.filter((s) => ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status));
      // Resolve the repo each subscription acts on so the UI can say "Hosting — my-repo".
      const repoIds = [...new Set(active.map((s) => s.metadata?.repoId).filter(Boolean))];
      const repos = repoIds.length ? await p.serverRepo.findMany({ where: { id: { in: repoIds } }, select: { id: true, name: true } }) : [];
      const repoName = Object.fromEntries(repos.map((r) => [r.id, r.name]));
      const list = active.map((s) => {
        const item = s.items?.data?.[0];
        const price = item?.price;
        const kind = s.metadata?.kind || (s.metadata?.repoId ? 'hosting' : 'subscription');
        return {
          id: s.id,
          status: s.status,
          kind,
          repoId: s.metadata?.repoId || null,
          repoName: s.metadata?.repoId ? (repoName[s.metadata.repoId] || null) : null,
          target: kind === 'feature' || kind === 'boost' ? 'boost' : 'hosting',
          amountCents: price?.unit_amount ?? 0,
          currency: price?.currency || 'usd',
          interval: price?.recurring?.interval || null,
          intervalCount: price?.recurring?.interval_count || 1,
          currentPeriodEnd: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
          trialEnd: s.trial_end ? new Date(s.trial_end * 1000).toISOString() : null,
          cancelAtPeriodEnd: !!s.cancel_at_period_end,
        };
      });
      return { subscriptions: list };
    } catch (e) {
      req.log?.warn?.({ err: e?.message }, 'billing overview failed');
      return { subscriptions: [] };
    }
  });

  // Cancel (stop auto-renew) or resume a subscription. Ownership is enforced by
  // checking the subscription belongs to THIS user's Stripe customer. Default cancels
  // at period end (keeps what's paid for); `resume:true` un-cancels.
  app.post('/me/subscriptions/:id/cancel', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ resume: z.boolean().optional() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid } });
    const sk = await stripe();
    if (!sk || !u?.stripeCustomerId) return reply.code(503).send({ error: 'stripe_not_configured' });
    try {
      const sub = await sk.subscriptions.retrieve(req.params.id);
      if (sub.customer !== u.stripeCustomerId) return reply.code(404).send({ error: 'not_found' });
      const updated = await sk.subscriptions.update(req.params.id, { cancel_at_period_end: !b.data.resume });
      // Keep the local mirror in step (best-effort — the webhook is the source of truth).
      if (sub.metadata?.repoId) await p.subscription.updateMany({ where: { stripeSubId: sub.id }, data: { status: b.data.resume ? 'active' : 'canceling' } }).catch(() => {});
      return { ok: true, cancelAtPeriodEnd: !!updated.cancel_at_period_end };
    } catch (e) {
      req.log?.warn?.({ err: e?.message }, 'subscription cancel failed');
      return reply.code(502).send({ error: 'stripe_error' });
    }
  });

  // Full invoice history from Stripe (covers one-time payments AND every recurring
  // subscription cycle) — the authoritative "payment history" with a real, downloadable
  // PDF per row. Falls back to empty when Stripe/customer isn't set up (the local
  // Payment ledger still renders in the UI).
  app.get('/me/invoices', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid } });
    const sk = await stripe();
    if (!sk || !u?.stripeCustomerId) return { invoices: [] };
    try {
      const inv = await sk.invoices.list({ customer: u.stripeCustomerId, limit: 100 });
      // Detect subscription invoices robustly across Stripe API versions — `invoice.subscription`
      // was removed in newer versions, so fall back to billing_reason and the line/parent links.
      const isRecurring = (i) => !!(i.subscription
        || (i.billing_reason && String(i.billing_reason).includes('subscription'))
        || i.lines?.data?.some((l) => l.subscription || l.parent?.subscription_item_details || l.type === 'subscription')
        || i.parent?.subscription_details?.subscription);
      const invoices = inv.data.map((i) => {
        const recurring = isRecurring(i);
        return {
          id: i.id,
          number: i.number || `BCW-${String(i.id).slice(-8).toUpperCase()}`,
          description: i.lines?.data?.[0]?.description || i.description || (recurring ? 'Subscription' : 'Payment'),
          lines: (i.lines?.data || []).map((l) => ({ description: l.description || 'Item', amountCents: l.amount ?? 0 })),
          amountCents: i.amount_paid ?? i.amount_due ?? i.total ?? 0,
          currency: i.currency || 'usd',
          status: i.status, // draft | open | paid | uncollectible | void
          recurring,
          created: i.created ? new Date(i.created * 1000).toISOString() : null,
          hosted: i.hosted_invoice_url || null,
          hasPdf: !!i.invoice_pdf,
        };
      // Drop $0 invoices: an auto-renew purchase makes Stripe emit a $0 "Trial period"
      // subscription invoice that masks the real prepaid charge in the history/modal.
      // Only invoices that actually moved money belong in a payment history.
      }).filter((i) => (i.status === 'paid' || i.status === 'open') && i.amountCents > 0);
      return { invoices };
    } catch (e) {
      req.log?.warn?.({ err: e?.message }, 'invoice list failed');
      return { invoices: [] };
    }
  });

  // Stream a Stripe invoice PDF straight through the API as an attachment — a REAL
  // download (correct filename, no redirect off-site), and ownership-checked against
  // the caller's Stripe customer so one user can't fetch another's invoice.
  app.get('/me/invoices/:id/pdf', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid } });
    const sk = await stripe();
    if (!sk || !u?.stripeCustomerId) return reply.code(503).send({ error: 'stripe_not_configured' });
    try {
      const inv = await sk.invoices.retrieve(req.params.id);
      if (inv.customer !== u.stripeCustomerId) return reply.code(404).send({ error: 'not_found' });
      if (!inv.invoice_pdf) return reply.code(404).send({ error: 'no_pdf' });
      const r = await fetch(inv.invoice_pdf);
      if (!r.ok) return reply.code(502).send({ error: 'pdf_fetch_failed' });
      const buf = Buffer.from(await r.arrayBuffer());
      const name = `invoice-${inv.number || inv.id}.pdf`;
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${name}"`);
      return reply.send(buf);
    } catch (e) {
      req.log?.warn?.({ err: e?.message }, 'invoice pdf stream failed');
      return reply.code(502).send({ error: 'stripe_lookup_failed' });
    }
  });
}
