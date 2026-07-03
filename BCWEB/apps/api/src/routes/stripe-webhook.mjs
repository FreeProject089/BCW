import { db, notify } from '../lib.mjs';
import { provisionHostedRepo } from './hosting.mjs';

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

      // Paid catalog-file hosting: clear the unpaid flag, queue for moderation, record.
      // This is a real RECURRING Stripe subscription (billed monthly by file size) —
      // stash its id so `customer.subscription.deleted` can find and unpublish the
      // item again if the recurring charge ever stops being paid.
      if (meta.type === 'catalog_hosting' && meta.itemId && meta.userId) {
        const item = await p.catalogItem.findUnique({ where: { id: meta.itemId } });
        if (item) {
          const { _hostingUnpaid, ...m } = item.meta || {};
          if (s.subscription) m._hostingSubId = s.subscription;
          await p.catalogItem.update({ where: { id: item.id }, data: { meta: m } });
          await p.submission.create({ data: { itemId: item.id, ownerId: meta.userId, type: 'NEW', status: 'PENDING' } });
          await p.payment.create({ data: {
            userId: meta.userId, kind: 'HOSTING', description: `Catalog hosting — "${item.name}"`,
            amountCents: s.amount_total ?? 0, currency: s.currency || 'usd', stripeSessionId: s.id,
          } });
          await notify(p, meta.userId, 'hosting_started', `Hosting for "${item.name}" is active — it's now in the moderation queue.`);
        }
        return { received: true };
      }

      // Paid re-upload on an EXISTING item: commit the held-pending payload now that
      // it's paid for, and queue the change for moderation (mirrors the create-time
      // catalog_hosting flow, but for an edit instead of a brand new submission).
      if (meta.type === 'catalog_hosting_update' && meta.itemId && meta.userId) {
        const item = await p.catalogItem.findUnique({ where: { id: meta.itemId } });
        if (item?.meta?._pendingPayloadKey) {
          const { _pendingPayloadKey, _pendingPayloadSize, ...m } = item.meta;
          // Re-uploads mint a brand new recurring subscription priced for the new
          // file size — cancel the old one so the item isn't billed twice.
          const oldSubId = item.meta._hostingSubId;
          if (oldSubId && oldSubId !== s.subscription) await stripe.subscriptions.cancel(oldSubId).catch(() => {});
          if (s.subscription) m._hostingSubId = s.subscription;
          await p.catalogItem.update({ where: { id: item.id }, data: { payloadKey: _pendingPayloadKey, payloadSize: _pendingPayloadSize || 0, meta: m } });
          await p.submission.create({ data: { itemId: item.id, ownerId: meta.userId, type: 'UPDATE', status: 'PENDING' } });
          await p.payment.create({ data: {
            userId: meta.userId, kind: 'HOSTING', description: `Catalog hosting update — "${item.name}"`,
            amountCents: s.amount_total ?? 0, currency: s.currency || 'usd', stripeSessionId: s.id,
          } });
          await notify(p, meta.userId, 'hosting_started', `Updated file for "${item.name}" is active — it's now in the moderation queue.`);
        }
        return { received: true };
      }

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

      // Paid repo upgrade: raise an EXISTING repo's quota/limits in place — never
      // creates a new repo or a second storage grant for the same physical space.
      if (meta.type === 'repo_upgrade' && meta.repoId && meta.userId && meta.planId) {
        const plan = await p.hostingPlan.findUnique({ where: { id: meta.planId } });
        const repo = await p.serverRepo.findUnique({ where: { id: meta.repoId } });
        if (plan && repo) {
          const months = Number(meta.months || 1);
          await p.serverRepo.update({ where: { id: repo.id }, data: {
            storageQuotaBytes: BigInt(plan.storageGB) * BigInt(1024 ** 3),
            uploadLimitKbps: plan.uploadLimitKbps, cpuShare: plan.cpuShare,
          } });
          // upsert, not create — every hosted repo already has a Subscription row
          // (serverRepoId is @unique), so a plain create() threw here every time.
          await p.subscription.upsert({
            where: { serverRepoId: repo.id },
            create: { userId: meta.userId, serverRepoId: repo.id, planId: plan.id, stripeSubId: s.subscription || null, status: 'active', currentPeriodEnd: new Date(Date.now() + months * 30 * 864e5) },
            update: { planId: plan.id, stripeSubId: s.subscription || null, status: 'active', currentPeriodEnd: new Date(Date.now() + months * 30 * 864e5) },
          });
          await p.payment.create({ data: {
            userId: meta.userId, serverRepoId: repo.id, kind: 'HOSTING',
            description: `"${repo.name}" upgrade → ${plan.storageGB}GB`,
            amountCents: s.amount_total ?? 0, currency: s.currency || 'usd', stripeSessionId: s.id,
          } });
          await notify(p, meta.userId, 'hosting_started', `"${repo.name}" upgraded to ${plan.storageGB} GB.`);
        }
        return { received: true };
      }

      // Paid repo renewal — same size/speed/CPU, just extends currentPeriodEnd.
      // Also the "resume payment" path: clears any pending 72h deleteAt and restores
      // ONLINE if the sweeper had already suspended it for a lapsed term.
      if (meta.type === 'repo_renew' && meta.repoId && meta.userId) {
        const repo = await p.serverRepo.findUnique({ where: { id: meta.repoId } });
        if (repo) {
          const months = Number(meta.months || 1);
          const currentPeriodEnd = new Date(Date.now() + months * 30 * 864e5);
          await p.serverRepo.update({ where: { id: repo.id }, data: { deleteAt: null, status: repo.status === 'SUSPENDED' ? 'ONLINE' : repo.status } });
          await p.subscription.upsert({
            where: { serverRepoId: repo.id },
            update: { status: 'active', currentPeriodEnd },
            create: { userId: meta.userId, serverRepoId: repo.id, status: 'active', currentPeriodEnd,
              planId: (await p.hostingPlan.create({ data: { name: `Custom ${Number(repo.storageQuotaBytes) / (1024 ** 3)}GB (renewal)`, storageGB: Number(repo.storageQuotaBytes) / (1024 ** 3), uploadLimitKbps: repo.uploadLimitKbps, cpuShare: repo.cpuShare, priceMonthlyCents: 0, active: false } })).id },
          });
          await p.payment.create({ data: {
            userId: meta.userId, serverRepoId: repo.id, kind: 'HOSTING',
            description: `"${repo.name}" renewal — ${months} month${months > 1 ? 's' : ''}`,
            amountCents: s.amount_total ?? 0, currency: s.currency || 'usd', stripeSessionId: s.id,
          } });
          await notify(p, meta.userId, 'hosting_started', `"${repo.name}" renewed for ${months} month${months > 1 ? 's' : ''}.`);
        }
        return { received: true };
      }

      const { userId, planId, repoName, hostMode } = meta;
      const plan = await p.hostingPlan.findUnique({ where: { id: planId } });
      if (plan && userId) {
        const months = Number(meta.months || 1);
        // Provision the (first) repo — status PROVISIONING; the provisioner brings it ONLINE.
        const repo = await provisionHostedRepo(p, { userId, plan, repoName, hostMode, months, stripeSubId: s.subscription || null });
        await notify(p, userId, 'hosting_started', `Your hosted repo "${repo.name}" is provisioning — prepaid for ${months} month${months > 1 ? 's' : ''}.`);
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subId = event.data.object.id;
      const sub = await p.subscription.findUnique({ where: { stripeSubId: subId } });
      if (sub) {
        await p.subscription.update({ where: { id: sub.id }, data: { status: 'canceled' } });
        await p.serverRepo.update({ where: { id: sub.serverRepoId }, data: { status: 'SUSPENDED' } });
      } else {
        // Not a repo subscription — check for a recurring catalog-file-hosting
        // subscription (payment failed after retries, or the user cancelled it in
        // the Stripe portal). Pull the file back out of the public catalog and
        // re-flag it unpaid so a fresh checkout resumes hosting.
        const item = await p.catalogItem.findFirst({ where: { meta: { path: ['_hostingSubId'], equals: subId } } });
        if (item) {
          const { _hostingSubId, ...m } = item.meta;
          await p.catalogItem.update({ where: { id: item.id }, data: { status: 'HIDDEN', meta: { ...m, _hostingUnpaid: true } } });
          await notify(p, item.ownerId, 'hosting_stopped', `Hosting for "${item.name}" has stopped (subscription ended) — it's hidden until you resume payment.`);
        }
      }
    }
    return { received: true };
  });
}
