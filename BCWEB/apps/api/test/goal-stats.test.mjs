// Conversion goals, measured against a real Postgres.
//
// The goals endpoint is behind requireCap('manage_analytics') and admin routes require 2FA,
// so no test can reach it through HTTP — which is why the counting was never covered and why
// it was pulled into lib/goal-stats.mjs.
//
// What is actually at risk here is the positional parameters. Every optional part of a goal
// (a path filter, a label filter, a dimension value) adds a clause, and the upper time bound
// is appended last, so $2 means something different in each of the eight shapes a goal can
// take. Get one wrong and Postgres does not necessarily complain — it compares a path against
// a timestamp, or silently matches nothing, and the dashboard reports a confident zero.
//
// So every shape is exercised against rows whose right answer is known by construction, and
// the two windows are checked separately: the whole point of the previous-period comparison
// is that `to` is honoured, and an ignored upper bound would make every goal look flat.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see the runbook) to run goal tests';
let p, measureGoal;

// A quiet corner of the past this suite owns, well inside any retention window (see the note
// in rollup.test.mjs about a parallel suite purging older rows mid-run).
const DAY = 864e5;
const NOW_FROM = new Date(Date.now() - 3 * DAY);           // "current" window: last 3 days
const PREV_FROM = new Date(Date.now() - 6 * DAY);          // the 3 days before that
const inNow = new Date(Date.now() - 2 * DAY);
const inPrev = new Date(Date.now() - 5 * DAY);
const TAG = 'goalstats-fixture';                            // every row we create carries it

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
  ({ measureGoal } = await import('../src/lib/goal-stats.mjs'));

  const pv = (createdAt, visitor, extra = {}) => ({
    path: `/${TAG}/checkout`, visitor, createdAt, device: 'desktop', browser: 'Chrome', os: 'Windows', ...extra,
  });
  await p.analyticsEvent.createMany({ data: [
    // Current window: 3 rows, 2 distinct visitors, all on the goal path.
    pv(inNow, `${TAG}-a`, { country: 'CH', ref: 'https://news.example/post' }),
    pv(inNow, `${TAG}-a`, { country: 'CH', ref: 'https://news.example/post' }),
    pv(inNow, `${TAG}-b`, { country: 'FR', ref: null }),
    // Current window, a DIFFERENT path — must not be counted by a path-filtered goal.
    pv(inNow, `${TAG}-c`, { country: 'CH', path: `/${TAG}/other` }),
    // Previous window: 1 row, 1 visitor.
    pv(inPrev, `${TAG}-a`, { country: 'CH', ref: 'https://news.example/post' }),
  ] });
  await p.interactionEvent.createMany({ data: [
    { path: `/${TAG}/checkout`, kind: 'click', label: 'Buy now', visitor: `${TAG}-a`, device: 'desktop', createdAt: inNow },
    { path: `/${TAG}/checkout`, kind: 'click', label: 'Buy now', visitor: `${TAG}-b`, device: 'desktop', createdAt: inNow },
    { path: `/${TAG}/checkout`, kind: 'click', label: 'Cancel',  visitor: `${TAG}-a`, device: 'desktop', createdAt: inNow },
    { path: `/${TAG}/other`,    kind: 'submit', label: 'Buy now', visitor: `${TAG}-a`, device: 'desktop', createdAt: inNow },
    { path: `/${TAG}/checkout`, kind: 'click', label: 'Buy now', visitor: `${TAG}-a`, device: 'desktop', createdAt: inPrev },
  ] });
});

// It is the user's dev database. Take the fixtures back out.
after(async () => {
  if (!RUN) return;
  await p.analyticsEvent.deleteMany({ where: { visitor: { startsWith: TAG } } }).catch(() => {});
  await p.interactionEvent.deleteMany({ where: { visitor: { startsWith: TAG } } }).catch(() => {});
  await p.$disconnect?.();
});

test('a pageview goal with a path counts rows and distinct visitors', { skip }, async () => {
  const g = { kind: 'pageview', path: `/${TAG}/checkout` };
  assert.deepEqual(await measureGoal(p, g, NOW_FROM, null), { completions: 3, visitors: 2 });
});

test('the upper bound is honoured, so the previous period is a different number', { skip }, async () => {
  const g = { kind: 'pageview', path: `/${TAG}/checkout` };
  // If `to` were dropped the previous window would swallow the current one and report 4/2 —
  // which would make every goal on the dashboard look flat, convincingly.
  assert.deepEqual(await measureGoal(p, g, PREV_FROM, NOW_FROM), { completions: 1, visitors: 1 });
});

test('an interaction goal filters on kind, path and label together', { skip }, async () => {
  const g = { kind: 'click', path: `/${TAG}/checkout`, label: 'Buy now' };
  // Two "Buy now" clicks on that path in the window; "Cancel" and the /other submit are out.
  assert.deepEqual(await measureGoal(p, g, NOW_FROM, null), { completions: 2, visitors: 2 });
});

test('an interaction goal with no label counts every kind on the path', { skip }, async () => {
  const g = { kind: 'click', path: `/${TAG}/checkout`, label: null };
  assert.deepEqual(await measureGoal(p, g, NOW_FROM, null), { completions: 3, visitors: 2 });
});

test('a country goal matches exactly', { skip }, async () => {
  const g = { kind: 'country', label: 'CH', path: `/${TAG}/` };
  // CH rows on any /goalstats-fixture/ path in the window: two on /checkout, one on /other.
  assert.deepEqual(await measureGoal(p, g, NOW_FROM, null), { completions: 3, visitors: 2 });
});

test('a referrer goal matches on a substring', { skip }, async () => {
  const g = { kind: 'referrer', label: 'news.example', path: `/${TAG}/` };
  assert.deepEqual(await measureGoal(p, g, NOW_FROM, null), { completions: 2, visitors: 1 });
});

test('a dimension goal with no value means "the field is set at all"', { skip }, async () => {
  const g = { kind: 'referrer', label: null, path: `/${TAG}/` };
  // Only the two rows that HAVE a referrer; the null-ref row is excluded.
  assert.deepEqual(await measureGoal(p, g, NOW_FROM, null), { completions: 2, visitors: 1 });
});

test('a dimension goal with no path is not restricted by one', { skip }, async () => {
  const withPath = await measureGoal(p, { kind: 'country', label: 'CH', path: `/${TAG}/checkout` }, NOW_FROM, null);
  const noPath = await measureGoal(p, { kind: 'country', label: 'CH', path: null }, NOW_FROM, null);
  assert.equal(withPath.completions, 2, 'only the two CH rows on /checkout');
  assert.ok(noPath.completions >= 3, 'without a path it must also see the CH row on /other');
});
