// A Creator ID header identifies nobody; a creator PROOF identifies one account.
//
// The token is minted by BMM in Rust (src-tauri/src/commands/security.rs — `creator_proof`)
// and verified here in Node, so the thing most likely to break is not the cryptography but the
// AGREEMENT: which bytes are signed, how they are encoded, and in what order the payload's
// fields appear. `mint()` below rebuilds the Rust side's output byte-for-byte — the same
// hand-written JSON with `cid`, `aud`, `exp` in that order, base64url with no padding, and a
// signature over the ENCODED payload segment rather than the JSON it decodes to. If the two
// ever drift, this file is where it shows up instead of in a user whose reports stop arriving.
//
// Every refusal is tested by MUTATION — take a token that verifies, change one thing, and
// assert it stops verifying. A verifier that accepts everything passes a test that only ever
// feeds it valid input.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyCreatorProof } from '../src/lib/creator-proof.mjs';

const AUD = 'https://bettercommunity.test';
const NOW = 1_760_000_000;

/** A keypair plus its creator id — the raw public key as hex, which is exactly what BMM
 *  puts in `X-Creator-ID`. */
function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, cid: Buffer.from(jwk.x, 'base64url').toString('hex') };
}

/** The Rust signer's output, rebuilt. Field order is deliberate: it is signed. */
function mint({ privateKey, cid }, { aud = AUD, exp = NOW + 120, tamper } = {}) {
  const json = `{"cid":"${cid}","aud":"${aud}","exp":${exp}}`;
  let payloadB64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = crypto.sign(null, Buffer.from(payloadB64, 'utf8'), privateKey);
  if (tamper) payloadB64 = tamper(payloadB64, json);
  return `bmmc1.${payloadB64}.${sig.toString('base64url')}`;
}

describe('verifyCreatorProof', () => {
  test('a proof made for this audience returns the creator id it proves', () => {
    const k = keypair();
    assert.equal(verifyCreatorProof(mint(k), AUD, NOW), k.cid);
  });

  test('no token, an empty one, and junk are all simply anonymous', () => {
    for (const t of [undefined, null, '', 'nonsense', 'bmmc1.only.two', 'a.b.c.d']) {
      assert.equal(verifyCreatorProof(t, AUD, NOW), null);
    }
  });

  test('a proof addressed to another server is refused here', () => {
    // The reason the audience is inside the signed bytes: a proof captured by the server it
    // was made for must not open a different one.
    const k = keypair();
    const token = mint(k, { aud: 'https://someone-else.test' });
    assert.equal(verifyCreatorProof(token, AUD, NOW), null);
    // ...and it still verifies at the server it WAS made for, so the refusal is the audience
    // check and not a broken signature.
    assert.equal(verifyCreatorProof(token, 'https://someone-else.test', NOW), k.cid);
  });

  test('a trailing slash on either side is not a different origin', () => {
    const k = keypair();
    assert.equal(verifyCreatorProof(mint(k, { aud: `${AUD}/` }), AUD, NOW), k.cid);
    assert.equal(verifyCreatorProof(mint(k), `${AUD}/`, NOW), k.cid);
  });

  test('an expired proof is refused', () => {
    const k = keypair();
    assert.equal(verifyCreatorProof(mint(k, { exp: NOW - 1 }), AUD, NOW), null);
  });

  test('a proof claiming a long life is refused even though it has not expired', () => {
    // The forgotten half of an expiry check. Without it a bearer token good for two minutes
    // becomes one good for a year, and nothing about it looks wrong.
    const k = keypair();
    assert.equal(verifyCreatorProof(mint(k, { exp: NOW + 86_400 }), AUD, NOW), null);
    assert.equal(verifyCreatorProof(mint(k, { exp: NOW + 299 }), AUD, NOW), k.cid);
  });

  test('swapping in someone else\'s creator id breaks the signature', () => {
    // The attack this exists to stop: an id is public, so the interesting forgery is a valid
    // signature re-labelled with a victim's id.
    const mine = keypair();
    const victim = keypair();
    const token = mint(mine, {
      tamper: (_b64, json) => Buffer.from(json.replace(mine.cid, victim.cid), 'utf8').toString('base64url'),
    });
    assert.equal(verifyCreatorProof(token, AUD, NOW), null);
  });

  test('a signature from the wrong key is refused', () => {
    const a = keypair(); const b = keypair();
    // b's id, a's signature.
    const json = `{"cid":"${b.cid}","aud":"${AUD}","exp":${NOW + 120}}`;
    const payloadB64 = Buffer.from(json, 'utf8').toString('base64url');
    const sig = crypto.sign(null, Buffer.from(payloadB64, 'utf8'), a.privateKey);
    assert.equal(verifyCreatorProof(`bmmc1.${payloadB64}.${sig.toString('base64url')}`, AUD, NOW), null);
  });

  test('a signature over the DECODED payload is refused', () => {
    // The convention that has to match across two languages. If the Rust side ever signs the
    // JSON instead of the segment, this is the failure it produces — a token that looks
    // perfectly well-formed and never verifies.
    const k = keypair();
    const json = `{"cid":"${k.cid}","aud":"${AUD}","exp":${NOW + 120}}`;
    const payloadB64 = Buffer.from(json, 'utf8').toString('base64url');
    const sig = crypto.sign(null, Buffer.from(json, 'utf8'), k.privateKey);
    assert.equal(verifyCreatorProof(`bmmc1.${payloadB64}.${sig.toString('base64url')}`, AUD, NOW), null);
  });

  test('a wrong version prefix is refused', () => {
    const k = keypair();
    assert.equal(verifyCreatorProof(mint(k).replace('bmmc1.', 'bmmc2.'), AUD, NOW), null);
  });

  test('a truncated or padded signature is refused, not thrown on', () => {
    const k = keypair();
    const [p, payload, sig] = mint(k).split('.');
    for (const bad of ['', sig.slice(0, 20), `${sig}AAAA`]) {
      assert.equal(verifyCreatorProof(`${p}.${payload}.${bad}`, AUD, NOW), null);
    }
  });

  test('a creator id that is not 32 bytes of hex never reaches the verifier', () => {
    // BMM's ids are 64 hex characters. Anything else is refused before Node is asked to build
    // a key out of it, because that is where a throw would come from.
    const k = keypair();
    for (const junk of ['', 'zz', 'g'.repeat(64), k.cid.slice(0, 62)]) {
      const json = `{"cid":"${junk}","aud":"${AUD}","exp":${NOW + 120}}`;
      const b64 = Buffer.from(json, 'utf8').toString('base64url');
      const sig = crypto.sign(null, Buffer.from(b64, 'utf8'), k.privateKey);
      assert.equal(verifyCreatorProof(`bmmc1.${b64}.${sig.toString('base64url')}`, AUD, NOW), null);
    }
  });

  test('an uppercase id in the token comes back lowercased, so lookups match', () => {
    // CreatorLink stores what BMM sent. Two spellings of the same key must not be two
    // different people.
    const k = keypair();
    const json = `{"cid":"${k.cid.toUpperCase()}","aud":"${AUD}","exp":${NOW + 120}}`;
    const b64 = Buffer.from(json, 'utf8').toString('base64url');
    const sig = crypto.sign(null, Buffer.from(b64, 'utf8'), k.privateKey);
    assert.equal(verifyCreatorProof(`bmmc1.${b64}.${sig.toString('base64url')}`, AUD, NOW), k.cid);
  });
});
