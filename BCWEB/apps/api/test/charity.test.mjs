// B14 — the org-share math and config normalisation. Pure functions, no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOrgShare, clampCharityPct, normalizeCharityConfig,
  CHARITY_MAX_PCT, monthKey, validateContribution, potTotalCents,
  CONTRIBUTION_MIN_CENTS, CONTRIBUTION_MAX_CENTS,
} from '../src/lib/charity.mjs';

test('org-share is a percentage of net recurring revenue', () => {
  // mrr 10000, burn 4000 → eligible 6000; 10% → 600
  const r = computeOrgShare({ mrrCents: 10000, monthlyBurnCents: 4000, percent: 10 });
  assert.equal(r.eligibleCents, 6000);
  assert.equal(r.orgShareCents, 600);
  assert.equal(r.percent, 10);
});

test('a loss-making month contributes nothing, never a negative', () => {
  const r = computeOrgShare({ mrrCents: 3000, monthlyBurnCents: 9000, percent: 25 });
  assert.equal(r.eligibleCents, 0);
  assert.equal(r.orgShareCents, 0);
});

test('the 50% ceiling is enforced no matter the input', () => {
  assert.equal(clampCharityPct(80), CHARITY_MAX_PCT);
  assert.equal(clampCharityPct(-5), 0);
  assert.equal(clampCharityPct('abc'), 0);
  // even asking for 90% only ever pays out half of eligible
  const r = computeOrgShare({ mrrCents: 10000, monthlyBurnCents: 0, percent: 90 });
  assert.equal(r.percent, CHARITY_MAX_PCT);
  assert.equal(r.orgShareCents, 5000);
});

test('rounding is to the nearest cent', () => {
  // eligible 3333, 10% = 333.3 → 333
  const r = computeOrgShare({ mrrCents: 3333, monthlyBurnCents: 0, percent: 10 });
  assert.equal(r.orgShareCents, 333);
});

test('config normalises to the current shape and clamps', () => {
  const c = normalizeCharityConfig({ enabled: true, percent: 200, currency: 'CHF', association: 'X' });
  assert.equal(c.enabled, true);
  assert.equal(c.percent, CHARITY_MAX_PCT);
  assert.equal(c.currency, 'chf');
  assert.equal(c.association, 'X');
  // junk in → safe defaults out
  const d = normalizeCharityConfig(null);
  assert.equal(d.enabled, false);
  assert.equal(d.currency, 'chf');
});

test('monthKey is UTC YYYY-MM', () => {
  assert.equal(monthKey(new Date('2026-09-01T00:00:00Z')), '2026-09');
  assert.equal(monthKey(new Date('2026-12-31T23:59:59Z')), '2026-12');
});

test('contribution amounts are validated (integer cents within bounds)', () => {
  assert.equal(validateContribution(500).ok, true);
  assert.equal(validateContribution(CONTRIBUTION_MIN_CENTS).ok, true);
  assert.equal(validateContribution(CONTRIBUTION_MIN_CENTS - 1).error, 'too_small');
  assert.equal(validateContribution(CONTRIBUTION_MAX_CENTS + 1).error, 'too_large');
  assert.equal(validateContribution(12.5).error, 'bad_amount');
  assert.equal(validateContribution('abc').error, 'bad_amount');
});

test('pot total = frozen org share + every community gift', () => {
  const r = potTotalCents({ orgContribCents: 600, contributions: [{ amountCents: 500 }, { amountCents: 250 }] });
  assert.deepEqual(r, { orgContribCents: 600, communityCents: 750, totalCents: 1350 });
  // an empty pot is all zeros, never NaN
  assert.deepEqual(potTotalCents({}), { orgContribCents: 0, communityCents: 0, totalCents: 0 });
});
