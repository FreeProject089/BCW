// The deployment map: what builds and ships the stack.
//
// The test that carries the weight is the trigger one. `on:` has three legal shapes and the
// header comments in these files contain the word "on" followed by a colon in prose — the
// first reader located the block with indexOf and returned `push:`, colon included, having
// silently lost pull_request and workflow_dispatch. A workflow map that under-reports when a
// workflow runs is worse than none: it is read to answer exactly that.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkflow, buildInfraMap } from '../src/lib/infra-map.mjs';

const BLOCK = `name: CI

# Quality gate. We run this on: every push, because catching it later costs more.

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
  rust:
    runs-on: windows-latest
    steps:
      - run: cargo test
        env:
          KEY: \${{ secrets.BMM_PRIVATE_KEY }}
`;

describe('parseWorkflow', () => {
  test('every trigger in the block form, and none of the prose', () => {
    // The header says "We run this on: every push" — a substring search for `on:` finds that
    // first and reads the wrong block.
    assert.deepEqual(parseWorkflow('ci.yml', BLOCK).triggers, ['push', 'pull_request', 'workflow_dispatch']);
  });

  test('the inline and list forms too', () => {
    assert.deepEqual(parseWorkflow('a.yml', 'on: [push, release]\n').triggers, ['push', 'release']);
    assert.deepEqual(parseWorkflow('b.yml', 'on: workflow_dispatch\n').triggers, ['workflow_dispatch']);
  });

  test('jobs carry the runner, which is what decides whether it can run at all', () => {
    const w = parseWorkflow('ci.yml', BLOCK);
    assert.deepEqual(w.jobs.map((j) => [j.name, j.runsOn]), [['frontend', 'ubuntu-latest'], ['rust', 'windows-latest']]);
  });

  test('secrets are collected, because that is why a fork fails', () => {
    assert.deepEqual(parseWorkflow('ci.yml', BLOCK).secrets, ['BMM_PRIVATE_KEY']);
  });

  test('what it publishes is read from the actions, not guessed from the name', () => {
    const rel = parseWorkflow('r.yml', 'name: Release\non: [push]\njobs:\n  r:\n    steps:\n      - uses: softprops/action-gh-release@v2\n');
    assert.equal(rel.publishes.release, true);
    assert.equal(rel.publishes.pages, false);
    // A job called "release" that publishes nothing is a real thing, and the opposite of what
    // its name suggests.
    assert.equal(parseWorkflow('x.yml', 'name: Release\non: [push]\njobs:\n  release:\n    steps:\n      - run: echo hi\n').publishes.release, false);
  });
});

describe('buildInfraMap', () => {
  const wfs = [
    { name: 'ci.yml', text: BLOCK },
    { name: 'open.yml', text: 'name: Open\non: [push]\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n' },
  ];

  test('the secrets a fresh clone would need, in one list', () => {
    assert.deepEqual(buildInfraMap(wfs).secretsNeeded, ['BMM_PRIVATE_KEY']);
  });

  test('and which workflows a contributor can actually run', () => {
    assert.deepEqual(buildInfraMap(wfs).noSecrets, ['open.yml']);
  });

  test('without a compose map the runtime half is NULL, not an empty stack', () => {
    // Inside the API image infra/ is not present. An empty services list would read as
    // "nothing is deployed", which is the most misleading possible answer here.
    assert.equal(buildInfraMap(wfs).runtime, null);
    assert.equal(buildInfraMap(wfs).counts.services, null);
  });

  test('with one, both halves are in the same document', () => {
    const m = buildInfraMap(wfs, { counts: { services: 2 }, services: [{ name: 'api' }, { name: 'db' }], exposedToNetwork: [{ service: 'api', host: '3000' }] });
    assert.deepEqual(m.runtime.services, ['api', 'db']);
    assert.equal(m.counts.publishedPorts, 1);
  });
});
