import { db, notify } from '../lib.mjs';

const GiB = 1024 ** 3;

// Encapsulated plugin: a raw-body JSON parser scoped here only, so Stripe's
// signature can be verified against the exact bytes (the rest of the API keeps
// normal JSON parsing).
export default async function stripeWebhook(app) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.post('/hosting/webhook', async (req, reply) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const sk = process.env.STRIPE_SECRET_KEY ? (await import('stripe')).default : null;
    if (!sk || !secret) return reply.code(503).send({ error: 'stripe_not_configured' });
    const stripe = new sk(process.env.STRIPE_SECRET_KEY);

    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret); }
    catch (e) { return reply.code(400).send({ error: 'bad_signature', detail: String(e.message) }); }

    const p = await db();
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const meta = s.metadata || {};

      // Paid feature promotion: extend the repo's featuredUntil + record an invoice.
      if (meta.type === 'feature' && meta.repoId && meta.userId) {
        const days = Number(meta.days || 7);
        const repo = await p.serverRepo.findUnique({ where: { id: meta.repoId } });
        if (repo) {
          const base = repo.featuredUntil && repo.featuredUntil > new Date() ? repo.featuredUntil : new Date();
          const until = new Date(base.getTime() + days * 864e5);
          await p.serverRepo.update({ where: { id: repo.id }, data: { featuredUntil: until } });
          await p.payment.create({ data: {
            userId: meta.userId, serverRepoId: repo.id, kind: 'FEATURE',
            description: `Featured listing — "${repo.name}" (${days} days)`,
            amountCents: s.amount_total ?? 0, currency: s.currency || 'usd', days, stripeSessionId: s.id,
          } });
          await notify(p, meta.userId, 'feature_active', `"${repo.name}" is now featured until ${until.toDateString()}.`);
        }
        return { received: true };
      }

      const { userId, planId, repoName } = meta;
      const plan = await p.hostingPlan.findUnique({ where: { id: planId } });
      if (plan && userId) {
        // Provision the repo (status PROVISIONING — the provisioner brings it ONLINE).
        const repo = await p.serverRepo.create({ data: {
          ownerId: userId, name: repoName || 'repo', hosted: true, status: 'PROVISIONING',
          storageQuotaBytes: BigInt(plan.storageGB) * BigInt(GiB),
          uploadLimitKbps: plan.uploadLimitKbps, cpuShare: plan.cpuShare,
        } });
        await p.subscription.create({ data: {
          userId, serverRepoId: repo.id, planId: plan.id,
          stripeSubId: s.subscription || null, status: 'active',
        } });
        await notify(p, userId, 'hosting_started', `Your hosted repo "${repo.name}" is being provisioned.`);
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = await p.subscription.findUnique({ where: { stripeSubId: event.data.object.id } });
      if (sub) {
        await p.subscription.update({ where: { id: sub.id }, data: { status: 'canceled' } });
        await p.serverRepo.update({ where: { id: sub.serverRepoId }, data: { status: 'SUSPENDED' } });
      }
    }
    return { received: true };
  });
}
