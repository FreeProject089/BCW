// Minimal RFC 4226 / RFC 6238 TOTP implementation (HMAC-SHA1, 6 digits, 30s step —
// the same defaults every authenticator app, incl. Google/Microsoft Authenticator
// and Authy, assumes). Written from scratch instead of pulling a dependency: it's
// ~40 lines of well-specified crypto, matching this codebase's existing preference
// for small self-contained primitives (see auth.mjs's proof-of-work).
import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function base32Encode(buf) {
  let bits = 0; let value = 0; let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0; let value = 0; const bytes = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter, digits) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

// Allows +/- 1 step (30s) of clock drift between the server and the user's phone.
export function verifyTotp(secret, token, { step = 30, digits = 6, window = 1 } = {}) {
  if (!/^\d{6}$/.test(String(token || '').trim())) return false;
  const counter = Math.floor(Date.now() / 1000 / step);
  const t = String(token).trim();
  for (let w = -window; w <= window; w++) { if (hotp(secret, counter + w, digits) === t) return true; }
  return false;
}

export function otpauthUri(secret, { issuer = 'BetterCommunity', account }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

// 8 one-time recovery codes, formatted like "XXXX-XXXX" — shown once at enable
// time; the caller stores argon2 hashes, never the plaintext.
export function generateRecoveryCodes(count = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n) => Array.from({ length: n }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return Array.from({ length: count }, () => `${pick(4)}-${pick(4)}`);
}
