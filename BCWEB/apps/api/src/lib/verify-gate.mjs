// What an account that has never confirmed its e-mail address may do.
//
// ── The problem ───────────────────────────────────────────────────────────────
// The confirmation mail has always gone out and /auth/verify-email has always worked, and
// four routes checked the result. Everything else did not: an address nobody can receive
// mail at could open a team, post in a thread, mint an API key and message other members.
// "Your account is created" meant nothing, and the one thing a confirmed address buys —
// being reachable afterwards — was exactly what those actions needed.
//
// ── The rule ──────────────────────────────────────────────────────────────────
// An unverified account is READ-ONLY, plus an explicit list of writes that concern nobody
// but itself.
//
// Deny-by-default rather than a guard added route by route, because this is a rule about
// the whole site and a rule written in eighty places is eighty places to forget it. A new
// route that publishes something is refused for an unverified caller the day it is written,
// with nobody remembering to do anything.
//
// ── Why it is not a lockout ───────────────────────────────────────────────────
// Somebody who typed `jon@gmial.com` must not lose the account. So an unverified account can
// still do everything that could FIX the situation or get them out:
//
//   · sign in, and stay signed in. A person who cannot sign in cannot see which address they
//     typed, cannot ask for the link again, and cannot reach support. The repo already
//     refuses to put a weak-password rule on the login path for the same reason.
//   · ask for the confirmation link again, reset the password, sign out.
//   · edit their own profile, change their password, turn 2FA on or off, list and revoke
//     their signed-in devices, read and mute notifications, accept a policy.
//   · link a GitHub or Discord account — which is itself a way to prove an address.
//   · close the account and take their data with them. Leaving is never gated.
//
// And two exemptions carried over from requireVerifiedEmail(), for the same reasons:
//
//   · if e-mail is switched off for this deployment nobody can EVER confirm, so the gate
//     stands aside entirely rather than bricking the site;
//   · staff are exempt, because an admin locked out of the admin surface by an unverified
//     address has no way to fix it from inside.
//
// ── What it refuses ───────────────────────────────────────────────────────────
// Everything else that writes. Notably `/me/catalogs`, `/me/teams`, `/me/threads/:id/messages`,
// `/me/transfers`, `/me/webhooks`, `/me/api-keys` and `/me/notifications-key` — the last two
// because an API key is a credential that does not carry a cookie, so it is the one way this
// hook could be walked around. An account that can never mint one can never walk around it.
//
// The refusal names itself (`email_unverified`), so the client can offer "send the link
// again" rather than a generic failure.

import jwt from 'jsonwebtoken';
import { emailEnabled } from './mail.mjs';

/** How long an unverified password sign-up lives before it is released. */
export const VERIFY_WINDOW_DAYS = 14;
/** When the single "you never confirmed" reminder goes out, counted from sign-up. */
export const VERIFY_REMIND_DAYS = 7;
/** The shortest gap between two confirmation mails to the same account. */
export const RESEND_MIN_GAP_MS = 5 * 60 * 1000;
/** How many confirmation mails one account may cause in a rolling day. */
export const RESEND_MAX_PER_DAY = 5;
/** The window the resend count is taken over. */
export const RESEND_DAY_MS = 24 * 3600 * 1000;

const ADMIN_TIER_ROLES = ['MOD', 'ADMIN', 'SUPERADMIN'];

/**
 * The writes an unverified account may still make.
 *
 * `*` matches one path segment; a trailing `**` matches the rest. Written out as literal
 * paths rather than prefixes on purpose: `/me/` is NOT a safe prefix — `/me/catalogs`,
 * `/me/teams` and `/me/threads/:id/messages` all publish to other people, and a prefix rule
 * would have let every one of them through while reading as if it were about settings.
 */
export const UNVERIFIED_ALLOW = [
  // Credentials. Never gated, whatever state the account is in.
  ['*', '/auth/**'],
  ['*', '/account/closure/cancel'],

  // The account's own settings.
  ['PATCH', '/me'],
  ['POST', '/me/password'],
  ['POST', '/me/2fa/setup'],
  ['POST', '/me/2fa/enable'],
  ['POST', '/me/2fa/disable'],
  ['PUT', '/me/messaging'],
  ['POST', '/me/legal-accept'],
  // The first-run flow's own progress (which step, which were skipped). It concerns nobody
  // else, and its first step is the one that asks for the confirmation.
  ['POST', '/me/onboarding'],

  // Signed-in devices: the screen that exists to evict an intruder must work before anything
  // else does.
  ['DELETE', '/me/sessions'],
  ['DELETE', '/me/sessions/*'],

  // Notifications: reading and muting them, never minting the key that reads them remotely.
  ['PUT', '/me/notification-prefs'],
  ['POST', '/me/notifications/*/read'],
  ['POST', '/me/notifications/read-all'],
  ['DELETE', '/me/notifications'],
  ['DELETE', '/me/notifications/*'],

  // Proving who you are by another route. Linking a provider is how somebody with a typo'd
  // address gets a confirmed one without waiting for anything.
  ['*', '/me/oauth/*'],
  ['DELETE', '/me/connections/*'],

  // Leaving. Always.
  ['POST', '/me/closure'],
  ['POST', '/me/closure/cancel'],
  ['POST', '/me/closure/survey'],
  ['DELETE', '/me/closure'],
  ['POST', '/me/telemetry/data-request'],
];

