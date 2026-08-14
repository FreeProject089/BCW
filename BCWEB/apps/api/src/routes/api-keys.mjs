// The public API: key management (session-authed, from the profile) and the `/v1`
// endpoints third parties actually call (key-authed, scoped).
//
// The ONLY credential system. The old single `User.apiToken` (plaintext, unscoped,
// re-readable forever) was removed before production ever saw it — its routes, its
// profile card, and its columns are gone, so there is no legacy surface to secure.
import crypto from 'node:crypto';
import { db, requireRole, requireCap, apiAuth, hashApiKey, API_SCOPES, logAudit, clientIp, notify } from '../lib/lib.mjs';
import { verifyTotp } from '../lib/totp.mjs';
import { buildPublicProfile } from './social.mjs';
import { findUserIdByBcId } from '../lib/repofingerprint.mjs';
import { apiUsageConfig } from '../lib/apiusage.mjs';

// Only the PREFIXED form (BCU-XXXX-XXXX). repofingerprint's looksLikeBcId also accepts a
// bare 8-character string, and resolving one costs a scan over every account — it
// recomputes the fingerprint per user, which is why its own comment calls it
// "admin-only, infrequent". On a key-authed endpoint that anyone can call, an ordinary
// 8-letter search term must not trigger that.
const looksLikeExplicitBcId = (s) => /^bc[uri][-\s]?[a-z0-9]{4}[-\s]?[a-z0-9]{4}$/i.test(String(s || '').trim());

