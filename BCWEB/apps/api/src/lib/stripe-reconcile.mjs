// Crash-during-payment reconciliation for EVERY purchase kind.
//
// The webhook is the source of truth, and the truth has a gap: if the API was down when Stripe
// fired the event, or the endpoint was misconfigured, or the delivery threw halfway, the money
// left the buyer and nothing was provisioned — a "paid but not delivered" that makes no noise,
// because the thing that would have noticed is the thing that did not run.
//
// This walks the PendingCheckout ledger (a row per in-flight checkout, written at session
// creation by every route that opens one), asks Stripe what really happened to each stale one,
// and finishes exactly what the webhook would have — by REPLAYING the same handler
// (dispatchStripeEvent) against the session it fetched. One delivery path, not two; every
// branch's own idempotency (a UNIQUE checkoutSessionId, a `!consultationPaid` guard, a Set of
// unlocked ids, …) is what makes a replay safe when the webhook did, in fact, already deliver.
//
// It runs three ways: once at boot (finish anything a crash left behind), from the sweeper
// every ~10 min (steady-state catch-up), and on demand from POST /admin/payments/reconcile.
//
// Imported LAZILY by the sweeper and by server.mjs (a dynamic import inside the call), because
// this pulls in the webhook, which pulls in hosting.mjs, marketplace.mjs and promo.mjs — and
// hosting.mjs already has to dynamic-import the sweeper to avoid a cycle. A static import here
// would close that loop from the other side.
import { dispatchStripeEvent } from '../routes/stripe-webhook.mjs';

/** How old a pending row must be before we chase it, by default. New checkouts are given time
 *  for the webhook to land normally; only the ones that clearly stalled are reconciled. Boot
 *  passes 1 — a crash means finish now, not in fifteen minutes, but a checkout opened seconds
 *  ago is still the live webhook's to finish. */
export const DEFAULT_OLDER_THAN_MIN = 15;

/** The ledger statuses a row can hold; exported so the admin screen and the tests share it. */
export const PENDING_STATUSES = Object.freeze(['pending', 'paid', 'delivered', 'failed']);

/**
 * Record an admin-visible alert. The mechanism the webhook already uses for "paid but
 * undelivered" is an ErrorEvent row (source 'reconcile', readable on the admin Errors page and
 * grouped there by message); the serious cases also notify every SUPERADMIN through the
 * 'security_alert' notification kind lib.mjs uses for sensitive staff actions, because a
 * payment taken and not delivered is not something to find in a log a week later. Best-effort
 * throughout — an alert that fails must not fail a reconciliation that otherwise worked.
 */
async function raiseAlert(p, { message, notifySupers = false }) {
  await p.errorEvent.create({ data: { source: 'reconcile', message: String(message).slice(0, 500), stack: '', path: 'payments:reconcile' } }).catch(() => {});
  if (notifySupers) {
    try {
      const supers = await p.user.findMany({ where: { role: 'SUPERADMIN' }, select: { id: true } });
      const { notify } = await import('./lib.mjs');
      await Promise.all(supers.map((u) => notify(p, u.id, 'security_alert', String(message).slice(0, 400)).catch(() => {})));
    } catch { /* the alert failing must not fail the reconciliation */ }
  }
}

/**
 * Has this checkout ALREADY been provisioned, by the live webhook, before the ledger caught up?
 *
 * The ledger is updated after the handler and best-effort, so "webhook delivered, ledger still
 * pending" is a real (rare) state — the process died between the two writes, or the ledger
 * update itself failed. Replaying the handler would be safe (every branch is idempotent), but
 * it is a wasted Stripe round trip on the marketplace path and, worse, an alert saying the
 * webhook "had not provisioned it" when it had. So the kinds that keep a per-session record
 * are checked first. Returns the number of delivery records found (0 = not delivered, 1 =
 * delivered once, 2+ = delivered TWICE, which is the thing worth shouting about), or null when
 * the kind has no per-session record and only a replay can tell.
 */
