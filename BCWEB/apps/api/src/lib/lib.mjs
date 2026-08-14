// Shared helpers: Prisma singleton, JWT sessions, role guards, slugify.
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { userBcId } from './repofingerprint.mjs';
import { boundedSet } from './boundedmap.mjs';
// NOTE: clientIp is deliberately NOT imported — this module already exports its own,
// and the two differ (`req.ip` here vs `req.ip || '0.0.0.0'` there). That split predates
// this feature; changing either return value would ripple through callers that test it
// for falsiness, so the local one is used below rather than quietly swapped.
import { geoOf, parseUA } from './geo.mjs';

// Constant-time string comparison for shared secrets / tokens / signatures
// (SECURITY_AUDIT: avoid the timing side-channel of `a === b`). Length-safe:
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
export const accountEntrySchema = z.object({
  type: z.enum(['bcweb', 'discord']),
  id: z.string().min(1).max(120),
  label: z.string().max(120).default(''),
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

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
// (it simply lands in the list with unknown origin) — this must never be the thing that
// stops someone signing in. For the same reason the whole recording step is wrapped: a
// GeoIP hiccup or a database blip degrades the panel, it does not deny the login.
export async function issueSession(reply, user, req) {
  let sid;
  try {
    if (req) {
      const p = await db();
      const ua = String(req.headers?.['user-agent'] || '').slice(0, 400);
      const { device, browser, os } = parseUA(ua);
      const geo = await geoOf(req);
      const row = await p.session.create({
        data: {
          userId: user.id,
          ip: clientIp(req),
          userAgent: ua || null,
          device, browser, os,
          country: geo?.country || null,
          region: geo?.region || null,
          city: geo?.city || null,
        },
        select: { id: true },
      });
      sid = row.id;
    }
  } catch { /* the panel degrades; the login does not fail */ }
  const token = jwt.sign({ uid: user.id, role: user.role, ...(sid ? { sid } : {}) }, JWT_SECRET, { expiresIn: '7d' });
  reply.setCookie('bcw_session', token, { ...cookieBase, maxAge: 7 * 24 * 3600 });
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

// How stale lastSeenAt may get before a request refreshes it. Every authenticated request
// already reads the row; without a floor it would also WRITE on every request.
const SESSION_TOUCH_MS = 5 * 60 * 1000;

/// Is the session behind this token dead? Called by every auth guard, so revoking a device
/// takes effect on its next request instead of whenever the 7-day token expires.
///
/// Tokens issued before this feature carry no `sid`. They stay valid: forcing every
/// existing user to sign in again is a bigger side effect than the panel is worth. They
/// simply do not appear in the list until the next sign-in.
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
const AUDIT_SECRET = process.env.AUDIT_SECRET || process.env.JWT_SECRET || 'dev-only-insecure-secret';
export function auditHash(prevHash, e) {
  const payload = `${prevHash}|${e.id}|${e.actorId}|${e.action}|${e.detail}|${new Date(e.createdAt).toISOString()}`;
  return crypto.createHmac('sha256', AUDIT_SECRET).update(payload).digest('hex');
}
// Sensitive staff actions that should immediately surface to SUPERADMINs — the tripwire
// for a compromised staff account (someone pulling another user's files, writing to the
// DB, or hitting power/terminal). Matched by action prefix.
const SENSITIVE_ACTION = /^(server\.(file_download|file_delete|db_write|db_restore|restart|terminal|power|db_write_blocked|db_restore_blocked)|user\.2fa_reset)/;
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
export const CAPABILITIES = [
  'manage_users', 'manage_repos', 'manage_analytics', 'manage_newsletter', 'manage_faq', 'manage_catalogs', 'manage_reports',
  // Content elements
  'manage_projects', 'manage_showcase', 'manage_announcements', 'manage_docs',
  // Growth elements
  'manage_events', 'manage_promotions',
  // Services
  'manage_myo', 'manage_api', 'manage_polls',
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
  if (!uid) return { role: null, perms: [] };
  const hit = _userCache.get(uid);
  if (hit && Date.now() - hit.at < MOD_TTL) return hit;
  let role = null, perms = [];
  try {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: uid }, select: { role: true, permissions: true, customRoleIds: true } });
    if (u) {
      role = u.role;
      perms = u.permissions || [];
      // Expand any assigned CustomRole into its capabilities and UNION them in — additive
      // only, so a role can never strip what the tier/individual grants already give.
      if (u.customRoleIds?.length) {
        const roles = await p.customRole.findMany({ where: { id: { in: u.customRoleIds } }, select: { capabilities: true } });
        if (roles.length) perms = [...new Set([...perms, ...roles.flatMap((r) => r.capabilities || [])])];
      }
    }
  } catch { /* keep nulls */ }
  const rec = { at: Date.now(), role, perms };
  boundedSet(_userCache, uid, rec, UID_CACHE_MAX, MOD_TTL);
  return rec;
}
// Does `req.user` (with a live role + perms) hold a capability? ADMIN/SUPERADMIN → all;
// MOD → its defaults + explicit grants; anyone else → only explicit grants.
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

