// Verifying that a caller holds the private half of the Creator ID it claims.
//
// `X-Creator-ID` is an ed25519 PUBLIC key, and the platform reads it as an identity — the
// feedback centre opens a thread in the sender's dashboard from it. But a public key is
// public: it is the thing repo owners collect in order to whitelist people, so a header
// carrying one is a claim anybody who has seen it can make. A report filed under somebody
// else's name would land in their inbox and mail them about it.
//
// So the claim is checked. BMM signs a short, domain-separated statement with the key its id
// names (src-tauri/src/commands/security.rs — `creator_proof`; keep the two in step), and this
// verifies it against that same id. Nothing is stored, nothing is registered, and a caller
// that cannot sign is simply anonymous rather than refused — the feature this guards is
// "replies reach you", not access.
//
// Format:
//
//   bmmc1.<base64url(JSON payload)>.<base64url(raw ed25519 signature)>
//   payload = { cid: <hex public key>, aud: <origin>, exp: <unix seconds> }
//
// The signature covers the base64url payload SEGMENT AS TRANSMITTED, not the JSON it decodes
// to — the same rule as the `bcw1.` attestations. Signing the decoded form would make validity
// depend on both sides serialising byte-for-byte identically, and a differing key order would
// look like a forgery.

import { createPublicKey, verify } from 'node:crypto';

/** Longest life this accepts, whatever the token says. The signer uses 120 s; a token
 *  claiming a week was either made by something else or made to be replayed. */
const MAX_TTL_SECONDS = 300;

/**
 * A raw 32-byte ed25519 public key as a KeyObject.
 *
 * Node will not take the bare key, only SPKI — which for ed25519 is a FIXED 12-byte prefix
 * followed by the key, so the wrapping is a concatenation rather than a conversion. Written
 * out here because the alternative is a DER library for twelve constant bytes.
 */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
function ed25519PublicKey(hex32) {
  if (!/^[0-9a-f]{64}$/i.test(hex32)) return null;
  try {
    return createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex32, 'hex')]),
      format: 'der',
      type: 'spki',
    });
  } catch { return null; }
}

/**
 * The creator id a proof actually proves, or null.
 *
 * `expectedAud` is this server's own origin — compared against, never taken from the token.
 * A proof made for someone else's server is refused here, which is the whole reason the
 * audience is inside the signed bytes.
 *
 * Returns the LOWERCASED hex id on success. Never throws: every malformed, expired or
 * mis-addressed token is the same answer as no token at all.
 */
export function verifyCreatorProof(token, expectedAud, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'bmmc1') return null;
  const [, payloadB64, sigB64] = parts;

  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); }
  catch { return null; }
  if (!payload || typeof payload !== 'object') return null;

  const cid = String(payload.cid || '').toLowerCase();
  const key = ed25519PublicKey(cid);
  if (!key) return null;

  // Expiry, both ends. Past is the obvious one; too far in the future is the one that gets
  // forgotten, and it is what turns a 2-minute bearer token into a permanent credential.
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp <= nowSeconds || exp > nowSeconds + MAX_TTL_SECONDS) return null;

  const aud = String(payload.aud || '').replace(/\/+$/, '');
  if (!aud || !expectedAud || aud !== String(expectedAud).replace(/\/+$/, '')) return null;

  let sig;
  try { sig = Buffer.from(sigB64, 'base64url'); } catch { return null; }
  if (sig.length !== 64) return null;

  // `null` algorithm: ed25519 signs the message directly, no separate digest.
  try { return verify(null, Buffer.from(payloadB64, 'utf8'), key, sig) ? cid : null; }
  catch { return null; }
}

/** The origin a proof must be addressed to for this deployment. */
export function expectedProofAudience() {
  try { return new URL(process.env.SITE_URL || 'https://bettercommunity.ch').origin; }
  catch { return 'https://bettercommunity.ch'; }
}
