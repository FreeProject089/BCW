// Shared helpers: Prisma singleton, JWT sessions, role guards, slugify.
import jwt from 'jsonwebtoken';
import { ipOf } from './client-ip.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { pubkeyFromOpenssh } from './keyauth.mjs';
import { userBcId } from './repofingerprint.mjs';
import { boundedSet } from './boundedmap.mjs';
import { normaliseCreatorId } from './creator-proof.mjs';
import { ciEquals } from './ci-equals.mjs';
// NOTE: clientIp is deliberately NOT imported — this module already exports its own,
// and the two differ (`req.ip` here vs `req.ip || '0.0.0.0'` there). That split predates
// this feature; changing either return value would ripple through callers that test it
// for falsiness, so the local one is used below rather than quietly swapped.
import { geoOf, parseUA } from './geo.mjs';

// Constant-time string comparison for shared secrets / tokens / signatures — `a === b`
// returns as soon as two bytes differ, which is a timing side-channel. Length-safe:
// hashes both sides to a fixed width first so it never leaks length and never
// throws on a mismatch, then does the real timing-safe compare.
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// A whitelist/ban entry that identifies an account rather than an IP/key —
// shared by per-repo settings (repos.mjs, repo-dashboard.mjs) and the global
// policy (access-policy.mjs) so the shape can never drift between the two.
// One OpenSSH public-key line an owner pasted into an access list.
//
// Rejected HERE, at save time, rather than at request time. What counts as usable is asked of
// the VERIFIER (pubkeyFromOpenssh) rather than listed here, so the two cannot disagree: a key
// this accepts and that cannot verify would store a requirement nothing could satisfy — every
// client locked out, the owner included, and a gate that looks broken rather than
// mis-configured. The moment the person is still looking at the field is the only good moment
// to say no.
//
// ed25519, RSA and ECDSA all pass. ssh-dss does not: OpenSSH removed it.
export const pubkeyLineSchema = z.string().max(1000).refine((v) => pubkeyFromOpenssh(v) !== null, {
  message: 'unsupported_public_key',
});

// A zod failure that is ONLY about a pasted public key, turned into a name the UI can act on.
//
// `invalid_input` is the right answer for a malformed body, and a useless one for "the key you
// just typed is the wrong kind" — the person is looking at the field and can fix it if we say
// which field. Returns null when the failure was something else, so the blanket code still
// covers everything it should.
export function pubkeyErrorCode(zodError) {
  const issues = zodError?.issues || [];
  return issues.length && issues.every((i) => i.message === 'unsupported_public_key')
    ? 'unsupported_public_key' : null;
}

export const accountEntrySchema = z.object({
  type: z.enum(['bcweb', 'discord']),
  id: z.string().min(1).max(120),
  label: z.string().max(120).default(''),
});

import { JWT_SECRET } from './jwt-secret.mjs';
export { JWT_SECRET };

let _prisma = null;
export async function db() {
  if (!_prisma) {
    const { PrismaClient } = await import('@prisma/client');
    _prisma = new PrismaClient();
  }
  return _prisma;
}

// Optional parent-domain scope so the session cookie is shared with sub-domains
// (e.g. telemetry.<domain>, gated in telemetry.mjs). Unset = host-only (current
// behaviour), so this is a no-op until COOKIE_DOMAIN is configured in production.
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;
// `Secure` is derived from the SITE scheme, NOT NODE_ENV. Over plain HTTP dev
// (http://localhost) a Secure cookie is only sent to `localhost` itself — Firefox
// does NOT treat `telemetry.localhost` as a secure context, so a Secure cookie never
// reaches the telemetry sub-domain and its edge gate always denies. HTTP → not
// secure (reaches every *.localhost); HTTPS prod → secure.
const COOKIE_SECURE = /^https:/i.test(process.env.SITE_URL || process.env.SITE_DOMAIN || '');
const cookieBase = { httpOnly: true, sameSite: 'lax', path: '/', secure: COOKIE_SECURE, ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}) };

// Signing in creates a Session row and stamps its id into the token as `sid`. Auth stays
// stateless in the sense that the JWT still carries the identity; the row exists so the
// account owner can SEE their signed-in devices and drop one without a global rotation.
//
// `req` is optional so a caller that has no request context still gets a working session
// (it simply lands in the list with unknown origin). The origin details are best-effort — a
// GeoIP hiccup costs a country column — but the ROW is not optional: its id is the `sid` in the
// token, and a token without one can never be revoked. See tokenAcceptable.
export async function issueSession(reply, user, req) {
  let sid;
  try {
    const p = await db();
    // Recorded even with no request context — it lands in the list with unknown origin, which
    // is the documented behaviour and is also the only way it gets a `sid` at all. The origin
    // details are best-effort; the ROW is not.
    const ua = String(req?.headers?.['user-agent'] || '').slice(0, 400);
    const { device, browser, os } = req ? parseUA(ua) : {};
    const geo = req ? await geoOf(req).catch(() => null) : null;
    const row = await p.session.create({
      data: {
        userId: user.id,
        ip: req ? clientIp(req) : null,
        userAgent: ua || null,
        device: device || null, browser: browser || null, os: os || null,
        country: geo?.country || null,
        region: geo?.region || null,
        city: geo?.city || null,
      },
      select: { id: true },
    });
    sid = row.id;
  } catch (e) {
    // This used to degrade silently — "the panel degrades; the login does not fail" — and mint
    // a token with no `sid`. Such a token is unrevocable BY ANYTHING: not the sessions panel,
    // not closing the account, not a password change. It works until it expires, and the guards
    // now refuse it, so degrading here would hand somebody a cookie that fails on their next
    // request. Recording the session is part of signing in.
    //
    // The cost is honest: if the database cannot take a row, the site it fronts is not working
    // either, and a refused login is a better answer than a session nobody can end.
    throw Object.assign(new Error('session_not_recorded'), { statusCode: 503, cause: e });
  }
  const token = jwt.sign({ uid: user.id, role: user.role, sid }, JWT_SECRET, { expiresIn: '7d' });
  reply.setCookie('bcw_session', token, { ...cookieBase, maxAge: 7 * 24 * 3600 });
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

// How stale lastSeenAt may get before a request refreshes it. Every authenticated request
// already reads the row; without a floor it would also WRITE on every request.
const SESSION_TOUCH_MS = 5 * 60 * 1000;

/// Is the session behind this token dead? Called by every auth guard, so revoking a device
/// takes effect on its next request instead of whenever the 7-day token expires.
///
/// A token with no `sid` short-circuits here to false — but it is NOT accepted: it is
/// refused two lines later by `tokenAcceptable`, and this function simply has nothing to
/// look up. Do not read the `return false` as a grace period.
///
/// There WAS one. It was retired by 0feed3f, after a SUPERADMIN cookie carrying no `sid`
/// turned up in a browser: nothing could revoke it — not this panel, not closing the
/// account, not a password change — and it opened every route its baked-in role allowed.
/// The grace had expired by construction anyway (tokens live seven days; the panel is far
/// older), so what was left were tokens minted when the session row silently failed to
/// write. `issueSession` now fails the login instead.
export async function sessionRevoked(claims) {
  if (!claims?.sid) return false;
  try {
    const p = await db();
    const row = await p.session.findUnique({
      where: { id: claims.sid },
      select: { revokedAt: true, lastSeenAt: true, userId: true },
    });
    // A row that vanished (or belongs to someone else) is not a session we will honour.
    if (!row || row.userId !== claims.uid) return true;
    if (row.revokedAt) return true;
    if (Date.now() - new Date(row.lastSeenAt).getTime() > SESSION_TOUCH_MS) {
      p.session.update({ where: { id: claims.sid }, data: { lastSeenAt: new Date() } })
        .catch(() => { /* a missed touch only ages the "last active" label */ });
    }
    return false;
  } catch {
    // Database trouble must not lock everyone out of the site.
    return false;
  }
}

export function clearSession(reply) {
  reply.clearCookie('bcw_session', { path: '/', ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}) });
}

// ── Step-up elevation for server-control tools (see server-control.mjs) ──
// A SEPARATE, short-lived cookie from the normal session — obtained by re-entering
// a TOTP code at POST /server/elevate. Every dangerous route (perf-dashboard
// actions, Docker, terminal, power) requires this IN ADDITION to the normal
// session + the canControlServer flag, so a stolen session cookie alone is never
// enough to reach them.
const ELEVATE_TTL_S = 15 * 60;
export function issueElevatedToken(reply, userId) {
  const token = jwt.sign({ uid: userId, purpose: 'server-control' }, JWT_SECRET, { expiresIn: ELEVATE_TTL_S });
  reply.setCookie('bcw_elevated', token, { ...cookieBase, maxAge: ELEVATE_TTL_S });
  return ELEVATE_TTL_S;
}
/** The shared secret the Discord bot presents on /bot/* routes.
 *
 *  BOT_SHARED_SECRET first, LINK_LOOKUP_SECRET as the documented alternative; the literal
 *  fallback is why the boot guard refuses to start in production without one of them.
 */
export const BOT_SECRET = () => process.env.BOT_SHARED_SECRET || process.env.LINK_LOOKUP_SECRET || 'dev-bot-secret';

/** Authenticate a bot request. Returns false and answers 401 when it fails.
 *
 *  Lives here because it existed TWICE - routes/bot.mjs and routes/server-perf.mjs - and
 *  the two copies had drifted: one compared with safeEqual, the other with `!==`, a plain
 *  string comparison of a secret that the rest of this codebase is careful never to make.
 *  Two copies of a security check is one copy that will be wrong.
 */
export function botAuth(req, reply) {
  if (!safeEqual(req.headers['x-bot-secret'] || '', BOT_SECRET())) {
    reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

export function requireElevated() {
  return async (req, reply) => {
    try {
      const claims = jwt.verify(req.cookies?.bcw_elevated, JWT_SECRET);
      if (claims.purpose !== 'server-control' || claims.uid !== req.user?.uid) throw new Error('mismatch');
    } catch { return reply.code(401).send({ error: 'elevation_required' }); }
  };
}
// Re-checks the DB (the session JWT doesn't carry this flag, so it can't go stale
// inside a 7-day session the moment a SUPERADMIN revokes it).
export function requireCanControlServer() {
  return async (req, reply) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user?.uid }, select: { canControlServer: true } });
    if (!u?.canControlServer) return reply.code(403).send({ error: 'forbidden' });
  };
}

