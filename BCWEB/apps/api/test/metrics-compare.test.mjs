// The daily-metrics comparison math (lib/metrics-compare.mjs). Pure — no DB.
//
// The thing to get right is what "no data" produces. A comparison against an empty window
// must come out as null, never as a change of zero: a flat line at zero is a statement about
// the server, and an empty table is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowBounds, summariseDaily, percentChange, compareDaily, dailyPoint } from '../src/lib/metrics-compare.mjs';

const day = (d, o) => ({ day: new Date(`2026-09-${String(d).padStart(2, '0')}T00:00:00Z`), samples: 144, cpuAvg: 20, cpuMax: 40, memAvg: 50, memMax: 60, diskAvg: 70, diskMax: 71, latencyAvg: 100, ...o });

test('windowBounds: the previous window is the same length, ending the day before the current one starts', () => {
  const now = new Date('2026-09-15T13:45:00Z');
  const w = windowBounds(7, now);
  assert.equal(w.days, 7);
  assert.equal(w.today.toISOString(), '2026-09-15T00:00:00.000Z');
  assert.equal(w.startCur.toISOString(), '2026-09-09T00:00:00.000Z');   // 7 days inclusive of today
  assert.equal(w.startPrev.toISOString(), '2026-09-02T00:00:00.000Z');  // the 7 before that
  assert.equal(w.previousTo.toISOString(), '2026-09-08T00:00:00.000Z');
  // A day is one day: current = today, previous = yesterday.
  const one = windowBounds(1, now);
  assert.equal(one.startCur.toISOString(), '2026-09-15T00:00:00.000Z');
  assert.equal(one.startPrev.toISOString(), '2026-09-14T00:00:00.000Z');
  assert.equal(one.previousTo.toISOString(), '2026-09-14T00:00:00.000Z');
});

test('windowBounds: nonsense and out-of-range day counts are clamped, not honoured', () => {
  assert.equal(windowBounds('abc').days, 7);
  assert.equal(windowBounds(0).days, 1);
  assert.equal(windowBounds(-3).days, 1);
  assert.equal(windowBounds(99999).days, 366);
});

test('summariseDaily: averages are weighted by samples, peaks are the max', () => {
  // Day A: 144 samples at 20% CPU; day B: 16 samples at 100%. Unweighted that is 60; weighted it
  // is (20·144 + 100·16) / 160 = 28.
  const s = summariseDaily([day(1, { cpuAvg: 20, cpuMax: 30 }), day(2, { samples: 16, cpuAvg: 100, cpuMax: 100 })]);
  assert.equal(s.days, 2);
  assert.equal(s.samples, 160);
  assert.equal(s.cpu, 28);
  assert.equal(s.cpuMax, 100);
  assert.equal(s.mem, 50);
  assert.equal(s.latencyMs, 100);
});

test('summariseDaily: an empty window is null, not a row of zeros', () => {
  assert.equal(summariseDaily([]), null);
  assert.equal(summariseDaily(null), null);
});

test('percentChange: relative to the previous value; null against nothing or zero', () => {
  assert.equal(percentChange(30, 20), 50);
  assert.equal(percentChange(15, 20), -25);
  assert.equal(percentChange(20, 20), 0);
  assert.equal(percentChange(20, null), null);
  assert.equal(percentChange(null, 20), null);
  assert.equal(percentChange(20, 0), null);      // "up from nothing" is not a percentage
  assert.equal(percentChange(33.333, 30), 11.1); // one decimal
});

test('compareDaily: every metric carries both values, the absolute and the relative change', () => {
  const cur = summariseDaily([day(8, { cpuAvg: 30, memAvg: 55, diskAvg: 70, latencyAvg: 120, cpuMax: 90 })]);
  const prev = summariseDaily([day(1, { cpuAvg: 20, memAvg: 50, diskAvg: 70, latencyAvg: 100, cpuMax: 45 })]);
  const c = compareDaily(cur, prev);
  assert.deepEqual(c.cpu, { current: 30, previous: 20, abs: 10, pct: 50 });
  assert.deepEqual(c.mem, { current: 55, previous: 50, abs: 5, pct: 10 });
  assert.deepEqual(c.disk, { current: 70, previous: 70, abs: 0, pct: 0 });
  assert.deepEqual(c.latencyMs, { current: 120, previous: 100, abs: 20, pct: 20 });
  assert.deepEqual(c.cpuMax, { current: 90, previous: 45, abs: 45, pct: 100 });
});

test('compareDaily: a missing previous window yields nulls, never zeros', () => {
  const cur = summariseDaily([day(8)]);
  const c = compareDaily(cur, null);
  assert.equal(c.cpu.current, 20);
  assert.equal(c.cpu.previous, null);
  assert.equal(c.cpu.abs, null);
  assert.equal(c.cpu.pct, null);
});

test('dailyPoint: what the charts draw — rounded averages, peaks alongside, latency as an integer', () => {
  const pt = dailyPoint(day(3, { cpuAvg: 12.345, latencyAvg: 87.6 }));
  assert.equal(pt.cpu, 12.3);
  assert.equal(pt.latencyMs, 88);
  assert.equal(pt.cpuMax, 40);
  assert.equal(pt.samples, 144);
  assert.equal(dailyPoint(day(3, { latencyAvg: null })).latencyMs, null);
});

test('the public status route no longer reads the daily metrics table', async () => {
  // A source-level guard: the route talks to live probes, which is not what this test is for.
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/routes/status.mjs', import.meta.url), 'utf8');
  assert.ok(!src.includes('serverMetricDaily'), 'GET /status must not query ServerMetricDaily');
  assert.ok(!/^\s*metrics:/m.test(src), 'GET /status must not publish a `metrics` field');
});
