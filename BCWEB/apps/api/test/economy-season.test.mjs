// Seasons: when the next reset falls; statistics: what a ledger row counts as, and the folds.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nextSeasonReset, seasonDue, normalizeSeason, classify, windowsOf, foldStats, METRICS, seasonLength, SEASON_EVERY } from '../src/lib/economy-season.mjs';

const iso = (d) => d.toISOString();

describe('nextSeasonReset', () => {
  test('off means never', () => {
    assert.equal(nextSeasonReset({ every: 'never' }, '2026-09-11T10:00:00Z'), null);
    assert.equal(nextSeasonReset({ every: 'weekly' }, 'not a date'), null);
  });
  test('daily: the next hour boundary strictly after from', () => {
    assert.equal(iso(nextSeasonReset({ every: 'daily', hour: 4 }, '2026-09-11T03:00:00Z')), '2026-09-11T04:00:00.000Z');
    assert.equal(iso(nextSeasonReset({ every: 'daily', hour: 4 }, '2026-09-11T04:00:00Z')), '2026-09-12T04:00:00.000Z');
  });
  test('weekly: the chosen weekday at the chosen hour', () => {
    // 2026-09-11 is a Friday; Monday (1) at 04:00 is the 14th.
    assert.equal(iso(nextSeasonReset({ every: 'weekly', weekday: 1, hour: 4 }, '2026-09-11T10:00:00Z')), '2026-09-14T04:00:00.000Z');
    // From a Monday 05:00, the next Monday is a week later, not the same day.
    assert.equal(iso(nextSeasonReset({ every: 'weekly', weekday: 1, hour: 4 }, '2026-09-14T05:00:00Z')), '2026-09-21T04:00:00.000Z');
  });
  test('monthly / quarterly / yearly on the day of month', () => {
    assert.equal(iso(nextSeasonReset({ every: 'monthly', dayOfMonth: 1, hour: 0 }, '2026-09-11T10:00:00Z')), '2026-10-01T00:00:00.000Z');
    assert.equal(iso(nextSeasonReset({ every: 'monthly', dayOfMonth: 15, hour: 6 }, '2026-09-11T10:00:00Z')), '2026-09-15T06:00:00.000Z');
    assert.equal(iso(nextSeasonReset({ every: 'quarterly', dayOfMonth: 1, hour: 0 }, '2026-09-11T10:00:00Z')), '2026-10-01T00:00:00.000Z');
    assert.equal(iso(nextSeasonReset({ every: 'quarterly', dayOfMonth: 1, hour: 0 }, '2026-10-01T00:00:00Z')), '2027-01-01T00:00:00.000Z');
    assert.equal(iso(nextSeasonReset({ every: 'yearly', dayOfMonth: 1, hour: 0 }, '2026-09-11T10:00:00Z')), '2027-01-01T00:00:00.000Z');
    // 29–31 are refused so February always has the day.
    assert.equal(normalizeSeason({ dayOfMonth: 31 }).dayOfMonth, 28);
  });
  test('custom: every N days, anchored to the hour so a late run does not drift', () => {
    assert.equal(iso(nextSeasonReset({ every: 'custom', days: 10, hour: 4 }, '2026-09-11T04:37:00Z')), '2026-09-21T04:00:00.000Z');
  });
  test('a season length in weeks or months, which is what the dashboard asks for', () => {
    // `days` is the N; the suffix of `every` is its unit.
    assert.equal(iso(nextSeasonReset({ every: 'custom_weeks', days: 2, hour: 4 }, '2026-09-11T04:37:00Z')), '2026-09-25T04:00:00.000Z');
    assert.equal(iso(nextSeasonReset({ every: 'custom_weeks', days: 1, hour: 0 }, '2026-09-11T10:00:00Z')), '2026-09-18T00:00:00.000Z');
    // Calendar months, not 30-day blocks: three months from 12 January is 12 April.
    assert.equal(iso(nextSeasonReset({ every: 'custom_months', days: 3, hour: 4 }, '2026-01-12T10:00:00Z')), '2026-04-12T04:00:00.000Z');
    assert.equal(iso(nextSeasonReset({ every: 'custom_months', days: 1, hour: 4 }, '2026-12-05T10:00:00Z')), '2027-01-05T04:00:00.000Z');
    // The day is clamped to 28 like every other monthly schedule, so a season that starts on
    // the 31st does not skip February.
    assert.equal(iso(nextSeasonReset({ every: 'custom_months', days: 1, hour: 4 }, '2026-01-31T10:00:00Z')), '2026-02-28T04:00:00.000Z');
    // Every custom_* schedule is a real length; nothing else is.
    assert.deepEqual(seasonLength({ every: 'custom_weeks', days: 2 }), { n: 2, unit: 'weeks' });
    assert.deepEqual(seasonLength({ every: 'custom_months', days: 6 }), { n: 6, unit: 'months' });
    assert.deepEqual(seasonLength({ every: 'custom', days: 45 }), { n: 45, unit: 'days' });
    assert.equal(seasonLength({ every: 'monthly' }), null);
    // An unknown `every` still normalises to "never" rather than throwing.
    assert.equal(normalizeSeason({ every: 'custom_fortnights' }).every, 'never');
    assert.ok(SEASON_EVERY.includes('custom_weeks') && SEASON_EVERY.includes('custom_months'));
  });
  test('seasonDue needs a clock and honours it', () => {
    const cfg = { every: 'weekly', weekday: 1, hour: 4 };
    assert.equal(seasonDue(cfg, {}, new Date('2026-09-20T00:00:00Z')), false, 'no since, no last reset: never due');
    assert.equal(seasonDue(cfg, { since: '2026-09-11T10:00:00Z' }, new Date('2026-09-13T00:00:00Z')), false);
    assert.equal(seasonDue(cfg, { since: '2026-09-11T10:00:00Z' }, new Date('2026-09-14T04:00:00Z')), true);
    assert.equal(seasonDue(cfg, { since: '2026-09-11T10:00:00Z', lastResetAt: '2026-09-14T04:00:10Z' }, new Date('2026-09-15T00:00:00Z')), false, 'just reset: the next one is a week away');
  });
});

