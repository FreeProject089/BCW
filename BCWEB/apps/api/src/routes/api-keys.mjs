// The public API: key management (session-authed, from the profile) and the `/v1`
// endpoints third parties actually call (key-authed, scoped).
//
// The ONLY credential system. The old single `User.apiToken` (plaintext, unscoped,
// re-readable forever) was removed before production ever saw it — its routes, its
// profile card, and its columns are gone, so there is no legacy surface to secure.
import crypto from 'node:crypto';
import { db, requireRole, apiAuth, hashApiKey, API_SCOPES } from '../lib/lib.mjs';
import { buildPublicProfile } from './social.mjs';
import { findUserIdByBcId } from '../lib/repofingerprint.mjs';

// Only the PREFIXED form (BCU-XXXX-XXXX). repofingerprint's looksLikeBcId also accepts a
// bare 8-character string, and resolving one costs a scan over every account — it
// recomputes the fingerprint per user, which is why its own comment calls it
// "admin-only, infrequent". On a key-authed endpoint that anyone can call, an ordinary
// 8-letter search term must not trigger that.
const looksLikeExplicitBcId = (s) => /^bc[uri][-\s]?[a-z0-9]{4}[-\s]?[a-z0-9]{4}$/i.test(String(s || '').trim());

// 32 random bytes, base64url — 43 characters after the prefix.
const genKey = () => 'bck_' + crypto.randomBytes(32).toString('base64url');
// Enough of the secret to tell two keys apart in a list, far too little to use.
const prefixOf = (k) => k.slice(0, 12);

const RL = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
// The read endpoints are what a sync script hammers; the limit is per key-holder's IP.
const RL_READ = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

/** What the owner sees about their own keys. Never includes anything usable. */
const keyView = {
  id: true, label: true, prefix: true, scopes: true,
  lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true,
};

