// Crash-during-payment reconciliation, with Stripe and the webhook handler both stubbed.
//
// What is under test is the DECISION per ledger row — paid → replay the handler once and say
// so loudly; expired → mark failed (and let the handler hand a held key back); already
// delivered → touch nothing but the ledger; delivered twice → shout. The handler itself is
// the real webhook code, tested elsewhere; here it is a spy so the test can count calls.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePendingCheckouts, listPendingCheckouts, DEFAULT_OLDER_THAN_MIN } from '../src/lib/stripe-reconcile.mjs';

const OLD = new Date(Date.now() - 60 * 60_000);

/** In-memory ledger + the alert sinks the reconciler writes to. */
function fakeDb({ ledger = [], purchaseCount = {}, paymentCount = {}, supers = ['sa_1'] } = {}) {
  const errorEvents = [];
  const notifications = [];
  const matchStatus = (row, where) => (where?.status?.in ? where.status.in.includes(row.status) : true);
  return {
    ledger, errorEvents, notifications,
    pendingCheckout: {
      findMany: async ({ where, take }) => ledger.filter((r) => matchStatus(r, where) && (!where.createdAt?.lt || r.createdAt < where.createdAt.lt)).slice(0, take),
      update: async ({ where, data }) => { const r = ledger.find((x) => x.id === where.id); Object.assign(r, data); return r; },
    },
    projectProductPurchase: { count: async ({ where }) => purchaseCount[where.checkoutSessionId] || 0 },
    payment: { count: async ({ where }) => paymentCount[where.stripeSessionId] || 0 },
    myoRequest: { count: async () => 0 },
    myoQuote: { count: async () => 0 },
    errorEvent: { create: async ({ data }) => { errorEvents.push(data); return data; } },
    user: {
      findMany: async () => supers.map((id) => ({ id })),
      findUnique: async () => ({ notifPrefs: null }),
    },
    notification: { create: async ({ data }) => { notifications.push(data); return data; } },
  };
}

/** A Stripe client that answers checkout.sessions.retrieve from a map. */
const fakeStripe = (sessions) => ({
  checkout: { sessions: { retrieve: async (id) => { if (!(id in sessions)) throw new Error(`No such checkout.session: ${id}`); return sessions[id]; } } },
});

const spy = () => { const calls = []; const fn = async (args) => { calls.push(args); }; fn.calls = calls; return fn; };
const row = (over) => ({ id: `pc_${over.sessionId}`, kind: 'marketplace', userId: 'u1', status: 'pending', createdAt: OLD, ...over });
const quiet = { warn() {}, info() {} };