/** Strip the query string and any trailing slash, so `/me/password?x=1` and `/me/password/`
 *  are the same path as `/me/password`. A rule that can be side-stepped by a slash is not a
 *  rule. */
export function normalizePath(url) {
  let p = String(url || '').split('?')[0].split('#')[0];
  // The API is mounted under /api at the edge and bare in tests; accept both spellings so the
  // list does not have to be written twice.
  if (p.startsWith('/api/')) p = p.slice(4);
  else if (p === '/api') p = '/';
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '') || '/';
  return p;
}

function segMatch(pattern, path) {
  const ps = pattern.split('/').filter(Boolean);
  const xs = path.split('/').filter(Boolean);
  for (let i = 0; i < ps.length; i++) {
    if (ps[i] === '**') return true;
    if (i >= xs.length) return false;
    if (ps[i] === '*') continue;
    if (ps[i] !== xs[i]) return false;
  }
  return ps.length === xs.length;
}

/** Read-only methods are always fine — the gate is about what an unverified account WRITES. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * May an unverified account make this request?
 *
 * Pure, and exported on its own so the boundary is testable without a database, a cookie or
 * an SMTP server. The interesting assertions are the negative ones.
 */
export function unverifiedMayWrite(method, url) {
  const m = String(method || '').toUpperCase();
  if (READ_METHODS.has(m)) return true;
  const path = normalizePath(url);
  return UNVERIFIED_ALLOW.some(([am, pattern]) => (am === '*' || am === m) && segMatch(pattern, path));
}

// Whether an account is verified, remembered briefly. Every refused-by-default write would
// otherwise cost one indexed read; confirming is a one-way door, so a stale "not verified"
// can only ever last this long and a stale "verified" cannot happen at all (the row is
// evicted by the verify route).
const CACHE_TTL_MS = 30_000;
const verifiedCache = new Map();
export function clearVerifiedCache(uid) {
  if (uid) verifiedCache.delete(uid); else verifiedCache.clear();
}

/**
 * Register the gate.
 *
 * An `onRequest` hook, and it reads the cookie itself rather than waiting for a route's own
 * preHandler: app-level preHandlers run BEFORE route-level ones in Fastify, so `req.user` does
 * not exist yet at any point where this could stand.
 *
 * A request with no session cookie is not this hook's business — an unauthenticated write is
 * somebody else's 401, and a bot/webhook/API-key caller carries no cookie at all.
 */
export function registerVerifyGate(app, { db, jwtSecret }) {
  app.addHook('onRequest', async (req, reply) => {
    // Nobody can confirm when no mail can be sent. Same rule as requireVerifiedEmail().
    if (!emailEnabled()) return;
    if (unverifiedMayWrite(req.method, req.url)) return;
    const tok = req.cookies?.bcw_session;
    if (!tok) return;
    let claims;
    try { claims = jwt.verify(tok, jwtSecret); } catch { return; }
    if (!claims?.uid) return;
    if (ADMIN_TIER_ROLES.includes(claims.role)) return;
    const hit = verifiedCache.get(claims.uid);
    let verified;
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) verified = hit.v;
    else {
      try {
        const p = await db();
        const u = await p.user.findUnique({ where: { id: claims.uid }, select: { emailVerified: true, role: true } });
        // A role in the cookie is seven days old; the live row is what staff exemption means.
        if (!u || ADMIN_TIER_ROLES.includes(u.role)) { verifiedCache.set(claims.uid, { at: Date.now(), v: true }); return; }
        verified = !!u.emailVerified;
        verifiedCache.set(claims.uid, { at: Date.now(), v: verified });
      } catch {
        // Database trouble must not turn into "nobody can do anything". The route behind this
        // will fail on its own if the database is really down.
        return;
      }
    }
    if (verified) return;
    reply.code(403).send({ error: 'email_unverified' });
    return reply;
  });
}
