// PKCE is what makes the authorization-code flow safe for a client that cannot keep a
// secret — a desktop app, a SPA. If it silently stops verifying, every one of those
// clients becomes interceptable and nothing anywhere reports a problem: the flow still
// completes, tokens are still issued, users still sign in.
//
// That is the whole reason these exist. The OIDC provider had no tests at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyPkce } from '../src/lib/oidc.mjs';

const challengeFor = (v) => crypto.createHash('sha256').update(v).digest('base64url');

test('the verifier that produced the challenge is accepted', () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  assert.equal(verifyPkce(challengeFor(verifier), verifier), true);
});

test('any other verifier is refused', () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = challengeFor(verifier);
  assert.equal(verifyPkce(challenge, crypto.randomBytes(32).toString('base64url')), false);
  // One character off — the interception case, where an attacker has almost the value.
  assert.equal(verifyPkce(challenge, verifier.slice(0, -1) + (verifier.endsWith('a') ? 'b' : 'a')), false);
  // A prefix. Truncation must not be treated as a match.
  assert.equal(verifyPkce(challenge, verifier.slice(0, 16)), false);
});

test('a missing verifier is refused, not hashed', () => {
  const verifier = 'some-verifier';
  const challenge = challengeFor(verifier);
  for (const bad of [undefined, null, '', 0, false, {}, []]) {
    assert.equal(verifyPkce(challenge, bad), false, `${JSON.stringify(bad)} was accepted`);
  }
  // The shape the route used to produce: String(undefined) is "undefined", a perfectly
  // hashable string. A client sending no verifier must not be able to match a challenge
  // that happens to be sha256("undefined").
  assert.equal(verifyPkce(challengeFor('undefined'), undefined), false);
});

test('an empty or absent challenge never matches', () => {
  // The route only calls this when a challenge was stored, but a function that returned
  // true for "" would turn a missing challenge into a passing check.
  for (const bad of [undefined, null, '', 0, {}]) {
    assert.equal(verifyPkce(bad, 'anything'), false, `challenge ${JSON.stringify(bad)} matched`);
  }
});

test('base64url, not base64', () => {
  // Values whose digest contains bytes that differ between the two alphabets. base64 uses
  // + and /, base64url uses - and _ and drops the padding. An implementation that used
  // base64 would pass every test written against itself and fail against a real client
  // that followed RFC 7636.
  let verifier = null;
  for (let i = 0; i < 500 && !verifier; i++) {
    const v = `probe-${i}`;
    const b64 = crypto.createHash('sha256').update(v).digest('base64');
    if (b64.includes('+') || b64.includes('/')) verifier = v;
  }
  assert.ok(verifier, 'no probe produced a digest that distinguishes the alphabets');

  const b64 = crypto.createHash('sha256').update(verifier).digest('base64');
  const b64url = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.notEqual(b64, b64url, 'the probe does not actually distinguish them');

  assert.equal(verifyPkce(b64url, verifier), true);
  assert.equal(verifyPkce(b64, verifier), false, 'a base64 challenge was accepted');
});

test('plain PKCE is not supported', () => {
  // RFC 7636 allows `plain`, where the challenge IS the verifier. It is worthless —
  // whoever intercepts one has the other — and the provider advertises S256 only
  // (code_challenge_methods_supported). This pins that: sending the verifier as its own
  // challenge must not authenticate.
  const verifier = 'a-verifier-used-as-its-own-challenge';
  assert.equal(verifyPkce(verifier, verifier), false);
});

// ── The /authorize front door ────────────────────────────────────────────────
//
// Five rules decided before any state exists. Each has a way of failing that leaves the
// flow working: a scope granted that was never registered still returns tokens, a public
// client without PKCE still signs users in. Nothing errors; the guarantee is just gone.

import { validateAuthorizeRequest } from '../src/lib/oidc.mjs';

const confidential = { confidential: true, scopes: ['openid', 'profile', 'email', 'repos'] };
const publicClient = { confidential: false, scopes: ['openid', 'profile'] };
const S256 = { code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' };

test('a well-formed request passes and reports what it parsed', () => {
  const r = validateAuthorizeRequest(confidential, { response_type: 'code', scope: 'openid profile' });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.scopes, ['openid', 'profile']);
  assert.equal(r.challenge, '');
});

test('only the code flow is accepted', () => {
  for (const rt of ['token', 'id_token', 'code token', '', undefined]) {
    const r = validateAuthorizeRequest(confidential, { response_type: rt, scope: 'openid' });
    assert.equal(r.error, 'unsupported_response_type', `response_type=${rt} was accepted`);
  }
});

test('a scope the client is not registered for is refused', () => {
  // The whole point of registering scopes. Without this, `repos` is available to anyone
  // who asks for it and registration constrains nothing.
  const r = validateAuthorizeRequest(publicClient, { response_type: 'code', scope: 'openid repos', ...S256 });
  assert.equal(r.error, 'invalid_scope');
  // …and the one it IS registered for still works, so the rule is not just "refuse".
  assert.equal(validateAuthorizeRequest(publicClient, { response_type: 'code', scope: 'openid profile', ...S256 }).error, undefined);
});

test('openid is required', () => {
  const r = validateAuthorizeRequest(confidential, { response_type: 'code', scope: 'profile email' });
  assert.equal(r.error, 'invalid_scope');
  assert.equal(validateAuthorizeRequest(confidential, { response_type: 'code', scope: '' }).error, 'invalid_scope');
});

test('a client with no registered scopes can request nothing', () => {
  // Includes the shape where `scopes` is missing entirely rather than empty — a client
  // row written before the column existed must not read as "everything allowed".
  for (const c of [{ confidential: true, scopes: [] }, { confidential: true }]) {
    assert.equal(validateAuthorizeRequest(c, { response_type: 'code', scope: 'openid' }).error, 'invalid_scope');
  }
});

test('a challenge must be S256', () => {
  for (const method of ['plain', 'S512', '', undefined]) {
    const r = validateAuthorizeRequest(confidential, { response_type: 'code', scope: 'openid', code_challenge: 'abc', code_challenge_method: method });
    assert.equal(r.error, 'invalid_request', `method=${method} was accepted`);
  }
});

test('a public client cannot skip PKCE', () => {
  // It cannot hold a secret, so PKCE is the only thing between an intercepted code and a
  // token. A confidential client may omit it — it authenticates with its secret instead.
  assert.equal(validateAuthorizeRequest(publicClient, { response_type: 'code', scope: 'openid' }).error, 'invalid_request');
  assert.equal(validateAuthorizeRequest(publicClient, { response_type: 'code', scope: 'openid', ...S256 }).error, undefined);
  assert.equal(validateAuthorizeRequest(confidential, { response_type: 'code', scope: 'openid' }).error, undefined);
});