// Server-side secret the audit HMAC is keyed with. An attacker who can write to the
// DB but doesn't hold this secret cannot forge a valid chain (edits/inserts are
// detectable). Dedicated env, falls back to JWT_SECRET.
const AUDIT_SECRET = process.env.AUDIT_SECRET || JWT_SECRET;
export function auditHash(prevHash, e) {
  const payload = `${prevHash}|${e.id}|${e.actorId}|${e.action}|${e.detail}|${new Date(e.createdAt).toISOString()}`;
  return crypto.createHmac('sha256', AUDIT_SECRET).update(payload).digest('hex');
}
// Sensitive staff actions that should immediately surface to SUPERADMINs — the tripwire
// for a compromised staff account (someone pulling another user's files, writing to the
// DB, or hitting power/terminal). Matched by action prefix.
//
// `marketplace.seller_` is on the list for the same reason as the rest: it names the Stripe
// account a project's sales are paid into. The route is already SUPERADMIN-only, which
// stops an ADMIN doing it and does nothing about a SUPERADMIN session in the wrong hands —
// and redirecting revenue is the quietest thing such a session could do.
const SENSITIVE_ACTION = /^(server\.(file_download|file_delete|db_write|db_restore|restart|terminal|power|db_write_blocked|db_restore_blocked)|user\.2fa_reset|marketplace\.seller_)/;
let _auditSettingsCache = { v: null, at: 0 };

// ── Append-only external anchor (closes the end-truncation gap) ──
// The HMAC chain detects edits + mid-deletions, but deleting the NEWEST rows leaves no
// gap in-DB. So each SENSITIVE entry's {id,hash} is also appended to a file on a
// dedicated volume mounted OUTSIDE /app — out of reach of the DB viewer AND the
// /app-confined file manager. Verify cross-checks: an anchored entry missing/altered in
// the DB (and newer than the retention horizon, so not just pruned) = truncation/tamper.
const ANCHOR_DIR = process.env.AUDIT_ANCHOR_DIR || '/var/audit';
const ANCHOR_FILE = path.join(ANCHOR_DIR, 'sensitive-anchor.jsonl');
async function appendAnchor(rec) {
  try {
    await fs.mkdir(ANCHOR_DIR, { recursive: true });
    await fs.appendFile(ANCHOR_FILE, JSON.stringify(rec) + '\n');
    // Opportunistically cap the file so it can't grow forever (rare, best-effort).
    if (Math.random() < 0.02) {
      const lines = (await fs.readFile(ANCHOR_FILE, 'utf8')).split('\n').filter(Boolean);
      if (lines.length > 5000) await fs.writeFile(ANCHOR_FILE, lines.slice(-5000).join('\n') + '\n');
    }
  } catch { /* anchor is best-effort — never block the action */ }
}
/**
 * Append one anchor from outside this module.
 *
 * `appendAnchor` is deliberately private and best-effort: it runs beside an action that must
 * not fail because a volume is full. An admin ANCHORING ON PURPOSE is the opposite case — a
 * silent failure there would tell them they are protected when they are not — so this one
 * reports whether it wrote.
 */
export async function anchorEntry(rec) {
  try {
    await fs.mkdir(ANCHOR_DIR, { recursive: true });
    await fs.appendFile(ANCHOR_FILE, JSON.stringify(rec) + '\n');
    return true;
  } catch { return false; }
}