describe('reconcilePendingCheckouts', () => {
  test('paid but undelivered: the handler is replayed exactly once and staff are told', async () => {
    const p = fakeDb({ ledger: [row({ sessionId: 'cs_paid' })] });
    const dispatch = spy();
    const r = await reconcilePendingCheckouts(p, { stripe: fakeStripe({ cs_paid: { id: 'cs_paid', status: 'complete', payment_status: 'paid', metadata: { type: 'marketplace' } } }), dispatch, log: quiet });
    assert.equal(r.delivered, 1);
    assert.equal(dispatch.calls.length, 1);
    assert.equal(dispatch.calls[0].event.type, 'checkout.session.completed');
    assert.equal(dispatch.calls[0].event.data.object.id, 'cs_paid');
    assert.equal(p.ledger[0].status, 'delivered');
    // The alert is the point: an endpoint that was down for an hour is invisible without it.
    assert.ok(p.errorEvents.some((e) => e.source === 'reconcile' && /paid-but-undelivered/.test(e.message)));
    assert.equal(p.notifications.length, 1, 'every SUPERADMIN is notified');
    assert.equal(p.notifications[0].kind, 'security_alert');
    // And a second run finds nothing to do.
    const again = await reconcilePendingCheckouts(p, { stripe: fakeStripe({}), dispatch, log: quiet });
    assert.equal(again.scanned, 0);
    assert.equal(dispatch.calls.length, 1);
  });

  test('a 100%-off session (no_payment_required) is settled and delivers', async () => {
    const p = fakeDb({ ledger: [row({ sessionId: 'cs_free' })] });
    const dispatch = spy();
    await reconcilePendingCheckouts(p, { stripe: fakeStripe({ cs_free: { id: 'cs_free', status: 'complete', payment_status: 'no_payment_required' } }), dispatch, log: quiet });
    assert.equal(dispatch.calls.length, 1);
    assert.equal(p.ledger[0].status, 'delivered');
  });

  test('expired: marked failed, the expiry branch replayed (held key back), nobody paged', async () => {
    const p = fakeDb({ ledger: [row({ sessionId: 'cs_exp' })] });
    const dispatch = spy();
    const r = await reconcilePendingCheckouts(p, { stripe: fakeStripe({ cs_exp: { id: 'cs_exp', status: 'expired', payment_status: 'unpaid' } }), dispatch, log: quiet });
    assert.equal(r.failed, 1);
    assert.equal(p.ledger[0].status, 'failed');
    assert.equal(dispatch.calls.length, 1);
    assert.equal(dispatch.calls[0].event.type, 'checkout.session.expired');
    assert.equal(p.notifications.length, 0);
  });

  test('already delivered by the live webhook: the handler is NOT replayed, the ledger is corrected, a quiet alert is left', async () => {
    const p = fakeDb({ ledger: [row({ sessionId: 'cs_done' })], purchaseCount: { cs_done: 1 } });
    const dispatch = spy();
    const r = await reconcilePendingCheckouts(p, { stripe: fakeStripe({ cs_done: { id: 'cs_done', status: 'complete', payment_status: 'paid' } }), dispatch, log: quiet });
    assert.equal(r.alreadyDelivered, 1);
    assert.equal(r.delivered, 0);
    assert.equal(dispatch.calls.length, 0, 'nothing to replay');
    assert.equal(p.ledger[0].status, 'delivered');
    assert.ok(p.errorEvents.some((e) => /ledger lag/.test(e.message)));
    assert.equal(p.notifications.length, 0, 'nobody was short-changed, so nobody is paged');
  });

  test('delivered twice: alert, page the super-admins, replay nothing', async () => {
    const p = fakeDb({ ledger: [row({ sessionId: 'cs_two' })], purchaseCount: { cs_two: 2 } });
    const dispatch = spy();
    const r = await reconcilePendingCheckouts(p, { stripe: fakeStripe({ cs_two: { id: 'cs_two', status: 'complete', payment_status: 'paid' } }), dispatch, log: quiet });
    assert.equal(dispatch.calls.length, 0);
    assert.equal(r.alerts, 1);
    assert.ok(p.errorEvents.some((e) => /DELIVERED TWICE/.test(e.message)));
    assert.equal(p.notifications.length, 1);
  });

  test('a hosting kind counts its Payment row as the delivery record', async () => {
    const p = fakeDb({ ledger: [row({ sessionId: 'cs_host', kind: 'cart' })], paymentCount: { cs_host: 3 } });
    const dispatch = spy();
    const r = await reconcilePendingCheckouts(p, { stripe: fakeStripe({ cs_host: { id: 'cs_host', status: 'complete', payment_status: 'paid' } }), dispatch, log: quiet });
    // Three Payment rows for a cart is three lines, not three deliveries: no "twice" alert.
    assert.equal(r.alreadyDelivered, 1);
    assert.equal(dispatch.calls.length, 0);
    assert.ok(!p.errorEvents.some((e) => /DELIVERED TWICE/.test(e.message)));
  });

  test('still open: left alone for a later run', async () => {
    const p = fakeDb({ ledger: [row({ sessionId: 'cs_open' })] });
    const dispatch = spy();
    const r = await reconcilePendingCheckouts(p, { stripe: fakeStripe({ cs_open: { id: 'cs_open', status: 'open', payment_status: 'unpaid' } }), dispatch, log: quiet });
    assert.equal(r.stillPending, 1);
    assert.equal(dispatch.calls.length, 0);
    assert.equal(p.ledger[0].status, 'pending');
  });

  test('a delayed payment method (complete, unpaid, one-off) is marked "paid" and waited for', async () => {
    const p = fakeDb({ ledger: [row({ sessionId: 'cs_slow' })] });
    const dispatch = spy();
    const r = await reconcilePendingCheckouts(p, { stripe: fakeStripe({ cs_slow: { id: 'cs_slow', status: 'complete', payment_status: 'unpaid', mode: 'payment' } }), dispatch, log: quiet });
    assert.equal(r.stillPending, 1);
    assert.equal(dispatch.calls.length, 0);
    assert.equal(p.ledger[0].status, 'paid');
  });

  test('a session Stripe does not know is counted and skipped, and the loop goes on', async () => {
    const p = fakeDb({ ledger: [row({ sessionId: 'cs_gone' }), row({ sessionId: 'cs_paid' })] });
    const dispatch = spy();
    const r = await reconcilePendingCheckouts(p, { stripe: fakeStripe({ cs_paid: { id: 'cs_paid', status: 'complete', payment_status: 'paid' } }), dispatch, log: quiet });
    assert.equal(r.errors, 1);
    assert.equal(r.delivered, 1);
    assert.equal(p.ledger[0].status, 'pending', 'the unknown one is left for a human');
  });

  test('a replay that throws is recorded as an error and paged, not retried in a loop', async () => {
    const p = fakeDb({ ledger: [row({ sessionId: 'cs_boom' })] });
    const dispatch = async () => { throw new Error('pool empty'); };
    const r = await reconcilePendingCheckouts(p, { stripe: fakeStripe({ cs_boom: { id: 'cs_boom', status: 'complete', payment_status: 'paid' } }), dispatch, log: quiet });
    assert.equal(r.errors, 1);
    assert.equal(r.delivered, 0);
    assert.equal(p.ledger[0].status, 'pending', 'still visible in the admin list');
    assert.ok(p.errorEvents.some((e) => /FAILED to deliver/.test(e.message) && /pool empty/.test(e.message)));
    assert.equal(p.notifications.length, 1);
  });

  test('only rows older than the threshold are chased', async () => {
    const fresh = row({ sessionId: 'cs_new', createdAt: new Date() });
    const p = fakeDb({ ledger: [fresh] });
    const dispatch = spy();
    const r = await reconcilePendingCheckouts(p, { stripe: fakeStripe({ cs_new: { id: 'cs_new', status: 'complete', payment_status: 'paid' } }), dispatch, log: quiet });
    assert.equal(r.scanned, 0, `default threshold is ${DEFAULT_OLDER_THAN_MIN} min`);
    const r0 = await reconcilePendingCheckouts(p, { stripe: fakeStripe({ cs_new: { id: 'cs_new', status: 'complete', payment_status: 'paid' } }), dispatch, log: quiet, olderThanMin: -1 });
    assert.equal(r0.scanned, 1);
  });

  test('no Stripe client: skipped, nothing touched', async () => {
    const p = fakeDb({ ledger: [row({ sessionId: 'cs_x' })] });
    const r = await reconcilePendingCheckouts(p, { stripe: null, dispatch: spy(), log: quiet });
    assert.equal(r.skipped, 'no_stripe');
    assert.equal(p.ledger[0].status, 'pending');
  });

  test('two overlapping runs in one process: the second yields', async () => {
    const p = fakeDb({ ledger: [row({ sessionId: 'cs_slowpaid' })] });
    let release;
    const gate = new Promise((res) => { release = res; });
    const stripe = { checkout: { sessions: { retrieve: async () => { await gate; return { id: 'cs_slowpaid', status: 'complete', payment_status: 'paid' }; } } } };
    const dispatch = spy();
    const first = reconcilePendingCheckouts(p, { stripe, dispatch, log: quiet });
    const second = await reconcilePendingCheckouts(p, { stripe, dispatch, log: quiet });
    assert.equal(second.skipped, 'busy');
    release();
    const r = await first;
    assert.equal(r.delivered, 1);
    assert.equal(dispatch.calls.length, 1, 'one delivery, not two');
  });
});

describe('listPendingCheckouts', () => {
  test('open rows oldest first, finished rows for context, ages in minutes', async () => {
    const ledger = [row({ sessionId: 'a', status: 'delivered', updatedAt: new Date() }), row({ sessionId: 'b' }), row({ sessionId: 'c', status: 'failed', updatedAt: new Date() })];
    const p = { pendingCheckout: { findMany: async ({ where, take }) => ledger.filter((r) => where.status.in.includes(r.status)).slice(0, take) } };
    const r = await listPendingCheckouts(p, { limit: 10 });
    assert.deepEqual(r.open.map((x) => x.sessionId), ['b']);
    assert.deepEqual(r.finished.map((x) => x.sessionId).sort(), ['a', 'c']);
    assert.ok(r.open[0].ageMin >= 59, String(r.open[0].ageMin));
    assert.ok(!('payload' in r.open[0]), 'the verbatim metadata stays out of the list');
  });
});
