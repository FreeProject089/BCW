// The marketplace delivery branch of the Stripe webhook, replayed — with the database faked.
//
// webhook.test.mjs signs real events through the whole Fastify route and needs Postgres, so
// it skips on a machine without one, which is most of them. This exercises the extracted
// handler (dispatchStripeEvent) against an in-memory Prisma stand-in, which is enough to
// prove the two properties the return-page and the reconciler rely on:
//
//   the same session delivered twice creates ONE purchase and counts ONE sale
//   a completed-but-unpaid session delivers NOTHING until the money clears
//
// Env is set before the import: the module reads nothing at load, but the test is explicit
// that no real Stripe key is ever in play here.
process.env.STRIPE_SECRET_KEY ||= 'sk_test_dummy';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchStripeEvent } from '../src/routes/stripe-webhook.mjs';

const PRODUCT = { id: 'prod_1', name: 'Pro licence', active: true, priceCents: 1500, currency: 'usd', deliveryKind: 'content', content: 'THE-SECRET', billing: 'one_time', intervalMonths: 1, feePercentBp: 1000, sold: 0, stock: null };

function fakeDb() {
  const purchases = [];
  const notifications = [];
  const errorEvents = [];
  const product = { ...PRODUCT };
  return {
    purchases, notifications, errorEvents, product,
    projectProduct: {
      findUnique: async ({ where }) => (where.id === product.id ? { ...product } : null),
      update: async ({ data }) => { if (data.sold?.increment) product.sold += data.sold.increment; return { ...product }; },
    },
    projectProductPurchase: {
      create: async ({ data }) => {
        if (purchases.some((r) => r.checkoutSessionId === data.checkoutSessionId)) { const e = new Error('Unique constraint failed on the fields: (`checkoutSessionId`)'); e.code = 'P2002'; throw e; }
        const r = { id: `pur_${purchases.length + 1}`, ...data }; purchases.push(r); return r;
      },
      update: async ({ where, data }) => { const r = purchases.find((x) => x.id === where.id); Object.assign(r, data); return r; },
    },
    adminSetting: { findUnique: async () => null },
    user: { findUnique: async () => ({ notifPrefs: null }) },
    notification: { create: async ({ data }) => { notifications.push(data); return data; } },
    errorEvent: { create: async ({ data }) => { errorEvents.push(data); return data; } },
    pendingCheckout: { updateMany: async () => ({ count: 0 }) },
  };
}

const stripeStub = { refunds: { create: async () => { throw new Error('no refunds in a unit test'); } } };
const quiet = { warn() {}, info() {} };
const session = (over = {}) => ({ id: 'cs_test_1', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_test_1', amount_total: 1500, currency: 'usd', metadata: { type: 'marketplace', productId: 'prod_1', userId: 'buyer_1', sellerAccountId: '' }, ...over });
const completed = (s) => ({ id: `evt_${Math.random()}`, type: 'checkout.session.completed', data: { object: s } });

describe('marketplace delivery via dispatchStripeEvent', () => {
  test('delivers once, records the payment intent, counts one sale', async () => {
    const p = fakeDb();
    const r = await dispatchStripeEvent({ p, stripe: stripeStub, event: completed(session()), log: quiet });
    assert.deepEqual(r, { received: true });
    assert.equal(p.purchases.length, 1);
    assert.equal(p.purchases[0].checkoutSessionId, 'cs_test_1');
    assert.equal(p.purchases[0].paymentIntentId, 'pi_test_1');
    assert.equal(p.purchases[0].delivery.content, 'THE-SECRET');
    assert.equal(p.purchases[0].priceCents, 1500);
    assert.equal(p.purchases[0].feeCents, 150);
    assert.equal(p.product.sold, 1);
    assert.equal(p.notifications.length, 1);
  });

  test('the same session replayed (Stripe retry, or the reconciler) delivers nothing more', async () => {
    const p = fakeDb();
    await dispatchStripeEvent({ p, stripe: stripeStub, event: completed(session()), log: quiet });
    for (let i = 0; i < 3; i++) await dispatchStripeEvent({ p, stripe: stripeStub, event: completed(session()), log: quiet });
    assert.equal(p.purchases.length, 1);
    assert.equal(p.product.sold, 1, 'one sale, however many times the event lands');
    assert.equal(p.notifications.length, 1, 'the buyer is told once');
  });

  test('async_payment_succeeded is the same delivery as completed, and just as idempotent', async () => {
    const p = fakeDb();
    await dispatchStripeEvent({ p, stripe: stripeStub, event: completed(session()), log: quiet });
    await dispatchStripeEvent({ p, stripe: stripeStub, event: { id: 'evt_a', type: 'checkout.session.async_payment_succeeded', data: { object: session() } }, log: quiet });
    assert.equal(p.purchases.length, 1);
  });

  test('completed but unpaid (a delayed bank debit) delivers nothing — until it clears', async () => {
    const p = fakeDb();
    await dispatchStripeEvent({ p, stripe: stripeStub, event: completed(session({ payment_status: 'unpaid' })), log: quiet });
    assert.equal(p.purchases.length, 0, 'no key for money that may still fail');
    assert.equal(p.product.sold, 0);
    await dispatchStripeEvent({ p, stripe: stripeStub, event: { id: 'evt_b', type: 'checkout.session.async_payment_succeeded', data: { object: session({ payment_status: 'paid' }) } }, log: quiet });
    assert.equal(p.purchases.length, 1);
  });

  test('a payment_intent passed expanded is stored by id', async () => {
    const p = fakeDb();
    await dispatchStripeEvent({ p, stripe: stripeStub, event: completed(session({ payment_intent: { id: 'pi_obj_1', object: 'payment_intent' } })), log: quiet });
    assert.equal(p.purchases[0].paymentIntentId, 'pi_obj_1');
  });

  test('a session for a product that no longer exists is acknowledged and delivers nothing', async () => {
    const p = fakeDb();
    const r = await dispatchStripeEvent({ p, stripe: stripeStub, event: completed(session({ metadata: { type: 'marketplace', productId: 'prod_gone', userId: 'buyer_1' } })), log: quiet });
    assert.deepEqual(r, { received: true });
    assert.equal(p.purchases.length, 0);
  });
});