async function deliveryCount(p, row) {
  try {
    if (row.kind === 'marketplace') return await p.projectProductPurchase.count({ where: { checkoutSessionId: row.sessionId } });
    if (row.kind === 'myo_consultation') return (await p.myoRequest.count({ where: { stripeSessionId: row.sessionId, consultationPaid: true } })) ? 1 : 0;
    if (row.kind === 'myo_quote') return (await p.myoQuote.count({ where: { stripeSessionId: row.sessionId, paidAt: { not: null } } })) ? 1 : 0;
    // Hosting kinds write a Payment row keyed by the session; a cart writes one per line, so
    // "more than one" is normal there and only marketplace is judged for double delivery.
    if (['hosting', 'cart', 'repo_upgrade', 'repo_renew', 'pool_renew', 'pool_consolidate', 'feature', 'catalog_hosting', 'catalog_hosting_update'].includes(row.kind)) {
      return (await p.payment.count({ where: { stripeSessionId: row.sessionId } })) ? 1 : 0;
    }
  } catch { /* an unknown model or a schema drift: fall through to "only a replay can tell" */ }
  return null;
}

/**
 * Reconcile stale pending checkouts.
 *
 * @param p        Prisma client
 * @param stripe   a Stripe client (the SERVICING one — never gated by the payments switch; a
 *                 reconciliation must run even after new sales are turned off). Null → skip.
 * @param log      logger
 * @param olderThanMin  only touch rows older than this (default 15; boot passes 1)
 * @param limit    cap per run, so a backlog is chipped at rather than swallowed whole
 * @param dispatch the webhook handler to replay (defaults to the real one; a test stubs it)
 * @returns a summary { scanned, delivered, alreadyDelivered, failed, stillPending, alerts, errors }
 */
let running = false;
export async function reconcilePendingCheckouts(p, { stripe, log = console, olderThanMin = DEFAULT_OLDER_THAN_MIN, limit = 200, dispatch = dispatchStripeEvent } = {}) {
  const summary = { scanned: 0, delivered: 0, alreadyDelivered: 0, failed: 0, stillPending: 0, alerts: 0, errors: 0 };
  if (!stripe) return { ...summary, skipped: 'no_stripe' };
  // One run at a time per process: boot fires one, the sweeper's first tick fires another a
  // moment later, and an admin can press the button during either. Every branch is idempotent,
  // so overlapping runs would not double-deliver — they would double-ALERT, which is the noise
  // that gets a real alert ignored. (Across replicas the sweeper's own lock does this.)
  if (running) return { ...summary, skipped: 'busy' };
  running = true;
  try { return await reconcileLocked(p, summary, { stripe, log, olderThanMin, limit, dispatch }); }
  finally { running = false; }
}

