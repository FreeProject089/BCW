// Laya on BMM live issues: the questions asked, the mapping back, and the switches.
// No database, no provider: the layer and the feature settings are injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueQuestions, mapIssueAnswers, classifyIssue, ISSUE_CATEGORIES } from '../src/lib/telemetry-issues-ai.mjs';
import { aiAskWithReason, _setSettingsLoaderForTests, _resetForTests } from '../src/lib/moderation/ai.mjs';

const featuresOn = async () => ({ cfg: { features: { telemetry_issues: { enabled: true } } } });
const featuresOff = async () => ({ cfg: { features: { telemetry_issues: { enabled: false } } } });

test('the vocabulary matches the telemetry service (issues.rs CATEGORIES)', () => {
  assert.deepEqual(Object.keys(ISSUE_CATEGORIES), ['crash', 'ui', 'network', 'filesystem', 'permissions', 'mod_conflict', 'configuration', 'performance', 'update', 'other']);
});

test('the duplicate question is only asked with a candidate', () => {
  assert.equal(issueQuestions(false).duplicate, undefined);
  assert.equal(issueQuestions(true).duplicate.type, 'noul');
  assert.deepEqual(Object.keys(issueQuestions(false)), ['category', 'severity', 'origin']);
});

test('answers outside the vocabulary are dropped', () => {
  const m = mapIssueAnswers({ category: { choice: 'network', p: 0.7 }, severity: { choice: 'apocalyptic', p: 1 }, origin: { choice: 'bmm_bug' }, duplicate: { p: 0.4 } });
  assert.deepEqual(m, { category: { value: 'network', p: 0.7 }, origin: { value: 'bmm_bug', p: null }, duplicate: { p: 0.4 } });
});

test('feature off → no call at all', async () => {
  let called = 0;
  const r = await classifyIssue({ text: 'boom' }, { features: featuresOff, ask: async () => { called++; return null; } });
  assert.deepEqual(r, { ok: false, reason: 'feature_off' });
  assert.equal(called, 0);
});

test('the layer is asked as feat:telemetry_issues, Laya only, and its reason is passed on', async () => {
  let seen;
  const r = await classifyIssue({ text: 'boom', duplicate: true }, { features: featuresOn, ask: async (q, input, opts) => { seen = { q, input, opts }; return { value: null, reason: 'busy' }; } });
  assert.deepEqual(r, { ok: false, reason: 'busy' });
  assert.equal(seen.opts.surface, 'feat:telemetry_issues');
  assert.equal(seen.opts.layaOnly, true);
  assert.ok(seen.q.duplicate);
  const ok = await classifyIssue({ text: 'boom' }, { features: featuresOn, ask: async () => ({ value: { model: 'laya-multilingual', latencyMs: 12, answers: { category: { choice: 'crash', p: 0.9 } } }, reason: null }) });
  assert.deepEqual(ok, { ok: true, model: 'laya-multilingual', latencyMs: 12, cached: false, labels: { category: { value: 'crash', p: 0.9 } } });
});

test('aiAskWithReason with layaOnly refuses a non-Laya provider before any call', async () => {
  _resetForTests();
  _setSettingsLoaderForTests(async () => ({ config: { provider: 'external', enabled: true }, killed: false }));
  const r = await aiAskWithReason(issueQuestions(false), { text: 'x' }, { surface: 'feat:telemetry_issues', layaOnly: true });
  assert.equal(r.value, null);
  assert.equal(r.reason, 'not_laya');
  _setSettingsLoaderForTests(async () => ({ config: { provider: 'off', enabled: false }, killed: false }));
  const off = await aiAskWithReason(issueQuestions(false), { text: 'x' }, { surface: 'feat:telemetry_issues', layaOnly: true });
  assert.equal(off.reason, 'disabled');
  _setSettingsLoaderForTests(null);
  _resetForTests();
});

test('invalid question sets are refused', async () => {
  assert.equal((await aiAskWithReason({}, { text: 'x' })).reason, 'invalid');
  assert.equal((await aiAskWithReason({ 'Bad Id!': { type: 'noul', instructions: 'q' } }, { text: 'x' })).reason, 'invalid');
});
