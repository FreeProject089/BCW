// What is a secret, for anything that copies settings out of this install.
//
// Three exporters existed and each carried its own idea of the answer: site-config.mjs had a
// name denylist, the custom seed generator had none (it only listed "safe" sections), and the
// content backup's `settings` section dumped the whole AdminSetting table — bot token, Ko-fi
// token, the backup signing key and the identity-attestation private key included — into a
// zip whose own header promised "no API tokens". A list per exporter is a list that one
// exporter forgets.
//
// So this is ONE policy, used by the config transfer (lib/config-transfer.mjs), the content
// backup and the generic settings routes, and it does not rely on key names alone:
//
//   1. KEYS that are credentials, named. These are the rows whose whole value is a secret.
//   2. FIELDS inside a value whose NAME says credential (`secret`, `token`, `password`…), at
//      any depth — the codegraph settings hold a webhook `secret` beside a harmless `url`.
//   3. VALUES whose SHAPE is a credential, whatever they are called: a Discord bot token, a
//      Stripe secret/restricted key or webhook secret, a GitHub/Slack token, a JWT, a PEM
//      block, an argon2 hash, an otpauth:// URI, a Discord webhook URL, an AWS key id, a
//      crypto-shredding envelope (lib/shred.mjs) or a long high-entropy blob. This is what
//      catches the key somebody pasted into a free-text field the schema never expected
//      to hold one.
//
// A field removed by 2 or 3 is reported by path, so the person exporting can see what did
// not travel instead of discovering it on the other install.

import { isSealed } from './shred.mjs';

/** AdminSetting rows that are credentials in their entirety. Never exported, never imported,
 *  never written through the generic settings route (each has its own guarded route). */
export const SECRET_SETTING_KEYS = new Set([
  'bot.token',                          // the Discord bot's token (routes/bot.mjs, ADMIN-only)
  'kofi.token',                         // Ko-fi webhook verification token (routes/kofi.mjs)
  'backup.signingKey',                  // ed25519 private key signing DB backups (lib/signing.mjs)
  'identity.attestation.privateKeyPem', // key signing identity attestations (lib/identity-attestation.mjs)
]);

/** Property names that hold a credential. Matched on the whole name, case-insensitively,
 *  after dropping `_`/`-`, so `client_secret`, `clientSecret` and `CLIENT-SECRET` are one. */
const SECRET_NAME = /^(?:secret|.*secret|token|.*token|accesstoken|refreshtoken|password|passwd|passphrase|.*password|privatekey|privatekeypem|apikey|.*apikey|signingkey|totpsecret|recoverycodes|totprecoverycodes|passwordhash|tokenhash|keyhash|credentials?|dsn|cookie|sessionid|webhookurl)$/i;
// Names that END in a secret word and are not secrets. Each is here because it exists in a
// real stored value and dropping it would break an import for nothing.
const NOT_SECRET_NAME = new Set(['tokens', 'icontokens', 'apptokens', 'maxtokens']);

export function isSecretFieldName(name) {
  const n = String(name || '').replace(/[-_\s]/g, '').toLowerCase();
  if (!n || NOT_SECRET_NAME.has(n)) return false;
  return SECRET_NAME.test(n);
}

const SHAPES = [
  ['discord_bot_token', /^[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}$/],
  ['stripe_secret', /^(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}$/],
  ['stripe_webhook_secret', /^whsec_[A-Za-z0-9+/=]{16,}$/],
  ['github_token', /^(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})$/],
  ['slack_token', /^xox[abprs]-[A-Za-z0-9-]{10,}$/],
  ['aws_key_id', /^(?:AKIA|ASIA)[A-Z0-9]{16}$/],
  ['jwt', /^eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/],
  ['argon2_hash', /^\$argon2(?:id|i|d)\$/],
  ['bcrypt_hash', /^\$2[aby]\$\d{2}\$/],
  ['otpauth_uri', /^otpauth:\/\//i],
  ['discord_webhook_url', /^https?:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/i],
];
// A value that IS a key (starts with the header). A key quoted inside a text is EMBEDDED's job.
const PEM = /^-----BEGIN [A-Z ]*(?:PRIVATE KEY|SECRET)[A-Z ]*-----/;

