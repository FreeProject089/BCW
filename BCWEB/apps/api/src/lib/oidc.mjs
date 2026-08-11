// OpenID Connect provider helpers — the RSA signing key (generate-once, cached) and
// JWT signing. BCWEB acts as an identity provider: it mints RS256 ID/access tokens
// that other services verify against the public key served at /.well-known/jwks.json.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from './lib.mjs';

let cached = null;

// The active signing key, generated + persisted on first use. The private PEM never
// leaves this process; only the public JWK is exposed (via jwks()).
export async function getSigningKey() {
  if (cached) return cached;
  const p = await db();
  let key = await p.oidcKey.findFirst({ where: { active: true }, orderBy: { createdAt: 'desc' } });
  if (!key) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = crypto.randomUUID();
    const publicJwk = publicKey.export({ format: 'jwk' });
    publicJwk.kid = kid; publicJwk.use = 'sig'; publicJwk.alg = 'RS256';
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    // create-if-absent race is harmless: whoever loses just reads the winner next call.
    key = await p.oidcKey.create({ data: { id: kid, alg: 'RS256', publicJwk, privatePem } })
      .catch(async () => p.oidcKey.findFirst({ where: { active: true }, orderBy: { createdAt: 'desc' } }));
  }
  cached = { kid: key.id, privatePem: key.privatePem, publicJwk: key.publicJwk };
  return cached;
}

// Public JWK set — only public key material, safe to serve to anyone.
export async function jwks() {
  const k = await getSigningKey();
  return { keys: [{ ...k.publicJwk, kid: k.kid, use: 'sig', alg: 'RS256' }] };
}

// The issuer identifier = the site's public origin (must match SITE_URL exactly, since
// relying parties validate the `iss` claim against the discovery document).
export function issuer() {
  return (process.env.SITE_URL || 'http://localhost').replace(/\/$/, '');
}

// Sign an RS256 JWT (ID token / access token). `claims` carries sub/aud/scope/nonce/etc.
export async function signRs256(claims, expiresInSeconds) {
  const k = await getSigningKey();
  return jwt.sign(claims, k.privatePem, { algorithm: 'RS256', keyid: k.kid, issuer: issuer(), expiresIn: expiresInSeconds });
}

// Verify an RS256 token we minted (used by the userinfo endpoint for access tokens).
export async function verifyRs256(token, opts = {}) {
  const k = await getSigningKey();
  const pub = crypto.createPublicKey({ key: k.publicJwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
  return jwt.verify(token, pub, { algorithms: ['RS256'], issuer: issuer(), ...opts });
}

/**
 * PKCE (RFC 7636, S256): does `verifier` hash to the `challenge` the client committed to
 * at /authorize?
 *
 * Extracted from the token route so it can be tested. It is the whole reason a public
 * client — a desktop app, a SPA — can use the authorization-code flow safely: an attacker
 * who intercepts the code cannot redeem it without the verifier, which never left the
 * client that started the exchange.
 *
 * base64url, NOT base64: the spec says so, and `+` `/` `=` in a URL-borne value are the
 * kind of difference that works in every test written against one implementation and
 * fails against a real client.
 *
 * A plain (non-hashed) comparison is intentionally NOT supported. `plain` is in the RFC
 * and is worthless — it makes the challenge and the verifier the same string, so
 * intercepting one gives you the other.
 *
 * No constant-time compare: both sides are hashes of a value already committed publicly.
 * The secret is the verifier, and it is never compared, only hashed.
 */
export function verifyPkce(challenge, verifier) {
  if (typeof challenge !== 'string' || !challenge) return false;
  if (typeof verifier !== 'string' || !verifier) return false;
  const hashed = crypto.createHash('sha256').update(verifier).digest('base64url');
  return hashed === challenge;
}
