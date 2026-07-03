// Shared helpers: Prisma singleton, JWT sessions, role guards, slugify.
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';

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

export function issueSession(reply, user) {
  const token = jwt.sign({ uid: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  reply.setCookie('bcw_session', token, {
    httpOnly: true, sameSite: 'lax', path: '/',
    secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 3600,
  });
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

export function clearSession(reply) {
  reply.clearCookie('bcw_session', { path: '/' });
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
  reply.setCookie('bcw_elevated', token, {
    httpOnly: true, sameSite: 'lax', path: '/',
    secure: process.env.NODE_ENV === 'production', maxAge: ELEVATE_TTL_S,
  });
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

/** Append an admin/staff audit-log entry. Never throws — logging must not break
 * the action it's recording. */
export async function logAudit(p, actorId, action, detail = '', ip = '') {
  try { await p.auditLogEntry.create({ data: { actorId, action, detail: String(detail || '').slice(0, 300), ip: String(ip || '').slice(0, 64) } }); } catch { /* non-fatal */ }
}

/** Auth guard. requireRole() = any logged-in user; requireRole('ADMIN','MOD') = those roles.
 * SUPERADMIN implicitly satisfies every check regardless of the list passed — it sits
 * above ADMIN in the hierarchy, and retrofitting every one of the ~80 requireRole(...)
 * call sites across the API to explicitly list it would be invasive and easy to miss. */
// Roles that reach the admin dashboard (moderation queue and up) — any route
// gated on one of these ALSO requires 2FA to be enabled on the account, even
// for SUPERADMIN. A password alone isn't enough for a surface this privileged.
const ADMIN_TIER_ROLES = ['MOD', 'ADMIN', 'SUPERADMIN'];

export function requireRole(...roles) {
  return async (req, reply) => {
    try {
      const claims = jwt.verify(req.cookies?.bcw_session, JWT_SECRET);
      if (roles.length && claims.role !== 'SUPERADMIN' && !roles.includes(claims.role)) return reply.code(403).send({ error: 'forbidden' });
      if (roles.length && ADMIN_TIER_ROLES.includes(claims.role)) {
        const p = await db();
        const u = await p.user.findUnique({ where: { id: claims.uid }, select: { totpEnabled: true } });
        if (!u?.totpEnabled) return reply.code(403).send({ error: '2fa_required' });
      }
      req.user = claims; // { uid, role }
    } catch { return reply.code(401).send({ error: 'unauthenticated' }); }
  };
}

/** Soft auth: sets req.user from the session cookie when valid, else null. Never
 * fails — used by "who am I" style endpoints so a logged-out visitor gets a clean
 * 200 { user: null } instead of a noisy 401 in the console. */
export function optionalAuth() {
  return async (req) => {
    try { req.user = jwt.verify(req.cookies?.bcw_session, JWT_SECRET); }
    catch { req.user = null; }
  };
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

/** Persist a notification (used by moderation to tell the owner). */
export async function notify(p, userId, kind, body) {
  try { await p.notification.create({ data: { userId, kind, body } }); } catch { /* non-fatal */ }
}

/** Append a per-repo audit entry. `actor` is a display label, not auth material. */
export async function repoLog(p, serverRepoId, actor, action, detail = '') {
  try { await p.repoAuditLog.create({ data: { serverRepoId, actor: String(actor || 'unknown').slice(0, 160), action, detail: String(detail || '').slice(0, 300) } }); } catch { /* non-fatal */ }
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
