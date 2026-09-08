// The platform's cut of a marketplace sale.
//
// This is money arithmetic that runs once per sale and is written onto the purchase row, so
// it is the number a payout report is built from. Every failure mode here is silent: a split
// that does not add back to the price, a rounding rule that quietly favours the platform on
// every odd amount, a percentage read out of the wrong place. None of them throw, and the
// only way anybody finds out is by adding up invoices months later.
//
// Pure arithmetic and one stubbed lookup — no database.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitFee, feeForProduct, marketplaceFeeBp } from '../src/routes/marketplace.mjs';

/** A stand-in for the Prisma client, holding one AdminSetting row. */
const dbWith = (value) => ({
  adminSetting: { findUnique: async () => (value === undefined ? null : { value }) },
});

describe('splitFee', () => {
  test('the two halves always add back to the price', () => {
    // The property that matters more than any single figure: whatever the rounding does, the
    // seller and the platform between them must account for every cent that was charged.
    for (const price of [0, 1, 7, 99, 100, 333, 1999, 250000]) {
      for (const bp of [0, 1, 250, 1000, 3333, 10000]) {
        const { feeCents, netCents } = splitFee(price, bp);
        assert.equal(feeCents + netCents, price, `${price}¢ at ${bp}bp`);
        assert.ok(feeCents >= 0 && netCents >= 0, `${price}¢ at ${bp}bp went negative`);
      }
    }
  });

  test('10% of 19.99 is 2.00, not 1.99', () => {
    // Rounded, not truncated. Flooring is the obvious implementation and it takes the extra
    // cent AWAY from the platform on every odd amount; ceiling takes it from the seller on
    // every odd amount. Either is a policy nobody decided, applied a few thousand times.
    assert.deepEqual(splitFee(1999, 1000), { feeCents: 200, netCents: 1799 });
  });

  test('0% leaves the seller everything, 100% leaves them nothing', () => {
    assert.deepEqual(splitFee(500, 0), { feeCents: 0, netCents: 500 });
    assert.deepEqual(splitFee(500, 10000), { feeCents: 500, netCents: 0 });
  });

  test('basis points express a fraction of a percent', () => {
    // 2.5% is a real number to charge and is not expressible in whole percent. That is the
    // reason the setting is basis points and not a percentage.
    assert.equal(splitFee(10000, 250).feeCents, 250);
  });

  test('a free product splits into zero and zero, never NaN', () => {
    assert.deepEqual(splitFee(0, 1000), { feeCents: 0, netCents: 0 });
  });

  test('nonsense is clamped rather than propagated', () => {
    // A negative or absurd percentage reaching this function means something upstream is
    // wrong; charging a negative fee — paying the seller MORE than the sale — is worse than
    // clamping and carrying on.
    assert.deepEqual(splitFee(1000, -50), { feeCents: 0, netCents: 1000 });
    assert.deepEqual(splitFee(1000, 99999), { feeCents: 1000, netCents: 0 });
    assert.deepEqual(splitFee(-10, 1000), { feeCents: 0, netCents: 0 });
    assert.deepEqual(splitFee(undefined, undefined), { feeCents: 0, netCents: 0 });
  });
});

describe('marketplaceFeeBp', () => {
  test('no row means the built-in default, not zero', () => {
    // Zero would be a silent policy change: every sale free of charge because a settings row
    // was never created.
    return marketplaceFeeBp(dbWith(undefined)).then((v) => assert.equal(v, 1000));
  });

  test('a stored value is used', () => marketplaceFeeBp(dbWith(250)).then((v) => assert.equal(v, 250)));

  test('a stored value out of range falls back rather than being clamped', async () => {
    // Different from splitFee on purpose. A bad SETTING is a configuration mistake and the
    // safe reading is "nobody set this", not "charge 100%".
    assert.equal(await marketplaceFeeBp(dbWith(20000)), 1000);
    assert.equal(await marketplaceFeeBp(dbWith(-1)), 1000);
    assert.equal(await marketplaceFeeBp(dbWith('nonsense')), 1000);
  });
});

describe('feeForProduct', () => {
  test('a product override wins over the site default', async () => {
    assert.equal(await feeForProduct(dbWith(1000), { feePercentBp: 250 }), 250);
  });

  test('ZERO is an override, not an absence', async () => {
    // The whole point of the field: our own products pay us nothing. `??` and not `||`, or
    // a 0% product would silently be charged the site default for ever.
    assert.equal(await feeForProduct(dbWith(1000), { feePercentBp: 0 }), 0);
  });

  test('null falls back to the site default', async () => {
    assert.equal(await feeForProduct(dbWith(750), { feePercentBp: null }), 750);
    assert.equal(await feeForProduct(dbWith(750), {}), 750);
  });

  test('an out-of-range override falls back too', async () => {
    assert.equal(await feeForProduct(dbWith(1000), { feePercentBp: 99999 }), 1000);
  });
});