async function reconcileLocked(p, summary, { stripe, log, olderThanMin, limit, dispatch }) {
  const cutoff = new Date(Date.now() - olderThanMin * 60_000);
  const rows = await p.pendingCheckout.findMany({
    where: { status: { in: ['pending', 'paid'] }, createdAt: { lt: cutoff } },
    orderBy: { createdAt: 'asc' }, take: limit,
  }).catch(() => []);

  for (const row of rows) {
    summary.scanned++;
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(row.sessionId);
    } catch (e) {
      // A session id Stripe does not know (a fixture, a wrong key, a deleted test session) must
      // not wedge the loop. Count it and move on; a persistently unretrievable row is visible
      // in GET /admin/payments/pending for a human to judge.
      summary.errors++;
      log?.warn?.({ e: String(e?.message || e), sessionId: row.sessionId }, 'reconcile: session retrieve failed');
      continue;
    }

    const status = session?.status;            // open | complete | expired
    const payStatus = session?.payment_status; // paid | unpaid | no_payment_required
    const settled = status === 'complete' && (payStatus === 'paid' || payStatus === 'no_payment_required');

    if (settled) {
      const n = await deliveryCount(p, row);
      if (n != null && n > 1) {
        // Impossible by construction for marketplace (UNIQUE checkoutSessionId) — which is
        // exactly why a second row is checked rather than assumed away: if the constraint ever
        // failed, this is the only thing that would say so.
        await raiseAlert(p, { message: `DELIVERED TWICE: ${row.kind} session ${row.sessionId} has ${n} delivery records`, notifySupers: true });
        summary.alerts++;
        await p.pendingCheckout.update({ where: { id: row.id }, data: { status: 'delivered' } }).catch(() => {});
        summary.alreadyDelivered++;
        continue;
      }
      if (n === 1) {
        // The live webhook delivered; only the ledger lagged. Nothing to replay — mark it and
        // say so quietly (an ErrorEvent, no SUPERADMIN ping: nobody was short-changed).
        await p.pendingCheckout.update({ where: { id: row.id }, data: { status: 'delivered' } }).catch(() => {});
        await raiseAlert(p, { message: `ledger lag: ${row.kind} session ${row.sessionId} was delivered by the webhook but the ledger still read '${row.status}' — corrected`, notifySupers: false });
        summary.alerts++;
        summary.alreadyDelivered++;
        continue;
      }
      // Paid, and either provably undelivered (n === 0) or unknowable without replaying
      // (n === null). Replay the webhook handler against the session Stripe returned — the
      // replay is what fixes it; the alert is what makes a human aware it was ever broken (an
      // endpoint down for an hour is invisible without this).
      try {
        await dispatch({ p, stripe, event: { id: `reconcile_${row.sessionId}`, type: 'checkout.session.completed', data: { object: session } }, log });
        await p.pendingCheckout.update({ where: { id: row.id }, data: { status: 'delivered' } }).catch(() => {});
        summary.delivered++;
        await raiseAlert(p, { message: `reconcile finished a paid-but-undelivered checkout: ${row.kind} session ${row.sessionId} (user ${row.userId || 'n/a'}) — the live webhook had not provisioned it`, notifySupers: true });
        summary.alerts++;
      } catch (e) {
        summary.errors++;
        log?.warn?.({ e: String(e?.message || e), sessionId: row.sessionId, kind: row.kind }, 'reconcile: replay delivery failed');
        await raiseAlert(p, { message: `reconcile FAILED to deliver paid checkout: ${row.kind} session ${row.sessionId} — ${String(e?.message || e).slice(0, 160)}`, notifySupers: true });
        summary.alerts++;
      }
    } else if (status === 'expired' || (status === 'complete' && payStatus === 'unpaid' && session?.mode !== 'payment')) {
      // Stripe expired it (the buyer never paid, or abandoned it). Mark it failed so it stops
      // being chased. Replaying the webhook's own `checkout.session.expired` branch hands a
      // held marketplace pool key back — the same code the live event would have run.
      try { await dispatch({ p, stripe, event: { id: `reconcile_${row.sessionId}`, type: 'checkout.session.expired', data: { object: session } }, log }); }
      catch (e) { log?.warn?.({ e: String(e?.message || e), sessionId: row.sessionId }, 'reconcile: expiry replay failed'); }
      await p.pendingCheckout.update({ where: { id: row.id }, data: { status: 'failed' } }).catch(() => {});
      summary.failed++;
    } else {
      // Still open (not paid, not expired) — the buyer is presumably still on Stripe's page, or
      // an async payment has not cleared. Leave it; a later run, or Stripe's own expiry, resolves
      // it. Only the ledger age brought it here, so this is the ordinary "give it more time".
      // A completed-but-unpaid one-off session is the delayed-method case: mark it `paid` (the
      // ledger's "checkout done, clearance pending") so a reader can tell it from abandoned.
      if (status === 'complete' && row.status === 'pending') {
        await p.pendingCheckout.update({ where: { id: row.id }, data: { status: 'paid' } }).catch(() => {});
      }
      summary.stillPending++;
    }
  }

  if (summary.delivered || summary.alreadyDelivered || summary.failed || summary.errors) {
    log?.info?.(summary, 'reconcile: pending checkouts');
  }
  return summary;
}

/**
 * The rows an admin sees on GET /admin/payments/pending: everything not yet finished, oldest
 * first, plus the most recent finished ones for context. Read-only.
 */
export async function listPendingCheckouts(p, { limit = 100, includeFinished = true } = {}) {
  const open = await p.pendingCheckout.findMany({ where: { status: { in: ['pending', 'paid'] } }, orderBy: { createdAt: 'asc' }, take: limit });
  const finished = includeFinished
    ? await p.pendingCheckout.findMany({ where: { status: { in: ['delivered', 'failed'] } }, orderBy: { updatedAt: 'desc' }, take: Math.min(50, limit) })
    : [];
  const ser = (r) => ({ id: r.id, kind: r.kind, sessionId: r.sessionId, userId: r.userId, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, ageMin: Math.round((Date.now() - new Date(r.createdAt).getTime()) / 60_000) });
  return { open: open.map(ser), finished: finished.map(ser) };
}
