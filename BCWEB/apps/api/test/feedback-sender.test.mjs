// Who a feedback submission is FROM — the decision, not the transport.
//
// It was made with `findUserIdByBcId(creatorId)`, and the gate in front of that
// (`looksLikeBcId`) refuses anything that is not an eight-character BC code. BMM sends a
// 64-character ed25519 public key. So the lookup never ran, `userId` was always null, every BMM
// report was filed anonymously, and `linked: false` came back while the app told the sender
// their reports would appear in their dashboard.
//
// That is a pure predicate — "given these headers, which account is this" — and this file
// pins it. The route composes the same three steps in the same order; keeping the rule here as
// well would be two rules and one of them would drift, so `senderIdFrom` is exported from the
// route and the route calls it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { senderIdFrom } from '../src/routes/feedback.mjs';

const AUD = 'https://bettercommunity.test';
const NOW = 1_760_000_000;

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, cid: Buffer.from(jwk.x, 'base64url').toString('hex') };
}
function proofFor({ privateKey, cid }, { aud = AUD, exp = NOW + 120 } = {}) {
  const json = `{"cid":"${cid}","aud":"${aud}","exp":${exp}}`;
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  return `bmmc1.${b64}.${crypto.sign(null, Buffer.from(b64, 'utf8'), privateKey).toString('base64url')}`;
}

/** A stand-in for the two lookups the route does, so this needs no database. */
function lookups(linkedCid, userId) {
  return {
    byCreatorId: async (cid) => (cid === linkedCid ? userId : null),
    byBcId: async () => null,
  };
}

describe('senderIdFrom', () => {
  const k = keypair();

  test('a session wins outright and nothing else is consulted', async () => {
    let asked = false;
    const id = await senderIdFrom({
      sessionUid: 'u-session',
      headers: { 'x-creator-id': k.cid, 'x-creator-proof': proofFor(k) },
      aud: AUD, now: NOW,
      byCreatorId: async () => { asked = true; return 'u-creator'; },
      byBcId: async () => null,
    });
    assert.equal(id, 'u-session');
    assert.equal(asked, false, 'a signed-in sender is not looked up by creator id');
  });

  test('a PROVEN creator id resolves to the account it is linked to', async () => {
    // The whole bug: this used to be null.
    const id = await senderIdFrom({
      headers: { 'x-creator-id': k.cid, 'x-creator-proof': proofFor(k) },
      aud: AUD, now: NOW, ...lookups(k.cid, 'u-owner'),
    });
    assert.equal(id, 'u-owner');
  });

  test('the header ALONE is not an identity', async () => {
    // A creator id is a public key. Repo owners hold other people's — that is what a
    // whitelist is — so acting on an unsigned header would let anyone who has seen your id
    // file reports in your name and have us mail you about them.
    const id = await senderIdFrom({
      headers: { 'x-creator-id': k.cid },
      aud: AUD, now: NOW, ...lookups(k.cid, 'u-owner'),
    });
    assert.equal(id, null);
  });

  test('a proof for another server does not identify anyone here', async () => {
    const id = await senderIdFrom({
      headers: { 'x-creator-id': k.cid, 'x-creator-proof': proofFor(k, { aud: 'https://evil.test' }) },
      aud: AUD, now: NOW, ...lookups(k.cid, 'u-owner'),
    });
    assert.equal(id, null);
  });

  test('an expired proof does not identify anyone', async () => {
    const id = await senderIdFrom({
      headers: { 'x-creator-id': k.cid, 'x-creator-proof': proofFor(k, { exp: NOW - 1 }) },
      aud: AUD, now: NOW, ...lookups(k.cid, 'u-owner'),
    });
    assert.equal(id, null);
  });

  test('a valid proof for one id, sent with somebody else\'s id in the header, is refused', async () => {
    // A disagreement is a misconfigured client rather than an attack, but either way it is
    // not the account in the header, and answering "whichever of the two we like" is how a
    // check becomes a coin toss.
    const other = keypair();
    const id = await senderIdFrom({
      headers: { 'x-creator-id': other.cid, 'x-creator-proof': proofFor(k) },
      aud: AUD, now: NOW,
      byCreatorId: async (cid) => (cid === k.cid ? 'u-mine' : 'u-theirs'),
      byBcId: async () => null,
    });
    assert.equal(id, null);
  });

  test('a proof with no header at all still identifies its own signer', async () => {
    // The proof carries the id; the header only exists to be cross-checked. A client that
    // sends one and not the other is unusual, not wrong.
    const id = await senderIdFrom({
      headers: { 'x-creator-proof': proofFor(k) },
      aud: AUD, now: NOW, ...lookups(k.cid, 'u-owner'),
    });
    assert.equal(id, 'u-owner');
  });

  test('case in the header does not make it a different key', async () => {
    const id = await senderIdFrom({
      headers: { 'x-creator-id': k.cid.toUpperCase(), 'x-creator-proof': proofFor(k) },
      aud: AUD, now: NOW, ...lookups(k.cid, 'u-owner'),
    });
    assert.equal(id, 'u-owner');
  });

  test('a proven id that is linked to nothing is anonymous, not an error', async () => {
    const id = await senderIdFrom({
      headers: { 'x-creator-id': k.cid, 'x-creator-proof': proofFor(k) },
      aud: AUD, now: NOW, ...lookups('somebody-else', 'u-owner'),
    });
    assert.equal(id, null);
  });

  test('no headers at all is anonymous', async () => {
    assert.equal(await senderIdFrom({ headers: {}, aud: AUD, now: NOW, ...lookups('x', 'u') }), null);
  });

  test('a BC code falls through to the second lookup', async () => {
    // The path that was here before, kept for a caller that really does send a BC code. It is
    // reached only for something SHAPED like one, because resolving it costs a scan over
    // every account.
    const seen = [];
    const id = await senderIdFrom({
      headers: { 'x-creator-id': 'BC-7K2M-9XQ4' },
      aud: AUD, now: NOW,
      byCreatorId: async (c) => { seen.push(['creator', c]); return null; },
      byBcId: async (c) => { seen.push(['bcid', c]); return 'u-bc'; },
    });
    assert.equal(id, 'u-bc');
    assert.deepEqual(seen.map((s) => s[0]), ['creator', 'bcid']);
  });

  test('a 64-character key never reaches the account scan', async () => {
    // The gate that makes the expensive lookup safe on a public endpoint. If a creator id
    // ever started matching it, every anonymous report would scan the user table.
    let scanned = false;
    await senderIdFrom({
      headers: { 'x-creator-id': k.cid, 'x-creator-proof': proofFor(k) },
      aud: AUD, now: NOW,
      byCreatorId: async () => null,
      byBcId: async () => { scanned = true; return null; },
    });
    assert.equal(scanned, false);
  });
});
