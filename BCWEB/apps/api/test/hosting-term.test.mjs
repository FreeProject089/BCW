// The prepaid term is whatever the admin bounds say, and the price is exact.
//
// The term used to be one of five numbers hard-coded in a zod refine, so "is this term
// allowed" was a membership test and "what does it cost" was a table lookup. Both are now
// functions of the admin settings, and both are the thing a hand-written request would aim
// at: a term of 0 months, a term of 200 months, a term between two steps, or a month count
// that the discount table never had a row for. Checked here without a database — the
// settings object is the only input.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { termBounds, termCheck, termDiscount, termPresets, termTotalCents, TERM_DEFAULTS, TERM_LIMIT_MONTHS } from '../src/routes/hosting.mjs';

describe('termBounds', () => {
  test('no settings at all → the defaults (1, 36, 1)', () => {
    assert.deepEqual(termBounds({}), TERM_DEFAULTS);
    assert.deepEqual(termBounds(undefined), TERM_DEFAULTS);
  });

  test('admin values are read, as numbers or numeric strings', () => {
    assert.deepEqual(termBounds({ 'hosting.termMinMonths': 3, 'hosting.termMaxMonths': '24', 'hosting.termStepMonths': 3 }), { min: 3, max: 24, step: 3 });
  });

  test('nonsense falls back per key, never to "nothing is valid"', () => {
    assert.deepEqual(termBounds({ 'hosting.termMinMonths': 'abc', 'hosting.termMaxMonths': 0, 'hosting.termStepMonths': -2 }), TERM_DEFAULTS);
  });

  test('a minimum above the maximum lifts the maximum rather than emptying the range', () => {
    const b = termBounds({ 'hosting.termMinMonths': 12, 'hosting.termMaxMonths': 6 });
    assert.deepEqual(b, { min: 12, max: 12, step: 1 });
    assert.equal(termCheck(b, 12), null);
  });

  test('nothing sells past the hard ceiling', () => {
    assert.equal(termBounds({ 'hosting.termMaxMonths': 999 }).max, TERM_LIMIT_MONTHS);
  });
});

describe('termCheck', () => {
  const b = { min: 1, max: 36, step: 1 };

  test('inside the bounds → allowed', () => {
    for (const m of [1, 2, 7, 12, 24, 36]) assert.equal(termCheck(b, m), null, `${m} months`);
  });

  test('below the minimum → refused, and the bounds ride along', () => {
    assert.deepEqual(termCheck(b, 0), { error: 'invalid_term', reason: 'below_min', min: 1, max: 36, step: 1 });
    assert.equal(termCheck({ ...b, min: 3 }, 2)?.reason, 'below_min');
  });

  test('above the maximum → refused', () => {
    assert.equal(termCheck(b, 37)?.reason, 'above_max');
    assert.equal(termCheck(b, 200)?.reason, 'above_max');
  });

  test('off the step grid → refused; the grid counts from the minimum', () => {
    const s3 = { min: 1, max: 36, step: 3 };
    assert.equal(termCheck(s3, 1), null);
    assert.equal(termCheck(s3, 4), null);
    assert.equal(termCheck(s3, 7), null);
    assert.equal(termCheck(s3, 3)?.reason, 'off_step');
    assert.equal(termCheck(s3, 12)?.reason, 'off_step');
    const from3 = { min: 3, max: 36, step: 3 };
    assert.equal(termCheck(from3, 3), null);
    assert.equal(termCheck(from3, 12), null);
    assert.equal(termCheck(from3, 4)?.reason, 'off_step');
  });

  test('not a whole number of months → refused', () => {
    assert.equal(termCheck(b, 1.5)?.reason, 'not_integer');
    assert.equal(termCheck(b, 'x')?.reason, 'not_integer');
    assert.equal(termCheck(b, NaN)?.reason, 'not_integer');
  });
});

describe('termDiscount', () => {
  test('the five terms that used to exist keep their exact discounts', () => {
    assert.equal(termDiscount(1), 0);
    assert.equal(termDiscount(3), 0.05);
    assert.equal(termDiscount(6), 0.10);
    assert.equal(termDiscount(12), 0.20);
    assert.equal(termDiscount(24), 0.35);
  });

  test('a term between two tiers gets the tier below it, never worse', () => {
    assert.equal(termDiscount(2), 0);
    assert.equal(termDiscount(5), 0.05);
    assert.equal(termDiscount(7), 0.10);
    assert.equal(termDiscount(11), 0.10);
    assert.equal(termDiscount(18), 0.20);
    assert.equal(termDiscount(36), 0.35);
  });

  test('is monotonic over the whole sellable range', () => {
    let prev = -1;
    for (let m = 1; m <= TERM_LIMIT_MONTHS; m++) { const d = termDiscount(m); assert.ok(d >= prev, `${m}`); prev = d; }
  });
});

describe('termTotalCents', () => {
  test('is months × monthly, exactly, when there is no discount', () => {
    assert.equal(termTotalCents(1000, 1, 1), 1000);
    assert.equal(termTotalCents(1000, 2, 1), 2000);
    assert.equal(termTotalCents(1234, 2, 1), 2468);
  });

  test('applies the tier discount to the whole term', () => {
    assert.equal(termTotalCents(1000, 12, 1), 9600); // 12 000 − 20 %
    assert.equal(termTotalCents(1000, 7, 1), 6300);  // 7 000 − 10 % (the 6-month tier)
    assert.equal(termTotalCents(1000, 24, 1), 15600); // 24 000 − 35 %
  });

  test('then the scarcity multiplier, rounded to the cent once', () => {
    assert.equal(termTotalCents(1000, 12, 1.1), 10560);
    assert.equal(termTotalCents(333, 3, 1.05), Math.round(333 * 3 * 0.95 * 1.05));
  });
});

describe('termPresets', () => {
  test('the minimum, every tier inside the bounds, and the maximum', () => {
    assert.deepEqual(termPresets({ min: 1, max: 36, step: 1 }), [1, 3, 6, 12, 24, 36]);
  });

  test('tiers off the step grid are not offered', () => {
    // With min 1 / step 3 the sellable terms are 1, 4, 7, …; none of 3/6/12/24 land on
    // that grid, and 36 does not either, so only the minimum survives.
    assert.deepEqual(termPresets({ min: 1, max: 36, step: 3 }), [1]);
    assert.deepEqual(termPresets({ min: 3, max: 24, step: 3 }), [3, 6, 12, 24]);
  });

  test('a range that ends before a tier simply omits it', () => {
    assert.deepEqual(termPresets({ min: 1, max: 6, step: 1 }), [1, 3, 6]);
  });
});
