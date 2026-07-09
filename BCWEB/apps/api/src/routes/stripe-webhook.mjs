import { db, notify } from '../lib.mjs';
import { provisionHostedRepo } from './hosting.mjs';
import { redeemPromoAtomic } from './promo.mjs';

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

      // Shopping-cart checkout: provision every line (hosted repos + boosts), record a
      // Payment per line, redeem any applied promo codes, then drop the PendingCart.
      if (meta.type === 'cart' && meta.cartId) {
        const cart = await p.pendingCart.findUnique({ where: { id: meta.cartId } });
        if (cart && cart.userId === meta.userId) {
          const { items = [], promoCodes = [] } = cart.payload || {};
          let provisioned = 0;
          // Saved card (present only when a line opted into auto-renew — the session
          // was created with setup_future_usage: off_session).
          let savedPm = null;
          if (items.some((l) => l.kind === 'hosting' && l.autoRenew) && s.payment_intent) {
            try { const pi = typeof s.payment_intent === 'string' ? await stripe.paymentIntents.retrieve(s.payment_intent) : s.payment_intent; savedPm = pi?.payment_method || null; } catch {}
          }
          for (const l of items) {
            try {
              if (l.kind === 'hosting') {
                const plan = l.planId ? await p.hostingPlan.findUnique({ where: { id: l.planId } }) : null;
                if (!plan) continue;
                const repo = await provisionHostedRepo(p, { userId: cart.userId, plan, repoName: l.repoName, hostMode: l.mode, months: l.months });
                await p.payment.create({ data: { userId: cart.userId, serverRepoId: repo.id, kind: 'HOSTING', description: `${plan.name} hosting — ${l.months} month${l.months > 1 ? 's' : ''}`, amountCents: l.finalCents ?? 0, currency: 'usd', stripeSessionId: s.id } });
                // Auto-renew: start a subscription that first bills at the prepaid
                // term end (trial_end), billed every `months` at the full term price.
                if (l.autoRenew && savedPm) {
                  try {
                    const trialEnd = Math.floor((Date.now() + l.months * 30 * 864e5) / 1000);
                    const price = await stripe.prices.create({ currency: 'usd', unit_amount: Math.max(50, l.baseCents || plan.priceMonthlyCents * l.months), recurring: { interval: 'month', interval_count: l.months }, product_data: { name: `${plan.name} hosting (auto-renew)` } });
                    const sub = await stripe.subscriptions.create({ customer: s.customer, items: [{ price: price.id }], default_payment_method: savedPm, trial_end: trialEnd, proration_behavior: 'none', metadata: { kind: 'hosting', repoId: repo.id, userId: cart.userId } });
                    await p.subscription.updateMany({ where: { serverRepoId: repo.id }, data: { stripeSubId: sub.id } });
                  } catch (e) { req.log?.warn?.({ err: e?.message }, 'cart auto-renew sub create failed'); }
                }
                provisioned++;
              } else if (l.kind === 'boost') {
                const repo = await p.serverRepo.findUnique({ where: { id: l.repoId } });
                if (!repo) continue;
                const base = repo.featuredUntil && repo.featuredUntil > new Date() ? repo.featuredUntil : new Date();
                const until = new Date(base.getTime() + l.days * 864e5);
                await p.serverRepo.update({ where: { id: repo.id }, data: { featuredUntil: until } });
                await p.payment.create({ data: { userId: cart.userId, serverRepoId: repo.id, kind: 'FEATURE', description: `Featured boost — "${repo.name}" (${l.days} days)`, amountCents: l.finalCents ?? 0, currency: 'usd', days: l.days, stripeSessionId: s.id } });
                provisioned++;
              }
            } catch (e) { req.log?.warn?.({ err: e?.message }, 'cart line provision failed'); }
          }
          for (const code of promoCodes) await redeemPromoAtomic(p, code, cart.userId, async () => ({ detail: 'cart checkout' })).catch(() => {});
          await p.pendingCart.delete({ where: { id: cart.id } }).catch(() => {});
          await notify(p, cart.userId, 'hosting_started', `Your order is being provisioned — ${provisioned} item${provisioned > 1 ? 's' : ''}.`);
        }
        return { received: true };
      }

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
      // When it's a recurring (auto-renew) boost, also track a FeatureSubscription so
      // invoice.paid can re-extend it each cycle.
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
          if (s.subscription) {
            await p.featureSubscription.upsert({
              where: { stripeSubId: s.subscription },
              create: { userId: meta.userId, serverRepoId: repo.id, stripeSubId: s.subscription, days, status: 'active', currentPeriodEnd: until },
              update: { status: 'active', days, currentPeriodEnd: until },
            });
          }
          await notify(p, meta.userId, 'feature_active', `"${repo.name}" is now featured until ${until.toDateString()}${s.subscription ? ' (auto-renews)' : ''}.`);
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
            // When this renewal is a real recurring subscription, persist its id so
            // invoice.paid 'subscription_cycle' events re-extend the right repo.
            update: { status: 'active', currentPeriodEnd, ...(s.subscription ? { stripeSubId: s.subscription } : {}) },
            create: { userId: meta.userId, serverRepoId: repo.id, status: 'active', currentPeriodEnd, stripeSubId: s.subscription || null,
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
    } else if (event.type === 'invoice.paid') {
      // Recurring HOSTING renewal. The FIRST invoice (billing_reason
      // 'subscription_create') is skipped — checkout.session.completed already
      // provisioned it. Only 'subscription_cycle' renewals land here.
      const inv = event.data.object;
      if (inv.billing_reason === 'subscription_cycle' && inv.subscription) {
        // A recurring FEATURE boost renewal → re-extend featuredUntil by its days.
        const fsub = await p.featureSubscription.findUnique({ where: { stripeSubId: inv.subscription } });
        if (fsub) {
          const repo = await p.serverRepo.findUnique({ where: { id: fsub.serverRepoId }, select: { name: true, ownerId: true, featuredUntil: true } });
          if (repo) {
            const base = repo.featuredUntil && repo.featuredUntil > new Date() ? repo.featuredUntil : new Date();
            const until = new Date(base.getTime() + fsub.days * 864e5);
            await p.serverRepo.update({ where: { id: fsub.serverRepoId }, data: { featuredUntil: until } });
            await p.featureSubscription.update({ where: { id: fsub.id }, data: { status: 'active', currentPeriodEnd: until } });
            await p.payment.create({ data: {
              userId: fsub.userId, serverRepoId: fsub.serverRepoId, kind: 'FEATURE',
              description: `Featured listing renewal — "${repo.name}" (${fsub.days} days)`,
              amountCents: inv.amount_paid ?? 0, currency: inv.currency || 'usd', days: fsub.days, stripeSessionId: inv.id,
            } });
            await notify(p, repo.ownerId, 'feature_active', `"${repo.name}" boost auto-renewed — featured until ${until.toDateString()}.`);
          }
          return { received: true };
        }
        const sub = await p.subscription.findUnique({ where: { stripeSubId: inv.subscription } });
        if (sub) {
          // Trust Stripe's own period for the new end date.
          const periodEnd = inv.lines?.data?.[0]?.period?.end ? new Date(inv.lines.data[0].period.end * 1000)
            : (inv.period_end ? new Date(inv.period_end * 1000) : new Date(Date.now() + 30 * 864e5));
          await p.subscription.update({ where: { id: sub.id }, data: { status: 'active', currentPeriodEnd: periodEnd } });
          const repo = await p.serverRepo.findUnique({ where: { id: sub.serverRepoId }, select: { name: true, ownerId: true, status: true } });
          // Restore a repo that a prior failed renewal had suspended.
          if (repo) await p.serverRepo.update({ where: { id: sub.serverRepoId }, data: { deleteAt: null, ...(repo.status === 'SUSPENDED' ? { status: 'ONLINE' } : {}) } });
          await p.payment.create({ data: {
            userId: sub.userId, serverRepoId: sub.serverRepoId, kind: 'HOSTING',
            description: `"${repo?.name || 'repo'}" auto-renewal`,
            amountCents: inv.amount_paid ?? 0, currency: inv.currency || 'usd', stripeSessionId: inv.id,
          } });
          if (repo) await notify(p, repo.ownerId, 'hosting_started', `"${repo.name}" auto-renewed successfully — thanks for staying with us!`);
        }
      }
    } else if (event.type === 'invoice.payment_failed') {
      // A recurring renewal charge failed. Stripe's dunning will retry; on final
      // failure customer.subscription.deleted fires (→ suspend, handled below). Here
      // we just warn the owner so they can fix their card in time.
      const inv = event.data.object;
      if (inv.subscription) {
        const sub = await p.subscription.findUnique({ where: { stripeSubId: inv.subscription } });
        if (sub) {
          const repo = await p.serverRepo.findUnique({ where: { id: sub.serverRepoId }, select: { name: true, ownerId: true } });
          if (repo) await notify(p, repo.ownerId, 'hosting_stopped', `Auto-renewal payment for "${repo.name}" failed — update your card in “Manage billing” soon, or hosting will be suspended.`);
        }
      }
    } else if (event.type === 'charge.refunded') {
      // A charge was (partially or fully) refunded. Record a lightweight refund
      // event for the Discord bot to announce (see bot.mjs /bot/payments/*). Keyed
      // by charge id + refunded amount so successive partial refunds are distinct.
      const c = event.data.object;
      const ev = {
        id: `${c.id}:${c.amount_refunded ?? 0}`,
        amountCents: c.amount_refunded ?? 0,
        currency: c.currency || 'usd',
        email: c.billing_details?.email || c.receipt_email || null,
        at: new Date().toISOString(),
      };
      const row = await p.adminSetting.findUnique({ where: { key: 'bot.refundEvents' } });
      const events = [...(row?.value?.events || []).filter((e) => e.id !== ev.id), ev].slice(-200);
      await p.adminSetting.upsert({ where: { key: 'bot.refundEvents' }, create: { key: 'bot.refundEvents', value: { events } }, update: { value: { events } } });
    } else if (event.type === 'customer.subscription.deleted') {
      const subId = event.data.object.id;
      // A cancelled/ended FEATURE boost: mark it so it stops renewing. The repo keeps
      // its current featuredUntil and simply lapses to normal when it passes — no
      // suspension (unlike hosting).
      const fsub = await p.featureSubscription.findUnique({ where: { stripeSubId: subId } });
      if (fsub) { await p.featureSubscription.update({ where: { id: fsub.id }, data: { status: 'canceled' } }); return { received: true }; }
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
