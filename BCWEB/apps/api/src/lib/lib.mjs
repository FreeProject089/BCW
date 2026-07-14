// Shared helpers: Prisma singleton, JWT sessions, role guards, slugify.
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { userBcId } from './repofingerprint.mjs';

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

export function issueSession(reply, user) {
  const token = jwt.sign({ uid: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  reply.setCookie('bcw_session', token, { ...cookieBase, maxAge: 7 * 24 * 3600 });
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
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
const SENSITIVE_ACTION = /^server\.(file_download|file_delete|db_write|db_restore|restart|terminal|power|db_write_blocked|db_restore_blocked)/;
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
const _modCache = new Map(); // uid -> { at, state }
export function clearAccountLockCache(uid) { if (uid) _modCache.delete(uid); else _modCache.clear(); }

// Fine-grained admin capabilities that can be granted to a user on top of their role.
// Each maps to an admin surface enforced by requireCap(...) on the server AND gates the
// matching admin tab client-side. Extend this list as more areas are capability-gated.
export const CAPABILITIES = ['manage_users', 'manage_repos', 'manage_analytics', 'manage_newsletter', 'manage_faq', 'manage_catalogs'];
// Default capabilities a MOD holds without explicit grants.
const MOD_DEFAULT_CAPS = ['manage_users'];

// Live role + permissions, short-TTL cached so an admin's role/permission change takes
// effect WITHOUT the target having to log out and back in (the JWT still carries the OLD
// role; we look up the current one here). Cache is cleared on any role/permission change.
const _userCache = new Map(); // uid -> { at, role, perms }
export function clearUserCache(uid) { if (uid) _userCache.delete(uid); else _userCache.clear(); }
export async function currentUser(uid) {
  if (!uid) return { role: null, perms: [] };
  const hit = _userCache.get(uid);
  if (hit && Date.now() - hit.at < MOD_TTL) return hit;
  let role = null, perms = [];
  try { const p = await db(); const u = await p.user.findUnique({ where: { id: uid }, select: { role: true, permissions: true } }); if (u) { role = u.role; perms = u.permissions || []; } } catch { /* keep nulls */ }
  const rec = { at: Date.now(), role, perms };
  _userCache.set(uid, rec);
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
export async function accountLock(uid) {
  if (!uid) return null;
  const hit = _modCache.get(uid);
  if (hit && Date.now() - hit.at < MOD_TTL) return hit.state;
  let state = null;
  try {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: uid }, select: { status: true, moderationUntil: true, moderationReason: true } });
    if (u && u.status && u.status !== 'active') {
      const until = u.moderationUntil ? new Date(u.moderationUntil) : null;
      if (!until || until.getTime() > Date.now()) state = { status: u.status, until, reason: u.moderationReason || null };
    }
  } catch { state = null; }
  _modCache.set(uid, { at: Date.now(), state });
  return state;
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
      const lock = await accountLock(claims.uid);
      if (lock) return reply.code(403).send(lockBody(lock));
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
      const lock = await accountLock(claims.uid);
      if (lock) return reply.code(403).send(lockBody(lock));
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

/** Personal-API-token auth: authenticates by the caller's own API token
 * (Authorization: Bearer <token> or X-API-Token) and sets req.user = { uid, role }
 * like the session guards, so token callers can drive their account endpoints. */
export function tokenAuth() {
  return async (req, reply) => {
    const hdr = req.headers['authorization'];
    const token = (hdr && /^Bearer\s+(.+)$/i.test(hdr) ? hdr.replace(/^Bearer\s+/i, '') : req.headers['x-api-token'] || '').toString().trim();
    if (!token || token.length < 20) return reply.code(401).send({ error: 'unauthenticated' });
    const p = await db();
    const u = await p.user.findUnique({ where: { apiToken: token }, select: { id: true, role: true } });
    if (!u) return reply.code(401).send({ error: 'invalid_token' });
    const lock = await accountLock(u.id);
    if (lock) return reply.code(403).send(lockBody(lock));
    req.user = { uid: u.id, role: u.role };
  };
}

/** Soft auth: sets req.user from the session cookie when valid, else null. Never
 * fails — used by "who am I" style endpoints so a logged-out visitor gets a clean
 * 200 { user: null } instead of a noisy 401 in the console. */
export function optionalAuth() {
  return async (req) => {
    try {
      const claims = jwt.verify(req.cookies?.bcw_session, JWT_SECRET);
      // A suspended/banned account reads as logged-out on soft-auth endpoints.
      req.user = (await accountLock(claims.uid)) ? null : claims;
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

/** Persist a notification (used by moderation to tell the owner). */
export async function notify(p, userId, kind, body) {
  try { await p.notification.create({ data: { userId, kind, body } }); } catch { /* non-fatal */ }
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
