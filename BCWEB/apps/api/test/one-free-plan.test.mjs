// Only one plan can be the free one.
//
// The public hosting page reads the free plan as `plans.find(pl => pl.priceMonthlyCents === 0)`
// — the FIRST match. A second zero-priced plan is therefore not a second offer: it is live in
// the database, counted in every admin total, and unreachable from the page. Nothing errors,
// so the only way anybody finds out is by wondering why a plan has no subscribers.
//
// The guard's interesting part is not the query, it is which plans COUNT — so that decision
// is a function and this is where it is checked, without a database.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { secondFreePlan } from '../src/routes/hosting.mjs';

const free = (over = {}) => ({ id: 'p_free', name: 'Free', priceMonthlyCents: 0, active: true, ...over });
const paid = (over = {}) => ({ id: 'p_paid', name: '25 GB', priceMonthlyCents: 800, active: true, ...over });

describe('secondFreePlan', () => {
  test('a free plan with another free plan already live is refused', () => {
    const clash = secondFreePlan(free({ id: 'new' }), [free()]);
    assert.equal(clash?.id, 'p_free');
  });

  test('the FIRST free plan is allowed', () => {
    assert.equal(secondFreePlan(free(), [paid()]), null);
  });

  test('a paid plan is never a clash, however many free ones exist', () => {
    assert.equal(secondFreePlan(paid(), [free()]), null);
  });

  // Retiring the current free plan and putting another in its place is a normal thing to
  // want, and it goes through an inactive state to get there. A guard that counted retired
  // plans would make that impossible and get switched off.
  test('an inactive plan neither clashes nor is clashed with', () => {
    assert.equal(secondFreePlan(free({ id: 'new', active: false }), [free()]), null);
    assert.equal(secondFreePlan(free({ id: 'new' }), [free({ active: false })]), null);
  });

  test('a price of zero as a string still counts as free', () => {
    // The route hands it straight from the request body via zod (a number), but the same
    // rule is used on a Prisma row merged with a partial edit — one loose compare here is
    // cheaper than a free plan slipping through because of a type.
    assert.equal(secondFreePlan(free({ id: 'new', priceMonthlyCents: '0' }), [free()])?.id, 'p_free');
  });

  test('nothing to save is not a clash', () => {
    assert.equal(secondFreePlan(null, [free()]), null);
    assert.equal(secondFreePlan(free(), undefined), null);
  });
});
