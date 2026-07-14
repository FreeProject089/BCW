// Tests for analytics retention (audit §3.6 — bound the append-only analytics tables).
// The pure resolveRetention() tests always run; the sweep integration tests need a
// throwaway Postgres (DATABASE_URL) and are skipped without one, like pool-billing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRetention, RETENTION_DEFAULTS } from '../src/lib/retention.mjs';

// ── pure config resolver (no DB) ─────────────────────────────────────────────
test('resolveRetention: no override → defaults', () => {
  assert.deepEqual(resolveRetention(undefined), RETENTION_DEFAULTS);
  assert.deepEqual(resolveRetention(null), RETENTION_DEFAULTS);
  assert.deepEqual(resolveRetention({}), RETENTION_DEFAULTS);
});
test('resolveRetention: partial override fills the rest from defaults', () => {
  const r = resolveRetention({ pageviewDays: 30 });
  assert.equal(r.pageviewDays, 30);
  assert.equal(r.interactionDays, RETENTION_DEFAULTS.interactionDays);
  assert.equal(r.vitalDays, RETENTION_DEFAULTS.vitalDays);
  assert.equal(r.loginDays, RETENTION_DEFAULTS.loginDays);
});
test('resolveRetention: 0 is honored (keep forever), non-numeric falls back', () => {
  assert.equal(resolveRetention({ pageviewDays: 0 }).pageviewDays, 0);
  assert.equal(resolveRetention({ loginDays: 'nope' }).loginDays, RETENTION_DEFAULTS.loginDays);
  assert.equal(resolveRetention({ vitalDays: 7 }).vitalDays, 7);
});

// ── sweep integration (needs Postgres) ───────────────────────────────────────
const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run retention sweep tests';
const DAY_MS = 864e5;
const daysAgo = (d) => new Date(Date.now() - d * DAY_MS);
let p, sweepAnalyticsRetention;

before(async () => {
  if (!RUN) return;
  const lib = await import('../src/lib/lib.mjs');
  p = await lib.db();
  ({ sweepAnalyticsRetention } = await import('../src/lib/sweeper.mjs'));
});
after(async () => { if (RUN) await p?.$disconnect?.(); });

const log = { warn() {} };
const setCfg = (cfg) => p.adminSetting.upsert({ where: { key: 'analytics.retention' }, create: { key: 'analytics.retention', value: cfg }, update: { value: cfg } });

test('sweep purges rows older than the window and keeps fresh ones', { skip }, async () => {
  await setCfg({ pageviewDays: 30, interactionDays: 30, vitalDays: 30, loginDays: 30 });
  const tag = `ret-${Date.now()}`;
  // one stale (60d) + one fresh (now) row per table
  const oldPv = await p.analyticsEvent.create({ data: { path: `/${tag}`, createdAt: daysAgo(60) } });
  const newPv = await p.analyticsEvent.create({ data: { path: `/${tag}`, createdAt: new Date() } });
  const oldIx = await p.interactionEvent.create({ data: { path: `/${tag}`, kind: 'click', createdAt: daysAgo(60) } });
  const newIx = await p.interactionEvent.create({ data: { path: `/${tag}`, kind: 'click', createdAt: new Date() } });
  const oldWv = await p.webVital.create({ data: { path: `/${tag}`, metric: 'LCP', value: 1, createdAt: daysAgo(60) } });
  const newWv = await p.webVital.create({ data: { path: `/${tag}`, metric: 'LCP', value: 1, createdAt: new Date() } });
  const oldLa = await p.loginAttempt.create({ data: { email: `${tag}@t.local`, ip: '127.0.0.1', success: false, createdAt: daysAgo(60) } });
  const newLa = await p.loginAttempt.create({ data: { email: `${tag}@t.local`, ip: '127.0.0.1', success: true, createdAt: new Date() } });

  const purged = await sweepAnalyticsRetention(p, log);
  assert.ok(purged >= 4, `expected at least the 4 stale rows purged, got ${purged}`);

  for (const [model, id] of [[p.analyticsEvent, oldPv.id], [p.interactionEvent, oldIx.id], [p.webVital, oldWv.id], [p.loginAttempt, oldLa.id]])
    assert.equal(await model.findUnique({ where: { id } }), null, 'stale row should be gone');
  for (const [model, id] of [[p.analyticsEvent, newPv.id], [p.interactionEvent, newIx.id], [p.webVital, newWv.id], [p.loginAttempt, newLa.id]])
    assert.ok(await model.findUnique({ where: { id } }), 'fresh row should remain');
});

test('a window of 0 keeps that table forever', { skip }, async () => {
  await setCfg({ pageviewDays: 0, interactionDays: 30, vitalDays: 30, loginDays: 30 });
  const ancient = await p.analyticsEvent.create({ data: { path: '/ret-zero', createdAt: daysAgo(9999) } });
  await sweepAnalyticsRetention(p, log);
  assert.ok(await p.analyticsEvent.findUnique({ where: { id: ancient.id } }), 'pageviewDays:0 must keep even a 9999-day-old row');
  await p.analyticsEvent.delete({ where: { id: ancient.id } }).catch(() => {});
});
