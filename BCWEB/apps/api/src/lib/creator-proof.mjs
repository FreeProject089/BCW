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

/**
 * The one spelling of a creator id, for every place that COMPARES one.
 *
 * A creator id is the hex of an ed25519 public key. `abcd…` and `ABCD…` are the same key,
 * and BMM writes it lower case — but an admin pasting one out of a bug report, a Discord
 * message or a screenshot may not. Every proof path already agrees on lower case
 * (`verifyCreatorProof` lowercases, `acceptCreatorProof` pins the lowercased id, the admin
 * tool lowercases what it is handed); the lists that do not go through a proof did not.
 *
 * `siteban.mjs` lower-cased its IP and User-Agent entries and NOT its creator ids, and
 * `accessListMatches` compared the raw `X-Creator-ID` header against the stored string. So
 * a ban entry recorded in any other spelling than the client's simply never fired: not a
 * refusal, not a log line, a ban that quietly did nothing. Written once, used by both.
 */
export function normaliseCreatorId(v) {
  return String(v ?? '').trim().toLowerCase();
}

/** The origin a proof must be addressed to for this deployment. */
export function expectedProofAudience() {
  try { return new URL(process.env.SITE_URL || 'https://bettercommunity.ch').origin; }
  catch { return 'https://bettercommunity.ch'; }
}

// ── Creator key v5 ────────────────────────────────────────────────────────────
//
// BMM's side, and the whole design, is src-tauri/src/commands/creator_v5.rs. In short:
//
//   · the Creator ID (`cid`) is unchanged: the ed25519 public key of the ROOT key, which for
//     every existing install is the v4 key. Bans, whitelists, free-tier claims and account
//     links keyed on it carry over because the NAME never changes; only the KEY does;
//   · a separate ACTIVE key (`kid`) signs proofs. A chain of rotation certificates leads from
//     `cid` to `kid`, each one signed by the key before it ("old signs new"), the first one by
//     the root. For an upgraded install that first link IS the v4 key signing the v5 key;
//   · the proof carries a random nonce, so a second use inside its two minutes is refused
//     (by the caller: that needs state, see creator-identity.mjs);
//   · `fp` holds per-component fingerprint HASHES, salted by BMM with this server's origin.
//     Nothing raw ever reaches us.
//
//   bmmc5.<b64u(payload)>.<b64u(sig over "bmmc5." + payload segment)>
//   payload = {"v":5,"cid","kid","aud","iat","exp","nonce","fp":{fv,board?,os?,disk?,canvas?},"chain":[bmmk5…]}
//   bmmk5.<b64u({"t":"bmm-key-rotate","cid","prev","next","seq","iat"})>.<b64u(sig by prev over "bmmk5." + segment)>
//
// The "bmmc5." prefix inside the signed bytes is domain separation: a v5 proof signed by a
// root key (a fresh install signs with its root) cannot be relabelled "bmmc1." to skip the
// nonce check, because v1 verifies a signature over the bare segment.

/** Longest rotation chain accepted. BMM refuses to grow one past this too. */
export const MAX_CHAIN = 8;
/** Clock skew tolerated on `iat`. */
const SKEW_SECONDS = 60;
const HEX64 = /^[0-9a-f]{64}$/;
const FP_KEYS = ['board', 'os', 'disk', 'canvas'];

