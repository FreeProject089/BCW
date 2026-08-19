// Tests for the analytics daily rollup (sweeper → AnalyticsDaily), which backs the
// dashboard's day-granularity series. Needs a throwaway Postgres (DATABASE_URL); skipped
// without one. Seeds events on an isolated past day, runs the rollup, and checks the
// day's views (row count) + visitors (distinct) match — and that a re-run is idempotent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run rollup tests';
let p, rollupAnalyticsDaily;

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  ({ rollupAnalyticsDaily } = await import('../src/lib/sweeper.mjs'));
});
after(async () => { if (RUN) await p?.$disconnect?.(); });

const log = { warn() {} };

test('rollup aggregates a day into views (count) + visitors (distinct), idempotently', { skip }, async () => {
  // An isolated day 10 days in the past, at 10:00 UTC.
  //
  // TEN, not 105, and the number is load-bearing. retention.test.mjs runs in a PARALLEL
  // process against the SAME database: it sets analytics.retention to pageviewDays: 30 and
  // calls sweepAnalyticsRetention, which deletes every AnalyticsEvent older than 30 days.
  // Seeded at 105 days these four rows were inside that purge, so whether they survived
  // depended on which process won the race — and because the purge deletes in bounded
  // batches, a mid-insert hit left a PARTIAL count. That is exactly what CI saw: views = 1
  // where 4 were expected, on a suite that is green every time locally.
  //
  // 10 keeps the day outside the rollup's trailing 3-day window (so the idempotency half of
  // this test still means something) and inside any retention floor the suite uses. Nothing
  // else seeds analytics events here: retention.test.mjs uses 60 days, 9999 days and now.
  //
  // Do not move this back without checking what retention.test.mjs purges.
  const at = new Date(); at.setUTCDate(at.getUTCDate() - 10); at.setUTCHours(10, 0, 0, 0);
  const dayKey = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const tag = `roll-${Date.now()}`;
  // 4 events, 3 distinct visitors, all on that day.
  for (const v of [`${tag}-a`, `${tag}-a`, `${tag}-b`, `${tag}-c`]) {
    await p.analyticsEvent.create({ data: { path: '/x', visitor: v, createdAt: at } });
  }
  // Fresh DB → no analytics.rollupAt yet → the full recompute runs and backfills this day.
  await rollupAnalyticsDaily(p, log);

  const row = await p.analyticsDaily.findUnique({ where: { day: dayKey } });
  assert.ok(row, 'a rollup row should exist for the seeded day');
  assert.equal(row.views, 4, 'views = total events that day');
  assert.equal(row.visitors, 3, 'visitors = distinct visitors that day');

  // Re-run: the once/day full recompute is now gated off, and the seeded day is outside the
  // trailing 3-day window, so its row must be unchanged (idempotent, no double count).
  await rollupAnalyticsDaily(p, log);
  const again = await p.analyticsDaily.findUnique({ where: { day: dayKey } });
  assert.equal(again.views, 4);
  assert.equal(again.visitors, 3);
});
