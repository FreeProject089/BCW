// Signed account-identity attestations for self-hosted BMM repo servers.
//
// A repo owner running their own HTTP repo wants to ban or allow *people*, not headers.
// BMM's `X-Creator-ID` is caller-supplied, so a ban is evaded by dropping it and an allow
// list is passed by claiming an id that is on it.
//
// The obvious fix — an endpoint the repo server calls to resolve a creator id into its
// linked accounts — is not built here on purpose: it would answer "is creator id X linked
// to Discord account Y?" for arbitrary X and Y, to anyone who can run a repo server. That
// is a linkage oracle over data users did not agree to publish.
//
// Instead the *account holder* asks us for a short-lived, signed statement of who they are,
// and presents it themselves. Linkage is disclosed only to the person it describes. The repo
// server verifies the signature offline with our public key, so downloads keep working when
// this API is down and we learn nothing about who downloads what.
//
// Format (verified by src-tauri/src/commands/identity.rs — keep the two in step):
//
//   bcw1.<base64url(JSON payload)>.<base64url(ed25519 signature)>
//
// The signature covers the base64url payload segment as transmitted, NOT the JSON it decodes
// to: signing the decoded form would make validity depend on both sides serialising byte-for
// byte identically, and a differing key order would look like a forgery.

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { db } from './lib.mjs';

const SETTING_KEY = 'identity.attestation.privateKeyPem';

// One hour. Long enough that a sync of a large repo never expires mid-download, short
// enough that a leaked attestation stops being useful quickly. It is a bearer token —
// whoever holds it can replay it until it expires, the same exposure as a session cookie.
export const ATTESTATION_TTL_SECONDS = 3600;

let _cache = null;

// The key lives in AdminSetting rather than an env var so the platform keeps working across
// deploys without an operator having to carry a secret around — a rotated-away key silently
// invalidates every repo owner's configured public key, which presents as "bans stopped
// working" on machines we do not control.
async function loadKeys() {
  if (_cache) return _cache;
  const p = await db();
  let row = await p.adminSetting.findUnique({ where: { key: SETTING_KEY } });
  if (!row?.value) {
    const { privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    row = await p.adminSetting.upsert({
      where: { key: SETTING_KEY },
      update: { value: pem },
      create: { key: SETTING_KEY, value: pem },
    });
  }
  const privateKey = createPrivateKey(row.value);
  const publicKey = createPublicKey(privateKey);
  // Repo servers hold the raw 32-byte ed25519 key as hex. JWK's `x` is that key, base64url.
  const jwk = publicKey.export({ format: 'jwk' });
  const publicKeyHex = Buffer.from(jwk.x, 'base64url').toString('hex');
  _cache = { privateKey, publicKeyHex };
  return _cache;
}

export async function attestationPublicKeyHex() {
  return (await loadKeys()).publicKeyHex;
}

/**
 * Mint an attestation for one account.
 *
 * `identity` is the shape `loadOwnerIdentities` returns for a user, plus their bcid.
 * Ko-fi status is deliberately NOT included: it is unrelated to access control and would
 * hand every repo server a donor list.
 */
export async function mintAttestation({ bcid, creatorIds = [], discordIds = [] }, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!bcid) throw new Error('bcid is required');
  const { privateKey } = await loadKeys();
  const payload = {
    bcid,
    creatorIds: [...new Set(creatorIds.filter(Boolean))],
    discordIds: [...new Set(discordIds.filter(Boolean))],
    iat: nowSeconds,
    exp: nowSeconds + ATTESTATION_TTL_SECONDS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  // `null` algorithm: ed25519 signs the message directly, no separate digest.
  const signature = sign(null, Buffer.from(payloadB64, 'utf8'), privateKey);
  return {
    token: `bcw1.${payloadB64}.${signature.toString('base64url')}`,
    expiresAt: payload.exp,
  };
}
