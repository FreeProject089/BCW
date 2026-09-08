// Where the money goes at the moment it is charged.
//
// Until now the marketplace WROTE the split — feeCents and netCents on every purchase row —
// and moved none of it. Every cent landed in the platform's Stripe account and the two
// columns said what somebody was owed. That is fine when the seller is us; it is a debt
// nothing discharges the moment a seller is anyone else.
//
// `connectChargeParams` is the decision, alone and without a network: given a product, the
// margin, and whichever connected account is on file for the page it sits on, what does the
// checkout session have to say? Every wrong answer here is expensive and silent — a fee
// Stripe rejects, a transfer to an account that cannot receive it, a routed charge on a
// product whose seller is the platform itself.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { connectChargeParams } from '../src/routes/marketplace.mjs';

/** A connected account that Stripe has said yes to. */
const READY = { stripeAccountId: 'acct_ready', chargesEnabled: true, payoutsEnabled: true };

describe('connectChargeParams — when NOT to route', () => {
  test('no account on file: the platform keeps the money, as it did before', () => {
    // The fallback has to be the old behaviour rather than a refusal. A page with no payout
    // account is the normal state of every first-party project, and a marketplace that
    // stops selling until somebody onboards Stripe is a regression, not a safeguard.
    assert.equal(connectChargeParams({ priceCents: 1000 }, null, 1000), null);
    assert.equal(connectChargeParams({ priceCents: 1000 }, undefined, 1000), null);
  });

  test('an account Stripe has not enabled is not used', () => {
    // The single most important guard. An account exists from the instant onboarding starts
    // and cannot take a charge until Stripe finishes its checks; routing to one fails the
    // whole checkout, so the buyer cannot pay at all. Falling back to the platform is worse
    // for the seller and better for everyone than a checkout that 500s.
    assert.equal(connectChargeParams({ priceCents: 1000 }, { ...READY, chargesEnabled: false }, 1000), null);
  });

  test('a row with no account id is not an account', () => {
    assert.equal(connectChargeParams({ priceCents: 1000 }, { ...READY, stripeAccountId: '' }, 1000), null);
    assert.equal(connectChargeParams({ priceCents: 1000 }, { ...READY, stripeAccountId: null }, 1000), null);
  });

  test('a free product routes nothing', () => {
    // There is no charge to attach a destination to, and Stripe rejects a transfer of zero.
    assert.equal(connectChargeParams({ priceCents: 0 }, READY, 1000), null);
  });

  test('a 100% margin leaves nothing to transfer, so nothing is transferred', () => {
    // The seller is owed zero. Routing the charge anyway would create a destination
    // transfer of 0 and an application fee equal to the whole amount — two Stripe objects
    // that describe a payout of nothing, on every sale, for ever.
    assert.equal(connectChargeParams({ priceCents: 1000 }, READY, 10000), null);
  });
});

describe('connectChargeParams — a one-off sale', () => {
  test('the fee Stripe takes is the fee we wrote on the purchase', () => {
    // The property that matters more than the shape: `application_fee_amount` and the
    // `feeCents` column must be the same arithmetic. If they drift, the invoice and the
    // payout report disagree and only one of them is the money.
    const r = connectChargeParams({ priceCents: 1999, billing: 'one_time' }, READY, 1000);
    assert.equal(r.mode, 'payment');
    assert.deepEqual(r.payment_intent_data, {
      application_fee_amount: 200,               // = splitFee(1999, 1000).feeCents
      transfer_data: { destination: 'acct_ready' },
    });
    assert.equal(r.subscription_data, undefined);
  });

  test('a zero margin omits the fee rather than sending a zero', () => {
    // "Our own products pay nothing" is a real setting, and this is the shape it takes on
    // a sale routed to a connected account: a destination transfer with no application fee.
    const r = connectChargeParams({ priceCents: 500 }, READY, 0);
    assert.deepEqual(r.payment_intent_data, { transfer_data: { destination: 'acct_ready' } });
    assert.ok(!('application_fee_amount' in r.payment_intent_data));
  });

  test('the fee never exceeds the amount charged', () => {
    for (const price of [1, 7, 99, 333, 1999, 250000]) {
      for (const bp of [1, 250, 1000, 3333, 9999]) {
        const r = connectChargeParams({ priceCents: price }, READY, bp);
        if (!r) continue;
        const fee = r.payment_intent_data.application_fee_amount || 0;
        assert.ok(fee <= price, `${price}¢ at ${bp}bp asked Stripe for a fee of ${fee}`);
        assert.ok(fee >= 0);
      }
    }
  });
});

describe('connectChargeParams — a subscription', () => {
  test('a subscription takes a PERCENT, not an amount', () => {
    // Stripe has no per-cycle amount to attach a fee to: the price recurs, so the fee is a
    // percentage applied to each invoice. Sending application_fee_amount on a subscription
    // is a 400, and sending basis points where a percent is expected would charge 1000%.
    const r = connectChargeParams({ priceCents: 1999, billing: 'subscription' }, READY, 1000);
    assert.equal(r.mode, 'subscription');
    assert.deepEqual(r.subscription_data, {
      application_fee_percent: 10,
      transfer_data: { destination: 'acct_ready' },
    });
    assert.equal(r.payment_intent_data, undefined);
  });

  test('basis points that are not whole percents survive the conversion', () => {
    assert.equal(connectChargeParams({ priceCents: 1000, billing: 'subscription' }, READY, 250).subscription_data.application_fee_percent, 2.5);
    assert.equal(connectChargeParams({ priceCents: 1000, billing: 'subscription' }, READY, 3333).subscription_data.application_fee_percent, 33.33);
  });

  test('a zero margin omits the percent rather than sending a zero', () => {
    const r = connectChargeParams({ priceCents: 1000, billing: 'subscription' }, READY, 0);
    assert.deepEqual(r.subscription_data, { transfer_data: { destination: 'acct_ready' } });
  });

  test('a 100% margin on a subscription routes nothing either', () => {
    assert.equal(connectChargeParams({ priceCents: 1000, billing: 'subscription' }, READY, 10000), null);
  });
});

describe('connectChargeParams — nonsense in', () => {
  test('a junk margin is treated as the safe direction, not as free money', () => {
    // splitFee clamps; this must agree with it rather than invent its own reading. A
    // negative fee would mean paying the seller MORE than the buyer paid.
    const r = connectChargeParams({ priceCents: 1000 }, READY, -50);
    assert.deepEqual(r.payment_intent_data, { transfer_data: { destination: 'acct_ready' } });
  });

  test('a missing price is not a sale', () => {
    assert.equal(connectChargeParams({}, READY, 1000), null);
    assert.equal(connectChargeParams(null, READY, 1000), null);
  });
});
