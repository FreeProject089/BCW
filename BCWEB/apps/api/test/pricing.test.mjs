// Unit tests for the billing MATH — the pure, DB-free pricing functions where a bug
// mischarges real users (audit P1). Uses Node's built-in test runner (no deps):
//   node --test          (from apps/api)   ·   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceCents, termTotalCents, capacityFactors } from '../src/routes/hosting.mjs';

// A representative pricing-settings object (the shape stored in AdminSetting).
const S = {
  'pricing.hostingFreeGB': 1,
  'pricing.perGBCents': 100,        // $1.00 / GB / month above the free floor
  'pricing.perUploadMbpsCents': 50, // $0.50 / Mbps
  'pricing.perCpuShareCents': 200,  // $2.00 / cpu share
};

// ── priceCents ────────────────────────────────────────────────────────────────
test('priceCents: storage at/below the free floor costs nothing', () => {
  assert.equal(priceCents(S, 1, 0, 0), 0);     // exactly the floor
  assert.equal(priceCents(S, 0.5, 0, 0), 0);   // below the floor → never negative
});

test('priceCents: only the storage ABOVE the free floor is billed', () => {
  // (5 - 1) GB * 100c = 400c
  assert.equal(priceCents(S, 5, 0, 0), 400);
});

test('priceCents: storage + upload + cpu components sum correctly', () => {
  // 400 (storage) + 2*50 (upload) + 0.5*200 (cpu) = 600
  assert.equal(priceCents(S, 5, 2, 0.5), 600);
});

test('priceCents: missing settings fall back to safe defaults (freeGB=1, rest=0)', () => {
  assert.equal(priceCents({}, 10, 5, 2), 0);   // no per-unit prices set → free
});

test('priceCents: result is always a rounded, non-negative integer', () => {
  const c = priceCents(S, 3.7, 1.3, 0.25);
  assert.ok(Number.isInteger(c), 'is an integer (cents)');
  assert.ok(c >= 0, 'never negative');
});

// ── termTotalCents (prepaid term discounts) ─────────────────────────────────────
test('termTotalCents: a 1-month term has no discount', () => {
  assert.equal(termTotalCents(1000, 1, 1), 1000);
});

test('termTotalCents: each prepaid tier applies its exact discount', () => {
  assert.equal(termTotalCents(1000, 3, 1), 2850);   // 3 * 1000 * (1 - 0.05)
  assert.equal(termTotalCents(1000, 6, 1), 5400);   // 6 * 1000 * (1 - 0.10)
  assert.equal(termTotalCents(1000, 12, 1), 9600);  // 12 * 1000 * (1 - 0.20)
  assert.equal(termTotalCents(1000, 24, 1), 15600); // 24 * 1000 * (1 - 0.35)
});

test('termTotalCents: an unknown term length falls back to NO discount (not a crash)', () => {
  assert.equal(termTotalCents(1000, 7, 1), 7000);
});

test('termTotalCents: the scarcity price multiplier scales the whole total', () => {
  assert.equal(termTotalCents(1000, 3, 1.1), 3135); // round(3 * 1000 * 0.95 * 1.1)
});

test('INVARIANT: a longer prepaid term never costs MORE per month', () => {
  const monthly = 1234;
  const perMonth = (m) => termTotalCents(monthly, m, 1) / m;
  const terms = [1, 3, 6, 12, 24];
  for (let i = 1; i < terms.length; i++) {
    assert.ok(perMonth(terms[i]) <= perMonth(terms[i - 1]) + 1e-9,
      `${terms[i]}mo per-month (${perMonth(terms[i])}) should be <= ${terms[i - 1]}mo (${perMonth(terms[i - 1])})`);
  }
});

// ── capacityFactors (scarcity-based price + caps) ───────────────────────────────
test('capacityFactors: an empty host prices at 1x with the widest caps', () => {
  const f = capacityFactors({ usableGB: 100, allocatedGB: 0 });
  assert.equal(f.fill, 0);
  assert.equal(f.priceMult, 1);
  assert.equal(f.maxUploadMbps, 1000);
  assert.equal(f.maxCpuShare, 8);
});

test('capacityFactors: a getting-full host raises price and tightens caps', () => {
  const f = capacityFactors({ usableGB: 100, allocatedGB: 80 }); // fill 0.8
  assert.equal(f.fill, 0.8);
  assert.equal(f.priceMult, 1.18);   // 1 + (0.8 - 0.6) * 0.9
  assert.equal(f.maxUploadMbps, 250); // fill > 0.75
  assert.equal(f.maxCpuShare, 2);
});

test('capacityFactors: a nearly-full host has the highest price and tightest caps', () => {
  const f = capacityFactors({ usableGB: 100, allocatedGB: 95 }); // fill 0.95
  assert.equal(f.priceMult, 1.315);  // 1 + (0.95 - 0.6) * 0.9
  assert.equal(f.maxUploadMbps, 100); // fill > 0.9
  assert.equal(f.maxCpuShare, 1);
});

test('capacityFactors: caps never exceed the admin-set hard ceilings', () => {
  const f = capacityFactors({ usableGB: 100, allocatedGB: 0, maxUploadMbpsCap: 200, maxCpuShareCap: 4 });
  assert.ok(f.maxUploadMbps <= 200);
  assert.ok(f.maxCpuShare <= 4);
});

test('capacityFactors: a zero-capacity host does not divide by zero', () => {
  const f = capacityFactors({ usableGB: 0, allocatedGB: 0 });
  assert.equal(f.fill, 0);
  assert.equal(f.priceMult, 1);
});

test('INVARIANT: price multiplier is monotonic non-decreasing as the host fills', () => {
  let prev = 0;
  for (let allocated = 0; allocated <= 100; allocated += 5) {
    const m = capacityFactors({ usableGB: 100, allocatedGB: allocated }).priceMult;
    assert.ok(m >= prev - 1e-9, `priceMult should not drop (allocated ${allocated})`);
    prev = m;
  }
});

// ── Consolidation savings (the pool-merge repricing math) ───────────────────────
test('consolidation: pricing one plan for the summed specs applies the free floor ONCE', () => {
  // Two 3GB subs priced separately each bill (3-1)*100 = 200 → 400 total.
  const separate = priceCents(S, 3, 0, 0) + priceCents(S, 3, 0, 0);
  // Consolidated to one 6GB plan bills (6-1)*100 = 500 (only one free GB), and an admin
  // discount is what turns that into a saving — mirrors the /consolidation endpoint.
  const consolidatedBase = priceCents(S, 6, 0, 0);
  assert.equal(separate, 400);
  assert.equal(consolidatedBase, 500);
  const discount = 0.3;
  const consolidated = Math.round(consolidatedBase * (1 - discount)); // 350
  assert.ok(consolidated < separate, 'with the discount, consolidating saves money');
});