// The same kinds, found INSIDE a longer text — a doc page or a bot message that quotes a key.
// Only the shapes that cannot be anything else: a prose value is redacted in place, not
// dropped, so a page that happens to quote one keeps the rest of its words.
const EMBEDDED = [
  ['pem_private_key', /-----BEGIN [A-Z ]*(?:PRIVATE KEY|SECRET)[A-Z ]*-----[\s\S]*?(?:-----END [A-Z ]*-----|$)/g],
  ['stripe_secret', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g],
  ['stripe_webhook_secret', /\bwhsec_[A-Za-z0-9+/=]{16,}/g],
  ['github_token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g],
  ['slack_token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['aws_key_id', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['discord_bot_token', /\b[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}\b/g],
  ['discord_webhook_url', /https?:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi],
  ['argon2_hash', /\$argon2(?:id|i|d)\$[^\s"'<>]+/g],
];
export const REDACTED = '[redacted]';

/** `s` with every embedded credential replaced, and what was replaced. */
export function redactEmbedded(s) {
  const found = [];
  let out = s;
  for (const [name, re] of EMBEDDED) {
    out = out.replace(re, () => { found.push(name); return REDACTED; });
  }
  return { value: out, found };
}

/** Bits per character. A cuid is ~4.2, an English sentence ~4, a random base64 key ~5.9. */
function entropy(s) {
  const f = new Map();
  for (const ch of s) f.set(ch, (f.get(ch) || 0) + 1);
  let h = 0;
  for (const n of f.values()) { const q = n / s.length; h -= q * Math.log2(q); }
  return h;
}

/**
 * Why this string is a credential, or null.
 *
 * The high-entropy rule is deliberately narrow: at least 40 characters, no whitespace, only
 * the token alphabet with upper case, lower case AND digits, not a path or a URL, and above
 * 4.5 bits per character. Ids (cuid, snowflakes, UUIDs), colours, slugs and every URL on the
 * site fall under it; a random base64 key does not.
 */
export function secretShape(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length < 16) return null;
  if (PEM.test(s)) return 'pem_private_key';
  for (const [name, re] of SHAPES) if (re.test(s)) return name;
  try { if (isSealed(s)) return 'shred_envelope'; } catch { /* not an envelope */ }
  if (s.length >= 40 && /^[A-Za-z0-9+/=_.-]+$/.test(s) && !s.startsWith('/')
    && /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s) && entropy(s) > 4.5) return 'high_entropy';
  return null;
}

/**
 * A copy of `value` with every secret field and secret-shaped string removed.
 * Returns { value, removed: [{ path, reason }] }. Arrays keep their length (a removed
 * element becomes null) so an index still means the same thing on the other side.
 */
export function stripSecrets(value, basePath = '') {
  const removed = [];
  const walk = (v, path) => {
    if (typeof v === 'string') {
      const why = secretShape(v);
      if (why) { removed.push({ path, reason: why }); return undefined; }
      const r = redactEmbedded(v);
      if (r.found.length) { r.found.forEach((f) => removed.push({ path, reason: `${f} (redacted in text)` })); return r.value; }
      return v;
    }
    if (Array.isArray(v)) return v.map((x, i) => { const r = walk(x, `${path}[${i}]`); return r === undefined ? null : r; });
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        const p = path ? `${path}.${k}` : k;
        // A boolean or a number under a secret-sounding name (`requirePassword: true`,
        // `tokenTtlDays: 30`) is a setting ABOUT a credential, not one.
        const credentialish = (typeof x === 'string' && x !== '') || (x && typeof x === 'object');
        if (isSecretFieldName(k) && credentialish) { removed.push({ path: p, reason: 'secret_field' }); continue; }
        const r = walk(x, p);
        if (r !== undefined) out[k] = r;
      }
      return out;
    }
    return v;
  };
  const out = walk(value, basePath);
  return { value: out === undefined ? null : out, removed };
}

/** Every secret-looking thing in a value, without changing it. Used as the last check on an
 *  export's bytes and on an import's input. */
export function findSecrets(value) {
  return stripSecrets(value).removed;
}

/**
 * Put back the secret fields a stripped value lost, from what is stored now.
 *
 * An import of `codegraph.settings.bmm` carries its `url` and not its webhook `secret`;
 * writing the imported value as-is would silently erase the secret this install already has.
 * Only the secret-NAMED top-level fields are carried over — enough for every real case, and
 * nothing the import could use to smuggle a value in.
 */
export function keepLocalSecrets(incoming, current) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;
  if (!current || typeof current !== 'object' || Array.isArray(current)) return incoming;
  const out = { ...incoming };
  for (const [k, v] of Object.entries(current)) if (isSecretFieldName(k) && !(k in out)) out[k] = v;
  return out;
}
