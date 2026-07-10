// Shared, fully-local TOTP + vault primitives used by both the /2fa page (twofa.jsx)
// and the inline quick-fill widget (twofa-fill.jsx). No network — everything is
// computed with the Web Crypto API and read from localStorage on this device only.

export const LS_KEY = 'bcw_2fa_vault';
export const PENDING_KEY = 'bcw_2fa_pending'; // hand-off slot: Profile → /2fa import
export const A2H = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

export const rid = () => Math.random().toString(36).slice(2, 10);

// ── Base32 (RFC 4648) ──
export function base32Decode(input) {
  const alph = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input || '').toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  if (!clean) throw new Error('empty');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = alph.indexOf(ch);
    if (idx === -1) throw new Error('bad base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

// ── TOTP code (RFC 6238) ──
export async function totp(secretB32, { digits = 6, period = 30, algorithm = 'SHA1' } = {}, at = Date.now()) {
  const key = base32Decode(secretB32);
  const counter = Math.floor(at / 1000 / period);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
  const ck = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: { name: A2H[algorithm] || 'SHA-1' } }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', ck, msg));
  const off = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[off] & 0x7f) << 24) | ((sig[off + 1] & 0xff) << 16) | ((sig[off + 2] & 0xff) << 8) | (sig[off + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

// ── otpauth://totp/Issuer:Label?secret=…&… ──
export function parseOtpauth(uri) {
  const u = new URL(uri);
  if (u.protocol !== 'otpauth:') throw new Error('not otpauth');
  if (u.host !== 'totp') throw new Error('only TOTP is supported');
  const path = decodeURIComponent(u.pathname.replace(/^\//, ''));
  const [maybeIssuer, maybeLabel] = path.includes(':') ? path.split(/:(.+)/) : [null, path];
  const q = u.searchParams;
  const secret = (q.get('secret') || '').replace(/\s+/g, '').slice(0, 512);
  if (!secret) throw new Error('missing secret');
  base32Decode(secret);
  const algo = (q.get('algorithm') || 'SHA1').toUpperCase();
  return {
    issuer: (q.get('issuer') || maybeIssuer || '').slice(0, 128),
    label: (maybeLabel || maybeIssuer || 'Account').trim().slice(0, 128),
    secret,
    digits: Math.min(8, Math.max(6, Number(q.get('digits')) || 6)),
    period: Math.min(120, Math.max(15, Number(q.get('period')) || 30)),
    algorithm: algo in A2H ? algo : 'SHA1',
  };
}

// Clamp/validate an account from an untrusted source (import file / hand-off). Rejects
// a bad secret and bounds every numeric field so e.g. digits:99999 can't blow up
// 10**digits / padStart (CWE-400) or bloat storage. Returns null if unusable.
export function sanitizeAccount(a) {
  if (!a || typeof a.secret !== 'string') return null;
  const secret = a.secret.replace(/\s+/g, '').slice(0, 512);
  try { base32Decode(secret); } catch { return null; }
  const algo = String(a.algorithm || 'SHA1').toUpperCase();
  return {
    id: rid(),
    label: String(a.label || 'Account').slice(0, 128),
    issuer: String(a.issuer || '').slice(0, 128),
    secret,
    digits: Math.min(8, Math.max(6, Number(a.digits) || 6)),
    period: Math.min(120, Math.max(15, Number(a.period) || 30)),
    algorithm: algo in A2H ? algo : 'SHA1',
    backupCodes: Array.isArray(a.backupCodes) ? a.backupCodes.map((c) => String(c).slice(0, 64)).slice(0, 50) : [],
    addedAt: Number(a.addedAt) || Date.now(),
  };
}

// ── AES-GCM vault encryption (PBKDF2 → AES-256-GCM) ──
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptVault(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return { v: 1, enc: true, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
export async function decryptVault(blob, pass) {
  const key = await deriveKey(pass, unb64(blob.salt));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ── Vault read helpers for external callers (quick-fill) ──
export function readVaultRaw() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; } }
// { locked, accounts } — accounts is empty while the vault is passphrase-encrypted
// (can't read without the passphrase, which lives only on the /2fa page in memory).
export function readAccounts() {
  const raw = readVaultRaw();
  if (!raw) return { locked: false, accounts: [] };
  if (raw.enc) return { locked: true, accounts: [] };
  return { locked: false, accounts: Array.isArray(raw.accounts) ? raw.accounts : [] };
}

// Hand-off slot so Profile can push a freshly-enrolled BCWEB account (+ backup codes)
// into the /2fa page without needing the vault passphrase here.
export function stagePending(acct) { try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(acct)); } catch { /* ignore */ } }
export function takePending() {
  try { const s = sessionStorage.getItem(PENDING_KEY); if (s) { sessionStorage.removeItem(PENDING_KEY); return JSON.parse(s); } } catch { /* ignore */ }
  return null;
}

// Fired whenever the vault changes so live widgets (TotpQuickFill) re-read it.
const VAULT_EVENT = 'bcw-2fa-vault-changed';
export function onVaultChange(fn) { if (typeof window === 'undefined') return () => {}; window.addEventListener(VAULT_EVENT, fn); return () => window.removeEventListener(VAULT_EVENT, fn); }
function emitVaultChange() { try { window.dispatchEvent(new Event(VAULT_EVENT)); } catch { /* ignore */ } }

// Add an account straight into the LOCAL vault (used by Profile's "Add to BCWEB
// Authenticator"). If the vault is passphrase-encrypted we can't write without the
// passphrase, so we stage it for the /2fa page to import on next unlock.
// Returns { added } | { added, dup } | { staged } | { error }.
export function addLocalAccount(input) {
  const acct = sanitizeAccount(input);
  if (!acct) return { error: 'bad_account' };
  const raw = readVaultRaw();
  if (raw?.enc) { stagePending(input); return { staged: true }; }
  const accounts = Array.isArray(raw?.accounts) ? raw.accounts : [];
  const history = Array.isArray(raw?.history) ? raw.history : [];
  const existing = accounts.find((a) => a.secret === acct.secret);
  if (existing) {
    // Already there — merge in any new backup codes (e.g. added at setup, then the
    // recovery codes arrive on enable) rather than duplicating the account.
    if (acct.backupCodes?.length) existing.backupCodes = [...new Set([...(existing.backupCodes || []), ...acct.backupCodes])];
    try { localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, enc: false, accounts, history })); } catch { return { error: 'save_failed' }; }
    emitVaultChange();
    return { added: true, dup: true };
  }
  accounts.push(acct);
  try { localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, enc: false, accounts, history })); } catch { return { error: 'save_failed' }; }
  emitVaultChange();
  return { added: true };
}

// Attach backup/recovery codes to an EXISTING local account by secret (used on 2FA
// enable, once the recovery codes are known, to complete a setup-time add). No-op if
// the account isn't present or the vault is encrypted (nothing to safely update).
export function attachBackupCodesBySecret(secret, codes) {
  const norm = (s) => String(s || '').replace(/\s+/g, '');
  if (!norm(secret) || !Array.isArray(codes) || !codes.length) return { skipped: true };
  const raw = readVaultRaw();
  if (!raw || raw.enc) return { skipped: true };
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  const a = accounts.find((x) => norm(x.secret) === norm(secret));
  if (!a) return { skipped: true };
  a.backupCodes = [...new Set([...(a.backupCodes || []), ...codes.map((c) => String(c).slice(0, 64))])].slice(0, 50);
  try { localStorage.setItem(LS_KEY, JSON.stringify({ ...raw, accounts })); } catch { return { error: 'save_failed' }; }
  emitVaultChange();
  return { updated: true };
}
