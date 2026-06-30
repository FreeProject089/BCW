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
    const b = z.object({ planId: z.string(), repoName: z.string().min(2).max(60) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cap = await capacityStatus(p);
    if (!cap.enabled) return reply.code(403).send({ error: 'hosting_disabled' });
    const plan = await p.hostingPlan.findUnique({ where: { id: b.data.planId } });
    if (!plan || !plan.active) return reply.code(404).send({ error: 'unknown_plan' });
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

  // Push an update to a hosted repo. The ONLY requirement is a valid SHA (integrity).
  app.post('/repos/:id/push', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ sha: z.string().regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i), sizeBytes: z.number().int().nonnegative().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_sha' });
    const p = await db();
    const repo = await p.serverRepo.findUnique({ where: { id: req.params.id } });
    if (!repo) return reply.code(404).send({ error: 'not_found' });
    if (repo.ownerId !== req.user.uid && req.user.role === 'USER') return reply.code(403).send({ error: 'forbidden' });
    if (b.data.sizeBytes != null && BigInt(b.data.sizeBytes) > repo.storageQuotaBytes) return reply.code(413).send({ error: 'quota_exceeded' });
    await p.serverRepo.update({ where: { id: repo.id }, data: b.data.sizeBytes != null ? { storageUsedBytes: BigInt(b.data.sizeBytes) } : {} });
    return { ok: true, sha: b.data.sha };
  });
}
