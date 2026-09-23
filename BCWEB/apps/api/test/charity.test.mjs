// B14 — the org-share math and config normalisation. Pure functions, no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOrgShare, clampCharityPct, normalizeCharityConfig,
  CHARITY_MAX_PCT, monthKey, validateContribution, potTotalCents,
  CONTRIBUTION_MIN_CENTS, CONTRIBUTION_MAX_CENTS, pollOpen, normalizeCharityDesign, charityHistoryView,
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

test('pollOpen reflects status + the open window', () => {
  const now = new Date('2026-09-15T00:00:00Z');
  assert.equal(pollOpen({ status: 'open' }, now), true);
  assert.equal(pollOpen({ status: 'draft' }, now), false);
  assert.equal(pollOpen({ status: 'open', opensAt: '2026-09-20T00:00:00Z' }, now), false); // not open yet
  assert.equal(pollOpen({ status: 'open', closesAt: '2026-09-10T00:00:00Z' }, now), false); // already closed
  assert.equal(pollOpen(null, now), false);
});

test('pot total = frozen org share + every community gift', () => {
  const r = potTotalCents({ orgContribCents: 600, contributions: [{ amountCents: 500 }, { amountCents: 250 }] });
  assert.deepEqual(r, { orgContribCents: 600, communityCents: 750, totalCents: 1350 });
  // an empty pot is all zeros, never NaN
  assert.deepEqual(potTotalCents({}), { orgContribCents: 0, communityCents: 0, totalCents: 0 });
});

// The landing design is an allowlist REBUILD, not a merge: anything the shape does not name
// is dropped rather than stored and rendered later. These are the cases that would otherwise
// travel all the way to the public /charity/current payload.
test('a design saved before the authored modes existed opens unchanged', () => {
  const old = { mode: 'custom', width: '2xl', height: 400, frame: false, ink: 'light', align: 'left', backdrop: '/api/media/a.png', bleed: 80, sticker: 'https://x.test/s.png', stickerSize: 200, stickerCorner: 'bl', stickerOffset: 40, alt: 'hi' };
  const d = normalizeCharityDesign(old);
  for (const [k, v] of Object.entries(old)) assert.deepEqual(d[k], v, `${k} drifted`);
  // and it gains the new fields in their "nothing changed" state
  assert.ok(Object.values(d.parts).every(Boolean));
  assert.equal(d.css, '');
  assert.deepEqual(d.blocks, []);
});

test('the third mode rebuilds parts, labels, classes and blocks from an allowlist', () => {
  const d = normalizeCharityDesign({
    mode: 'code',
    css: 'x'.repeat(30000),
    parts: { bar: false, bogus: true },
    labels: { give: 'Donne', evil: 'x' },
    classes: { root: 'p-4', nope: 'y' },
    blocks: [
      { kind: 'text', text: 'hi', id: '"] , * { display:none } [x="' }, // an id that would escape [data-b="…"]
      { kind: 'evil' },                                                 // unknown kind
      { kind: 'image', src: 'javascript:alert(1)' },                    // a scheme that is not an image
      { kind: 'spacer', size: 9999 },                                   // out of bounds
    ],
  });
  assert.equal(d.mode, 'code');
  assert.equal(d.css.length, 20000);            // capped, never unbounded in an AdminSetting row
  assert.equal(d.parts.bar, false);
  assert.equal('bogus' in d.parts, false);
  assert.equal(d.labels.give, 'Donne');
  assert.equal('evil' in d.labels, false);
  assert.deepEqual(Object.keys(d.classes), ['root', 'card', 'content']);
  assert.equal(d.blocks.length, 3);             // the unknown kind is gone entirely
  assert.match(d.blocks[0].id, /^[A-Za-z0-9_-]{1,24}$/);
  assert.equal(d.blocks[1].src, '');            // javascript: never survives as an image
  assert.equal(d.blocks[2].size, 720);
});

// M12: the ready-made looks. The field is on the allowlist (so the public /charity/current
// design carries it), an unknown id is refused, and a design saved before presets opens as ''.
test('the preset is an allowlisted field: known ids travel, anything else falls back to ""', () => {
  for (const id of ['classic', 'minimal', 'band', 'glass', 'hand']) assert.equal(normalizeCharityDesign({ preset: id }).preset, id);
  assert.equal(normalizeCharityDesign({ preset: '<img onerror=x>' }).preset, '');
  assert.equal(normalizeCharityDesign({ mode: 'custom' }).preset, '');
  assert.equal(normalizeCharityDesign(null).preset, '');
});

test('an unknown mode falls back to the default card', () => {
  assert.equal(normalizeCharityDesign({ mode: 'hax' }).mode, 'default');
  assert.equal(normalizeCharityDesign(null).mode, 'default');
});

test('the public history: past months only, newest first, totals and a gift count, never who gave', () => {
  const pots = [
    { month: '2026-07', association: 'A', status: 'paid', proofUrl: 'https://x/p', proofNote: 'internal', paidAt: new Date('2026-08-02T10:00:00Z'), orgContribCents: 1000, currency: 'chf', contributions: [{ amountCents: 500, userId: 'u1' }, { amountCents: 250, userId: null }] },
    { month: '2026-09', association: 'Now', status: 'open', orgContribCents: 1, contributions: [] },
    { month: '2026-08', association: '', status: 'closing', proofUrl: 'https://x/early', orgContribCents: 0, contributions: [] },
  ];
  const h = charityHistoryView(pots, '2026-09');
  assert.deepEqual(h.map((x) => x.month), ['2026-08', '2026-07']);
  assert.deepEqual(h[1], {
    month: '2026-07', association: 'A', status: 'paid', currency: 'chf', proofUrl: 'https://x/p',
    paidAt: '2026-08-02T10:00:00.000Z', gifts: 2, orgContribCents: 1000, communityCents: 750, totalCents: 1750,
  });
  // A proof link on a month that is not marked paid is not published yet.
  assert.equal(h[0].proofUrl, '');
  // No identities and no admin note, anywhere in the output.
  const json = JSON.stringify(h);
  assert.ok(!json.includes('u1') && !json.includes('internal') && !json.includes('userId'));
});
