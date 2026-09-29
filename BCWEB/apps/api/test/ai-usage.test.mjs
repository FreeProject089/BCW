// aios (agent-bcw-ai-os): AI usage analytics (lib/ai-usage.mjs) and its wiring into the
// provider pipeline (lib/moderation/ai.mjs), without a database.
//
// What is pinned: a recorded call holds numbers and enum strings ONLY (a caller that hands the
// whole request over still stores no text); percentiles come out of the histogram right;
// cache-hit and error rates are computed over the right denominators; a day without traffic is
// a zero in the series, not a missing point; the breaker's OPENING is counted once and the
// calls it then refuses are counted apart; a decision the AI raised is counted as "changed";
// a moderator's verdict on an AI-flagged case becomes false-positive / confirmed feedback.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

delete process.env.REDIS_URL;
process.env.JWT_SECRET ||= 'ai-usage-test-secret';
process.env.LAYA_API_KEY = ['laya', 'usage', 'test'].join('-');
delete process.env.AI_KILL_SWITCH;
delete process.env.AI_PROVIDER;

const U = await import('../src/lib/ai-usage.mjs');
const ai = await import('../src/lib/moderation/ai.mjs');
const { aiVerdict } = await import('../src/lib/moderation/cases.mjs');

let mode = 'ok';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (mode === 'error') { res.writeHead(500); return res.end('boom'); }
    let json = {}; try { json = JSON.parse(body); } catch { /* */ }
    const answers = {};
    for (const [id, q] of Object.entries(json?.questions || {})) {
      if (q.type === 'noul') answers[id] = { noul: 0.2 };
      else { const l = Object.keys(q.criteria || {}); answers[id] = { choice: l[0], probabilities: Object.fromEntries(l.map((x, i) => [x, i ? 0.1 : 0.9])) }; }
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ answers }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.LAYA_URL = `http://127.0.0.1:${server.address().port}`;

const setCfg = (config) => { ai._resetForTests(); ai._setSettingsLoaderForTests(async () => ({ config, killed: false })); };
after(async () => { ai._setSettingsLoaderForTests(null); ai._resetForTests(); U._resetAiUsageForTests(); await new Promise((r) => server.close(r)); });
beforeEach(() => { mode = 'ok'; U._resetAiUsageForTests(); });

describe('the histogram', () => {
  test('bucketOf and percentiles', () => {
    assert.equal(U.bucketOf(10), 0);
    assert.equal(U.bucketOf(50), 0);
    assert.equal(U.bucketOf(51), 1);
    assert.equal(U.bucketOf(999999), U.LAT_BOUNDS.length);
    // 90 fast calls, 10 slow ones: p50 is in the fast bucket, p95 in the slow one.
    const h = []; h[0] = 90; h[6] = 10;
    assert.equal(U.percentileFromHist(h, 50), 50);
    assert.equal(U.percentileFromHist(h, 95), U.LAT_BOUNDS[6]);
    assert.equal(U.percentileFromHist([], 95), null);
  });
  test('addHist adds element-wise, whatever the lengths', () => {
    assert.deepEqual(U.addHist([1, 2], [0, 0, 3]).slice(0, 3), [1, 2, 3]);
  });
});

describe('recordAi stores numbers, never text', () => {
  test('a caller that passes the whole request stores none of it', () => {
    const secret = 'my password is hunter2 and my card is 4111111111111111';
    U.recordAi({ feature: 'describe', provider: 'byok', outcome: 'ok', latencyMs: 120, tokensIn: 10, tokensOut: 5, userId: 'ckabcdefghijklmnop', text: secret, prompt: secret, url: 'https://evil.example/x?k=1' });
    const dump = JSON.stringify(U._peekAiUsageForTests());
    assert.ok(!dump.includes('hunter2') && !dump.includes('4111') && !dump.includes('evil.example'), dump);
    const [row] = U._peekAiUsageForTests().rows;
    assert.equal(row.calls, 1); assert.equal(row.ok, 1); assert.equal(row.tokensIn, 10);
  });
  test('an invented feature or provider name is folded, not stored as given', () => {
    U.recordAi({ feature: 'DROP TABLE "User"; --', provider: 'https://x', outcome: 'weird' });
    const [row] = U._peekAiUsageForTests().rows;
    assert.equal(row.feature, 'other');
    assert.equal(row.provider, 'off');
    assert.equal(row.failed, 1, 'an unknown outcome counts as a failure');
  });
  test('refusals are not calls; cache hits count toward the hit rate', () => {
    U.recordAi({ feature: 'suggest_tags', provider: 'laya', outcome: 'rateLimited' });
    U.recordAi({ feature: 'suggest_tags', provider: 'laya', outcome: 'cacheHit' });
    U.recordAi({ feature: 'suggest_tags', provider: 'laya', outcome: 'ok', latencyMs: 80 });
    U.recordAi({ feature: 'suggest_tags', provider: 'laya', outcome: 'timeout', latencyMs: 1500 });
    const r = U.buildReport(U._peekAiUsageForTests().rows, [], { days: 1 });
    assert.equal(r.total.calls, 2);
    assert.equal(r.total.rateLimited, 1);
    assert.equal(r.total.cacheHitRate, 1 / 3);
    assert.equal(r.total.errorRate, 0.5);
    assert.equal(r.series.length, 1);
  });
  test('the external provider is priced from the admin\'s figures; Laya costs nothing', () => {
    U.setAiPricing({ external: { inPerMTok: 2, outPerMTok: 0 }, site: { inPerMTok: 0, outPerMTok: 0 } });
    U.recordAi({ feature: 'mod:contact', provider: 'external', outcome: 'ok', latencyMs: 10, tokensIn: 500000 });
    U.recordAi({ feature: 'mod:contact', provider: 'laya', outcome: 'ok', latencyMs: 10, tokensIn: 500000 });
    const rows = U._peekAiUsageForTests().rows;
    assert.equal(rows.find((x) => x.provider === 'external').costUsd, 1);
    assert.equal(rows.find((x) => x.provider === 'laya').costUsd, 0);
    U.setAiPricing({ external: { inPerMTok: 0, outPerMTok: 0 }, site: { inPerMTok: 0, outPerMTok: 0 } });
  });
});