/** Read the external sensitive-action anchors (most recent `limit`). */
export async function readAnchors(limit = 2000) {
  try {
    const lines = (await fs.readFile(ANCHOR_FILE, 'utf8')).split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** Append an admin/staff audit-log entry, HMAC-chained for tamper-evidence. Never
 * throws — logging must not break the action it's recording. Also (best-effort) alerts
 * SUPERADMINs on sensitive actions and prunes the log to the configured retention. */
export async function logAudit(p, actorId, action, detail = '', ip = '') {
  const d = String(detail || '').slice(0, 300); const ipS = String(ip || '').slice(0, 64);
  let created = null;
  try {
    // Serialize audit writes with a Postgres advisory lock so the chain's prevHash is
    // consistent under concurrency, inside one interactive transaction.
    created = await p.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(918273645)`;
      const last = await tx.auditLogEntry.findFirst({ orderBy: { createdAt: 'desc' }, select: { hash: true } });
      const prevHash = last?.hash || 'GENESIS';
      const id = 'a' + crypto.randomUUID().replace(/-/g, '');
      const createdAt = new Date();
      const hash = auditHash(prevHash, { id, actorId, action, detail: d, createdAt });
      await tx.auditLogEntry.create({ data: { id, actorId, action, detail: d, ip: ipS, createdAt, prevHash, hash } });
      return { id, hash, createdAt };
    });
  } catch { /* non-fatal */ }
  // Sensitive actions: external anchor + SUPERADMIN alert. Best-effort, off critical path.
  try {
    if (created && SENSITIVE_ACTION.test(action)) {
      await appendAnchor({ at: created.createdAt.toISOString(), id: created.id, hash: created.hash, action });
      const supers = await p.user.findMany({ where: { role: 'SUPERADMIN' }, select: { id: true } });
      const who = await p.user.findUnique({ where: { id: actorId }, select: { displayName: true } }).catch(() => null);
      await Promise.all(supers.map((s) => notify(p, s.id, 'security_alert', `Sensitive staff action: ${who?.displayName || actorId} — ${action}${d ? ` (${d.slice(0, 120)})` : ''}`)));
    }
  } catch { /* non-fatal */ }
  if (Math.random() < 0.05) pruneAuditLog(p).catch(() => {});
}

/** Prune the audit log to the admin-configured retention (audit.maxDays age +
 * audit.maxEntries count). Authorized, app-controlled deletion — the chain verifier
 * treats the oldest RETAINED entry as a fresh chain start, so pruning never trips it. */
export async function pruneAuditLog(p) {
  if (Date.now() - _auditSettingsCache.at > 60_000) {
    _auditSettingsCache = { v: Object.fromEntries((await p.adminSetting.findMany()).map((r) => [r.key, r.value])), at: Date.now() };
  }
  const s = _auditSettingsCache.v || {};
  const maxDays = Number(s['audit.maxDays'] ?? 0);
  const maxEntries = Number(s['audit.maxEntries'] ?? 0);
  if (maxDays > 0) await p.auditLogEntry.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - maxDays * 864e5) } } });
  if (maxEntries > 0) {
    const cutoff = await p.auditLogEntry.findMany({ orderBy: { createdAt: 'desc' }, skip: maxEntries, take: 1, select: { createdAt: true } });
    if (cutoff.length) await p.auditLogEntry.deleteMany({ where: { createdAt: { lte: cutoff[0].createdAt } } });
  }
}

/** Auth guard. requireRole() = any logged-in user; requireRole('ADMIN','MOD') = those roles.
 * SUPERADMIN implicitly satisfies every check regardless of the list passed — it sits
 * above ADMIN in the hierarchy, and retrofitting every one of the ~80 requireRole(...)
 * call sites across the API to explicitly list it would be invasive and easy to miss. */
// Roles that reach the admin dashboard (moderation queue and up) — any route
// gated on one of these ALSO requires 2FA to be enabled on the account, even
// for SUPERADMIN. A password alone isn't enough for a surface this privileged.
const ADMIN_TIER_ROLES = ['MOD', 'ADMIN', 'SUPERADMIN'];

// Account moderation gate. JWT sessions are stateless, so to lock out a suspended/
// banned user's LIVE session we look up their status — cached briefly so this doesn't
// add a DB hit to every guarded request (a ban then takes effect within MOD_TTL).
// Returns the active lock ({ status, until, reason }) or null (active / expired lock).
const MOD_TTL = 15_000;
// Both per-uid caches below are keyed by user id, so without a cap they'd keep one entry per
// user who ever hit the API, for the process's life (the TTL only makes an entry stale, it
// never frees it). 5k live users' worth of role/lock state is plenty to cache hot; the rest
// evict and simply re-read from the DB. See boundedmap.mjs.
const UID_CACHE_MAX = 5000;
const _modCache = new Map(); // uid -> { at, state }
export function clearAccountLockCache(uid) { if (uid) _modCache.delete(uid); else _modCache.clear(); }

// Fine-grained admin capabilities that can be granted to a user on top of their role —
// individually (User.permissions) or bundled into a CustomRole. Each maps to an admin
// surface enforced by requireCap(...) on the server AND gates the matching admin tab
// client-side (ADMIN_CAPS in admin.jsx must mirror this list). Extend as more areas are
// capability-gated; a slug listed here MUST be enforced end-to-end, never client-only.
// Each of these opens ONE part of the dashboard and the endpoints behind it. They exist so
// that trusting somebody with the Discord bot does not also hand them the server terminal,
// the audit log and everybody's account.
//
// ADMIN and SUPERADMIN hold every capability implicitly (see hasCap), so adding one never
// takes anything away from an admin — it only makes a section grantable to somebody who
// is not one. That is the safe direction, and the reason a route can move from
// requireRole('ADMIN') to requireCap() without auditing who holds what.
//
// NOT everything is here, deliberately. The server terminal, power and database controls
// have no capability and cannot be granted; neither can handing out permissions, which
// would be a capability that grants every other one. Those stay requireRole.
//
// scripts/check-capabilities.mjs fails the build if this list and the role editor's
// catalogue disagree, or if a capability is declared and no route enforces it.
export const CAPABILITIES = [
  'manage_users', 'manage_repos', 'manage_analytics', 'manage_newsletter', 'manage_faq', 'manage_catalogs', 'manage_reports',
  // Content elements
  'manage_projects', 'manage_showcase', 'manage_announcements', 'manage_docs',
  // The studio on EVERY page (projects, other projects, the home page) and on a page whose
  // studio is switched off (decision D2: only this capability prepares one). Not implied by
  // manage_projects / manage_showcase: editing a page's words is not drawing it
  // (PLAN-STUDIO-2026 3.1). ADMIN and SUPERADMIN hold it through hasCap (D8).
  'manage_studio',
  // Growth elements
  'manage_events', 'manage_promotions',
  // Services
  'manage_myo', 'manage_api', 'manage_polls',
  // Sections that used to be "are you an admin" and are now their own job.
  'manage_bot', 'manage_hosting', 'manage_donations', 'manage_assets',
  'manage_history', 'manage_sanctions', 'manage_legal', 'manage_expenses',
  // Its own capability and not part of manage_bot, even though its routes live in
  // bot.mjs. Granting somebody the Discord dashboard must not hand them the ability to
  // mint the currency its shop spends.
  'manage_economy',
  // The staff task board (routes/tasks.mjs, rules in lib/tasks.mjs). Three, because "who may
  // read the board", "who may hand work out" and "who may shape the teams" are three different
  // people on a real staff. Each is ordered so that nothing it lets you hand out is more than
  // what it already gives you — see the non-escalation note at the top of lib/tasks.mjs.
  'view_tasks', 'manage_tasks', 'manage_teams',
  // Translators — scoped to what they may translate, not to admin power. `translate_site`
  // opens the runtime-locale editor (site strings); the other two scope blog/docs translation.
  'translate_site', 'translate_blog', 'translate_docs',
];
// Default capabilities a MOD holds without explicit grants.
const MOD_DEFAULT_CAPS = ['manage_users'];

// Live role + permissions, short-TTL cached so an admin's role/permission change takes
// effect WITHOUT the target having to log out and back in (the JWT still carries the OLD
// role; we look up the current one here). Cache is cleared on any role/permission change.
const _userCache = new Map(); // uid -> { at, role, perms }
// Clear one user (or, with no arg, everyone). Pass no arg after ANY CustomRole edit/delete,
// since a single role change affects every member's effective perms.
export function clearUserCache(uid) { if (uid) _userCache.delete(uid); else _userCache.clear(); }
export async function currentUser(uid) {
  if (!uid) return { role: null, perms: [], exists: false };
  const hit = _userCache.get(uid);
  if (hit && Date.now() - hit.at < MOD_TTL) return hit;
  let role = null, perms = [], exists = null;   // exists: null = could not ask, false = no such account
  try {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: uid }, select: { role: true, permissions: true, customRoleIds: true } });
    exists = !!u;
    if (u) {
      role = u.role;
      perms = u.permissions || [];
      // Expand any assigned CustomRole into its capabilities and UNION them in — additive
      // only, so a role can never strip what the tier/individual grants already give.
      // A SCOPED role (limited to elements) adds nothing here: its rights are per element
      // and live in projectGrants() below.
      if (u.customRoleIds?.length) {
        const roles = await p.customRole.findMany({ where: { id: { in: u.customRoleIds } }, select: { capabilities: true, scope: true } });
        const wide = roles.filter((r) => !isScopedRole(r));
        if (wide.length) perms = [...new Set([...perms, ...wide.flatMap((r) => r.capabilities || [])])];
      }
    }
  } catch { /* keep nulls */ }
  const rec = { at: Date.now(), role, perms, exists };
  boundedSet(_userCache, uid, rec, UID_CACHE_MAX, MOD_TTL);
  return rec;
}
/** A role limited to elements (projects / showcase pages) rather than site-wide. */
export function isScopedRole(r) {
  const s = r?.scope;
  return !!(s && typeof s === 'object' && ((s.projectKeys || []).length || (s.showcaseIds || []).length || s.allShowcase));
}
/** The rights a scoped role carries on its elements. Absent = `pages`, what a scope always meant.
 *
 *  The filter is an ALLOWLIST and that is the point: an unknown string in a stored scope
 *  grants nothing rather than something nobody named. It is also why adding a right is a
 *  change in three places — here, the grants function that reads it, and the editor that
 *  offers it — and why 'market' did not exist until it was added to all three.
 */
// 'inbox': read and answer the contact inbox of these projects (lib/project-contact.mjs).
// Its own right, not implied by 'pages': the person who edits a page's wording is not
// automatically the person who should read what visitors write to the project.
// 'studio': draw the studio pages of these projects (PLAN-STUDIO-2026 3.1). Its own right, not
// implied by 'pages': the page's words and its hand-drawn layout are granted apart.
const SCOPE_RIGHTS = ['pages', 'blog', 'market', 'inbox', 'studio'];
export function scopeRights(r) {
  const rights = Array.isArray(r?.scope?.rights) ? r.scope.rights.filter((x) => SCOPE_RIGHTS.includes(x)) : [];
  return rights.length ? rights : ['pages'];
}
export { SCOPE_RIGHTS };
// The blog side of scoped roles: which blogs a user may post in because a role says so —
// the same shape projectGrants() has for pages, kept apart because the two rights are
// granted separately ("writes the BSM blog" is not "edits the BSM page").
export async function blogRoleGrants(uid) {
  const out = { allShowcase: false, showcaseIds: new Set(), projectKeys: new Set() };
  if (!uid) return out;
  try {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: uid }, select: { customRoleIds: true } });
    if (!u?.customRoleIds?.length) return out;
    const roles = await p.customRole.findMany({ where: { id: { in: u.customRoleIds } }, select: { scope: true } });
    for (const r of roles) {
      if (!isScopedRole(r) || !scopeRights(r).includes('blog')) continue;
      if (r.scope.allShowcase) out.allShowcase = true;
      for (const id of r.scope.showcaseIds || []) out.showcaseIds.add(id);
      for (const k of r.scope.projectKeys || []) out.projectKeys.add(k);
    }
  } catch { /* no grants on error */ }
  return out;
}
// The marketplace side of scoped roles: whose SHOP a user may administer because a role
// says so. Same shape as blogRoleGrants and kept apart for the same reason — "runs the BSM
// shop" is not "edits the BSM page", and somebody trusted with one is not automatically
// trusted with the other. This one moves money, so it is the least automatic of the three.
export async function marketRoleGrants(uid) {
  const out = { allShowcase: false, showcaseIds: new Set(), projectKeys: new Set() };
  if (!uid) return out;
  try {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: uid }, select: { customRoleIds: true } });
    if (!u?.customRoleIds?.length) return out;
    const roles = await p.customRole.findMany({ where: { id: { in: u.customRoleIds } }, select: { scope: true } });
    for (const r of roles) {
      if (!isScopedRole(r) || !scopeRights(r).includes('market')) continue;
      if (r.scope.allShowcase) out.allShowcase = true;
      for (const id of r.scope.showcaseIds || []) out.showcaseIds.add(id);
      for (const k of r.scope.projectKeys || []) out.projectKeys.add(k);
    }
  } catch { /* no grants on error */ }
  return out;
}
// The contact-inbox side of scoped roles: whose project INBOX a user may read because a role
// says so. Same shape as the two above, kept apart for the same reason.
export async function inboxRoleGrants(uid) {
  const out = { allShowcase: false, showcaseIds: new Set(), projectKeys: new Set() };
  if (!uid) return out;
  try {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: uid }, select: { customRoleIds: true } });
    if (!u?.customRoleIds?.length) return out;
    const roles = await p.customRole.findMany({ where: { id: { in: u.customRoleIds } }, select: { scope: true } });
    for (const r of roles) {
      if (!isScopedRole(r) || !scopeRights(r).includes('inbox')) continue;
      if (r.scope.allShowcase) out.allShowcase = true;
      for (const id of r.scope.showcaseIds || []) out.showcaseIds.add(id);
      for (const k of r.scope.projectKeys || []) out.projectKeys.add(k);
    }
  } catch { /* no grants on error */ }
  return out;
}
// Does `req.user` (with a live role + perms) hold a capability? ADMIN/SUPERADMIN → all;
// MOD → its defaults + explicit grants; anyone else → only explicit grants.
/**
 * A link somebody will click. Use this instead of `z.string().url()` for anything stored and
 * later rendered as an href.
 *
 * `z.string().url()` asks `new URL()` whether the string parses, and `javascript:alert(1)`
 * parses — so do `data:` and `vbscript:`. React 18 puts a javascript: href straight into the
 * DOM with a console warning and nothing more, and this site's CSP carries 'unsafe-inline'
 * in script-src, so the browser does not stop it either. A marketplace seller scoped to one
 * project could put one on a product and reach every visitor to that project's page.
 *
 * Two schemes, checked with the parser rather than a prefix match: `\tjavascript:` and
 * `java\nscript:` both survive a startsWith and both run.
 *
 * Takes the length rather than being chained with `.max()`: `.refine()` returns a
 * ZodEffects, which has no `.max`, so `httpUrl().max(600)` throws at import — at IMPORT,
 * which is the good direction, but only because every route file is loaded at boot.
 */
export const httpUrl = (max = 2048) => z.string().max(max).refine((v) => {
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}, { message: 'must be an http(s) URL' });

// Does `req.user` (with a live role + perms) hold a capability? ADMIN/SUPERADMIN → all;
export function hasCap(user, cap) {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'SUPERADMIN') return true;
  if (user.role === 'MOD' && MOD_DEFAULT_CAPS.includes(cap)) return true;
  return (user.perms || []).includes(cap);
}

// ── Project editing ─────────────────────────────────────────────────────────────
// "Manage" = full control over EVERY project of that kind, including the reserved
// controls (pinTopbar, visibility, announcement, publish/order). Admin-tier roles pass
// via hasCap; a capability bundle can grant it to a non-admin (a "project moderator").
export function canManageShowcase(user) { return hasCap(user, 'manage_showcase'); }
export function canManageProjects(user) { return hasCap(user, 'manage_projects'); }

// ── The staff task board ─────────────────────────────────────────────────────────
// The three capability questions, written once. lib/tasks.mjs combines them with team
// standing; nothing else asks hasCap about a task.
//   dispatch  manage_tasks: every task, every team — assign, edit, cancel, move, accept a
//             proposal. It is also what "run a team" is made of, which is why naming a chief
//             needs it.
//   read      view_tasks: every task, read and comment, nothing else. manage_tasks implies it.
//   shape     manage_teams: create, rename, archive, dissolve teams. Taking standing AWAY
//             needs only this; HANDING it out (a chief, a member) also needs dispatch — you
//             cannot give somebody a power you do not hold.
export function canDispatchTasks(user) { return hasCap(user, 'manage_tasks'); }
export function canReadAllTasks(user) { return hasCap(user, 'manage_tasks') || hasCap(user, 'view_tasks'); }
export function canShapeTeams(user) { return hasCap(user, 'manage_teams'); }

// A user's per-project EDIT grants (ProjectPermission rows), collapsed into a quick-check
// shape. Content-only: reserved controls are still gated behind canManage*(). Not cached —
// project edits are rare and always want the live grant set.
export async function projectGrants(uid) {
  const out = { allShowcase: false, showcaseIds: new Set(), projectKeys: new Set() };
  if (!uid) return out;
  try {
    const p = await db();
    const gs = await p.projectPermission.findMany({ where: { userId: uid }, select: { showcaseProjectId: true, projectKey: true, allShowcase: true, rights: true } });
    for (const g of gs) {
      // A direct grant carries its rights (ProjectPermission.rights, default ['pages']): a
      // studio-only grant draws the page and does not edit its words.
      if (!grantRights(g).includes('pages')) continue;
      if (g.allShowcase) out.allShowcase = true;
      if (g.showcaseProjectId) out.showcaseIds.add(g.showcaseProjectId);
      if (g.projectKey) out.projectKeys.add(g.projectKey);
    }
    // Scoped custom roles: a named, reusable version of the same grants.
    const u = await p.user.findUnique({ where: { id: uid }, select: { customRoleIds: true } });
    if (u?.customRoleIds?.length) {
      const roles = await p.customRole.findMany({ where: { id: { in: u.customRoleIds } }, select: { scope: true } });
      for (const r of roles) {
        // Only the roles whose rights include the PAGE. A blog-only scope grants nothing here.
        if (!isScopedRole(r) || !scopeRights(r).includes('pages')) continue;
        if (r.scope.allShowcase) out.allShowcase = true;
        for (const id of r.scope.showcaseIds || []) out.showcaseIds.add(id);
        for (const k of r.scope.projectKeys || []) out.projectKeys.add(k);
      }
    }
  } catch { /* no grants on error */ }
  return out;
}
/** What a DIRECT grant may carry. A scoped role carries more (blog, market, inbox), which have
 *  their own direct grants elsewhere (BlogPermission) or none. */
export const GRANT_RIGHTS = ['pages', 'studio'];
/** The rights a direct ProjectPermission row carries. Same allowlist idea as a scoped role's:
 *  an unknown string grants nothing, and an empty or missing list means `pages`, the only
 *  thing a grant meant before the column existed. */
export function grantRights(g) {
  const rights = Array.isArray(g?.rights) ? g.rights.filter((x) => GRANT_RIGHTS.includes(x)) : [];
  return rights.length ? rights : ['pages'];
}

// ── The studio right (PLAN-STUDIO-2026 3.1) ─────────────────────────────────────────
// Who may DRAW a page, as opposed to edit its words. Same shape as projectGrants, from the
// same two sources: direct grants whose rights include 'studio', and scoped roles with the
// 'studio' right. Never implied by 'pages', by manage_projects or by manage_showcase.
export async function studioGrants(uid) {
  const out = { allShowcase: false, showcaseIds: new Set(), projectKeys: new Set() };
  if (!uid) return out;
  try {
    const p = await db();
    const gs = await p.projectPermission.findMany({ where: { userId: uid }, select: { showcaseProjectId: true, projectKey: true, allShowcase: true, rights: true } });
    for (const g of gs) {
      if (!grantRights(g).includes('studio')) continue;
      if (g.allShowcase) out.allShowcase = true;
      if (g.showcaseProjectId) out.showcaseIds.add(g.showcaseProjectId);
      if (g.projectKey) out.projectKeys.add(g.projectKey);
    }
    const u = await p.user.findUnique({ where: { id: uid }, select: { customRoleIds: true } });
    if (u?.customRoleIds?.length) {
      const roles = await p.customRole.findMany({ where: { id: { in: u.customRoleIds } }, select: { scope: true } });
      for (const r of roles) {
        if (!isScopedRole(r) || !scopeRights(r).includes('studio')) continue;
        if (r.scope.allShowcase) out.allShowcase = true;
        for (const id of r.scope.showcaseIds || []) out.showcaseIds.add(id);
        for (const k of r.scope.projectKeys || []) out.projectKeys.add(k);
      }
    }
  } catch { /* no grants on error */ }
  return out;
}
/** Does this user hold the studio right on this target, whatever its switch says? This is
 *  what "may they GRANT it" asks (routes/roles.mjs); opening asks canUseStudio below. */
export async function holdsStudioRight(user, kind, id) {
  if (!user) return false;
  if (hasCap(user, 'manage_studio')) return true;
  if (kind !== 'project' && kind !== 'showcase') return false;
  const g = await studioGrants(user.uid);
  return kind === 'project' ? g.projectKeys.has(id) : (g.allShowcase || g.showcaseIds.has(id));
}
/**
 * May this user OPEN and SAVE the studio of this target? The one question every studio door
 * asks (the studio routes, the config PUTs through guardStudioContent, the public GET's
 * drafts). `kind` is 'project' (id = key), 'showcase' (id = row id) or 'home'.
 *
 *   · manage_studio (ADMIN / SUPERADMIN implicitly, D8): everything, the home page included,
 *     and a page whose studio is switched off (D2: only this capability prepares one);
 *   · otherwise the `studio` right on THIS target, and only while its switch is on. The
 *     config is required for that: without it the answer is no, the safe direction;
 *   · a suspended account draws nothing, whatever it holds: a studio page is public content.
 */
export async function canUseStudio(user, kind, id, config) {
  return (await studioChecker(user))(kind, id, config);
}
/**
 * canUseStudio for MANY targets at once: the lookups once, then a synchronous predicate
 * `(kind, id, config) => boolean`. The public list (GET /projects) asks it for every project;
 * one query per project would be the price of a rule, and a rule that costs too much gets
 * written a second, cheaper time — which is how two copies of it start to disagree.
 *
 * The role and capabilities are read LIVE (currentUser), because optionalAuth hands over the
 * token's claims, which carry no capabilities and may carry a stale role.
 */
export async function studioChecker(user) {
  const no = () => false;
  if (!user?.uid) return no;
  if (await accountLock(user.uid, 'service')) return no;
  const cur = await currentUser(user.uid);
  if (cur.exists === false) return no;
  const live = { uid: user.uid, role: cur.role || user.role, perms: cur.perms || user.perms || [] };
  if (hasCap(live, 'manage_studio')) return () => true;
  const g = await studioGrants(user.uid);
  return (kind, id, config) => {
    if (kind !== 'project' && kind !== 'showcase') return false;
    if (!config || typeof config !== 'object' || config.studioEnabled !== true) return false;
    return kind === 'project' ? g.projectKeys.has(id) : (g.allShowcase || g.showcaseIds.has(id));
  };
}
/** The error a studio door answers with when canUseStudio said no: `studio_off` for somebody
 *  who holds the right on this page while its switch is off (D2), so the screen can say why;
 *  `forbidden` for everybody else, the same word whether or not the page exists for them. */
export async function studioRefusal(user, kind, id) {
  if (user?.uid && !(await accountLock(user.uid, 'service')) && (await holdsStudioRight(user, kind, id))) return 'studio_off';
  return 'forbidden';
}
/**
 * Who may READ a config's studio drafts on a public GET: exactly who could open them in the
 * studio (studioChecker), and only with 2FA on, like every door of the studio. Everybody else
 * gets withoutStudioDrafts. `req.user` is optionalAuth's (null when signed out).
 */
export async function draftReader(req) {
  const no = () => false;
  if (!req?.user?.uid) return no;
  const check = await studioChecker(req.user);
  const p = await db();
  const u = await p.user.findUnique({ where: { id: req.user.uid }, select: { totpEnabled: true } }).catch(() => null);
  return u?.totpEnabled ? check : no;
}

// May this user edit this ONE other-project's content? True for managers (all projects)
// or a matching per-project / allShowcase grant. `user` is req.user ({ uid, role, perms }).
export async function canEditShowcase(user, showcaseId) {
  if (canManageShowcase(user)) return true;
  const g = await projectGrants(user?.uid);
  return g.allShowcase || g.showcaseIds.has(showcaseId);
}
export async function canEditProject(user, projectKey) {
  if (canManageProjects(user)) return true;
  const g = await projectGrants(user?.uid);
  return g.projectKeys.has(projectKey);
}
/** Is this account locked, and for what?
 *
 *  Two different questions hid behind one answer, and conflating them made a suspension
 *  identical to a ban:
 *
 *  · `service`  — may this account's SERVICES run? No for both suspended and banned. This
 *                 is API keys, OIDC grants, hosted content.
 *  · `signin`   — may the person reach the website at all? No only for a ban. A suspension
 *                 has to leave the door open: somebody who cannot sign in cannot read why
 *                 they were suspended, cannot appeal it, and cannot download their invoices.
 */
export async function accountLock(uid, scope = 'service') {
  if (!uid) return null;
  // Filtered on the way out, not on the way in: the cache holds the ACCOUNT's state and one
  // entry has to answer both questions, or a suspended user would populate it under one
  // scope and get the wrong answer under the other.
  const forScope = (st) => (!st ? null : (scope === 'signin' && st.status !== 'banned') ? null : st);
  const hit = _modCache.get(uid);
  if (hit && Date.now() - hit.at < MOD_TTL) return forScope(hit.state);
  let state = null;
  try {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: uid }, select: { status: true, moderationUntil: true, moderationReason: true } });
    if (u && u.status && u.status !== 'active') {
      const until = u.moderationUntil ? new Date(u.moderationUntil) : null;
      if (!until || until.getTime() > Date.now()) state = { status: u.status, until, reason: u.moderationReason || null };
    }
  } catch { state = null; }
  boundedSet(_modCache, uid, { at: Date.now(), state }, UID_CACHE_MAX, MOD_TTL);
  return forScope(state);
}
// 403 body a locked account gets — the client turns this into the "you're suspended/
// banned" screen (reason + countdown, or a support link when permanent).
const lockBody = (lock) => ({ error: `account_${lock.status}`, status: lock.status, reason: lock.reason || null, until: lock.until ? lock.until.toISOString() : null, permanent: !lock.until });

// Require 2FA once we know the caller is on the admin surface (admin-tier role OR any
// granted capability) — a helper shared by requireRole/requireCap.
/** Exported because a staff POWER is not always reached through a route named `/admin/*`.
 *  A contact thread is the case that found it: an ADMIN sees every conversation on the site
 *  through `GET /me/threads/:id`, which is `requireRole()` with no roles and therefore no
 *  2FA wall, while `GET /admin/threads/:id` refuses the same account without TOTP. Two doors
 *  to one room, one of them unlocked. The gate belongs wherever the power is, so the door
 *  that grants it calls this. */
export async function ensure2fa(uid, reply) {
  const p = await db();
  const u = await p.user.findUnique({ where: { id: uid }, select: { totpEnabled: true } });
  if (!u?.totpEnabled) { reply.code(403).send({ error: '2fa_required' }); return false; }
  return true;
}
/**
 * Is this token still worth honouring, beyond "it verifies"?
 *
 * Two things a signature cannot tell you, both found by looking at a real cookie:
 *
 * • **No `sid`.** The session id is what "sign out this device" revokes against, so a token
 *   without one cannot be revoked by anything — not by the sessions panel, not by closing the
 *   account, not by a password change. It simply works until it expires. Tokens predating the
 *   feature were let through on purpose ("forcing everyone to sign in again is a bigger side
 *   effect than the panel is worth") and that grace expired by construction: tokens last seven
 *   days and the feature is far older than that. What is left is tokens minted when the
 *   session row could not be written — see issueSession, which no longer allows that.
 *
 * • **No account.** `currentUser` returns nulls for a uid with no row, and the guards read
 *   `cur.role || claims.role` — so a deleted account kept working with the role baked into its
 *   token at sign-in. A deleted admin was a permanent admin.
 *
 * `exists: null` means the lookup itself failed. Treated as acceptable: a database blip must
 * not sign the whole site out, and `sessionRevoked` already makes that same call.
 */
export function tokenAcceptable(claims, cur) {
    if (!claims?.uid) return { ok: false, error: 'unauthenticated' };
    if (!claims.sid) return { ok: false, error: 'session_revoked' };
    if (cur?.exists === false) return { ok: false, error: 'session_revoked' };
    return { ok: true };
}

/**
 * Everything the four guards did identically: verify, check the account lock, check the
 * session, read the live role. It was five lines copied four times, and the copies had already
 * drifted — requireEditor never applied the role fallback the others did.
 *
 * Returns `{ user }` or `{ reply }` — the caller sends the latter and stops.
 */
async function authenticated(req, reply) {
    const claims = jwt.verify(req.cookies?.bcw_session, JWT_SECRET);   // throws → caller answers 401
    const lock = await accountLock(claims.uid, 'signin');
    if (lock) return { reply: reply.code(403).send(lockBody(lock)) };
    if (await sessionRevoked(claims)) return { reply: reply.code(401).send({ error: 'session_revoked' }) };
    const cur = await currentUser(claims.uid);
    const verdict = tokenAcceptable(claims, cur);
    if (!verdict.ok) return { reply: reply.code(401).send({ error: verdict.error }) };
    return { user: { ...claims, role: cur.role || claims.role, perms: cur.perms } };
}

/**
 * The signed-in account behind this request, asked exactly the way the guards ask it, or
 * null. For the doors that are not guards: a route that reads the session cookie for itself
 * (a login-optional page, a forward-auth gate, soft auth) calls this and nothing else.
 *
 * Two of them used to call `jwt.verify` alone (full audit, Sept 24 2026). Every JWT this API
 * signs verifies with the same secret, so "it verifies" is not "it is a session": the
 * `2fa-pending` half-token that /auth/login hands out after the PASSWORD opened the repo
 * dashboard and the telemetry gate, and so did a revoked device, a banned account and a role
 * the account no longer holds. One function, so there is one answer to "who is this".
 * test/session-side-doors.test.mjs.
 */
export async function sessionUser(req) {
  let claims;
  try { claims = jwt.verify(req.cookies?.bcw_session, JWT_SECRET); } catch { return null; }
  if (!claims?.uid) return null;
  if (await accountLock(claims.uid, 'signin')) return null;
  if (await sessionRevoked(claims)) return null;
  const cur = await currentUser(claims.uid);
  if (!tokenAcceptable(claims, cur).ok) return null;
  return { ...claims, role: cur.role || claims.role, perms: cur.perms || [] };
}

/**
 * A SUSPENDED account keeps sign-in (accountLock 'signin' lets it through, on purpose: the
 * person has to be able to read why, appeal, and fetch their invoices) — and nothing else. Its
 * staff powers are services too. `authenticated()` asks only the sign-in question, so until
 * this check a suspended moderator went on suspending other people, and a suspended admin kept
 * the whole dashboard: 1018 staff doors answered a suspended account (pentest round 2, R3,
 * test/capability-route-matrix.test.mjs). Asked AFTER the role/capability check, so somebody
 * who holds nothing still hears `forbidden` / `missing_permission`, as before.
 *
 * Staff doors only (requireCap, requireRole with a role list). requireRole() with no roles is
 * the account's own pages — the ones a suspension exists to leave open.
 */
async function staffLocked(uid, reply) {
  const lock = await accountLock(uid, 'service');
  if (!lock) return false;
  reply.code(403).send(lockBody(lock));
  return true;
}

export function requireRole(...roles) {
  return async (req, reply) => {
    try {
      // The LIVE role (not the possibly-stale JWT), so a role change takes effect without the
      // target having to sign out and in again.
      const got = await authenticated(req, reply);
      if (got.reply) return got.reply;
      const { user } = got;
      const role = user.role;
      if (roles.length && role !== 'SUPERADMIN' && !roles.includes(role)) return reply.code(403).send({ error: 'forbidden' });
      if (roles.length && (await staffLocked(user.uid, reply))) return;
      if (roles.length && ADMIN_TIER_ROLES.includes(role)) { if (!(await ensure2fa(user.uid, reply))) return; }
      req.user = user; // { uid, role (live), perms }
    } catch { return reply.code(401).send({ error: 'unauthenticated' }); }
  };
}
/**
 * Require a CONFIRMED email address, on top of being signed in.
 *
 * The confirmation mail has always been sent and the /verify-email flow has always worked;
 * almost nothing ever checked the result. So an address nobody could receive mail at could
 * publish content, open a paid commission and post in other people's threads — and the one
 * thing a confirmed address is for is being reachable afterwards, which is exactly what those
 * actions need.
 *
 * Two rules keep this from becoming a lockout:
 *
 *   · If email is switched OFF for this deployment, verification is IMPOSSIBLE — nobody can
 *     ever receive the link. Gating on it there would brick the site for everybody, so the
 *     guard stands aside. A deployment that wants the gate turns email on; that is the same
 *     switch, and it cannot be half-set.
 *   · Staff are exempt. An admin locked out of the admin surface by an unverified address has
 *     no way to fix it from inside, and the seeded owner account is verified by the seed
 *     precisely so this is never reachable — but relying on a seed for a lockout is not a
 *     plan.
 *
 * The refusal names itself (`email_unverified`) so the client can offer "resend the link"
 * rather than a generic failure, which is the only useful thing to show someone here.
 */
export function requireVerifiedEmail() {
  return async (req, reply) => {
    try {
      const got = await authenticated(req, reply);
      if (got.reply) return got.reply;
      const { user } = got;
      req.user = user;
      // Nobody can verify when no mail can be sent. See above.
      const { emailEnabled } = await import('./mail.mjs');
      if (!emailEnabled()) return;
      if (ADMIN_TIER_ROLES.includes(user.role)) return;
      const p = await db();
      const u = await p.user.findUnique({ where: { id: user.uid }, select: { emailVerified: true } });
      if (!u?.emailVerified) {
        return reply.code(403).send({ error: 'email_unverified' });
      }
    } catch { return reply.code(401).send({ error: 'unauthenticated' }); }
  };
}

// Require a specific capability. Allowed if the (live) role is ADMIN/SUPERADMIN, or one of
// `alsoRoles` (e.g. 'MOD' for moderation routes), or the user has `cap` granted. A denial
// returns { error:'missing_permission', capability } so the client can say exactly what's
// missing. 2FA is enforced for any admin-surface access.
export function requireCap(cap, ...alsoRoles) {
  return async (req, reply) => {
    try {
      const got = await authenticated(req, reply);
      if (got.reply) return got.reply;
      const { user } = got;
      const allowed = hasCap(user, cap) || alsoRoles.includes(user.role);
      if (!allowed) return reply.code(403).send({ error: 'missing_permission', capability: cap });
      if (await staffLocked(user.uid, reply)) return;
      if (!(await ensure2fa(user.uid, reply))) return;
      req.user = user;
    } catch { return reply.code(401).send({ error: 'unauthenticated' }); }
  };
}

// Any logged-in user, but — like every admin-dashboard surface — 2FA-gated. Used by the
// project-EDIT routes a non-admin grantee (ProjectPermission) may reach: they pass through
// the same 2FA wall as staff, then the route itself checks canEdit*/strips reserved fields.
// Sets req.user = { uid, role (live), perms }.
export function requireEditor() {
  return async (req, reply) => {
    try {
      const got = await authenticated(req, reply);
      if (got.reply) return got.reply;
      if (!(await ensure2fa(got.user.uid, reply))) return;
      req.user = got.user;
    } catch { return reply.code(401).send({ error: 'unauthenticated' }); }
  };
}

/** Every scope the public API knows, and what each one lets a key see or do.
 *
 * Deliberately narrow and read-heavy: a key is a credential a user pastes into a script
 * on a machine you do not control, so the default posture is that losing one costs a
 * consumer their read access and nothing else. Write scopes exist, but nothing that
 * spends money, changes access control, or deletes anything is reachable by key.
 */
export const API_SCOPES = Object.freeze({
  'account:read':  'Read your account profile.',
  'account:write': 'Change your display name and bio.',
  'repos:read':    'List your repos and read their file lists and change history.',
  'catalog:read':  'Read published catalog items and their change history.',
  'users:read':    'Look up public profiles — exactly what a signed-out visitor sees.',
  'notifications:read': 'Read your notifications. This is what lets BMM show them in its notification centre.',
  'notifications:write': 'Mark your notifications as read. Read-only clients never need this.',
  'pools:read':    'List your storage pools: how much space each holds, what is in it, and what it costs.',
  'catalogs:read': 'List the catalogs you own and the items inside them, including unpublished ones.',
  'payments:read': 'Read your own payment history and invoices. Amounts and dates, never a card number.',
  'polls:read':    'Read the polls open to you and how you answered.',
  'polls:write':   'Answer polls on your behalf.',
  'transfers:read': 'See ownership transfers offered to or by you.',
  'favorites:read': 'List the repositories and catalogs you starred.',
  'economy:read':  'Read your Discord level, XP, points, and what you bought in the points shop.',
  'badges:read':   'List the badges on your profile and when you earned them.',
  'charity:read':  'Read the Community Charity pot: the association, the totals and the month’s vote.',
});

/** True if the key carries `scope`. A key with no scopes is allowed nothing. */
function hasScope(key, scope) {
  return Array.isArray(key.scopes) && key.scopes.includes(scope);
}

/** SHA-256 of the presented secret — what the ApiKey row stores instead of the secret. */
export function hashApiKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

/** Pull the presented key out of the request, or '' if there is none. */
function presentedKey(req) {
  const hdr = req.headers['authorization'];
  const raw = hdr && /^Bearer\s+(.+)$/i.test(hdr)
    ? hdr.replace(/^Bearer\s+/i, '')
    : req.headers['x-api-key'] || '';
  return raw.toString().trim();
}

/** Last-used is written best-effort and never blocks the request. Failing to record
 * that a key was used must not stop the call it was used for. */
function touch(p, id, ip) {
  p.apiKey.update({ where: { id }, data: { lastUsedAt: new Date(), lastUsedIp: ip || null } })
    .catch(() => {});
}

/**
 * Public-API auth. `apiAuth('catalog:read')` authenticates an ApiKey and requires that
 * scope; the route then sees req.user = { uid, role } and req.apiKey.
 *
 * The lookup is by HASH, so the database never holds anything a thief could present.
 * Expiry and revocation fail closed, and a key whose owner is suspended or banned stops
 * working at the same moment their session does.
 */
export function apiAuth(scope) {
  return async (req, reply) => {
    // The public-API switch lives HERE, not on each /v1 route: apiAuth already guards
    // every one of them, and a check that has to be repeated per route is one that will
    // be missed on the route added next week.
    //
    // Imported lazily to keep lib.mjs free of a load-order dependency on flags.mjs, which
    // imports db() from this file.
    const { flagEnabled } = await import('./flags.mjs');
    if (!flagEnabled('features.publicApiEnabled')) {
      return reply.code(503).send({ error: 'feature_disabled', feature: 'public_api' });
    }
    const secret = presentedKey(req);
    // Short-circuit before touching the database: a real key is 40+ characters.
    if (!secret || secret.length < 20) {
      return reply.code(401).send({ error: 'unauthenticated', hint: 'Send Authorization: Bearer <key>' });
    }
    const p = await db();
    const key = await p.apiKey.findUnique({
      where: { hash: hashApiKey(secret) },
      select: { id: true, userId: true, scopes: true, revokedAt: true, expiresAt: true, testMode: true, user: { select: { role: true } } },
    });
    // One answer for "no such key", "revoked" and "expired": a caller probing keys must
    // not learn that one of them was ever real.
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= new Date())) {
      return reply.code(401).send({ error: 'invalid_key' });
    }
    // Attributed BEFORE the scope check, so a refusal is still recorded against the key that
    // caused it. A key repeatedly asking for a scope it does not hold is precisely what an
    // admin needs to see, and it is the one call that would otherwise be invisible.
    req.apiKey = { id: key.id, scopes: key.scopes, userId: key.userId };
    // Flagged as a sandbox call BEFORE the scope check, not after it. A console request that
    // is refused for a missing scope is still a console request: recorded the other way round
    // it landed in the real error rate (an experiment reading as an incident) and never
    // appeared in the sandbox view — which exists precisely to show which endpoints turn
    // people away. The simulated ANSWER still comes after every check, further down.
    // Either the caller asked for a rehearsal on this request, or the key itself can only
    // ever rehearse. The second is the one that survives being forgotten.
    if (req.method !== 'GET' && (key.testMode || String(req.headers['x-bcw-sandbox'] || '') === '1')) req.sandbox = true;
    if (scope && !hasScope(key, scope)) {
      return reply.code(403).send({ error: 'insufficient_scope', required: scope, granted: key.scopes });
    }
    const lock = await accountLock(key.userId);
    if (lock) return reply.code(403).send(lockBody(lock));

    touch(p, key.id, req.ip);
    req.user = { uid: key.userId, role: key.user?.role };

    // Sandbox: a call that changes nothing.
    //
    // Placed HERE rather than in a global hook because this is the one guard every /v1 route
    // shares, and by this point the key is authenticated — so a sandbox call is still counted
    // against it and still refused if the scope is missing. A console that skipped those
    // checks would be teaching people an API that does not exist.
    //
    // Only writes are simulated. A GET changes nothing by definition, and showing somebody
    // fabricated data would make the console worse than useless for the thing it is for.
    if (req.sandbox) {
      return reply.code(200).send({
        sandbox: true,
        method: req.method,
        path: req.routeOptions?.url || req.url,
        scope: scope || null,
        testKey: !!key.testMode,
        note: key.testMode
          ? 'Sandbox: this is a test key, so its writes are always simulated. Use a normal key to do it for real.'
          : 'Sandbox: authentication and scope were checked, and nothing was written. Send the same request without the X-BCW-Sandbox header to do it for real.',
      });
    }
  };
}

/** Soft auth: sets req.user from the session cookie when valid, else null. Never
 * fails — used by "who am I" style endpoints so a logged-out visitor gets a clean
 * 200 { user: null } instead of a noisy 401 in the console. */
export function optionalAuth() {
  return async (req) => {
    // A banned account reads as logged-out on soft-auth endpoints, and so does a revoked
    // device — otherwise "sign out this device" would leave it still recognised by /me, which
    // is exactly the screen the user checks to confirm it worked. optionalUid stays a pure
    // token read on purpose: it feeds no-auth ingest endpoints where a DB round-trip per event
    // is not worth it.
    //
    // The role is the LIVE one, like the strict guards (it used to be the role baked into the
    // seven-day token, so a demoted moderator kept the staff view of every soft-auth page —
    // unlisted polls, other people's catalogue keys — until the token expired).
    try { req.user = await sessionUser(req); } catch { req.user = null; }
  };
}

// Cheap best-effort "who is this" for no-auth ingest endpoints (analytics): returns the
// signed-in account id from the session cookie, or null. No DB hit, no lock check.
export function optionalUid(req) {
  try { return jwt.verify(req.cookies?.bcw_session, JWT_SECRET)?.uid || null; } catch { return null; }
}

// A repo.json is only "valid" if it matches BMM's CURRENT ServerRepo manifest format
// (models/repo.rs): required name, version, game_name, created_at + a profiles array.
// Old-format manifests (e.g. missing game_name/profiles) are NOT valid — so they stay
// unverified and drop out of the public list, instead of being trusted as "verified"
// just for being parseable JSON.
export function isValidRepoManifest(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const str = (v) => typeof v === 'string' && v.length > 0;
  return str(o.name) && str(o.version) && str(o.game_name) && str(o.created_at) && Array.isArray(o.profiles);
}

export function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

/** Prune an edit-history table (BlogRevision / DocRevision) for one parent row to the
 *  admin-configured retention: keep at most `history.maxRevisions` snapshots AND at
 *  most `history.maxRevisionKB` of cumulative body size (0 = that limit off), always
 *  keeping the newest ones. `delegate` is the Prisma model (p.blogRevision), `where`
 *  scopes to the parent (e.g. { postId } / { pageId }). Best-effort. */
export async function pruneRevisions(p, delegate, where) {
  const s = Object.fromEntries((await p.adminSetting.findMany()).map((r) => [r.key, r.value]));
  const maxCount = Math.max(1, Number(s['history.maxRevisions'] ?? 30));
  const maxBytes = Math.max(0, Number(s['history.maxRevisionKB'] ?? 0)) * 1024;
  const revs = await delegate.findMany({ where, orderBy: { version: 'desc' }, select: { id: true, body: true, bodyFr: true } });
  const doomed = [];
  let bytes = 0;
  revs.forEach((r, i) => {
    bytes += Buffer.byteLength(r.body || '') + Buffer.byteLength(r.bodyFr || '');
    // Drop anything beyond the count cap, or once the size cap is exceeded — but never
    // the single newest snapshot (i === 0), so history is never left empty.
    if (i > 0 && (i >= maxCount || (maxBytes > 0 && bytes > maxBytes))) doomed.push(r.id);
  });
  if (doomed.length) await delegate.deleteMany({ where: { id: { in: doomed } } });
}

/** The plan every GRANTED storage contribution is booked against — an admin gift, a promo
 *  pool. It is never sold: `active: false` keeps it out of the plan list, and its only job is
 *  to mark a Subscription as "not something the user paid for", which is what lets a resize
 *  tell paid storage from granted storage.
 *
 *  It lives here rather than in hosting.mjs because promo.mjs needs it too, and hosting.mjs
 *  already imports from promo.mjs — putting it there would close an import cycle. Both callers
 *  must agree on the NAME, so there is exactly one copy of it. */
export const GRANT_PLAN_NAME = 'Admin grant';
export async function grantPlan(p) {
  const found = await p.hostingPlan.findFirst({ where: { name: GRANT_PLAN_NAME } });
  return found || p.hostingPlan.create({ data: {
    name: GRANT_PLAN_NAME, storageGB: 0, uploadLimitKbps: 8192, cpuShare: 0.5,
    priceMonthlyCents: 0, active: false,
  } });
}

/** The categories a person can switch off, and which kinds belong to each.
 *
 *  Grouped rather than per-kind because there are thirty-odd kinds and a settings screen
 *  with thirty switches is one nobody reads. The mapping is by prefix where the kinds are
 *  slugs, with an explicit list for the ones that are not.
 */
export const NOTIF_CATEGORIES = {
  hosting: { match: (k) => /^hosting_|^feature_/.test(k), label: 'Hosting & billing' },
  repos: { match: (k) => /^repo_/.test(k), label: 'Your repositories' },
  catalog: { match: (k) => /^catalog_|^submission_/.test(k), label: 'Your catalog items' },
  reports: { match: (k) => /^report_/.test(k), label: 'Reports & support replies' },
  myo: { match: (k) => /^myo_/.test(k), label: 'Commissions' },
  promos: { match: (k) => /^promo_|^kofi_/.test(k), label: 'Promotions & rewards' },
  // Broadcasts: an event or a site-wide announcement goes to EVERY account, which makes it
  // the category people most want a switch for. It is only mutable because nothing
  // account-critical is ever sent this way — those carry their own kind and land in
  // `security` below.
  broadcasts: { match: (k) => /^event$|^announce/.test(k), label: 'Site news & events' },
  // The rest of what the platform actually sends. Each one existed as a kind already and was
  // silently falling through to the locked security category, which meant it could not be
  // switched off — a newsletter confirmation is not a security notice.
  social: { match: (k) => /^badge_|^follow|^profile_|^reaction/.test(k), label: 'Badges, follows & reactions' },
  transfers: { match: (k) => /^transfer_|^ownership/.test(k), label: 'Ownership transfers' },
  polls: { match: (k) => /^poll_/.test(k), label: 'Polls & surveys' },
  blog: { match: (k) => /^blog_|^docs_|^comment/.test(k), label: 'Comments & replies on your writing' },
  newsletter: { match: (k) => /^newsletter/.test(k), label: 'Newsletter' },
  // Sign-in alerts (a new device, a new country, a success after a run of failures).
  //
  // Mutable, and deliberately NOT part of the locked category below — the full reasoning is at
  // the top of lib/login-alert.mjs. The short version: everything in `security` has already
  // happened TO the account and is lost if muted, whereas a sign-in alert is an event the
  // person caused themselves and is a push copy of what /me/sessions shows at all times. One
  // switch covers both the in-app notice and the e-mail; a preference that silences the bell
  // and not the inbox is a rule written twice.
  logins: { match: (k) => /^login_/.test(k), label: 'New sign-ins' },
  // Not switchable, and deliberately so: these are the ones you would most regret muting —
  // a ban, a revoked key, an app losing access, a closure. An account that can silence its
  // own security notices is one that finds out too late.
  security: { match: () => true, label: 'Account & security', locked: true },
};

/** Which category a kind belongs to. Falls through to `security`, which cannot be muted —
 *  so an unrecognised kind is always delivered rather than silently dropped. */
export function notifCategory(kind) {
  const k = String(kind || '');
  for (const [name, def] of Object.entries(NOTIF_CATEGORIES)) {
    if (name !== 'security' && def.match(k)) return name;
  }
  return 'security';
}

/** Persist a notification, unless the account switched its category off.
 *
 *  Filtered at WRITE rather than at read: a notification you asked not to receive should not
 *  exist, not sit hidden waiting for you to change your mind. The trade is that switching a
 *  category back on shows nothing retrospectively, which is the honest behaviour for
 *  something you told us not to send.
 */
/**
 * A path a notification may point at.
 *
 * In-app only, and deliberately strict: exactly one leading slash, no scheme, no protocol-
 * relative "//host". Every code path that can notify a user would otherwise also be a way to
 * send that user to an arbitrary origin — and notifications are written from webhooks, from
 * the bot, and from anything that can reach `notify`.
 *
 * Returns null rather than throwing: a bad link must cost the notification its link, never the
 * notification itself.
 */
export function safeNotifHref(href) {
  const v = String(href ?? '').trim();
  if (!v || !v.startsWith('/') || v.startsWith('//')) return null;
  // A backslash is treated as a slash by some parsers, so "/\evil.com" can escape the origin.
  if (v.includes('\\')) return null;
  return v.slice(0, 300);
}

/**
 * Notify one user.
 *
 * The fifth argument is either the French body (what all 81 existing callers pass) or an
 * options bag `{ bodyFr, href }`. Accepting both is what let a destination be added without
 * editing every call site — and every call site edited to pass a field it does not care about
 * is a call site that can be edited wrong.
 */
export async function notify(p, userId, kind, body, opts) {
  try {
    const o = (opts && typeof opts === 'object') ? opts : { bodyFr: opts };
    const cat = notifCategory(kind);
    if (!NOTIF_CATEGORIES[cat]?.locked) {
      const u = await p.user.findUnique({ where: { id: userId }, select: { notifPrefs: true } });
      if (u?.notifPrefs && u.notifPrefs[cat] === false) return;
    }
    const href = safeNotifHref(o.href);
    await p.notification.create({ data: { userId, kind, body, ...(o.bodyFr ? { bodyFr: o.bodyFr } : {}), ...(href ? { href } : {}) } });
  } catch { /* non-fatal */ }
}

/** Broadcast to every account, minus the ones that muted the category.
 *
 *  Exists because the bulk senders (announcements, events) used `createMany` over the whole
 *  user table and so were the only writers a preference could not reach — the switch would
 *  have been decorative for exactly the notifications that arrive unasked.
 */
export async function notifyAll(p, kind, body, bodyFr) {
  const cat = notifCategory(kind);
  const locked = !!NOTIF_CATEGORIES[cat]?.locked;
  const users = await p.user.findMany({ select: { id: true, notifPrefs: true } });
  const targets = locked ? users : users.filter((u) => !(u.notifPrefs && u.notifPrefs[cat] === false));
  if (!targets.length) return 0;
  const write = (list) => p.notification.createMany({ data: list.map((u) => ({ userId: u.id, kind, body, ...(bodyFr ? { bodyFr } : {}) })) });
  try {
    await write(targets);
  } catch (e) {
    // An account erased between the read above and this insert fails the WHOLE createMany on
    // its foreign key (P2003), and nobody gets the broadcast. Re-read who still exists and
    // send once more; anything else is a real error.
    if (e?.code !== 'P2003') throw e;
    const alive = new Set((await p.user.findMany({ where: { id: { in: targets.map((u) => u.id) } }, select: { id: true } })).map((u) => u.id));
    const left = targets.filter((u) => alive.has(u.id));
    if (left.length) await write(left);
    return left.length;
  }
  return targets.length;
}

/** Append a per-repo audit entry. `actor` is a display label, not auth material.
 * Retention: entries older than 30 days are pruned, and each repo keeps at most
 * 1000 rows (oldest overwritten) — sampled at 3% so writes stay cheap. */
/** How long per-repository activity is kept, from `history.repoDays` (default 30, 0 = for
 *  ever). Cached for a minute: this is read on every repo action and the value changes about
 *  once a year. */
let _repoDays = { at: 0, v: 30 };
/** Drop the cache — called by the endpoint that writes the setting, so a save is visible
 *  immediately instead of a minute later. */
export function clearRepoLogDaysCache() { _repoDays = { at: 0, v: _repoDays.v }; }
export async function repoLogDays(p) {
  if (Date.now() - _repoDays.at < 60_000) return _repoDays.v;
  try {
    const row = await p.adminSetting.findUnique({ where: { key: 'history.repoDays' } });
    const n = Number(row?.value?.days);
    _repoDays = { at: Date.now(), v: Number.isFinite(n) && n >= 0 ? n : 30 };
  } catch { _repoDays = { at: Date.now(), v: _repoDays.v }; }
  return _repoDays.v;
}

export async function repoLog(p, serverRepoId, actor, action, detail = '') {
  try {
    await p.repoAuditLog.create({ data: { serverRepoId, actor: String(actor || 'unknown').slice(0, 160), action, detail: String(detail || '').slice(0, 300) } });
    if (Math.random() < 0.03) {
      // Was a hardcoded 30. It is now the one window an admin could see in the history tab
      // and not change, which is the worst combination — visible and immovable. Cached for a
      // minute so the hot path does not read a setting on every repo action.
      const keepDays = await repoLogDays(p);
      if (keepDays > 0) await p.repoAuditLog.deleteMany({ where: { serverRepoId, createdAt: { lt: new Date(Date.now() - keepDays * 864e5) } } }).catch(() => {});
      const excess = await p.repoAuditLog.findMany({ where: { serverRepoId }, orderBy: { createdAt: 'desc' }, skip: 1000, take: 500, select: { id: true } }).catch(() => []);
      if (excess.length) await p.repoAuditLog.deleteMany({ where: { id: { in: excess.map((e) => e.id) } } }).catch(() => {});
    }
  } catch { /* non-fatal */ }
}

/** Record what happened to a catalog item, for the public change feed.
 *
 * Written from the item's own row, but it OUTLIVES that row: the delete grace period
 * ends, sweeper.mjs drops the CatalogItem, and this entry is then the only evidence the
 * item ever existed. That is the whole point — a consumer mirroring the catalog needs to
 * hear about a removal, and a removal is precisely the event that leaves nothing behind
 * to read.
 *
 * Never throws: failing to write history must not fail the action it describes.
 */
export async function catalogLog(p, item, action, detail = '') {
  try {
    if (!item?.slug) return;
    await p.catalogAuditLog.create({
      data: {
        catalogId: item.id || null,
        slug: item.slug,
        kind: item.kind,
        ownerId: item.ownerId || null,
        action,
        version: item.version || null,
        detail: String(detail || '').slice(0, 300),
      },
    });
  } catch { /* non-fatal */ }
}

/** One free repo / one free catalog upload per account — AND per linked creator id,
 * so unlinking a creator id and relinking it to a fresh account can't be used to
 * claim a second free item (FreeTierClaim rows are never deleted, unlike CreatorLink). */
export async function hasFreeTierClaim(p, kind, userId) {
  const creatorIds = (await p.creatorLink.findMany({ where: { userId }, select: { creatorId: true } })).map((c) => c.creatorId);
  const existing = await p.freeTierClaim.findFirst({ where: { kind, OR: [{ userId }, ...(creatorIds.length ? [{ creatorId: { in: creatorIds } }] : [])] } });
  return !!existing;
}
export async function recordFreeTierClaim(p, kind, userId) {
  const firstCreatorId = (await p.creatorLink.findFirst({ where: { userId }, select: { creatorId: true } }))?.creatorId || null;
  await p.freeTierClaim.create({ data: { kind, userId, creatorId: firstCreatorId } }).catch(() => {}); // unique race — fine to ignore
}

// ── Global access policy + account-based whitelisting (shared by hosting-content's
// sandbox gate, the admin policy editor, and every per-repo settings schema) ──
const DEFAULT_ACCESS_POLICY = { whitelistOnly: false, whitelistIps: [], whitelistKeys: [], whitelistAccounts: [], bannedIps: [], bannedKeys: [], bannedAccounts: [] };
export async function getGlobalAccessPolicy(p) {
  const row = await p.globalAccessPolicy.findUnique({ where: { id: 'global' } });
  return row ? { ...DEFAULT_ACCESS_POLICY, ...row } : { ...DEFAULT_ACCESS_POLICY };
}
// Same shape, owner-scoped: applies only to that owner's own hosted repos, on top
// of both the repo's own settings AND the site-wide GlobalAccessPolicy.
export async function getUserAccessPolicy(p, userId) {
  const row = await p.userAccessPolicy.findUnique({ where: { userId } });
  return row ? { ...DEFAULT_ACCESS_POLICY, ...row } : { ...DEFAULT_ACCESS_POLICY };
}
// An account entry is { type: "bcweb"|"discord", id, label } — matches a resolved
// client identity (from CreatorLink -> userId, and that user's DiscordLink -> discordId).
export function matchAccountList(list, userId, discordId) {
  return (list || []).some((a) => (a.type === 'bcweb' && userId && a.id === userId) || (a.type === 'discord' && discordId && a.id === discordId));
}

// The connecting client's IP (honours the last X-Forwarded-For hop, set by our edge).
export const clientIp = (req) => ipOf(req);
// Resolve the FULL client identity from the X-Creator-ID header BMM sends on repo AND
// catalog requests. The header is trusted only as far as CreatorLink allows — userId,
// that account's Discord, email and BC id are all derived server-side, so a banned
// client can't slip a whitelist/ban match by lying about any of them. Shared by the
// repo sandbox gate and the community-catalog gate.
export async function resolveClientIdentity(p, req) {
  const ip = clientIp(req);
  const raw = req.headers['x-creator-id'];
  const creatorId = raw ? String(raw).slice(0, 120) : null;
  let userId = null, discordId = null, email = null;
  if (creatorId) {
    // Exact, then any spelling (F23-6: a creator id is hex and the client picks its case, so an
    // upper-cased header must still name the account a ban or whitelist entry is about).
    // ciEquals, never a raw insensitive equals: that one is an ILIKE and `%` names an account.
    const include = { user: { select: { email: true, discordLinks: { select: { discordId: true }, take: 1 } } } };
    const link = await p.creatorLink.findUnique({ where: { creatorId }, include })
      || await p.creatorLink.findFirst({ where: { creatorId: ciEquals(creatorId.trim()) }, include });
    if (link) { userId = link.userId; email = link.user?.email || null; discordId = link.user?.discordLinks?.[0]?.discordId || null; }
  }
  return { ip, creatorId, userId, discordId, email, bcId: userId ? userBcId(userId) : null };
}

// Does a resolved identity match an access list { ips, keys, accounts }? keys are BMM
// creator ids (matched against X-Creator-ID); accounts are { type:'bcweb'|'discord'|
// 'creator', id }; ips are raw addresses. Email / BC id / username entries are resolved
// to a bcweb account (userId) at save time, so runtime matching stays id-based.
export function accessListMatches(list, identity) {
  if (!list) return false;
  const { ip, userId, discordId } = identity;
  // Creator ids are compared in ONE spelling, on both sides. They are the hex of a public
  // key, `X-Creator-ID` is whatever the client typed, and the stored entry is whatever an
  // admin pasted — so an exact string compare made an upper-case ban entry a silent no-op
  // and an upper-case whitelist entry an equally silent lock-out. See normaliseCreatorId.
  const creatorId = normaliseCreatorId(identity.creatorId);
  if (ip && (list.ips || []).includes(ip)) return true;
  if (creatorId && (list.keys || []).some((k) => normaliseCreatorId(k) === creatorId)) return true;
  return (list.accounts || []).some((a) =>
    (a.type === 'bcweb' && userId && a.id === userId)
    || (a.type === 'discord' && discordId && a.id === discordId)
    || (a.type === 'creator' && creatorId && normaliseCreatorId(a.id) === creatorId));
}
// Adapt a GlobalAccessPolicy/UserAccessPolicy (banned*/whitelist* fields) to the
// {ips,keys,accounts} shape accessListMatches expects.
export function policyBans(policy, identity) {
  return accessListMatches({ ips: policy?.bannedIps, keys: policy?.bannedKeys, accounts: policy?.bannedAccounts }, identity);
}
export function policyWhitelist(policy, identity) {
  return accessListMatches({ ips: policy?.whitelistIps, keys: policy?.whitelistKeys, accounts: policy?.whitelistAccounts }, identity);
}

// ── Project/showcase page visibility (task: Project Announcement pages) ──
// A slightly wider account-entry shape than accountEntrySchema above — adds
// 'creator' (a BMM creator id, via CreatorLink) since a page whitelist is about
// gating page VIEWS, where "I have this creator id linked" is a meaningful
// audience the repo/global access policies never needed.
export const pageVisibilitySchema = z.enum(['public', 'private', 'unlisted', 'whitelist']);
export const pageAccountEntrySchema = z.object({
  type: z.enum(['bcweb', 'discord', 'creator']),
  id: z.string().min(1).max(120),
  label: z.string().max(120).default(''),
});

// `unlisted` reads exactly like `public` here — it only differs in whether the
// page is INCLUDED IN LISTINGS (topbar pins, /projects grid, /showcase), which
// callers decide separately (only 'public' pages should ever be listed).
// `private` has no bypass here — admin routes fetch pages through their own
// requireRole('ADMIN') preHandler instead of this check.
// Takes the page ROW as the routes pass it (column `visibilityWhitelist`) or an explicit
// `{ visibility, whitelist }`. It used to read `whitelist` only, so every route that passed
// the row refused the very accounts on a whitelisted page's list (test/page-whitelist).
export async function canViewPage(p, { visibility, whitelist, visibilityWhitelist }, req) {
  if (visibility === 'public' || visibility === 'unlisted') return true;
  if (visibility !== 'whitelist') return false;
  if (!req?.user?.uid) return false;
  const userId = req.user.uid;
  const [discordLink, creatorLinks] = await Promise.all([
    p.discordLink.findUnique({ where: { userId } }).catch(() => null),
    p.creatorLink.findMany({ where: { userId }, select: { creatorId: true } }).catch(() => []),
  ]);
  const creatorIds = new Set(creatorLinks.map((c) => c.creatorId));
  const list = Array.isArray(whitelist) ? whitelist : Array.isArray(visibilityWhitelist) ? visibilityWhitelist : [];
  return list.some((a) =>
    (a.type === 'bcweb' && a.id === userId)
    || (a.type === 'discord' && discordLink && a.id === discordLink.discordId)
    || (a.type === 'creator' && creatorIds.has(a.id)));
}

// A staged { ...fields } object swapped into a project/showcase row the first
// time it's read after `scheduledAt` has passed — no cron needed, purely
// computed + lazily persisted on read. Returns the effective (possibly merged)
// row; mutates the DB once so subsequent admin edits see the swapped-in state.
export async function applyScheduledUpdate(p, model, row) {
  if (!row.scheduledAt || !row.scheduledNext || row.scheduledAt > new Date()) return row;
  const next = { ...row.scheduledNext, scheduledAt: null, scheduledNext: null };
  return model.update({ where: { id: row.id }, data: next }).catch(() => row);
}

/**
 * What an account still owns.
 *
 * Two features ask this question — closing an account, and unlinking the creator id the
 * content is published under — and they want the same numbers for the same reason: you
 * cannot walk away from something that is still yours and still being served. Counting it
 * twice is how the two answers drift, so it is counted here and each caller decides its
 * own policy on top.
 *
 * They deliberately do NOT share the policy. Closure blocks on subscriptions, pools, repos
 * and items but not on catalogs; the creator-id unlink blocks on anything BMM reaches with
 * an `X-Creator-ID` header, which includes them. Same facts, different rules, both visible.
 */
export async function ownedContent(p, userId) {
  const [subscriptions, repos, items, pools, catalogs] = await Promise.all([
    p.subscription.count({ where: { userId, status: 'active' } }).catch(() => 0),
    p.serverRepo.count({ where: { ownerId: userId } }).catch(() => 0),
    p.catalogItem.count({ where: { ownerId: userId } }).catch(() => 0),
    p.hostingGroup.count({ where: { ownerId: userId } }).catch(() => 0),
    p.communityCatalog.count({ where: { ownerId: userId } }).catch(() => 0),
  ]);
  return { subscriptions, repos, items, pools, catalogs };
}

/**
 * Free bytes left in a storage pool.
 *
 * Storage is fungible: a repo and a catalog draw from the same `poolBytes`, so both are
 * subtracted. Quota, not usage — what a repo has RESERVED is what the pool has given away,
 * and letting a second repo reserve the same bytes because the first has not filled them
 * yet is how a pool goes over its own ceiling.
 *
 * Lives here rather than in catalogs.mjs (where it was written) because ownership transfers
 * ask the same question, and a second implementation of "how much room is left" is a second
 * answer waiting to disagree with the first.
 */
export async function poolFreeBytes(p, group) {
  // A blog or a contact inbox can reserve bytes from a pool too (lib/entity-hosting.mjs);
  // those are given away exactly like a repo's quota. Imported lazily: entity-hosting is a
  // leaf, but this file is imported by nearly everything and a static cycle is not worth it.
  const { entityPoolQuotaBytes } = await import('./entity-hosting.mjs');
  const [repoAgg, catAgg, reserved] = await Promise.all([
    p.serverRepo.aggregate({ where: { groupId: group.id }, _sum: { storageQuotaBytes: true } }),
    p.communityCatalog.aggregate({ where: { groupId: group.id }, _sum: { storageQuotaBytes: true } }),
    entityPoolQuotaBytes(p, group.id),
  ]);
  return group.poolBytes - (repoAgg._sum.storageQuotaBytes || 0n) - (catAgg._sum.storageQuotaBytes || 0n) - reserved;
}

/**
 * How long people get before hosted content is destroyed.
 *
 * These were three hardcoded `3 * DAY_MS` and the word "72h" written into four
 * notification bodies. That is fine until the day somebody wants a week, at which point
 * the number changes in the code and the sentences keep promising 72 hours — the exact
 * shape of drift this codebase has been bitten by before.
 *
 * So: one place, read from admin settings, and every message that mentions a duration
 * takes it from here instead of spelling it out.
 *
 *   · `lapseHours`  — term ended or cancelled. The content is suspended (read-only for its
 *                     owner, so it can still be downloaded for backup) and destroyed at the
 *                     end of the window unless the term is renewed or the content moved.
 *   · `unpaidHours` — a payment that FAILED, which is usually a card that expired rather
 *                     than a decision. Longer by default for exactly that reason.
 *   · `warnHours`   — how far ahead of the end of a term the warning goes out.
 *
 * Clamped to [1, 8760]: zero means "delete without a window", which no admin means to type,
 * and a year is already far past the point where this is a grace period.
 */
export async function hostingGrace(p) {
  const KEYS = ['hosting.graceLapseHours', 'hosting.graceUnpaidHours', 'hosting.warnBeforeHours'];
  let rows = [];
  try { rows = await p.adminSetting.findMany({ where: { key: { in: KEYS } } }); } catch { /* defaults */ }
  const get = (k, d) => {
    const n = Number(rows.find((r) => r.key === k)?.value);
    return Number.isFinite(n) && n > 0 ? Math.min(8760, Math.max(1, Math.round(n))) : d;
  };
  // The Terms promise AT LEAST 72 hours before content goes (legal.jsx, both grace clauses): no
  // admin value can shorten a window below what the site told its customers.
  return {
    lapseHours: Math.max(72, get('hosting.graceLapseHours', 72)),
    unpaidHours: Math.max(72, get('hosting.graceUnpaidHours', 168)),
    warnHours: get('hosting.warnBeforeHours', 72),
  };
}

/** "72 hours" / "7 days" — whichever a person would actually say. */
export function humanHours(h) {
  const n = Math.max(1, Math.round(Number(h) || 0));
  if (n % 24 === 0 && n >= 24) {
    const d = n / 24;
    return d === 1 ? '24 hours' : `${d} days`;
  }
  return n === 1 ? '1 hour' : `${n} hours`;
}

/**
 * The studio switch is an ADMIN decision, and the save path has to enforce that.
 *
 * A per-project grantee may edit their page's config — that is the point of a grant — and the
 * config is stored as free-form JSON. So without this, "only an admin can turn the studio on
 * for a project" would be a checkbox hidden in the UI and nothing more: a grantee could POST
 * `studioEnabled: true` in their own config and have it. A rule enforced only by not drawing
 * the control is not a rule.
 *
 * Returns the config to STORE: the caller's, with `studioEnabled` forced back to whatever is
 * already stored unless they are allowed to change it.
 *
 * @param {object} incoming  the config as submitted
 * @param {object} current   the config as stored (may be null on first save)
 * @param {boolean} mayToggle  whether this caller is allowed to set the flag
 */
export function guardStudioFlag(incoming, current, mayToggle) {
  const next = { ...(incoming && typeof incoming === 'object' ? incoming : {}) };
  if (mayToggle) return next;
  const was = current && typeof current === 'object' ? current.studioEnabled : undefined;
  if (was === undefined) delete next.studioEnabled;
  else next.studioEnabled = was;
  return next;
}

/**
 * The studio's CONTENT, on the config routes: the same idea as guardStudioFlag above.
 *
 * `canvases` travel inside the free-form config, so without this the `pages` right would be
 * the studio right by another door: PUT the config with a canvas added, reordered, removed or
 * redrawn. For a caller without the studio right (canUseStudio) the stored pages are put
 * back, whatever was sent; everything else in the config is theirs to change. An ABSENT
 * `canvases` is "not touched" for everybody: the config editor of a non-holder loads the
 * public config, which carries no drafts, and saving it must not erase them.
 */
export function guardStudioContent(incoming, current, mayStudio) {
  const next = { ...(incoming && typeof incoming === 'object' ? incoming : {}) };
  const cur = current && typeof current === 'object' ? current : {};
  if (mayStudio && Array.isArray(next.canvases)) return next;
  if (cur.canvases === undefined) delete next.canvases;
  else next.canvases = cur.canvases;
  return next;
}
/** The same for the home page's custom sections: each section's drawing (`canvas`) and its
 *  written-or-drawn switch (`mode: 'canvas'`) are studio content; the rest is the section's. */
export function guardStudioSections(incoming, current, mayStudio) {
  if (!Array.isArray(incoming) || mayStudio) return incoming;
  const byId = new Map((Array.isArray(current) ? current : []).filter((s) => s && typeof s.id === 'string').map((s) => [s.id, s]));
  return incoming.map((s) => {
    if (!s || typeof s !== 'object') return s;
    const was = typeof s.id === 'string' ? byId.get(s.id) : null;
    const out = { ...s };
    if (was && was.canvas !== undefined) out.canvas = was.canvas; else delete out.canvas;
    if (was && was.mode !== undefined) out.mode = was.mode;
    else if (out.mode === 'canvas') out.mode = 'md';
    return out;
  });
}
/**
 * What a VISITOR receives of a config's studio pages: the ones the public page shows (studio
 * on, an id, a title, at least one block: the web's canvasTabsFor), nothing else. A page being
 * prepared, or every page of a studio that is off, is a draft and stays out of the public GET
 * (PLAN-STUDIO-2026 S7). The editor gets the whole list through the studio routes.
 */
export function withoutStudioDrafts(config) {
  if (!config || typeof config !== 'object' || !Array.isArray(config.canvases)) return config;
  const shown = config.studioEnabled === true
    ? config.canvases.filter((cv) => cv && typeof cv === 'object' && cv.id && String(cv.title || '').trim() && Array.isArray(cv.blocks) && cv.blocks.length)
    : [];
  return { ...config, canvases: shown };
}
/** The same for the home page: a section that is off, or not drawn, keeps no drawing. */
export function sectionsWithoutDrafts(sections) {
  if (!Array.isArray(sections)) return sections;
  return sections.map((s) => {
    if (!s || typeof s !== 'object' || s.canvas === undefined) return s;
    if (s.enabled !== false && s.mode === 'canvas') return s;
    const { canvas: _drop, ...rest } = s;
    return rest;
  });
}
