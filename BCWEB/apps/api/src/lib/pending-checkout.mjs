// The PendingCheckout ledger — one row per Stripe Checkout the DB knows is in flight.
//
// A deliberately DEPENDENCY-FREE leaf: it is imported by every route that opens a checkout
// session (marketplace, hosting, repos, catalog, charity, myo, bot, showcase-requests) and by
// the webhook, and it in turn imports nothing of theirs. That is what keeps the reconciler —
// which DOES import the webhook's big handler — from closing an import cycle back through here.
//
// The row is written the instant a session is created; the webhook flips it to `delivered`
// when it provisions, or `failed` when Stripe expires the session. Its whole reason to exist
// is the crash case: the webhook never ran, so a row would otherwise sit at `pending` for ever
// with nobody watching. lib/stripe-reconcile.mjs walks the stale ones and finishes them.

/**
 * Record an in-flight checkout. Idempotent on the session id (a resent create is a no-op) and
 * never throws for the ordinary duplicate — recording MUST NOT be able to fail a checkout, so
 * every caller awaits it after the session exists and swallows the rest.
 *
 * @param p         the Prisma client
 * @param kind      the checkout's metadata.type (marketplace, cart, charity, feature, …)
 * @param sessionId the Stripe checkout session id
 * @param userId    the buyer, when there is one (charity allows anonymous)
 * @param payload   the checkout metadata, kept verbatim for a human triaging a stuck row
 */
export async function recordPendingCheckout(p, { kind, sessionId, userId = null, payload = null }) {
  if (!sessionId) return null;
  try {
    return await p.pendingCheckout.create({
      data: { kind: String(kind || 'unknown'), sessionId, userId: userId || null, payload: payload || {}, status: 'pending' },
    });
  } catch (e) {
    // P2002 = the unique sessionId already has a row: this session is already tracked, which is
    // exactly what we wanted. Anything else is real and worth surfacing to the caller's catch.
    if (e?.code === 'P2002') return null;
    throw e;
  }
}

/**
 * What a buyer's return page is allowed to learn about its checkout: has the webhook delivered
 * it yet? READ-ONLY — the one invariant this module exists to protect is that nothing on the
 * Checkout return path can grant a product. It reads the ledger and the purchase row; it never
 * writes either.
 *
 * Ownership: the ledger row's userId must be the caller (a session id in a URL is a weak
 * secret, and the purchase row carries the key). A row with no ledger entry — a session
 * opened before the ledger existed — falls back to the purchase row's buyer, still the caller.
 *
 * @returns null when nothing is known about the session for this user; otherwise
 *   { status: 'pending' | 'paid' | 'delivered' | 'failed', purchase? } — `purchase` is
 *   { id, name, delivery } once delivered (the same shape /marketplace/my-purchases shows).
 */
export async function purchaseStatusForSession(p, { sessionId, userId }) {
  if (!sessionId || !userId) return null;
  const [row, purchase] = await Promise.all([
    p.pendingCheckout.findUnique({ where: { sessionId } }).catch(() => null),
    p.projectProductPurchase.findUnique({ where: { checkoutSessionId: sessionId }, include: { product: { select: { name: true, redeemUrl: true, redeemNote: true } } } }).catch(() => null),
  ]);
  if (row && row.userId && row.userId !== userId) return null;
  if (!row && (!purchase || purchase.buyerId !== userId)) return null;
  if (purchase && purchase.buyerId === userId) {
    // The purchase row is the truth: it exists only because the webhook (or its replay) ran.
    return { status: 'delivered', purchase: { id: purchase.id, name: purchase.product?.name || null, status: purchase.status, delivery: purchase.delivery, redeemUrl: purchase.product?.redeemUrl || null, redeemNote: purchase.product?.redeemNote || null } };
  }
  // No purchase yet: the ledger says whether it is still in flight or already dead. A ledger
  // row that reads `delivered` with no purchase row is a non-marketplace kind or a delivery
  // that failed after the row was claimed — report it as pending rather than lie either way.
  const st = row?.status === 'failed' ? 'failed' : row?.status === 'paid' ? 'paid' : 'pending';
  return { status: st };
}

/**
 * Keep the ledger in step with a Stripe event the webhook just handled, so the reconciler does
 * not re-open a session the live webhook already finished. Best-effort and status-guarded:
 *
 *   completed / async_payment_succeeded, money settled → delivered
 *   completed but NOT settled (a delayed bank debit)   → paid-but-uncleared, kept as `pending`
 *                                                         (a distinct `paid` step so a reader
 *                                                         can tell "awaiting clearance" apart)
 *   expired / async_payment_failed                     → failed
 *
 * A row that is already `delivered` is never walked back — the guards keep an out-of-order
 * event (a late `expired` after a manual capture, say) from un-delivering a real sale.
 */
export async function syncPendingFromEvent(p, event) {
  const t = event?.type;
  const s = event?.data?.object;
  if (!s?.id) return;
  const settled = (st) => !st || st === 'paid' || st === 'no_payment_required';
  if (t === 'checkout.session.completed' || t === 'checkout.session.async_payment_succeeded') {
    if (settled(s.payment_status)) {
      await p.pendingCheckout.updateMany({ where: { sessionId: s.id, status: { in: ['pending', 'paid'] } }, data: { status: 'delivered' } }).catch(() => {});
    } else {
      // Completed but the money has not cleared yet: mark it `paid` (a misnomer kept for the
      // column's small vocabulary — it means "checkout done, clearance pending") so it is not
      // mistaken for abandoned, and the async_payment_succeeded event will flip it to delivered.
      await p.pendingCheckout.updateMany({ where: { sessionId: s.id, status: 'pending' }, data: { status: 'paid' } }).catch(() => {});
    }
  } else if (t === 'checkout.session.expired' || t === 'checkout.session.async_payment_failed') {
    await p.pendingCheckout.updateMany({ where: { sessionId: s.id, status: { in: ['pending', 'paid'] } }, data: { status: 'failed' } }).catch(() => {});
  }
}
