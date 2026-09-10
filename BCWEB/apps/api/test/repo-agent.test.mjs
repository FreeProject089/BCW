// The agent credential: what it is made of, and what the dashboard is allowed to see.
//
// The interesting properties here are negative ones — what must NOT come back — and a
// negative is exactly what a reviewer's eye slides over. agentView is one object literal; the
// day somebody adds `...a` to save six lines, the hash of a live credential starts arriving
// in a JSON response and nothing about the diff looks wrong.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { genAgentToken, agentPrefixOf, agentUsable, agentView, AGENT_COMMANDS } from '../src/routes/repo-agent.mjs';

const row = (over = {}) => ({
  id: 'ag_1', repoId: 'r_1', label: 'box', prefix: 'bca_AAAAAAA', hash: 'deadbeef'.repeat(8),
  createdAt: new Date('2026-09-10T10:00:00Z'), revokedAt: null,
  lastSeenAt: null, lastIp: null, agentVersion: null, hostLabel: null,
  pendingCmd: null, pendingAt: null,
  reportedAt: null, reportOk: false, reportError: null,
  fileCount: null, totalBytes: null, manifestSha: null,
  ...over,
});

describe('agent token', () => {
  test('is prefixed, and long enough to be a secret', () => {
    const tok = genAgentToken();
    assert.match(tok, /^bca_[A-Za-z0-9_-]{43}$/);
    // 32 bytes of crypto randomness, base64url — the same shape as an API key. Two
    // credential generators in one codebase is how one of them quietly ends up weaker.
    assert.equal(Buffer.from(tok.slice(4), 'base64url').length, 32);
  });

  test('two tokens are never the same', () => {
    const seen = new Set(Array.from({ length: 200 }, genAgentToken));
    assert.equal(seen.size, 200);
  });

  test('the stored prefix identifies without being usable', () => {
    const tok = genAgentToken();
    const pre = agentPrefixOf(tok);
    assert.equal(pre.length, 12);
    assert.ok(tok.startsWith(pre));
    // 8 characters of a 43-character secret.
    assert.ok(pre.length < tok.length / 3);
  });
});

describe('agentView', () => {
  test('never returns the hash, under any spelling', () => {
    const v = agentView(row());
    const json = JSON.stringify(v);
    assert.equal('hash' in v, false);
    assert.equal(json.includes('deadbeef'), false);
  });

  test('never returns a token field at all', () => {
    // There is no endpoint that can re-read the secret, on purpose: one would turn any later
    // session theft into credential theft. This asserts the shape that keeps it that way.
    assert.equal('token' in agentView(row()), false);
    assert.equal('secret' in agentView(row()), false);
  });

  test('BigInt bytes come back as a number the client can render', () => {
    const v = agentView(row({ totalBytes: 12345678901n }));
    assert.equal(typeof v.totalBytes, 'number');
    assert.equal(v.totalBytes, 12345678901);
    // Null must stay null rather than becoming 0 — "not reported" and "reported zero" are
    // different things, and the panel prints a dash for one of them.
    assert.equal(agentView(row()).totalBytes, null);
  });

  test('nothing to show is null, not an empty object', () => {
    assert.equal(agentView(null), null);
  });
});

describe('agentUsable', () => {
  test('a live agent is usable', () => {
    assert.equal(agentUsable(row()), true);
  });

  test('a revoked one is not, and neither is a missing one', () => {
    assert.equal(agentUsable(row({ revokedAt: new Date() })), false);
    assert.equal(agentUsable(null), false);
    assert.equal(agentUsable(undefined), false);
  });
});

describe('AGENT_COMMANDS', () => {
  test('is a closed list', () => {
    assert.deepEqual([...AGENT_COMMANDS].sort(), ['ping', 'rescan']);
  });

  test('does not accept an arbitrary string', () => {
    // /agent/hello filters what it hands out against this list, so a value that reached the
    // column by any other route is never delivered as a command.
    assert.equal(AGENT_COMMANDS.includes('rm -rf /'), false);
    assert.equal(AGENT_COMMANDS.includes(''), false);
  });
});
