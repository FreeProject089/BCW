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
