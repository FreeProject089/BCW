// "Is the server all right?" — the answer Simple mode shows.
//
// Pure by design, so every boundary can be pinned rather than sampled from whatever the
// machine happens to be doing. The boundaries are the whole value: a verdict that says "ok"
// at 89.9% of a 90% ceiling and "problem" at 90.0% is only useful if those two numbers are
// exactly where they claim to be.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverVerdict, ALERT_THRESHOLDS } from '../src/lib/thresholds.mjs';

const T = ALERT_THRESHOLDS;              // cpuPct/memPct/diskPct all 90 by default
const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);
const sample = (o = {}) => ({ cpuPct: 5, memPct: 5, diskPct: 5, createdAt: new Date(NOW - 60_000), ...o });
const v = (s, t = T) => serverVerdict(s, t, { now: NOW });

test('a quiet machine is ok, with nothing to say about it', () => {
  const r = v(sample());
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.reasons, []);
});

test('at the ceiling is a problem; a hair under it is not', () => {
  assert.equal(v(sample({ diskPct: 90 })).state, 'problem', '90 >= 90 fires');
  assert.equal(v(sample({ diskPct: 89.9 })).state, 'watch', 'just under the ceiling is still watch');
  // 90% of the 90 ceiling = 81. This is the line that makes "watch" mean something.
  assert.equal(v(sample({ diskPct: 81 })).state, 'watch');
  assert.equal(v(sample({ diskPct: 80.9 })).state, 'ok');
});

test('the reason names the metric, its value and the limit it is measured against', () => {
  const r = v(sample({ memPct: 93 }));
  assert.equal(r.state, 'problem');
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0].text, /Memory at 93% \(limit 90%\)/);
  assert.equal(r.reasons[0].key, 'mem');
  assert.equal(r.reasons[0].level, 'problem');
});

test('one problem outranks any number of watches', () => {
  const r = v(sample({ cpuPct: 85, memPct: 85, diskPct: 95 }));
  assert.equal(r.state, 'problem');
  assert.equal(r.reasons.length, 3, 'and it still lists all three, so nothing is hidden by the worst');
  assert.deepEqual(r.reasons.map((x) => x.level), ['watch', 'watch', 'problem']);
});

test('a stale sample is unknown, not healthy', () => {
  // The one case where the machine is in trouble is also the case where it stops writing
  // samples. Reporting the last known numbers as current would be green while it burns.
  const r = v(sample({ createdAt: new Date(NOW - 45 * 60_000) }));
  assert.equal(r.state, 'unknown');
  assert.match(r.reasons[0].text, /45 min old/);
});

test('a sample just inside the staleness window is still trusted', () => {
  assert.equal(v(sample({ createdAt: new Date(NOW - 29 * 60_000) })).state, 'ok');
});

test('no sample at all says so rather than guessing', () => {
  const r = v(null);
  assert.equal(r.state, 'unknown');
  assert.equal(r.reasons[0].key, 'nosample');
});

test('custom thresholds are honoured — this is what makes editing them mean anything', () => {
  const strict = { ...T, diskPct: 50 };
  assert.equal(v(sample({ diskPct: 60 }), strict).state, 'problem');
  assert.equal(v(sample({ diskPct: 60 })).state, 'ok', 'the same sample is fine under the defaults');
});

test('a missing or nonsensical metric is skipped, not counted as zero', () => {
  // A sample with no cpuPct must not read as "CPU at 0%, all good" and must not throw.
  assert.equal(v({ memPct: 5, diskPct: 5, createdAt: new Date(NOW) }).state, 'ok');
  assert.equal(v(sample({ cpuPct: null })).reasons.length, 0);
  // A threshold of 0 would mean "alert on everything"; it is treated as unset instead.
  assert.equal(v(sample({ diskPct: 5 }), { ...T, diskPct: 0 }).state, 'ok');
});