describe('statistics', () => {
  test('every ledger kind lands in one bucket, and a gift is counted once', () => {
    assert.equal(classify('levelup', 10), 'generated');
    assert.equal(classify('grant', -5), 'lost');
    assert.equal(classify('casino', 40), 'won');
    assert.equal(classify('casino', -20), 'lost');
    assert.equal(classify('gift_out', -3), 'given');
    assert.equal(classify('gift_in', 3), null);
    assert.equal(classify('purchase', -50), 'used');
    assert.equal(classify('season', -999), 'lost');
    for (const m of METRICS) assert.ok(typeof m === 'string');
  });
  test('windows are UTC and contiguous', () => {
    const w = windowsOf(new Date('2026-09-11T15:00:00Z')); // a Friday
    assert.equal(w.today[0].toISOString(), '2026-09-11T00:00:00.000Z');
    assert.equal(w.yesterday[1].getTime(), w.today[0].getTime());
    assert.equal(w.thisWeek[0].toISOString(), '2026-09-07T00:00:00.000Z', 'weeks start on Monday');
    assert.equal(w.lastWeek[1].getTime(), w.thisWeek[0].getTime());
    assert.equal(w.thisMonth[0].toISOString(), '2026-09-01T00:00:00.000Z');
    assert.equal(w.lastMonth[0].toISOString(), '2026-08-01T00:00:00.000Z');
  });
  test('foldStats sums per window and per day, counts rows once, and nets the flows', () => {
    const now = new Date('2026-09-11T15:00:00Z');
    const rows = [
      { day: '2026-09-11T00:00:00Z', kind: 'levelup', pos: 100, neg: 0, n: 10 },
      { day: '2026-09-11T00:00:00Z', kind: 'casino', pos: 30, neg: 80, n: 12 },
      { day: '2026-09-10T00:00:00Z', kind: 'gift_out', pos: 0, neg: 25, n: 2 },
      { day: '2026-09-10T00:00:00Z', kind: 'gift_in', pos: 25, neg: 0, n: 2 },
      { day: '2026-08-20T00:00:00Z', kind: 'purchase', pos: 0, neg: 200, n: 4 },
    ];
    const { windows, series } = foldStats(rows, now, 30);
    assert.deepEqual({ ...windows.today }, { generated: 100, won: 30, lost: 80, given: 0, used: 0, rows: 22, net: 50 });
    assert.equal(windows.yesterday.given, 25, 'the giver side');
    assert.equal(windows.yesterday.generated, 0, 'the receiver side is not a second flow');
    assert.equal(windows.thisWeek.generated, 100);
    assert.equal(windows.lastMonth.used, 200);
    assert.equal(windows.thisMonth.used, 0);
    assert.equal(series.length, 30);
    assert.equal(series[series.length - 1].day, '2026-09-11');
    assert.equal(series[series.length - 1].net, 50);
    assert.equal(series[series.length - 2].given, 25);
  });
});
