// The baseline / anomaly maths behind the analytics Trends view.
//
// Worth testing rather than eyeballing, because every failure mode here is a chart that looks
// completely plausible: a baseline that lags, a trajectory invented by a quiet Sunday, a
// four-day slump drawn as four separate crises. None of those throw, and none of them look
// wrong unless you already know the right answer.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rollingMedian, smooth, distancePct, flagDrops, trajectory, analyseTrend, robustCeiling, SENSITIVITY } from '../src/lib/trend.js';

const rows = (values, metric = 'views') => values.map((v, i) => ({
  day: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
  [metric]: v,
}));

describe('rollingMedian', () => {
  test('is null until the window is full, then is the trailing median', () => {
    assert.deepEqual(rollingMedian([1, 2, 3, 4], 3), [null, null, 2, 3]);
  });
  test('an even window averages the two middle values', () => {
    assert.deepEqual(rollingMedian([1, 2, 3, 10], 4), [null, null, null, 2.5]);
  });
  test('a window longer than the data is all null rather than a partial answer', () => {
    assert.deepEqual(rollingMedian([5, 5], 4), [null, null]);
  });
  test('window 1 is the values themselves', () => {
    assert.deepEqual(rollingMedian([4, 9], 1), [4, 9]);
  });
  test('one huge outlier does not move it — the reason it is a median', () => {
    assert.deepEqual(rollingMedian([10, 10, 10, 10, 100000], 5), [null, null, null, null, 10]);
  });
  test('it does not reorder the caller’s array', () => {
    const input = [3, 1, 2];
    rollingMedian(input, 3);
    assert.deepEqual(input, [3, 1, 2]);
  });
});

describe('robustCeiling', () => {
  test('a lone outlier does not set the axis', () => {
    const v = [...new Array(99).fill(100), 5000];
    assert.ok(robustCeiling(v, { percentile: 0.9 }) <= 200, 'one spike still set the ceiling');
  });
  test('the percentile must clear a SMOOTHED spike, not just a single day', () => {
    // The bug this exists for: a 7-day trailing average turns one viral day into a seven-day
    // plateau. In a 200-day series that plateau IS the top 3.5%, so a 98th percentile lands
    // inside it and the "cap" comes out one percent below the plain maximum — which is to say
    // it does nothing at all. Shipped that way once; the chart was unreadable.
    const v = [...new Array(193).fill(100), ...new Array(7).fill(4000)];
    assert.ok(robustCeiling(v, { percentile: 0.98 }) > 1000, 'p98 was expected to land inside the plateau');
    assert.equal(robustCeiling(v, { percentile: 0.9 }), 100);
  });
  test('the floor keeps a genuinely climbing site from being cropped', () => {
    assert.equal(robustCeiling([...new Array(99).fill(100), 5000], { percentile: 0.9, floor: 900 }), 900);
  });
  test('never above the real maximum — a quiet series gets no ceiling it never reaches', () => {
    assert.equal(robustCeiling([1, 2, 3], { percentile: 0.9, floor: 99999 }), 3);
  });
  test('an empty or all-null series answers 1, not NaN', () => {
    assert.equal(robustCeiling([]), 1);
    assert.equal(robustCeiling([null, undefined, NaN]), 1);
  });
  test('it does not reorder the caller’s array', () => {
    const input = [9, 1, 5];
    robustCeiling(input);
    assert.deepEqual(input, [9, 1, 5]);
  });
});

describe('smooth', () => {
  test('starts at the first point instead of a window in', () => {
    const s = smooth([10, 20, 30], 3);
    assert.equal(s[0], 10);          // averaged over what exists
    assert.equal(s[1], 15);
    assert.equal(s[2], 20);
  });
  test('is TRAILING — a later value never changes an earlier point', () => {
    const short = smooth([10, 20, 30], 3);
    const long = smooth([10, 20, 30, 1000], 3);
    assert.deepEqual(long.slice(0, 3), short);
  });
});

describe('distancePct', () => {
  test('is a percentage of the baseline, not an absolute difference', () => {
    assert.deepEqual(distancePct([50, 200], [100, 100]), [-50, 100]);
  });
  test('a zero baseline has no percentage rather than Infinity', () => {
    assert.deepEqual(distancePct([5], [0]), [null]);
    assert.deepEqual(distancePct([5], [null]), [null]);
  });
});

