// Admin: the in-flight Stripe checkouts, and the button that finishes the stuck ones.
//
// Two routes, both behind manage_hosting — the capability that already covers plans, pools
// and billing grants ("Hosting & billing"), because a stuck payment is a billing incident and
// the person who handles those is the person who holds this. Neither route talks to a buyer;
// neither can take money. The POST calls the same reconciler the sweeper runs every ten
// minutes, with the same Stripe client, so pressing it early is the only thing it changes.
import { db, requireCap, logAudit } from '../lib/lib.mjs';
import { stripe } from './hosting.mjs';

export default async function paymentsAdminRoutes(app) {
  // The ledger, oldest open row first, with the most recent finished rows for context.
  app.get('/admin/payments/pending', { preHandler: requireCap('manage_hosting') }, async (req) => {
    const p = await db();
    const { listPendingCheckouts } = await import('../lib/stripe-reconcile.mjs');
    const limit = Math.min(500, Math.max(1, Number(req.query?.limit) || 100));
    return listPendingCheckouts(p, { limit });
  });

  // Run the reconciler now. `olderThanMin` defaults to the sweeper's 15 so a checkout the
  // buyer is still on is not chased; an admin who knows the endpoint was down can pass 0.
  app.post('/admin/payments/reconcile', { preHandler: requireCap('manage_hosting') }, async (req, reply) => {
    const p = await db();
    // The SERVICING client, deliberately not `forPurchase`: reconciling a payment that was
    // taken has to work after new sales are switched off.
    const sk = await stripe();
    if (!sk) return reply.code(503).send({ error: 'stripe_not_configured' });
    const { reconcilePendingCheckouts, DEFAULT_OLDER_THAN_MIN } = await import('../lib/stripe-reconcile.mjs');
    const raw = Number(req.body?.olderThanMin);
    const olderThanMin = Number.isFinite(raw) && raw >= 0 ? Math.min(raw, 24 * 60) : DEFAULT_OLDER_THAN_MIN;
    const summary = await reconcilePendingCheckouts(p, { stripe: sk, log: req.log, olderThanMin, limit: 500 });
    await logAudit(p, req.user.uid, 'payments.reconcile', `olderThanMin=${olderThanMin} scanned=${summary.scanned} delivered=${summary.delivered} failed=${summary.failed} errors=${summary.errors}`).catch(() => {});
    return { ok: true, olderThanMin, summary };
  });
}