// A user's per-project EDIT grants (ProjectPermission rows), collapsed into a quick-check
// shape. Content-only: reserved controls are still gated behind canManage*(). Not cached —
// project edits are rare and always want the live grant set.
export async function projectGrants(uid) {
  const out = { allShowcase: false, showcaseIds: new Set(), projectKeys: new Set() };
  if (!uid) return out;
  try {
    const p = await db();
    const gs = await p.projectPermission.findMany({ where: { userId: uid }, select: { showcaseProjectId: true, projectKey: true, allShowcase: true } });
    for (const g of gs) {
      if (g.allShowcase) out.allShowcase = true;
      if (g.showcaseProjectId) out.showcaseIds.add(g.showcaseProjectId);
      if (g.projectKey) out.projectKeys.add(g.projectKey);
    }
  } catch { /* no grants on error */ }
  return out;
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
async function ensure2fa(uid, reply) {
  const p = await db();
  const u = await p.user.findUnique({ where: { id: uid }, select: { totpEnabled: true } });
  if (!u?.totpEnabled) { reply.code(403).send({ error: '2fa_required' }); return false; }
  return true;
}
export function requireRole(...roles) {
  return async (req, reply) => {
    try {
      const claims = jwt.verify(req.cookies?.bcw_session, JWT_SECRET);
      const lock = await accountLock(claims.uid, 'signin');
      if (lock) return reply.code(403).send(lockBody(lock));
      if (await sessionRevoked(claims)) return reply.code(401).send({ error: 'session_revoked' });
      // Use the LIVE role (not the possibly-stale JWT), so role changes propagate without
      // requiring the user to re-login.
      const cur = await currentUser(claims.uid);
      const role = cur.role || claims.role;
      if (roles.length && role !== 'SUPERADMIN' && !roles.includes(role)) return reply.code(403).send({ error: 'forbidden' });
      if (roles.length && ADMIN_TIER_ROLES.includes(role)) { if (!(await ensure2fa(claims.uid, reply))) return; }
      req.user = { ...claims, role, perms: cur.perms }; // { uid, role (live), perms }
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
      const claims = jwt.verify(req.cookies?.bcw_session, JWT_SECRET);
      const lock = await accountLock(claims.uid, 'signin');
      if (lock) return reply.code(403).send(lockBody(lock));
      if (await sessionRevoked(claims)) return reply.code(401).send({ error: 'session_revoked' });
      const cur = await currentUser(claims.uid);
      const role = cur.role || claims.role;
      const user = { ...claims, role, perms: cur.perms };
      const allowed = hasCap(user, cap) || alsoRoles.includes(role);
      if (!allowed) return reply.code(403).send({ error: 'missing_permission', capability: cap });
      if (!(await ensure2fa(claims.uid, reply))) return;
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
      const claims = jwt.verify(req.cookies?.bcw_session, JWT_SECRET);
      const lock = await accountLock(claims.uid, 'signin');
      if (lock) return reply.code(403).send(lockBody(lock));
      if (await sessionRevoked(claims)) return reply.code(401).send({ error: 'session_revoked' });
      const cur = await currentUser(claims.uid);
      if (!(await ensure2fa(claims.uid, reply))) return;
      req.user = { ...claims, role: cur.role || claims.role, perms: cur.perms };
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
    const secret = presentedKey(req);
    // Short-circuit before touching the database: a real key is 40+ characters.
    if (!secret || secret.length < 20) {
      return reply.code(401).send({ error: 'unauthenticated', hint: 'Send Authorization: Bearer <key>' });
    }
    const p = await db();
    const key = await p.apiKey.findUnique({
      where: { hash: hashApiKey(secret) },
      select: { id: true, userId: true, scopes: true, revokedAt: true, expiresAt: true, user: { select: { role: true } } },
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
    if (req.method !== 'GET' && String(req.headers['x-bcw-sandbox'] || '') === '1') req.sandbox = true;
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
        note: 'Sandbox: authentication and scope were checked, and nothing was written. Send the same request without the X-BCW-Sandbox header to do it for real.',
      });
    }
  };
}

/** Soft auth: sets req.user from the session cookie when valid, else null. Never
 * fails — used by "who am I" style endpoints so a logged-out visitor gets a clean
 * 200 { user: null } instead of a noisy 401 in the console. */
export function optionalAuth() {
  return async (req) => {
    try {
      const claims = jwt.verify(req.cookies?.bcw_session, JWT_SECRET);
      // A suspended/banned account reads as logged-out on soft-auth endpoints, and so
      // does a revoked device — otherwise "sign out this device" would leave it still
      // recognised by /me, which is exactly the screen the user checks to confirm it
      // worked. optionalUid stays a pure token read on purpose: it feeds no-auth ingest
      // endpoints where a DB round-trip per event is not worth it.
      const dead = (await accountLock(claims.uid, 'signin')) || (await sessionRevoked(claims));
      req.user = dead ? null : claims;
    } catch { req.user = null; }
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
export async function notify(p, userId, kind, body, bodyFr) {
  try {
    const cat = notifCategory(kind);
    if (!NOTIF_CATEGORIES[cat]?.locked) {
      const u = await p.user.findUnique({ where: { id: userId }, select: { notifPrefs: true } });
      if (u?.notifPrefs && u.notifPrefs[cat] === false) return;
    }
    await p.notification.create({ data: { userId, kind, body, ...(bodyFr ? { bodyFr } : {}) } });
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
  await p.notification.createMany({
    data: targets.map((u) => ({ userId: u.id, kind, body, ...(bodyFr ? { bodyFr } : {}) })),
  });
  return targets.length;
}

/** Append a per-repo audit entry. `actor` is a display label, not auth material.
 * Retention: entries older than 30 days are pruned, and each repo keeps at most
 * 1000 rows (oldest overwritten) — sampled at 3% so writes stay cheap. */
export async function repoLog(p, serverRepoId, actor, action, detail = '') {
  try {
    await p.repoAuditLog.create({ data: { serverRepoId, actor: String(actor || 'unknown').slice(0, 160), action, detail: String(detail || '').slice(0, 300) } });
    if (Math.random() < 0.03) {
      await p.repoAuditLog.deleteMany({ where: { serverRepoId, createdAt: { lt: new Date(Date.now() - 30 * 864e5) } } }).catch(() => {});
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
export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip;
}
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
    const link = await p.creatorLink.findUnique({
      where: { creatorId },
      include: { user: { select: { email: true, discordLinks: { select: { discordId: true }, take: 1 } } } },
    });
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
  const { ip, creatorId, userId, discordId } = identity;
  if (ip && (list.ips || []).includes(ip)) return true;
  if (creatorId && (list.keys || []).includes(creatorId)) return true;
  return (list.accounts || []).some((a) =>
    (a.type === 'bcweb' && userId && a.id === userId)
    || (a.type === 'discord' && discordId && a.id === discordId)
    || (a.type === 'creator' && creatorId && a.id === creatorId));
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
export async function canViewPage(p, { visibility, whitelist }, req) {
  if (visibility === 'public' || visibility === 'unlisted') return true;
  if (visibility !== 'whitelist') return false;
  if (!req?.user?.uid) return false;
  const userId = req.user.uid;
  const [discordLink, creatorLinks] = await Promise.all([
    p.discordLink.findUnique({ where: { userId } }).catch(() => null),
    p.creatorLink.findMany({ where: { userId }, select: { creatorId: true } }).catch(() => []),
  ]);
  const creatorIds = new Set(creatorLinks.map((c) => c.creatorId));
  return (whitelist || []).some((a) =>
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
