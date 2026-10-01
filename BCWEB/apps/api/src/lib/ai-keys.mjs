// AI provider keys at rest (aios, agent-bcw-ai-os): a member's own key (BYOK) and the site key
// an admin types into the dashboard.
//
// SEALED, NEVER SHOWN AGAIN. A key is encrypted with AES-256-GCM through shred.mjs's
// seal()/open() — the same envelope the backups use, so there is one implementation of it to
// audit — under a key DERIVED (HKDF-SHA256) from AI_KEYS_SECRET, or from JWT_SECRET when that
// is not set. The derivation carries its own label, so the JWT secret is never used as an
// encryption key directly and the two can never be confused.
//
// What this protects, honestly: a database dump, a backup or a replica read without the
// application's environment yields ciphertext. It does not protect a key from somebody who
// holds both the database and the environment, and nothing at rest could.
//
// Rotating the secret makes every stored key unreadable: openKey() returns null, the feature
// says "no key", and the member types theirs again. That is the documented behaviour
// (guides/run/AI_FEATURES_*.md), not a failure.
//
// The URL a key goes with is validated with the same rules as the operator's external
// provider (validateExternalUrl: https only, no private address, no credentials, no query),
// and is called through net.mjs safeFetch, which re-checks every DNS answer and pins it.
import crypto from 'node:crypto';
import { seal, open } from './shred.mjs';
import { JWT_SECRET } from './jwt-secret.mjs';
import { validateExternalUrl } from './moderation/ai.mjs';

const LABEL = 'bcw-ai-keys-v1';

function masterKey(env = process.env) {
  const secret = String(env.AI_KEYS_SECRET || '').trim() || JWT_SECRET;
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from(LABEL, 'utf8'), Buffer.from('ai-provider-key', 'utf8'), 32));
}

/** Seal one API key for one owner (a user id, or 'site'). */
export function sealKey(plain, owner) {
  return seal(masterKey(), String(plain), String(owner || 'site'));
}

/** The key back, or null when it cannot be read (rotated secret, edited envelope). Never throws. */
export function openKey(envelope, owner) {
  try {
    const e = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
    // The envelope names its owner; one sealed for somebody else is refused even if it
    // decrypts, so a row copied onto another account does not hand them the key.
    if (owner != null && String(e?.userId) !== String(owner)) return null;
    return open(masterKey(), e);
  } catch { return null; }
}

/** The four characters a person recognises their key by. Nothing more is ever shown. */
export function last4(plain) {
  const s = String(plain || '').trim();
  return s.length >= 12 ? s.slice(-4) : '';
}

/** A plausible key: printable, no spaces, 8..400 characters. */
export function keyShapeOk(k) {
  return typeof k === 'string' && /^[\x21-\x7e]{8,400}$/.test(k.trim());
}

/**
 * Validate a provider base URL for a stored key.
 *
 * The operator may lift the private-address rule for THEIR provider (AI_EXTERNAL_ALLOW_PRIVATE=1:
 * a model on their own network) — and that is the SITE key only (`{ site: true }`). A member's
 * key (BYOK) and a Discord server's key never get it: their URL is typed by somebody else, and
 * with the switch on it would aim the API's own network position at 127.0.0.1, the LAN or the
 * cloud metadata address (SSRF). Audit Oct 2026, finding 6.
 *
 * Tests only: AI_TEST_ALLOW_PRIVATE_BYOK=1 lets the route tests point a member key at their fake
 * provider on 127.0.0.1. It is read only under the node test runner (NODE_TEST_CONTEXT) and
 * never in production, so no deployment can turn it on.
 */
export function checkBaseUrl(raw, { site = false } = {}, env = process.env) {
  const operator = /^(1|true)$/i.test(String(env.AI_EXTERNAL_ALLOW_PRIVATE || ''));
  const testDoor = /^(1|true)$/i.test(String(env.AI_TEST_ALLOW_PRIVATE_BYOK || '')) && !!env.NODE_TEST_CONTEXT && env.NODE_ENV !== 'production';
  const allowPrivate = site ? operator : testDoor;
  const v = validateExternalUrl(raw, { allowPrivate });
  if (!v.ok) return v;
  return { ok: true, url: v.url.toString().replace(/\/+$/, ''), host: v.url.host, allowPrivate };
}

/** The host a key talks to, for the disclosure line ("sent to api.example.com"). */
export function hostOf(url) {
  try { return new URL(url).host; } catch { return ''; }
}
