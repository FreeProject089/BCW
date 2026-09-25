// The deploy gate on the security workflow (.github/scripts/security-verdict.mjs, used by
// .github/workflows/deploy.yml). Run: node --test .github/scripts/security-verdict.test.mjs
//
// What must never happen: production deployed from a commit whose security scans failed, were
// cancelled, never ran, or ran on something else (another commit, another workflow, a pull
// request's merge commit). And a deploy that waits forever is a failure too: "not yet" has to be
// told apart from "no", so the caller can bound the wait.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './security-verdict.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'security-verdict.mjs');
const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const WF = 'BCWEB security';
let n = 0;
const run = (over = {}) => ({ id: ++n, run_number: n, name: WF, head_sha: SHA, event: 'push', status: 'completed', conclusion: 'success', html_url: `https://example.invalid/runs/${n}`, ...over });
const verdict = (runs) => decide(runs, { sha: SHA, workflow: WF }).verdict;

test('a successful run of the security workflow for this exact commit passes', () => {
  assert.equal(verdict([run()]), 'pass');
  assert.equal(verdict([run({ event: 'workflow_dispatch' })]), 'pass');
  assert.equal(verdict([run({ event: 'schedule' })]), 'pass');
});

test('a failed, cancelled or timed-out run fails, and so does one with no conclusion at all', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', null]) {
    assert.equal(verdict([run({ conclusion })]), 'fail', String(conclusion));
  }
});

test('success on ANOTHER commit, workflow or a pull request run proves nothing: wait for the real one', () => {
  assert.equal(verdict([run({ head_sha: OTHER })]), 'wait');
  assert.equal(verdict([run({ name: 'BCWEB CI' })]), 'wait');
  assert.equal(verdict([run({ name: 'BCWEB DAST' })]), 'wait');
  assert.equal(verdict([run({ event: 'pull_request' })]), 'wait');
  assert.equal(verdict([run({ event: 'workflow_run' })]), 'wait');
});

test('no run yet, or one queued / in progress, is "not decided" (the caller polls, bounded)', () => {
  assert.equal(verdict([]), 'wait');
  assert.equal(verdict([run({ status: 'queued', conclusion: null })]), 'wait');
  assert.equal(verdict([run({ status: 'in_progress', conclusion: null })]), 'wait');
  // a failed attempt being re-run: still undecided, not a failure yet
  assert.equal(verdict([run({ conclusion: 'failure' }), run({ status: 'in_progress', conclusion: null })]), 'wait');
});

test('one successful run among failed ones is enough (e.g. the weekly run passed after a flaky push run)', () => {
  assert.equal(verdict([run({ conclusion: 'failure' }), run({ event: 'schedule' })]), 'pass');
});

test('bad input is refused, never read as a verdict', () => {
  assert.throws(() => decide(null, { sha: SHA, workflow: WF }));
  assert.throws(() => decide([], { sha: 'abc', workflow: WF }));
});

const cli = (input, sha = SHA) => spawnSync(process.execPath, [SCRIPT, '--sha', sha, '--workflow', WF], { input, encoding: 'utf8' });

test('CLI: exit 0 pass, 10 wait, 1 fail, 2 on input that is not the API shape', () => {
  assert.equal(cli(JSON.stringify({ workflow_runs: [run()] })).status, 0);
  assert.equal(cli(JSON.stringify({ total_count: 0, workflow_runs: [] })).status, 10);
  assert.equal(cli(JSON.stringify({ workflow_runs: [run({ conclusion: 'failure' })] })).status, 1);
  assert.equal(cli('not json').status, 2);
  assert.equal(cli(JSON.stringify({ message: 'Not Found' })).status, 2);
  assert.equal(cli(JSON.stringify({ workflow_runs: [] }), 'HEAD').status, 2);
});

test('deploy.yml runs this gate before any step that touches the deploy key or the server', async () => {
  const { readFileSync } = await import('node:fs');
  const yml = readFileSync(join(dirname(SCRIPT), '../workflows/deploy.yml'), 'utf8');
  const gate = yml.indexOf('security-verdict.mjs');
  assert.ok(gate > 0, 'deploy.yml does not call security-verdict.mjs');
  for (const later of ['DEPLOY_SSH_KEY: ${{', 'ssh -i']) {
    const at = yml.indexOf(later);
    assert.ok(at > gate, `"${later}" comes before the security gate in deploy.yml`);
  }
  assert.match(yml, /--workflow "BCWEB security"/, 'the gate must name the security workflow exactly');
  const sec = readFileSync(join(dirname(SCRIPT), '../workflows/security.yml'), 'utf8');
  assert.match(sec, /^name: BCWEB security$/m, 'security.yml was renamed: deploy.yml would wait for a workflow that no longer exists');
});