describe('buildReport', () => {
  test('series is filled, top users are ranked, per-feature totals add up', () => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = [
      { day: today, feature: 'describe', provider: 'site', calls: 4, ok: 3, failed: 1, cacheHit: 0, costUsd: 0.5, latencySumMs: 400, latencyHist: [0, 4] },
      { day: today, feature: 'mod:contact', provider: 'laya', calls: 10, ok: 10, cacheHit: 5, latencySumMs: 500, latencyHist: [10], changed: 2, falsePositive: 1, confirmed: 3 },
    ];
    const users = [{ userId: 'a', feature: 'describe', calls: 3, tokens: 100, costUsd: 0.4 }, { userId: 'b', feature: 'describe', calls: 1, tokens: 10, costUsd: 0.1 }];
    const r = U.buildReport(rows, users, { days: 7, names: { a: 'Alice' } });
    assert.equal(r.series.length, 7);
    assert.equal(r.series.at(-1).calls, 14);
    assert.equal(r.series[0].calls, 0);
    assert.equal(r.total.changed, 2);
    assert.equal(r.total.falsePositive, 1);
    assert.equal(r.topUsers[0].userId, 'a');
    assert.equal(r.topUsers[0].name, 'Alice');
    assert.equal(r.byFeature.length, 2);
    assert.equal(r.byProvider.find((x) => x.key === 'site').costUsd, 0.5);
  });
});

describe('the pipeline counts what happened', () => {
  test('ok, cache hit, and the per-user row', async () => {
    setCfg({ provider: 'laya', enabled: true, surfaces: { community: true }, cacheTtlSec: 60 });
    const a = await ai.aiAnalyze('community', { text: 'hello there friends', meta: { userId: 'ckuser0000000001' } });
    assert.ok(a);
    await ai.aiAnalyze('community', { text: 'hello there friends', meta: { userId: 'ckuser0000000001' } });
    const { rows, users } = U._peekAiUsageForTests();
    const r = rows.find((x) => x.feature === 'mod:community');
    assert.equal(r.provider, 'laya');
    assert.equal(r.ok, 1);
    assert.equal(r.cacheHit, 1);
    assert.equal(users[0].calls, 2);
  });
  test('a feature surface is named after the feature', async () => {
    setCfg({ provider: 'laya', enabled: true, cacheTtlSec: 0 });
    const r = await ai.aiClassifyWithReason({ type: 'choice', instructions: 'Which?', options: ['a', 'b'] }, { text: 'some text here' }, { surface: 'feat:suggest_tags' });
    assert.ok(r.value, r.reason);
    assert.equal(U._peekAiUsageForTests().rows[0].feature, 'suggest_tags');
  });
  test('the breaker OPENING is counted once, the refused calls apart', async () => {
    setCfg({ provider: 'laya', enabled: true, surfaces: { community: true }, cacheTtlSec: 0, breakerFailures: 2, breakerOpenSec: 60 });
    mode = 'error';
    for (let i = 0; i < 4; i++) await ai.aiAnalyze('community', { text: `failing text number ${i}` });
    const r = U._peekAiUsageForTests().rows.find((x) => x.feature === 'mod:community');
    assert.equal(r.failed, 2);
    assert.equal(r.breakerOpen, 1);
    assert.equal(r.breakerRefused, 2);
  });
  test('killed and disabled are counted, not called', async () => {
    ai._resetForTests(); ai._setSettingsLoaderForTests(async () => ({ config: { provider: 'laya', enabled: true, surfaces: { community: true } }, killed: true }));
    await ai.aiAnalyze('community', { text: 'x y z' });
    setCfg({ provider: 'laya', enabled: false });
    await ai.aiAnalyze('community', { text: 'x y z' });
    const rows = U._peekAiUsageForTests().rows;
    assert.equal(rows.reduce((n, r) => n + r.killed, 0), 1);
    assert.equal(rows.reduce((n, r) => n + r.disabled, 0), 1);
    assert.equal(rows.reduce((n, r) => n + r.calls, 0), 0);
  });
});

describe('a moderator\'s verdict is the AI\'s feedback', () => {
  test('aiVerdict', () => {
    const flagged = { provider: 'laya', labels: { spam: 0.93 } };
    assert.equal(aiVerdict(flagged, 'false_positive'), 'falsePositive');
    assert.equal(aiVerdict(flagged, 'dismiss'), 'falsePositive');
    assert.equal(aiVerdict(flagged, 'remove'), 'confirmed');
    assert.equal(aiVerdict(flagged, 'sanction'), 'confirmed');
    assert.equal(aiVerdict({ labels: { spam: 0.3 } }, 'remove'), null, 'the AI did not flag it: nothing to learn');
    assert.equal(aiVerdict(null, 'remove'), null);
  });
});
