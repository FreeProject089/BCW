// B13 — the git-activity engine turns GitHub commit-stats into heatmap + span + contributors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeActivity, releaseMarkers } from '../src/lib/git-activity.mjs';

const WEEK = 604800;
const W0 = Math.floor(Date.UTC(2026, 0, 4) / 1000); // a Sunday

test('daily heatmap, active days and busiest day from commit_activity', () => {
  const ca = [
    { week: W0, total: 5, days: [0, 2, 0, 3, 0, 0, 0] },
    { week: W0 + WEEK, total: 1, days: [1, 0, 0, 0, 0, 0, 0] },
  ];
  const out = computeActivity(ca, []);
  assert.equal(out.heatmap.length, 14);           // 2 weeks × 7 days
  assert.equal(out.yearCommits, 6);
  assert.equal(out.activeDays, 3);                 // Mon+Wed of wk0, Sun of wk1
  assert.equal(out.busiestDay.count, 3);
  assert.equal(out.heatmap[0].date, '2026-01-04'); // W0 is Sunday
  assert.equal(out.heatmap[3].count, 3);           // Wed of wk0
});

test('contributors, total and span from stats/contributors', () => {
  const contribs = [
    { total: 40, author: { login: 'alice' }, weeks: [{ w: W0, c: 40 }] },
    { total: 10, author: { login: 'bob' }, weeks: [{ w: W0 - 52 * WEEK, c: 10 }] },
    { total: 0, author: { login: 'ghost' }, weeks: [{ w: W0, c: 0 }] }, // no commits → dropped
  ];
  const out = computeActivity([], contribs);
  assert.equal(out.totalCommits, 50);
  assert.deepEqual(out.contributors.map((c) => c.name), ['alice', 'bob']); // sorted desc, ghost gone
  assert.equal(out.firstCommit, iso(W0 - 52 * WEEK));
  assert.equal(out.lastCommit, iso(W0));
  assert.equal(out.spanMonths, 12);               // ~52 weeks
  assert.ok(out.spanYears >= 0.9 && out.spanYears <= 1.1);
});

test('empty / malformed input never throws and yields zeros', () => {
  const out = computeActivity(null, undefined);
  assert.equal(out.heatmap.length, 0);
  assert.equal(out.totalCommits, 0);
  assert.equal(out.firstCommit, null);
  assert.equal(out.spanDays, 0);
});

test('release markers respect the include-messages toggle and drop drafts', () => {
  const rel = [
    { tag_name: 'v1.0', name: 'One', published_at: '2026-02-01T00:00:00Z', body: 'notes' },
    { tag_name: 'v0.9', name: 'Beta', created_at: '2026-01-01T00:00:00Z', prerelease: true, body: 'x' },
    { tag_name: 'draft', draft: true, created_at: '2026-03-01T00:00:00Z' },
  ];
  const off = releaseMarkers(rel);
  assert.equal(off.length, 2);                     // draft dropped
  assert.equal(off[0].date, '2026-01-01');         // sorted ascending
  assert.equal(off[1].kind, 'release');
  assert.ok(!('body' in off[1]));                  // messages off by default
  const on = releaseMarkers(rel, { includeMessages: true });
  assert.equal(on[1].body, 'notes');               // messages on
  assert.equal(on[0].kind, 'prerelease');
});

function iso(s) { return new Date(s * 1000).toISOString().slice(0, 10); }
