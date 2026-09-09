// How to refund a purchase we took money for and could not deliver.
//
// The webhook cannot be exercised without a Stripe account, so the decision it makes is a
// function and this is where it gets checked. The expensive case is the one the codebase
// already warned about in its charge.refunded branch: refunding a DESTINATION charge without
// reversing the transfer makes the buyer whole, lets the seller keep their share, and takes
// the difference out of the platform — no error, no failed event, just a balance that is
// short by the seller's cut. Nothing about the refund call looks wrong when that happens,
// which is exactly why it needs a test rather than care.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { refundPlanFor } from '../src/routes/stripe-webhook.mjs';

const SESSION = { mode: 'payment', payment_intent: 'pi_123' };

describe('refundPlanFor', () => {
  test('an ordinary sale refunds the payment intent and nothing else', () => {
    const { params, skip } = refundPlanFor(SESSION, { id: 'pur_1', sellerAccountId: null });
    assert.equal(skip, undefined);
    assert.equal(params.payment_intent, 'pi_123');
    // Sending these on a charge that was never routed is an error from Stripe, not a no-op.
    assert.equal('reverse_transfer' in params, false);
    assert.equal('refund_application_fee' in params, false);
  });

  test('a ROUTED sale reverses the transfer and gives the fee back', () => {
    // The whole reason this function exists. Without reverse_transfer the seller keeps their
    // share of a sale that delivered nothing and the platform pays for it; without
    // refund_application_fee we keep a commission on the same non-sale.
    const { params } = refundPlanFor(SESSION, { id: 'pur_2', sellerAccountId: 'acct_x' });
    assert.equal(params.reverse_transfer, true);
    assert.equal(params.refund_application_fee, true);
  });

  test('the real reason travels in metadata, since Stripe has no code for it', () => {
    const { params } = refundPlanFor(SESSION, { id: 'pur_3' });
    assert.equal(params.metadata.bcweb_reason, 'undeliverable');
    assert.equal(params.metadata.purchaseId, 'pur_3');
    // requested_by_customer is the closest of the three Stripe accepts; it is not a claim
    // that the customer asked, which is why the true reason is carried alongside.
    assert.equal(params.reason, 'requested_by_customer');
  });

  test('a subscription is refused with a reason, not attempted and failed', () => {
    // Its checkout session has no payment_intent — the money moved through an invoice — so
    // there is nothing here to refund. Cancelling is a different decision with a different
    // answer about the cycle already consumed.
    for (const [session, purchase] of [
      [{ mode: 'subscription', payment_intent: null }, { id: 'p' }],
      [{ mode: 'subscription', payment_intent: 'pi_x' }, { id: 'p' }],
      [SESSION, { id: 'p', status: 'active' }],
    ]) {
      const r = refundPlanFor(session, purchase);
      assert.equal(r.params, undefined);
      assert.match(r.skip, /subscription/);
    }
  });

  test('no payment intent is a stated skip rather than a silent one', () => {
    const r = refundPlanFor({ mode: 'payment', payment_intent: null }, { id: 'p' });
    assert.equal(r.params, undefined);
    assert.match(r.skip, /payment_intent/);
  });

  test('an expanded payment_intent object is accepted as well as an id', () => {
    // Stripe hands back either, depending on what the caller expanded. Reading only the
    // string would turn an expanded session into "no payment_intent" and skip the refund.
    const { params } = refundPlanFor({ mode: 'payment', payment_intent: { id: 'pi_obj' } }, { id: 'p' });
    assert.equal(params.payment_intent, 'pi_obj');
  });

  test('nothing at all is refused rather than throwing', () => {
    for (const [a, b] of [[null, null], [undefined, undefined], [{}, {}]]) {
      const r = refundPlanFor(a, b);
      assert.equal(r.params, undefined);
      assert.ok(r.skip);
    }
  });
});