describe('flagDrops', () => {
  const days = Array.from({ length: 10 }, (_, i) => `d${i}`);
  test('a contiguous slump is ONE event, marked at its deepest day', () => {
    const dist = [0, 0, -30, -55, -40, 0, 0, 0, 0, 0];
    const ev = flagDrops(days, dist, { sensitivity: 'medium' });
    assert.equal(ev.length, 1);
    assert.equal(ev[0].day, 'd3');
    assert.equal(ev[0].drop, -55);
    assert.equal(ev[0].length, 3);
  });
  test('two separate slumps are two events', () => {
    const dist = [-30, -30, 0, 0, -40, -40, 0, 0, 0, 0];
    assert.equal(flagDrops(days, dist, { sensitivity: 'medium' }).length, 2);
  });
  test('a single bad day is not an episode', () => {
    assert.deepEqual(flagDrops(days, [0, -80, 0, 0, 0, 0, 0, 0, 0, 0], { sensitivity: 'medium' }), []);
  });
  test('a slump running to the last day is still flagged — the run is closed at the end', () => {
    const dist = [0, 0, 0, 0, 0, 0, 0, 0, -50, -60];
    const ev = flagDrops(days, dist, { sensitivity: 'medium' });
    assert.equal(ev.length, 1);
    assert.equal(ev[0].day, 'd9');
  });
  test('sensitivity moves the threshold in the direction its name claims', () => {
    const dist = [0, -20, -20, 0, 0, 0, 0, 0, 0, 0];
    assert.equal(flagDrops(days, dist, { sensitivity: 'high' }).length, 1);   // 15% → caught
    assert.equal(flagDrops(days, dist, { sensitivity: 'medium' }).length, 0); // 25% → not
    assert.equal(flagDrops(days, dist, { sensitivity: 'low' }).length, 0);    // 40% → not
    assert.ok(SENSITIVITY.high < SENSITIVITY.medium && SENSITIVITY.medium < SENSITIVITY.low);
  });
  test('nulls (before the baseline warms up) are gaps, not drops', () => {
    const dist = [null, null, null, 0, 0, 0, 0, 0, 0, 0];
    assert.deepEqual(flagDrops(days, dist, { sensitivity: 'high' }), []);
  });
  test('a null in the MIDDLE breaks a run rather than bridging it', () => {
    const dist = [-50, null, -50, 0, 0, 0, 0, 0, 0, 0];
    assert.deepEqual(flagDrops(days, dist, { sensitivity: 'medium' }), []);
  });
});

describe('trajectory', () => {
  test('compares two whole windows, so one quiet day at an edge is not a trend', () => {
    // Flat 100s with a single quiet Sunday at the very end. Last-value-minus-value-then
    // would call this −90%; comparing windows sees it for what it is.
    const flat = new Array(28).fill(100); flat[27] = 10;
    const tr = trajectory(flat, 14);
    assert.ok(tr > -10 && tr < 0, `expected a small dip, got ${tr}`);
  });
  test('a genuine doubling reads as +100%', () => {
    assert.equal(trajectory([...new Array(14).fill(50), ...new Array(14).fill(100)], 14), 100);
  });
  test('null rather than a comparison against a partial window', () => {
    assert.equal(trajectory(new Array(27).fill(1), 14), null);
    assert.equal(trajectory(new Array(28).fill(1), 14), 0);
  });
  test('growth from nothing is +100%, not a division by zero', () => {
    assert.equal(trajectory([...new Array(3).fill(0), ...new Array(3).fill(9)], 3), 100);
    assert.equal(trajectory(new Array(6).fill(0), 3), 0);
  });
});

describe('analyseTrend', () => {
  test('reads the metric it was asked for', () => {
    const data = [{ day: '2026-01-01', views: 10, visitors: 3 }, { day: '2026-01-02', views: 20, visitors: 4 }];
    assert.deepEqual(analyseTrend(data, { metric: 'views' }).raw, [10, 20]);
    assert.deepEqual(analyseTrend(data, { metric: 'visitors' }).raw, [10 * 0 + 3, 4]);
  });

  test('one 20× spike does not turn the next thirty ordinary days into a crisis', () => {
    // Sixty flat days with a single 20× spike in the middle — a post that got shared once.
    // Everything after it is perfectly ordinary. Written with a MEAN baseline this failed:
    // normal was dragged up 63% for a month and every following day read as a −39% collapse,
    // i.e. the alert fired because traffic went up. Smoothing first does not help; a median
    // does.
    const v = new Array(60).fill(100); v[30] = 2000;
    const a = analyseTrend(rows(v), { baselineWindow: 30, smoothWindow: 7, sensitivity: 'medium' });
    assert.deepEqual(a.events, [], `a flat site with one spike flagged ${a.events.length} crisis/crises`);
  });

  test('a real collapse IS flagged, once', () => {
    const v = [...new Array(60).fill(1000), ...new Array(10).fill(150), ...new Array(30).fill(1000)];
    const a = analyseTrend(rows(v), { baselineWindow: 30, smoothWindow: 7, sensitivity: 'medium' });
    assert.equal(a.events.length, 1, `expected one episode, got ${a.events.map((e) => e.day).join(', ')}`);
    assert.ok(a.events[0].drop < -25);
  });

  test('a zero-fill gap — the site actually went dark — is the loudest event there is', () => {
    const v = [...new Array(60).fill(500), ...new Array(5).fill(0), ...new Array(20).fill(500)];
    const a = analyseTrend(rows(v), { baselineWindow: 30, sensitivity: 'low' });
    assert.equal(a.events.length, 1);
    assert.ok(a.events[0].drop <= -40);
  });

  test('a steadily growing site is never flagged as a crisis', () => {
    const a = analyseTrend(rows(Array.from({ length: 120 }, (_, i) => 100 + i * 5)), { sensitivity: 'high' });
    assert.deepEqual(a.events, []);
    assert.ok(a.vsBaseline > 0, 'growth should sit above its own baseline');
    assert.ok(a.d30 > 0);
  });

  test('an empty series answers rather than throwing', () => {
    const a = analyseTrend([], {});
    assert.deepEqual(a.events, []);
    assert.equal(a.baseNow, null);
    assert.equal(a.vsBaseline, null);
    assert.equal(a.d14, null);
  });

  test('every array it returns is the same length as the input', () => {
    const a = analyseTrend(rows(new Array(45).fill(7)), { baselineWindow: 30 });
    for (const k of ['days', 'raw', 'line', 'base', 'dist']) {
      assert.equal(a[k].length, 45, `${k} is ${a[k].length}, not 45 — the chart would draw it misaligned`);
    }
  });
});