function decodeSeg(seg) {
  try {
    const v = JSON.parse(Buffer.from(String(seg), 'base64url').toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

function sigOk(pubHex, message, sigB64) {
  const key = ed25519PublicKey(pubHex);
  if (!key) return false;
  let sig;
  try { sig = Buffer.from(String(sigB64), 'base64url'); } catch { return false; }
  if (sig.length !== 64) return false;
  try { return verify(null, Buffer.from(message, 'utf8'), key, sig); } catch { return false; }
}

/**
 * Walk a rotation chain from `cid`. Returns `{ ok, kids, error }` where `kids[0]` is the cid
 * and `kids[i]` the key introduced by link `i`, so the key a proof may be signed by is the
 * last entry, and `kids.indexOf(k)` is the sequence number at which `k` was introduced.
 */
export function verifyKeyChain(cid, chain) {
  const id = String(cid || '').toLowerCase();
  if (!HEX64.test(id)) return { ok: false, kids: [], error: 'bad_cid' };
  if (!Array.isArray(chain)) return { ok: false, kids: [id], error: 'bad_chain' };
  if (chain.length > MAX_CHAIN) return { ok: false, kids: [id], error: 'chain_too_long' };
  const kids = [id];
  for (let i = 0; i < chain.length; i++) {
    const parts = String(chain[i] || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'bmmk5') return { ok: false, kids, error: `link_${i + 1}_malformed` };
    const c = decodeSeg(parts[1]);
    if (!c || c.t !== 'bmm-key-rotate') return { ok: false, kids, error: `link_${i + 1}_malformed` };
    const prev = String(c.prev || '').toLowerCase();
    const next = String(c.next || '').toLowerCase();
    if (String(c.cid || '').toLowerCase() !== id) return { ok: false, kids, error: `link_${i + 1}_other_id` };
    if (prev !== kids[kids.length - 1]) return { ok: false, kids, error: `link_${i + 1}_does_not_follow` };
    if (Number(c.seq) !== i + 1) return { ok: false, kids, error: `link_${i + 1}_out_of_order` };
    if (!HEX64.test(next) || !ed25519PublicKey(next)) return { ok: false, kids, error: `link_${i + 1}_bad_key` };
    if (!sigOk(prev, `bmmk5.${parts[1]}`, parts[2])) return { ok: false, kids, error: `link_${i + 1}_bad_signature` };
    kids.push(next);
  }
  return { ok: true, kids, error: null };
}

/** Only well-formed 128-bit hex hashes survive; anything else a client put in `fp` is dropped. */
export function cleanFingerprint(fp) {
  const out = {};
  if (!fp || typeof fp !== 'object') return out;
  for (const k of FP_KEYS) {
    const v = String(fp[k] || '').toLowerCase();
    if (/^[0-9a-f]{32}$/.test(v)) out[k] = v;
  }
  return out;
}

/**
 * A v5 proof, checked statelessly: format, audience, time window, chain, signature.
 *
 * Returns `{ version: 5, cid, kid, seq, kids, nonce, exp, fp }` or null. It does NOT refuse a
 * replay or a forked chain; both need memory. `acceptCreatorProof` in creator-identity.mjs
 * adds them, and every route that acts on a proof must go through that.
 */
export function verifyCreatorProofV5(token, expectedAud, nowSeconds = Math.floor(Date.now() / 1000)) {
  const t = String(token || '');
  if (t.length > 8192) return null;
  const parts = t.split('.');
  if (parts.length !== 3 || parts[0] !== 'bmmc5') return null;
  const pl = decodeSeg(parts[1]);
  if (!pl || pl.v !== 5) return null;
  const cid = String(pl.cid || '').toLowerCase();
  const kid = String(pl.kid || '').toLowerCase();
  if (!HEX64.test(cid) || !HEX64.test(kid)) return null;

  const iat = Number(pl.iat); const exp = Number(pl.exp);
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null;
  if (exp <= nowSeconds || iat > nowSeconds + SKEW_SECONDS || exp <= iat || exp - iat > MAX_TTL_SECONDS) return null;

  const aud = String(pl.aud || '').replace(/\/+$/, '');
  if (!aud || !expectedAud || aud !== String(expectedAud).replace(/\/+$/, '')) return null;

  const nonce = String(pl.nonce || '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(nonce)) return null;

  const ch = verifyKeyChain(cid, pl.chain);
  if (!ch.ok || ch.kids[ch.kids.length - 1] !== kid) return null;
  if (!sigOk(kid, `bmmc5.${parts[1]}`, parts[2])) return null;

  return { version: 5, cid, kid, seq: ch.kids.length - 1, kids: ch.kids, nonce, exp, fp: cleanFingerprint(pl.fp) };
}

/** Either version, statelessly: `{ version, cid, … }` or null. v1 has no kid chain, nonce or fp. */
export function verifyAnyCreatorProof(token, expectedAud, nowSeconds = Math.floor(Date.now() / 1000)) {
  const t = String(token || '');
  if (t.startsWith('bmmc5.')) return verifyCreatorProofV5(t, expectedAud, nowSeconds);
  const cid = verifyCreatorProof(t, expectedAud, nowSeconds);
  return cid ? { version: 1, cid, kid: cid, seq: 0, kids: [cid], nonce: null, exp: null, fp: {} } : null;
}

/**
 * Take a pasted value apart for staff: a bare creator id, a bmmc1 proof or a bmmc5 proof.
 *
 * Every check is reported separately. "Signature valid, expired, addressed elsewhere" is a
 * useful answer about a token copied out of a report days ago, and a single yes/no is not.
 * Nothing here trusts the token: the chain and signature are verified, never assumed.
 */
export function inspectCreatorToken(raw, expectedAud, nowSeconds = Math.floor(Date.now() / 1000)) {
  const v = String(raw || '').trim();
  if (HEX64.test(v.toLowerCase())) return { kind: 'id', version: null, cid: v.toLowerCase(), checks: {} };
  if (v.length > 8192) return { kind: 'unknown', error: 'too_long' };
  const parts = v.split('.');
  if (parts.length !== 3 || !['bmmc1', 'bmmc5'].includes(parts[0])) return { kind: 'unknown', error: 'not_a_creator_id_or_proof' };
  const pl = decodeSeg(parts[1]);
  if (!pl) return { kind: 'unknown', error: 'undecodable' };
  const cid = String(pl.cid || '').toLowerCase();
  const aud = String(pl.aud || '').replace(/\/+$/, '').slice(0, 200);
  const exp = Number(pl.exp);
  const base = {
    cid: HEX64.test(cid) ? cid : null,
    aud,
    exp: Number.isFinite(exp) ? exp : null,
    checks: {
      id: HEX64.test(cid) && !!ed25519PublicKey(cid),
      audience: !!expectedAud && aud === String(expectedAud).replace(/\/+$/, ''),
      unexpired: Number.isFinite(exp) && exp > nowSeconds,
    },
  };
  if (parts[0] === 'bmmc1') {
    base.checks.signature = base.checks.id && sigOk(cid, parts[1], parts[2]);
    return { kind: 'proof', version: 1, kid: base.cid, seq: 0, fp: {}, ...base };
  }
  const kid = String(pl.kid || '').toLowerCase();
  const ch = base.cid ? verifyKeyChain(cid, pl.chain) : { ok: false, kids: [], error: 'bad_cid' };
  base.checks.chain = ch.ok && ch.kids[ch.kids.length - 1] === kid;
  base.checks.signature = HEX64.test(kid) && sigOk(kid, `bmmc5.${parts[1]}`, parts[2]);
  base.checks.nonce = /^[0-9a-f]{32}$/.test(String(pl.nonce || ''));
  return {
    kind: 'proof', version: 5, kid: HEX64.test(kid) ? kid : null, seq: Math.max(0, ch.kids.length - 1),
    chainError: ch.error, iat: Number(pl.iat) || null, fp: cleanFingerprint(pl.fp), ...base,
  };
}
