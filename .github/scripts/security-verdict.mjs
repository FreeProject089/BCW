#!/usr/bin/env node
// Did the security workflow pass for THIS commit? Read by .github/workflows/deploy.yml before
// it opens the SSH connection to production.
//
//   gh api "repos/$REPO/actions/runs?head_sha=$SHA&per_page=100" \
//     | node .github/scripts/security-verdict.mjs --sha "$SHA" --workflow "BCWEB security"
//
// Exit codes (the deploy step loops on 10, bounded):
//   0   a run of that workflow for that exact commit concluded `success`
//   10  not decided yet: no run for the commit yet (it is queued behind the push), or one is
//       still queued / in progress
//   1   every run for that commit finished, and none succeeded (failure, cancelled, timed out…)
//   2   the input is not what the GitHub API returns: refuse rather than guess
//
// Which runs count: the workflow is matched by its NAME (the `name:` line of security.yml),
// the commit by its full SHA, and only the events that test that commit as it is — push,
// workflow_dispatch, schedule. A pull_request run tests the MERGE of the branch into its base,
// not the commit itself, so it proves nothing about what is being deployed.
// Why the deploy waits for this at all: BCWEB/guides/run/DEPLOY_EN.md section 9.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const COUNTED_EVENTS = ['push', 'workflow_dispatch', 'schedule'];

/**
 * { verdict: 'pass' | 'wait' | 'fail', message, runs } from the `workflow_runs` array of
 * GET /repos/{owner}/{repo}/actions/runs.
 */
export function decide(workflowRuns, { sha, workflow }) {
  if (!Array.isArray(workflowRuns)) throw new TypeError('workflow_runs is not an array');
  if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new TypeError(`not a full commit sha: ${sha}`);
  const runs = workflowRuns.filter((r) => r && r.name === workflow && r.head_sha === sha && COUNTED_EVENTS.includes(r.event));
  const line = (r) => `#${r.run_number ?? r.id} (${r.event}): ${r.status}${r.conclusion ? `/${r.conclusion}` : ''} ${r.html_url || ''}`.trim();
  const ok = runs.find((r) => r.status === 'completed' && r.conclusion === 'success');
  if (ok) return { verdict: 'pass', runs, message: `"${workflow}" passed for ${sha}: ${line(ok)}` };
  const pending = runs.filter((r) => r.status !== 'completed');
  if (pending.length) return { verdict: 'wait', runs, message: `"${workflow}" still running for ${sha}: ${pending.map(line).join('; ')}` };
  if (!runs.length) return { verdict: 'wait', runs, message: `no "${workflow}" run for ${sha} yet` };
  return { verdict: 'fail', runs, message: `"${workflow}" did not pass for ${sha}: ${runs.map(line).join('; ')}` };
}

const EXIT = { pass: 0, wait: 10, fail: 1 };

function main(argv) {
  const arg = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : undefined; };
  const sha = arg('--sha');
  const workflow = arg('--workflow');
  if (!sha || !workflow) { console.error('usage: … | security-verdict.mjs --sha <sha> --workflow <name>'); return 2; }
  let body;
  try { body = JSON.parse(readFileSync(0, 'utf8')); } catch (e) { console.error(`::error::the runs list is not JSON (${e.message})`); return 2; }
  if (!body || !Array.isArray(body.workflow_runs)) { console.error('::error::expected {workflow_runs: [...]} from GET /repos/{repo}/actions/runs'); return 2; }
  try {
    const d = decide(body.workflow_runs, { sha, workflow });
    console.log(d.message);
    return EXIT[d.verdict];
  } catch (e) { console.error(`::error::${e.message}`); return 2; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
