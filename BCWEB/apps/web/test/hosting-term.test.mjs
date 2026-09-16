// The client never decides what a term is worth — it reads the server's tiers. These pin the
// reading: a term between two tiers takes the lower one, a typed number lands on the grid, and
// the total is priced in the server's order (term discount, then promo).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseTerm, discountFor, snapTerm, termTotalCents, nextTier, TERM_FALLBACK } from '../src/lib/hosting-term.js';

describe('normaliseTerm', () => {
  test('nothing from the server yet → the fallback', () => {
    assert.deepEqual(normaliseTerm(null), { ...TERM_FALLBACK, tiers: [...TERM_FALLBACK.tiers], presets: [...TERM_FALLBACK.presets] });
  });
  test('the server bounds win, and presets off the grid are dropped', () => {
    const n = normaliseTerm({ min: 3, max: 24, step: 3, presets: [1, 3, 6, 12, 24, 36], tiers: [{ from: 12, off: 0.2 }] });
    assert.deepEqual([n.min, n.max, n.step], [3, 24, 3]);
    assert.deepEqual(n.presets, [3, 6, 12, 24]);
    assert.deepEqual(n.tiers, [{ from: 12, off: 0.2 }]);
  });
  test('a max below the min is lifted to the min', () => {
    assert.equal(normaliseTerm({ min: 12, max: 6 }).max, 12);
  });
});

describe('discountFor', () => {
  const tiers = TERM_FALLBACK.tiers;
  test('exact tiers', () => {
    assert.equal(discountFor(tiers, 1), 0);
    assert.equal(discountFor(tiers, 3), 0.05);
    assert.equal(discountFor(tiers, 12), 0.20);
    assert.equal(discountFor(tiers, 24), 0.35);
  });
  test('between tiers takes the one below', () => {
    assert.equal(discountFor(tiers, 7), 0.10);
    assert.equal(discountFor(tiers, 30), 0.35);
  });
  test('tiers in any order', () => {
    assert.equal(discountFor([{ from: 3, off: 0.05 }, { from: 12, off: 0.2 }], 12), 0.2);
  });
});

describe('snapTerm', () => {
  const b = { min: 1, max: 36, step: 1 };
  test('clamps', () => {
    assert.equal(snapTerm(b, 0), 1);
    assert.equal(snapTerm(b, 500), 36);
    assert.equal(snapTerm(b, 'x'), 1);
  });
  test('rounds to the grid counted from the minimum', () => {
    const s3 = { min: 1, max: 36, step: 3 };
    assert.equal(snapTerm(s3, 3), 4);
    assert.equal(snapTerm(s3, 2), 1);
    assert.equal(snapTerm(s3, 36), 34);
    assert.equal(snapTerm({ min: 3, max: 24, step: 3 }, 8), 9);
  });
});

describe('termTotalCents', () => {
  const tiers = TERM_FALLBACK.tiers;
  test('months × monthly, then the discount, then the promo', () => {
    assert.equal(termTotalCents(1000, 2, tiers), 2000);
    assert.equal(termTotalCents(1000, 12, tiers), 9600);
    assert.equal(termTotalCents(1000, 12, tiers, 10), 8640);
  });
});

describe('nextTier', () => {
  const b = normaliseTerm(null);
  test('names the next reachable tier', () => {
    assert.deepEqual(nextTier(b, 1), { months: 3, off: 0.05 });
    assert.deepEqual(nextTier(b, 7), { months: 12, off: 0.20 });
  });
  test('null at the top, or when the range ends first', () => {
    assert.equal(nextTier(b, 24), null);
    assert.equal(nextTier(normaliseTerm({ max: 6 }), 6), null);
  });
});