/** Clamp a page size a caller asked for. */
const limitOf = (q, def = 50, max = 200) => {
  const n = parseInt(q?.limit, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
};

/** Parse `?since=` as a date, or null. An unparseable value means "no filter" rather
 * than an error: a consumer replaying a bad cursor gets everything, not a 400 loop. */
const sinceOf = (q) => {
  const d = q?.since ? new Date(q.since) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export default async function apiKeyRoutes(app) {
  // ── Key management (session auth — a key can never mint another key) ─────────
  //
  // Deliberate: if a leaked key could create keys, revoking the leaked one would not
  // end the intrusion. Minting requires the browser session, and therefore 2FA when
  // the account has it.

  app.get('/me/api-keys', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const keys = await p.apiKey.findMany({
      where: { userId: req.user.uid },
      select: keyView,
      orderBy: { createdAt: 'desc' },
    });
    return { keys, scopes: API_SCOPES };
  });

  app.post('/me/api-keys', { preHandler: requireRole(), ...RL }, async (req, reply) => {
    const b = req.body || {};
    const label = typeof b.label === 'string' ? b.label.trim().slice(0, 60) : '';
    const known = Object.keys(API_SCOPES);
    const scopes = Array.isArray(b.scopes) ? [...new Set(b.scopes.filter((s) => known.includes(s)))] : [];
    if (!scopes.length) return reply.code(400).send({ error: 'no_scopes', allowed: known });

    // An expiry the caller can set but not extend past a year — a key that never
    // expires is a key nobody ever revisits.
    let expiresAt = null;
    const days = parseInt(b.expiresInDays, 10);
    if (Number.isFinite(days) && days > 0) {
      expiresAt = new Date(Date.now() + Math.min(days, 365) * 86400_000);
    }

    const p = await db();
    // A cap, so a compromised session cannot quietly leave a hundred working keys behind.
    const count = await p.apiKey.count({ where: { userId: req.user.uid, revokedAt: null } });
    if (count >= 20) return reply.code(409).send({ error: 'too_many_keys', max: 20 });

    const secret = genKey();
    const row = await p.apiKey.create({
      data: { userId: req.user.uid, label, prefix: prefixOf(secret), hash: hashApiKey(secret), scopes, expiresAt },
      select: keyView,
    });
    // The only time the secret is ever sent. It is not stored, so this response cannot
    // be reproduced — the client must show it now or the key is lost.
    return reply.code(201).send({ key: row, secret });
  });

  app.delete('/me/api-keys/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    // Scoped to the owner: an id from another account matches nothing.
    const r = await p.apiKey.updateMany({
      where: { id: req.params.id, userId: req.user.uid, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!r.count) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  // ── /v1: what a key actually buys ───────────────────────────────────────────

  app.get('/v1/scopes', RL_READ, async () => ({ scopes: API_SCOPES }));

  app.get('/v1/account', { preHandler: apiAuth('account:read'), ...RL_READ }, async (req) => {
    const p = await db();
    const user = await p.user.findUnique({
      where: { id: req.user.uid },
      select: { id: true, displayName: true, bio: true, role: true, createdAt: true },
    });
    return { user, scopes: req.apiKey.scopes };
  });

  app.patch('/v1/account', { preHandler: apiAuth('account:write'), ...RL }, async (req, reply) => {
    const b = req.body || {};
    const data = {};
    if (typeof b.displayName === 'string' && b.displayName.trim().length >= 2 && b.displayName.length <= 60) {
      data.displayName = b.displayName.trim();
    }
    if (typeof b.bio === 'string' && b.bio.length <= 500) data.bio = b.bio;
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'nothing_to_update' });
    const p = await db();
    const user = await p.user.update({ where: { id: req.user.uid }, data, select: { id: true, displayName: true, bio: true } });
    return { user };
  });

  // ── Repos ───────────────────────────────────────────────────────────────────

  app.get('/v1/repos', { preHandler: apiAuth('repos:read'), ...RL_READ }, async (req) => {
    const p = await db();
    const repos = await p.serverRepo.findMany({
      where: { ownerId: req.user.uid },
      select: {
        id: true, name: true, status: true, hostPath: true, published: true, listed: true,
        verified: true, sha: true, storageUsedBytes: true, storageQuotaBytes: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    // BigInt does not survive JSON.stringify. Bytes go out as numbers.
    return { repos: repos.map((r) => ({ ...r, storageUsedBytes: Number(r.storageUsedBytes ?? 0), storageQuotaBytes: Number(r.storageQuotaBytes ?? 0) })) };
  });

  /** Owner check, done once. Returns the repo or null — never another account's row. */
  async function ownRepo(p, uid, id) {
    return p.serverRepo.findFirst({ where: { id, ownerId: uid }, select: { id: true, name: true, hostPath: true } });
  }

  // The file list BCWEB holds for a repo — the thing a directory listing would give you
  // on a plain web host, which is exactly what BMM needs to refresh a repo it did not
  // publish itself.
  app.get('/v1/repos/:id/files', { preHandler: apiAuth('repos:read'), ...RL_READ }, async (req, reply) => {
    const p = await db();
    if (!(await ownRepo(p, req.user.uid, req.params.id))) return reply.code(404).send({ error: 'not_found' });
    const files = await p.repoFile.findMany({
      where: { serverRepoId: req.params.id },
      select: { path: true, size: true, sha256: true, contentType: true, updatedAt: true },
      orderBy: { path: 'asc' },
      take: limitOf(req.query, 5000, 20000),
    });
    return { files: files.map((f) => ({ ...f, size: Number(f.size ?? 0) })) };
  });

  // What changed and when. Reads the per-repo audit trail, which records an upload or a
  // delete at the moment it happens — so a consumer learns about a file that no longer
  // exists, which the file list alone can never tell them.
  app.get('/v1/repos/:id/changes', { preHandler: apiAuth('repos:read'), ...RL_READ }, async (req, reply) => {
    const p = await db();
    if (!(await ownRepo(p, req.user.uid, req.params.id))) return reply.code(404).send({ error: 'not_found' });
    const since = sinceOf(req.query);
    const rows = await p.repoAuditLog.findMany({
      where: { serverRepoId: req.params.id, ...(since ? { createdAt: { gt: since } } : {}) },
      select: { action: true, detail: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: limitOf(req.query, 100, 500),
    });
    return {
      // Honest about the horizon: the table is pruned to 30 days / 1000 rows, so a
      // consumer that has been away longer must re-read the file list instead of
      // believing "nothing changed".
      retentionDays: 30,
      changes: rows.map((r) => ({ action: r.action, path: r.detail || null, at: r.createdAt })),
    };
  });

  // ── Users ───────────────────────────────────────────────────────────────────
  //
  // A key sees exactly what a signed-out visitor sees, and never more. buildPublicProfile
  // is called with viewer = null on purpose: it grants staff a look at private profiles,
  // and a moderator's key must not carry that. Their browser session is where staff
  // powers live, behind 2FA — a bearer token pasted into a script is not.

  app.get('/v1/users/:id', { preHandler: apiAuth('users:read'), ...RL_READ }, async (req, reply) => {
    const p = await db();
    // A BC id (BCR-XXXX-XXXX style) resolves to its account, so a BMM integration holding
    // only a creator id does not have to know the internal user id.
    let id = req.params.id;
    if (looksLikeExplicitBcId(id)) id = (await findUserIdByBcId(p, id)) || id;
    const r = await buildPublicProfile(p, id, null);
    if (r.error) return reply.code(r.code).send({ error: r.error });
    return r;
  });

  // Name / BC id / repo id / catalog slug, all resolving to the owner — the same search
  // the site's own user directory runs, minus anything a visitor could not see.
  app.get('/v1/users', { preHandler: apiAuth('users:read'), ...RL_READ }, async (req) => {
    const q = String(req.query?.q || '').trim();
    if (q.length < 2) return { users: [] };
    const p = await db();

    const ids = new Set();
    if (looksLikeExplicitBcId(q)) { const uid = await findUserIdByBcId(p, q); if (uid) ids.add(uid); }
    const [repo, cat] = await Promise.all([
      p.serverRepo.findUnique({ where: { id: q }, select: { ownerId: true } }).catch(() => null),
      p.communityCatalog.findFirst({ where: { OR: [{ id: q }, { slug: q }] }, select: { ownerId: true } }).catch(() => null),
    ]);
    if (repo?.ownerId) ids.add(repo.ownerId);
    if (cat?.ownerId) ids.add(cat.ownerId);

    const users = await p.user.findMany({
      where: {
        // Public profiles only, and never a banned account — the same two conditions the
        // profile endpoint enforces, so a search cannot surface what a fetch would refuse.
        profilePublic: true,
        status: { not: 'banned' },
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          ...(ids.size ? [{ id: { in: [...ids] } }] : []),
        ],
      },
      select: { id: true, displayName: true, role: true, avatar: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: limitOf(req.query, 25, 100),
    });
    return { users };
  });

  // ── Catalog ─────────────────────────────────────────────────────────────────

  app.get('/v1/catalog', { preHandler: apiAuth('catalog:read'), ...RL_READ }, async (req) => {
    const p = await db();
    const kind = typeof req.query?.kind === 'string' ? req.query.kind.toUpperCase() : null;
    const items = await p.catalogItem.findMany({
      // Published only. PENDING, REJECTED, HIDDEN and SUSPENDED are the review process,
      // not the catalog, and a key must not be a way to read around it.
      where: { status: 'PUBLISHED', ...(kind ? { kind } : {}) },
      select: {
        id: true, slug: true, name: true, kind: true, version: true,
        downloads: true, views: true, createdAt: true, updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: limitOf(req.query, 100, 500),
    });
    return { items };
  });

  // Additions and removals, with dates. Backed by the tombstone table rather than the
  // items themselves: a deleted item is really deleted here, so nothing else could
  // report that it ever existed.
  app.get('/v1/catalog/changes', { preHandler: apiAuth('catalog:read'), ...RL_READ }, async (req) => {
    const p = await db();
    const since = sinceOf(req.query);
    const rows = await p.catalogAuditLog.findMany({
      where: since ? { createdAt: { gt: since } } : {},
      select: { slug: true, kind: true, action: true, version: true, createdAt: true, catalogId: true },
      orderBy: { createdAt: 'desc' },
      take: limitOf(req.query, 100, 500),
    });
    return {
      changes: rows.map((r) => ({
        slug: r.slug, kind: r.kind, action: r.action, version: r.version,
        // Null once the row is gone — the slug stays the identity either way.
        id: r.catalogId, at: r.createdAt,
      })),
    };
  });
}
