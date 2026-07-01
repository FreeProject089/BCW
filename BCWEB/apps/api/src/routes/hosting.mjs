import { z } from 'zod';
import { db, requireRole } from '../lib.mjs';

const GiB = 1024 ** 3;
let _stripe = null;
async function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) { const Stripe = (await import('stripe')).default; _stripe = new Stripe(process.env.STRIPE_SECRET_KEY); }
  return _stripe;
}

async function settings(p) {
  return Object.fromEntries((await p.adminSetting.findMany()).map((r) => [r.key, r.value]));
}

/** Global storage capacity status. The host must always keep `reservedFreeGB` free. */
export async function capacityStatus(p) {
  const s = await settings(p);
  const totalGB = Number(s['hosting.totalCapacityGB'] ?? 0);
  const reservedGB = Number(s['hosting.reservedFreeGB'] ?? 0);
  const agg = await p.serverRepo.aggregate({ where: { hosted: true }, _sum: { storageQuotaBytes: true } });
  const allocatedGB = Number(agg._sum.storageQuotaBytes || 0n) / GiB;
  const usableGB = Math.max(0, totalGB - reservedGB);
  return { totalGB, reservedGB, usableGB, allocatedGB, freeGB: Math.max(0, usableGB - allocatedGB), enabled: s['features.hostingEnabled'] !== false };
}

/** Flexible price (cents/month) from the admin-tunable knobs. */
function priceCents(s, storageGB, uploadMbps, cpuShare) {
  return Math.round(Number(s['pricing.perGBCents'] ?? 0) * storageGB
    + Number(s['pricing.perUploadMbpsCents'] ?? 0) * uploadMbps
    + Number(s['pricing.perCpuShareCents'] ?? 0) * cpuShare);
}

export default async function hostingRoutes(app) {
  app.get('/hosting/plans', async () => {
    const p = await db();
    return { plans: await p.hostingPlan.findMany({ where: { active: true }, orderBy: { storageGB: 'asc' } }) };
  });

  app.get('/hosting/capacity', async () => ({ capacity: await capacityStatus(await db()) }));

  // Live price preview for arbitrary specs (used by the admin/pricing UI).
  app.get('/hosting/price', async (req) => {
    const p = await db();
    const s = await settings(p);
    const q = req.query || {};
    return { priceMonthlyCents: priceCents(s, Number(q.storageGB || 0), Number(q.uploadMbps || 0), Number(q.cpuShare || 0)) };
  });

  // Start a hosting subscription → Stripe Checkout. Capacity-guarded.
  app.post('/hosting/checkout', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      planId: z.string().optional(),
      repoName: z.string().min(2).max(60),
      // Custom plan: user picks their own size / upload / cpu.
      custom: z.object({ storageGB: z.number().int().min(1).max(500), uploadMbps: z.number().min(1).max(1000), cpuShare: z.number().min(0.1).max(8) }).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
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

    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const siteUrl = process.env.SITE_URL || 'http://localhost';
    const session = await sk.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ quantity: 1, price_data: {
        currency: 'usd', unit_amount: plan.priceMonthlyCents, recurring: { interval: 'month' },
        product_data: { name: `${plan.name} hosting` },
      } }],
      metadata: { userId: req.user.uid, planId: plan.id, repoName: b.data.repoName },
      success_url: `${siteUrl}/dashboard?hosting=ok`,
      cancel_url: `${siteUrl}/dashboard?hosting=cancel`,
    });
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
    const siteUrl = process.env.SITE_URL || 'http://localhost';
    const session = await sk.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amount, product_data: { name: `Feature "${repo.name}" for ${b.data.days} days` } } }],
      metadata: { type: 'feature', userId: req.user.uid, repoId: repo.id, days: String(b.data.days) },
      success_url: `${siteUrl}/dashboard?feature=ok`,
      cancel_url: `${siteUrl}/dashboard?feature=cancel`,
    });
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