// 32 random bytes, base64url — 43 characters after the prefix.
// Exported so the account-link flow can mint a key without a second generator.
// Two implementations of "make a credential" is how one of them quietly ends up
// with less entropy than the other and nobody notices until it matters.
export const genKey = () => 'bck_' + crypto.randomBytes(32).toString('base64url');
// Enough of the secret to tell two keys apart in a list, far too little to use.
export const prefixOf = (k) => k.slice(0, 12);

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
  /** Ask for the second factor when the account has one.
   *
   *  Returns null when the caller may proceed, or {code, body} to send back. Accounts
   *  WITHOUT 2FA are not blocked: this protects people who chose the protection, it does not
   *  force everybody to choose it before they can use the API.
   */
  async function require2fa(req) {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid }, select: { totpEnabled: true, totpSecret: true } });
    if (!u?.totpEnabled) return null;
    const code = String(req.body?.totp || '').trim();
    if (!code) return { code: 401, body: { error: 'totp_required' } };
    if (!verifyTotp(u.totpSecret, code)) return { code: 401, body: { error: 'totp_invalid' } };
    return null;
  }

  // ════════════════ Admin: what the public API is being used for (manage_api) ════
  //
  // Two datasets, on purpose (see lib/apiusage.mjs): ApiUsageDay is the exact count and is
  // kept; ApiRequest is a short-lived SAMPLE of individual calls. Anything reported here
  // says which of the two it came from, because a graph drawn from a sample and a graph
  // drawn from a count are not the same graph and only one of them can be trusted for
  // "how many".

  const dayList = (days) => {
    const out = [];
    const d = new Date(); d.setUTCHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) out.push(new Date(d.getTime() - i * 86400000).toISOString().slice(0, 10));
    return out;
  };

  app.get('/admin/api/overview', { preHandler: requireCap('manage_api') }, async (req) => {
    const p = await db();
    const days = Math.min(90, Math.max(1, parseInt(req.query?.days, 10) || 30));
    const since = new Date(Date.now() - days * 86400000);
    since.setUTCHours(0, 0, 0, 0);

    const [usage, keys, cfgRow, sampleCount] = await Promise.all([
      p.apiUsageDay.findMany({ where: { day: { gte: since } }, orderBy: { day: 'asc' } }),
      p.apiKey.findMany({
        select: { id: true, label: true, prefix: true, scopes: true, revokedAt: true, expiresAt: true, lastUsedAt: true, createdAt: true,
          user: { select: { id: true, displayName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      p.adminSetting.findUnique({ where: { key: 'api.usage' } }),
      p.apiRequest.count(),
    ]);

    const byDay = new Map(dayList(days).map((d) => [d, { day: d, count: 0, errors: 0, sandbox: 0 }]));
    const byKey = new Map();
    for (const u of usage) {
      const d = u.day.toISOString().slice(0, 10);
      const slot = byDay.get(d);
      if (slot) { slot.count += u.count; slot.errors += u.errors; slot.sandbox += u.sandbox || 0; }
      const k = u.keyId || 'deleted';
      const agg = byKey.get(k) || { keyId: u.keyId, count: 0, errors: 0, lastDay: null };
      agg.count += u.count; agg.errors += u.errors;
      if (!agg.lastDay || d > agg.lastDay) agg.lastDay = d;
      byKey.set(k, agg);
    }

    const keyById = new Map(keys.map((k) => [k.id, k]));
    const top = [...byKey.values()]
      .map((a) => ({
        ...a,
        // A key that has been deleted still owns its history — naming it "(deleted key)"
        // rather than hiding the row keeps the totals adding up.
        label: keyById.get(a.keyId)?.label || (a.keyId ? '' : '(deleted key)'),
        prefix: keyById.get(a.keyId)?.prefix || '',
        owner: keyById.get(a.keyId)?.user || null,
      }))
      .sort((x, y) => y.count - x.count).slice(0, 20);

    const total = [...byDay.values()].reduce((n, d) => n + d.count, 0);
    const errors = [...byDay.values()].reduce((n, d) => n + d.errors, 0);
    const sandbox = [...byDay.values()].reduce((n, d) => n + d.sandbox, 0);
    return {
      days, series: [...byDay.values()], total, errors, sandbox,
      // Named errorRate, not "health": it is the share of calls that answered 4xx/5xx, and a
      // client hammering a 404 is not the server being unwell.
      errorRate: total ? errors / total : 0,
      top,
      keyCount: keys.length,
      activeKeyCount: keys.filter((k) => !k.revokedAt && (!k.expiresAt || k.expiresAt > new Date())).length,
      sampleCount,
      config: { sampleRate: Number(cfgRow?.value?.sampleRate ?? 1), retentionDays: Number(cfgRow?.value?.retentionDays ?? 7) },
    };
  });

  // Who is exploring the API, and what they tried.
  //
  // A separate view rather than a filter on the request log, because the questions are
  // different: the log asks "what did this key do to us", this asks "is the console any
  // good" — which endpoints people reach for first, and which of those refused them. A
  // sandbox 403 is not an incident, it is documentation failing.
  app.get('/admin/api/sandbox', { preHandler: requireCap('manage_api') }, async (req) => {
    const p = await db();
    const hours = Math.min(24 * 30, Math.max(1, parseInt(req.query?.hours, 10) || 24 * 7));
    const since = new Date(Date.now() - hours * 3600_000);
    const rows = await p.apiRequest.findMany({
      where: { sandbox: true, at: { gte: since } }, orderBy: { at: 'desc' }, take: 500,
      select: { id: true, userId: true, keyId: true, method: true, path: true, status: true, ms: true, at: true },
    });

    const byPath = new Map();
    const byUser = new Map();
    for (const r of rows) {
      const pk = `${r.method} ${r.path}`;
      const a = byPath.get(pk) || { endpoint: pk, calls: 0, refused: 0, lastAt: r.at };
      a.calls += 1; if (r.status >= 400) a.refused += 1;
      byPath.set(pk, a);
      if (r.userId) {
        const u = byUser.get(r.userId) || { userId: r.userId, calls: 0, refused: 0, lastAt: r.at, endpoints: new Set() };
        u.calls += 1; if (r.status >= 400) u.refused += 1;
        u.endpoints.add(pk);
        byUser.set(r.userId, u);
      }
    }
    // Names are resolved in one query rather than per row.
    const users = byUser.size
      ? await p.user.findMany({ where: { id: { in: [...byUser.keys()] } }, select: { id: true, displayName: true, email: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u]));

    return {
      hours,
      // The sample rate applies here too: say so rather than let a count be read as exact.
      sampleRate: apiUsageConfig().sampleRate,
      calls: rows.length,
      refused: rows.filter((r) => r.status >= 400).length,
      explorers: [...byUser.values()]
        .map((u) => ({ ...u, endpoints: u.endpoints.size, user: nameById.get(u.userId) || null }))
        .sort((a, b) => b.calls - a.calls).slice(0, 20),
      endpoints: [...byPath.values()].sort((a, b) => b.calls - a.calls).slice(0, 20),
      recent: rows.slice(0, 40),
    };
  });

  app.get('/admin/api/keys', { preHandler: requireCap('manage_api') }, async (req) => {
    const p = await db();
    const q = String(req.query?.q || '').trim();
    const where = q ? { OR: [
      { label: { contains: q, mode: 'insensitive' } },
      { prefix: { contains: q, mode: 'insensitive' } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
      { user: { displayName: { contains: q, mode: 'insensitive' } } },
    ] } : {};
    const keys = await p.apiKey.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200,
      select: { id: true, label: true, prefix: true, scopes: true, lastUsedAt: true, lastUsedIp: true,
        expiresAt: true, revokedAt: true, createdAt: true,
        user: { select: { id: true, displayName: true, email: true } } },
    });
    // One grouped query rather than a count per key: this list is 200 rows on a busy site.
    const totals = await p.apiUsageDay.groupBy({
      by: ['keyId'], where: { keyId: { in: keys.map((k) => k.id) } },
      _sum: { count: true, errors: true },
    });
    const tot = new Map(totals.map((t) => [t.keyId, t._sum]));
    return { keys: keys.map((k) => ({ ...k, calls: tot.get(k.id)?.count || 0, errors: tot.get(k.id)?.errors || 0 })) };
  });

  /** The sampled call log. Filterable, because "recent calls" on a busy key is noise. */
  app.get('/admin/api/requests', { preHandler: requireCap('manage_api') }, async (req) => {
    const p = await db();
    const where = {};
    if (req.query?.keyId) where.keyId = String(req.query.keyId);
    if (req.query?.userId) where.userId = String(req.query.userId);
    if (req.query?.status === 'errors') where.status = { gte: 400 };
    else if (req.query?.status) where.status = parseInt(req.query.status, 10) || 0;
    if (req.query?.path) where.path = { contains: String(req.query.path).slice(0, 200), mode: 'insensitive' };
    const take = limitOf(req.query, 100, 500);
    const [rows, total] = await Promise.all([
      p.apiRequest.findMany({ where, orderBy: { at: 'desc' }, take,
        include: { key: { select: { label: true, prefix: true, user: { select: { id: true, displayName: true } } } } } }),
      p.apiRequest.count({ where }),
    ]);
    return { requests: rows, total, sampled: true };
  });

  app.put('/admin/api/config', { preHandler: requireCap('manage_api') }, async (req, reply) => {
    const rate = Number(req.body?.sampleRate);
    const retention = parseInt(req.body?.retentionDays, 10);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) return reply.code(400).send({ error: 'invalid_input' });
    if (!Number.isFinite(retention) || retention < 1 || retention > 90) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const value = { sampleRate: rate, retentionDays: retention };
    await p.adminSetting.upsert({ where: { key: 'api.usage' }, create: { key: 'api.usage', value }, update: { value } });
    await logAudit(p, req.user.uid, 'api.config', `sample ${Math.round(rate * 100)}%, keep ${retention}d`, clientIp(req));
    return { ok: true, ...value };
  });

  /** Revoke someone else's key. Staff-side counterpart of DELETE /me/api-keys/:id. */
  app.post('/admin/api/keys/:id/revoke', { preHandler: requireCap('manage_api') }, async (req, reply) => {
    const p = await db();
    const key = await p.apiKey.findUnique({ where: { id: req.params.id }, select: { id: true, label: true, revokedAt: true, userId: true } });
    if (!key) return reply.code(404).send({ error: 'not_found' });
    if (key.revokedAt) return { ok: true, alreadyRevoked: true };
    await p.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    await logAudit(p, req.user.uid, 'api.key_revoked', `${key.label || key.id} (owner ${key.userId})`, clientIp(req));
    // The owner is told. A key going dead without explanation is a support ticket, and one
    // that starts from the wrong theory.
    await notify(p, key.userId, 'api_key_revoked', `“${key.label || 'Untitled key'}” was revoked by staff. Create a new key from your profile if you still need one.`);
    return { ok: true };
  });

  /** Everything the API knows about one user's keys — used by the admin User details. */
  app.get('/admin/api/users/:id', { preHandler: requireCap('manage_api') }, async (req) => {
    const p = await db();
    const [keys, usage, recent] = await Promise.all([
      p.apiKey.findMany({ where: { userId: req.params.id }, orderBy: { createdAt: 'desc' },
        select: { id: true, label: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true } }),
      p.apiUsageDay.findMany({ where: { userId: req.params.id }, orderBy: { day: 'desc' }, take: 60 }),
      p.apiRequest.findMany({ where: { userId: req.params.id }, orderBy: { at: 'desc' }, take: 25 }),
    ]);
    return {
      keys, usage: usage.map((u) => ({ day: u.day.toISOString().slice(0, 10), count: u.count, errors: u.errors })),
      recent, totalCalls: usage.reduce((n, u) => n + u.count, 0),
    };
  });

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
    const gate = await require2fa(req);
    if (gate) return reply.code(gate.code).send(gate.body);
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
    // A key is a credential, so removing one is protected exactly like minting one. Without
    // this, a stolen session could quietly delete the key an integration runs on — an outage
    // with no trace of who caused it.
    const gate = await require2fa(req);
    if (gate) return reply.code(gate.code).send(gate.body);
    const p = await db();
    // Scoped to the owner: an id from another account matches nothing.
    //
    // A real DELETE, not a revoke. "Delete" that left the row behind meant a key you had
    // removed still sat in your list as a tombstone, and there was no way to actually get
    // rid of it. The usage history survives regardless — ApiUsageDay and ApiRequest hold
    // keyId with ON DELETE SET NULL, so last quarter's numbers keep adding up while the
    // credential itself is gone.
    const r = await p.apiKey.deleteMany({ where: { id: req.params.id, userId: req.user.uid } });
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

  // Notifications already existed at GET /me/notifications, but behind requireRole()
  // — a browser session. A desktop app has no session to present, which is the only
  // reason BMM could not show them. Same rows, same ownership check, reachable with
  // a scoped key.
  //
  // `since` makes this pollable without re-reading the whole list every few minutes:
  // the caller sends the newest createdAt it already has and gets only what arrived
  // after. Without it a poller either re-downloads a hundred rows forever or invents
  // its own de-duplication, and inventing it per client is how two clients disagree
  // about what is unread.
  app.get('/v1/notifications', { preHandler: apiAuth('notifications:read'), ...RL_READ }, async (req) => {
    const p = await db();
    const where = { userId: req.user.uid };
    const since = req.query?.since ? new Date(String(req.query.since)) : null;
    // An unparseable date must not silently become "everything since 1970" — that is
    // the shape of a poller that quietly re-sends the user's whole history.
    if (since && !Number.isNaN(since.getTime())) where.createdAt = { gt: since };
    const take = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 100);
    const notifications = await p.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      // bodyFr rides along rather than being resolved here: the server does not know
      // which language BMM is running in, and picking one would make the row wrong for
      // a user who switches. The client already has that answer.
      select: { id: true, kind: true, body: true, bodyFr: true, readAt: true, createdAt: true },
    });
    return { notifications };
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


  // ── Storage pools ───────────────────────────────────────────────────────────
  //
  // A pool is where the storage actually lives; repos and catalogs draw from it. Without
  // this a client can see a repo is at its quota and has no way to find out why, or what
  // the quota belongs to.

  app.get('/v1/pools', { preHandler: apiAuth('pools:read'), ...RL_READ }, async (req) => {
    const p = await db();
    const pools = await p.hostingGroup.findMany({
      where: { ownerId: req.user.uid },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, freePlan: true, poolBytes: true, uploadLimitKbps: true,
        cpuShare: true, createdAt: true,
        repos: { select: { id: true, name: true, status: true, storageUsedBytes: true } },
        catalogs: { select: { id: true, name: true, slug: true, status: true } },
        subscriptions: { select: { id: true, status: true, currentPeriodEnd: true, plan: { select: { name: true, priceMonthlyCents: true } } }, orderBy: { currentPeriodEnd: 'desc' }, take: 1 },
      },
    });
    // BigInt does not survive JSON.stringify — same rule as /v1/repos.
    return {
      pools: pools.map((g) => {
        const used = g.repos.reduce((n, r) => n + Number(r.storageUsedBytes ?? 0), 0);
        return {
          id: g.id, name: g.name, freePlan: g.freePlan,
          poolBytes: Number(g.poolBytes ?? 0),
          usedBytes: used,
          freeBytes: Math.max(0, Number(g.poolBytes ?? 0) - used),
          uploadLimitKbps: g.uploadLimitKbps, cpuShare: g.cpuShare, createdAt: g.createdAt,
          repos: g.repos.map((r) => ({ id: r.id, name: r.name, status: r.status, storageUsedBytes: Number(r.storageUsedBytes ?? 0) })),
          catalogs: g.catalogs,
          subscription: g.subscriptions[0] || null,
        };
      }),
    };
  });

  // ── Catalogs you own ────────────────────────────────────────────────────────
  //
  // Distinct from `catalog:read`, which reads the PUBLISHED feed anybody can see. This one
  // is your side of it: your catalogs, including the items still pending or hidden. Two
  // scopes because they are two different audiences — a public mirror needs the first and
  // has no business holding the second.

  app.get('/v1/catalogs', { preHandler: apiAuth('catalogs:read'), ...RL_READ }, async (req) => {
    const p = await db();
    const cats = await p.communityCatalog.findMany({
      where: { ownerId: req.user.uid },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, slug: true, description: true, kinds: true, mode: true,
        status: true, visibility: true, listed: true, freePlan: true, groupId: true, createdAt: true,
        _count: { select: { items: true } },
      },
    });
    return { catalogs: cats.map((c) => ({ ...c, itemCount: c._count.items, _count: undefined })) };
  });

  app.get('/v1/catalogs/:id/items', { preHandler: apiAuth('catalogs:read'), ...RL_READ }, async (req, reply) => {
    const p = await db();
    const own = await p.communityCatalog.findFirst({ where: { id: req.params.id, ownerId: req.user.uid }, select: { id: true } });
    if (!own) return reply.code(404).send({ error: 'not_found' });
    const items = await p.communityCatalogItem.findMany({
      where: { catalogId: own.id },
      orderBy: { createdAt: 'desc' },
      take: limitOf(req.query, 100, 500),
    });
    return { items: items.map((it) => ({ ...it, payloadSize: Number(it.payloadSize ?? 0) })) };
  });

  // ── Payments ────────────────────────────────────────────────────────────────

  app.get('/v1/payments', { preHandler: apiAuth('payments:read'), ...RL_READ }, async (req) => {
    const p = await db();
    const rows = await p.payment.findMany({
      where: { userId: req.user.uid },
      orderBy: { createdAt: 'desc' },
      take: limitOf(req.query, 50, 200),
      // No Stripe session id: it is an identifier into someone else's system and a key
      // holder has no use for it that reading their own invoices does not already cover.
      select: { id: true, kind: true, description: true, amountCents: true, currency: true, status: true, days: true, createdAt: true },
    });
    return { payments: rows };
  });

  // ── Polls ───────────────────────────────────────────────────────────────────

  app.get('/v1/polls', { preHandler: apiAuth('polls:read'), ...RL_READ }, async (req) => {
    const p = await db();
    const polls = await p.poll.findMany({
      where: { status: 'open' },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      include: { options: { orderBy: { sort: 'asc' } }, votes: { select: { optionId: true, userId: true, wasLoggedIn: true } } },
    });
    const now = Date.now();
    return {
      polls: polls
        .filter((poll) => (!poll.opensAt || new Date(poll.opensAt).getTime() <= now) && (!poll.closesAt || new Date(poll.closesAt).getTime() > now))
        .map((poll) => {
          const mine = poll.votes.filter((v) => v.userId === req.user.uid).map((v) => v.optionId);
          const counted = mine.length > 0 || poll.results === 'always';
          const tally = new Map(poll.options.map((o) => [o.id, 0]));
          for (const v of poll.votes) tally.set(v.optionId, (tally.get(v.optionId) || 0) + 1);
          return {
            id: poll.id, question: poll.question, description: poll.description,
            audience: poll.audience, multiple: poll.multiple, maxChoices: poll.maxChoices,
            closesAt: poll.closesAt, myVotes: mine,
            // Same rule as the website: the tally is not handed out before you answer.
            // A client that could read it early would be a way around that.
            options: poll.options.map((o) => ({ id: o.id, label: o.label, ...(counted ? { votes: tally.get(o.id) || 0 } : {}) })),
          };
        }),
    };
  });

  app.post('/v1/polls/:id/vote', { preHandler: apiAuth('polls:write'), ...RL }, async (req, reply) => {
    const ids = Array.isArray(req.body?.optionIds) ? req.body.optionIds.slice(0, 20).map(String) : [];
    if (!ids.length) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const poll = await p.poll.findUnique({ where: { id: req.params.id }, include: { options: { select: { id: true } } } });
    if (!poll || poll.status !== 'open') return reply.code(404).send({ error: 'not_found' });
    const now = Date.now();
    if ((poll.opensAt && new Date(poll.opensAt).getTime() > now) || (poll.closesAt && new Date(poll.closesAt).getTime() <= now)) {
      return reply.code(409).send({ error: 'closed' });
    }
    const valid = new Set(poll.options.map((o) => o.id));
    const picks = [...new Set(ids)].filter((id) => valid.has(id));
    if (!picks.length) return reply.code(400).send({ error: 'invalid_option' });
    if (!poll.multiple && picks.length > 1) return reply.code(400).send({ error: 'single_choice' });
    if (poll.maxChoices > 0 && picks.length > poll.maxChoices) return reply.code(400).send({ error: 'too_many', max: poll.maxChoices });
    // Replaces the previous answer, exactly like the website — one behaviour for one act,
    // whichever door it came through.
    await p.pollVote.deleteMany({ where: { pollId: poll.id, userId: req.user.uid } });
    await p.pollVote.createMany({
      data: picks.map((optionId) => ({ pollId: poll.id, optionId, userId: req.user.uid, wasLoggedIn: true })),
      skipDuplicates: true,
    });
    return { ok: true, myVotes: picks };
  });

  // ── Favourites ──────────────────────────────────────────────────────────────

  app.get('/v1/favorites', { preHandler: apiAuth('favorites:read'), ...RL_READ }, async (req) => {
    const p = await db();
    const [repos, catalogs] = await Promise.all([
      p.repoFavorite.findMany({
        where: { userId: req.user.uid }, orderBy: { createdAt: 'desc' }, take: 200,
        include: { repo: { select: { id: true, name: true, listed: true, verified: true, status: true } } },
      }),
      p.catalogFavorite.findMany({
        where: { userId: req.user.uid }, orderBy: { createdAt: 'desc' }, take: 200,
        include: { catalog: { select: { id: true, name: true, slug: true, kinds: true, status: true } } },
      }),
    ]);
    // A favourite whose target was deleted is dropped rather than returned as a null: a
    // client iterating this should not have to defend against half a row.
    return {
      repos: repos.filter((f) => f.repo).map((f) => ({ ...f.repo, favoritedAt: f.createdAt })),
      catalogs: catalogs.filter((f) => f.catalog).map((f) => ({ ...f.catalog, favoritedAt: f.createdAt })),
    };
  });

  // ── Ownership transfers ─────────────────────────────────────────────────────
  //
  // Read-only on purpose. Accepting a transfer takes on somebody else's storage bill and
  // their content's moderation history; that belongs behind a session, not behind a key
  // that may be sitting in a script's environment.

  app.get('/v1/transfers', { preHandler: apiAuth('transfers:read'), ...RL_READ }, async (req) => {
    const p = await db();
    const rows = await p.ownershipTransfer.findMany({
      where: { OR: [{ fromUserId: req.user.uid }, { toUserId: req.user.uid }] },
      orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, kind: true, targetId: true, targetName: true, status: true, fromUserId: true, toUserId: true, expiresAt: true, createdAt: true },
    });
    return {
      transfers: rows.map((r) => ({
        ...r,
        direction: r.fromUserId === req.user.uid ? 'outgoing' : 'incoming',
        fromUserId: undefined, toUserId: undefined,
      })),
    };
  });

  // ── Notifications: the write half ───────────────────────────────────────────

  app.post('/v1/notifications/:id/read', { preHandler: apiAuth('notifications:write'), ...RL }, async (req, reply) => {
    const p = await db();
    // updateMany with the owner in the WHERE, not findUnique-then-update: it cannot touch
    // another account's row even for an instant.
    const r = await p.notification.updateMany({ where: { id: req.params.id, userId: req.user.uid }, data: { readAt: new Date() } });
    if (!r.count) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.post('/v1/notifications/read-all', { preHandler: apiAuth('notifications:write'), ...RL }, async (req) => {
    const p = await db();
    const r = await p.notification.updateMany({ where: { userId: req.user.uid, readAt: null }, data: { readAt: new Date() } });
    return { ok: true, marked: r.count };
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
