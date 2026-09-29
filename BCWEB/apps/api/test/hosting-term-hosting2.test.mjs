// hosting2 (agent-hosting): the prepaid duration is a number the member types, so the page and
// the server must say yes and no to exactly the same numbers, and price them to the same cent.
//
// The page's rule lives in apps/web/src/lib/hosting-term.js, the server's in routes/hosting.mjs.
// They cannot share a module (the API image does not ship the web sources), so this pins them
// together instead: every bound the admin can set × every number somebody can type.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { termBounds, termCheck, termTotalCents, termEndDate, termAdminCheck, TERM_LIMIT_MONTHS } from '../src/routes/hosting.mjs';
import * as web from '../../web/src/lib/hosting-term.js';

const D = (s) => new Date(`${s}T12:00:00Z`);

// Every setting an admin can save (1..12 each), and a few stored values from before the cap.
function* allBounds() {
  for (let min = 1; min <= 12; min++) for (let max = 1; max <= 12; max++) for (const step of [1, 2, 3, 4, 6, 12]) {
    yield termBounds({ 'hosting.termMinMonths': min, 'hosting.termMaxMonths': max, 'hosting.termStepMonths': step });
  }
  yield termBounds({ 'hosting.termMaxMonths': 36 });
  yield termBounds({});
}
const TYPED = [-1, 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 24, 36, 120, NaN, '6', 'x', null, undefined, Infinity];

describe('the page refuses exactly what the server refuses', () => {
  test('termError (web) ≡ termCheck (API), reason for reason', () => {
    let n = 0;
    for (const b of allBounds()) {
      const sent = web.normaliseTerm({ ...b, presets: [], tiers: [] });
      for (const m of TYPED) {
        const s = termCheck(b, m); const w = web.termError(sent, m);
        assert.equal(w?.reason ?? null, s?.reason ?? null, `bounds ${JSON.stringify(b)} months ${String(m)}`);
        n++;
      }
    }
    assert.ok(n > 20000);
  });
  test('whatever the page snaps a typed number to, the server accepts', () => {
    for (const b of allBounds()) {
      const sent = web.normaliseTerm({ ...b, presets: [], tiers: [] });
      for (const m of TYPED) assert.equal(termCheck(b, web.snapTerm(sent, m)), null, `${JSON.stringify(b)} ${String(m)}`);
    }
  });
});

describe('the price on the page is the price at checkout', () => {
  const tiers = [{ from: 12, off: 0.20 }, { from: 6, off: 0.10 }];
  test('termTotalCents (web, with the scarcity multiplier) ≡ termTotalCents (API)', () => {
    for (const monthly of [0, 1, 99, 333, 500, 1234, 4999]) for (let m = 1; m <= TERM_LIMIT_MONTHS; m++) for (const mult of [1, 1.05, 1.123, 1.36]) {
      assert.equal(web.termTotalCents(monthly, m, tiers, 0, mult), termTotalCents(monthly, m, mult), `${monthly}×${m}×${mult}`);
    }
  });
  test('the multiplier defaults to 1, so older callers are unchanged', () => {
    assert.equal(web.termTotalCents(1000, 12, tiers), 9600);
    assert.equal(web.termTotalCents(1000, 12, tiers, 10), 8640);
  });
});

describe('the term ends on the same calendar day N months later', () => {
  test('termEndDate', () => {
    assert.equal(termEndDate(D('2026-09-26'), 12).toISOString(), D('2027-09-26').toISOString());
    assert.equal(termEndDate(D('2026-01-31'), 1).toISOString(), D('2026-02-28').toISOString());
    assert.equal(termEndDate(D('2026-05-10'), 7).toISOString(), D('2026-12-10').toISOString());
  });
  test('the page shows the same date', () => {
    for (const s of ['2026-01-31', '2026-02-28', '2026-08-31', '2026-12-15']) for (let m = 1; m <= 12; m++) {
      assert.equal(web.termEndDate(D(s), m).toISOString(), termEndDate(D(s), m).toISOString());
    }
  });
});

describe('the admin bounds (PUT /admin/hosting/term)', () => {
  test('a valid set is returned as stored', () => {
    assert.deepEqual(termAdminCheck({ min: 1, max: 12, step: 1 }), { ok: true, value: { min: 1, max: 12, step: 1 } });
    assert.deepEqual(termAdminCheck({ min: 3, max: 12, step: 3 }), { ok: true, value: { min: 3, max: 12, step: 3 } });
  });
  test('above 12 months is refused, and the refusal names what would have to change', () => {
    const r = termAdminCheck({ min: 1, max: 24, step: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.body.error, 'term_above_legal_cap');
    assert.equal(r.body.cap, 12);
  });
  test('a minimum above the maximum, zero, fractions and junk are refused', () => {
    assert.equal(termAdminCheck({ min: 6, max: 3, step: 1 }).body.error, 'term_min_above_max');
    assert.equal(termAdminCheck({ min: 0, max: 3, step: 1 }).body.error, 'invalid_input');
    assert.equal(termAdminCheck({ min: 1, max: 3.5, step: 1 }).body.error, 'invalid_input');
    assert.equal(termAdminCheck({ min: '1', max: 3, step: 1 }).body.error, 'invalid_input');
    assert.equal(termAdminCheck(null).body.error, 'invalid_input');
  });
  test('a step that leaves nothing but the minimum is allowed, and said', () => {
    const r = termAdminCheck({ min: 12, max: 12, step: 1 });
    assert.equal(r.ok, true);
  });
});
