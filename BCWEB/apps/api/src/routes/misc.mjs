import { z } from 'zod';
import { db, requireRole, requireCap, hasCap, optionalAuth, slugify, logAudit, notify, clearAccountLockCache, clearUserCache, CAPABILITIES, NOTIF_CATEGORIES } from '../lib/lib.mjs';
import { suspendOwned, restoreOwned, cancelSubscriptions } from './closure.mjs';
import { sendMail, mailShell, emailEnabled, escapeHtml, mdToEmailHtml } from '../lib/mail.mjs';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { exportUser } from '../lib/user-export.mjs';
import { buildErasePlan, eraseUser } from '../lib/user-erase.mjs';
import { verifyTotp } from '../lib/totp.mjs';
// Same one-line helper the auth routes use for reset tokens: the token is mailed, only
// its hash is stored, so the database never holds anything that grants access.
const sha256 = (x) => crypto.createHash('sha256').update(x).digest('hex');

const SITE_URL = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');
// Staff seniority for moderation: an actor can only moderate a strictly lower rank.
const MOD_RANK = { USER: 0, MOD: 1, ADMIN: 2, SUPERADMIN: 3 };
import { prefixUsage } from '../lib/storage.mjs';
import { capacityStatus, realDiskStats, stripe } from './hosting.mjs';
import { powVerify } from './auth.mjs';
import { FILES_BACKUP_ROOT, DB_BACKUP_ROOT, repoSizeBytes } from '../lib/gitbackup.mjs';
import { userBcId, itemFingerprint, repoFingerprint, loadOwnerIdentities, looksLikeBcId, findUserIdByBcId } from '../lib/repofingerprint.mjs';
import { telemetryDb } from './server-control.mjs';
import { issueSanction, splitSubscriptionsByTerm, cancelSubscriptionList } from '../lib/sanctions.mjs';

// The real client IP as observed by our trusted proxy (Caddy appends it last).
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip;
}

const GiB = 1024 ** 3;

// Forward a contact message to Discord if DISCORD_CONTACT_WEBHOOK is set. The future
// Discord bot can also read these from the DB; the webhook is the immediate path.
async function forwardContactToDiscord(msg) {
  const url = process.env.DISCORD_CONTACT_WEBHOOK;
  if (!url) return;
  await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [{
      title: 'New contact message', color: 0xf59e0b,
      fields: [
        { name: 'From', value: `${msg.name} (${msg.email})`.slice(0, 256) },
        { name: 'Message', value: msg.body.slice(0, 1000) },
      ],
      timestamp: new Date().toISOString(),
    }] }),
  });
}

// Public homepage counters — real DB counts, cached 60s so the landing page
// can't hammer Postgres. Zeros are returned as-is (the client hides them).
let _stats = null;
// Everything currently waiting on a human, in one place.
//
// Each queue is gated on the capability that lets you ACT on it — a moderator who cannot
// answer contact mail is not shown a contact backlog they can do nothing about, and the
// counts never become a side channel for data the caller has no access to. `hasCap` is the
// same predicate the individual routes use, so this cannot drift into being more permissive
// than the pages it links to.
//
// Cheap by construction: counts are COUNT queries, and only a small, capped slice of rows is
// fetched for the preview list. It is polled by the admin shell, so it must stay cheap.
const PENDING_QUEUES = [
  {
    // Data requests come FIRST because they are the only queue here with a legal clock on
    // it. An export or erasure request has a deadline; a pending catalogue submission does
    // not. Until this existed they arrived as free text in the contact list, indistinguishable
    // from "the download button is grey", and were found by whoever happened to read them.
    key: 'dataRequests', cap: 'manage_users', to: '/admin?s=contact',
    count: (p) => p.contactMessage.count({ where: { kind: { in: ['data_export', 'data_delete'] }, readAt: null } }),
    recent: (p) => p.contactMessage.findMany({
      where: { kind: { in: ['data_export', 'data_delete'] }, readAt: null },
      orderBy: { createdAt: 'asc' }, take: 5,
      select: { id: true, email: true, kind: true, createdAt: true },
    }).then((rows) => rows.map((r) => ({
      // OLDEST first, unlike every other queue here: with a deadline, the one that has been
      // waiting longest is the one that matters, not the one that just arrived.
      id: r.id, title: r.email, sub: r.kind === 'data_export' ? 'export request' : 'erasure request', at: r.createdAt,
    }))),
  },
  {
    key: 'submissions', cap: 'manage_catalogs', to: '/admin?s=moderation',
    count: (p) => p.catalogItem.count({ where: { status: 'PENDING' } }),
    recent: (p) => p.catalogItem.findMany({
      where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 5,
      select: { id: true, name: true, kind: true, createdAt: true },
    }).then((rows) => rows.map((r) => ({ id: r.id, title: r.name, sub: r.kind, at: r.createdAt }))),
  },
  {
    key: 'reports', cap: 'manage_reports', to: '/admin?s=reports',
    count: (p) => p.report.count({ where: { status: 'open' } }),
    recent: (p) => p.report.findMany({
      where: { status: 'open' }, orderBy: { createdAt: 'desc' }, take: 5,
      select: { id: true, targetType: true, reason: true, createdAt: true },
    }).then((rows) => rows.map((r) => ({ id: r.id, title: r.reason || r.targetType, sub: r.targetType, at: r.createdAt }))),
  },
  {
    key: 'contact', cap: 'manage_users', to: '/admin?s=messages',
    count: (p) => p.contactMessage.count({ where: { status: 'new' } }),
    recent: (p) => p.contactMessage.findMany({
      where: { status: 'new' }, orderBy: { createdAt: 'desc' }, take: 5,
      select: { id: true, name: true, email: true, body: true, createdAt: true },
    }).then((rows) => rows.map((r) => ({ id: r.id, title: r.name || r.email, sub: String(r.body || '').slice(0, 90), at: r.createdAt }))),
  },
  {
    // staffUnread is the model's own "a user wrote and nobody has read it" flag — a far
    // better signal than a status, which stays 'open' long after staff have replied.
    key: 'myo', cap: 'manage_myo', to: '/admin?s=myo',
    count: (p) => p.myoRequest.count({ where: { staffUnread: true, status: { notIn: ['cancelled', 'closed'] } } }),
    recent: (p) => p.myoRequest.findMany({
      where: { staffUnread: true, status: { notIn: ['cancelled', 'closed'] } },
      orderBy: { lastActivityAt: 'desc' }, take: 5,
      select: { id: true, name: true, status: true, lastActivityAt: true },
    }).then((rows) => rows.map((r) => ({ id: r.id, title: r.name, sub: r.status, at: r.lastActivityAt }))),
  },
  {
    // A contested sanction is somebody asking to be heard, and the answer is owed. It sat
    // nowhere until now: the sanction screen had to be opened to discover one existed.
    key: 'contests', cap: 'manage_users', to: '/admin?s=sanctions',
    count: (p) => p.sanction.count({ where: { contestedAt: { not: null }, contestOutcome: null } }),
    recent: (p) => p.sanction.findMany({
      where: { contestedAt: { not: null }, contestOutcome: null }, orderBy: { contestedAt: 'desc' }, take: 5,
      select: { id: true, code: true, kind: true, contestedAt: true },
    }).then((rows) => rows.map((r) => ({ id: r.id, title: `${r.code} — contested`, sub: r.kind, at: r.contestedAt }))),
  },
  {
    // Not a human queue but the same question — "is something waiting for me?" — and the
    // one nobody was being told about: a server alert only existed inside the perf tab, so
    // you found it by opening the tab you had no reason to open.
    //
    // `manage_server` is deliberately NOT in CAPABILITIES: no bundle can grant it, so hasCap
    // passes for ADMIN/SUPERADMIN only — the same audience as requireRole('ADMIN') on the
    // perf routes it links to.
    key: 'alerts', cap: 'manage_server', to: '/admin?s=serverperf',
    // Marking an alert handled HERE acknowledges the alert itself, rather than writing a
    // dismissal beside it. The two lists are one piece of work: without this, "mark as
    // handled" in the digest hid the row and left the Performance badge at 6, so the button
    // appeared to do nothing and staff learned to ignore it. Acking is what "handled" means
    // for an alert — unlike a report, there is no further action the word could refer to.
    handle: (p, id, uid) => p.serverAlertLog.updateMany({ where: { id, ackAt: null }, data: { ackAt: new Date(), ackById: uid } }),
    unhandle: (p, id) => p.serverAlertLog.updateMany({ where: { id }, data: { ackAt: null, ackById: null } }),
    count: (p) => p.serverAlertLog.count({ where: { ackAt: null } }),
    recent: (p) => p.serverAlertLog.findMany({
      where: { ackAt: null }, orderBy: { createdAt: 'desc' }, take: 5,
      select: { id: true, kind: true, message: true, createdAt: true },
    }).then((rows) => rows.map((r) => ({ id: r.id, title: r.message, sub: r.kind, at: r.createdAt }))),
  },
];

import { footerSchema, pageColours, THEME_KEY, HEX, THEME_DEFAULTS } from '../lib/config-schemas.mjs';
export { footerSchema, footSocial, pageColours } from '../lib/config-schemas.mjs';

export default async function miscRoutes(app) {
  // Public: every visitor reads this to paint the site. Cheap and cacheable.
  app.get('/theme', async (req, reply) => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: THEME_KEY } });
    reply.header('Cache-Control', 'public, max-age=60');
    return { theme: { ...THEME_DEFAULTS, ...(row?.value || {}) } };
  });

  // SUPERADMIN only. This changes what every visitor sees, which is a different class of
  // action from the per-project settings an ADMIN manages — hence the higher bar.
  app.put('/admin/theme', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const b = z.object({
      accent: z.string().regex(HEX).optional(),
      accent2: z.string().regex(HEX).optional(),
      mode: z.enum(['light', 'dark']).optional(),
      preset: z.string().max(60).optional(),
      light: pageColours,
      dark: pageColours,
      shared: pageColours,
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: THEME_KEY } });
    const value = { ...THEME_DEFAULTS, ...(row?.value || {}), ...b.data };
    await p.adminSetting.upsert({ where: { key: THEME_KEY }, create: { key: THEME_KEY, value }, update: { value } });
    await logAudit(p, req.user.uid, 'site.theme', `accent=${value.accent} accent2=${value.accent2} mode=${value.mode} preset=${value.preset || '-'} pages=${value.light || value.dark ? 'custom' : 'default'}`);
    return { ok: true, theme: value };
  });

  // What is waiting on staff right now. Drives the tab badges and the "Needs attention"
  // section. MOD is the floor; each queue is then filtered by capability.
  app.get('/admin/pending', { preHandler: requireCap('manage_users', 'MOD', 'ADMIN', 'SUPERADMIN') }, async (req) => {
    const p = await db();
    const allowed = PENDING_QUEUES.filter((q) => hasCap(req.user, q.cap));
    const counts = {};
    const results = await Promise.all(allowed.map(async (q) => {
      // One failing queue must not blank the whole panel — a null count reads as "unknown"
      // in the UI rather than as a reassuring zero.
      try { return { key: q.key, to: q.to, n: await q.count(p), rows: await q.recent(p) }; }
      catch { return { key: q.key, to: q.to, n: null, rows: [] }; }
    }));
    const items = [];
    for (const r of results) {
      counts[r.key] = r.n;
      for (const row of r.rows) items.push({ ...row, queue: r.key, to: r.to });
    }
    // Rows somebody already dealt with drop out of the LIST. The counts above are untouched:
    // the work still exists, and a count that quietly followed this list would stop being the
    // number staff trust.
    const dismissed = await p.pendingDismissal.findMany({
      where: { OR: items.map((it) => ({ queue: it.queue, itemId: String(it.id) })) },
      select: { queue: true, itemId: true, mode: true },
    }).catch(() => []);
    // A queue that owns a `handle` resolves in its own model, so a PendingDismissal for it
    // is stale by construction — and stale in the worst direction: it would hide the row
    // from this list while the count, which reads the model, still includes it. The badge
    // would say 1 and the list would show nothing.
    //
    // Found on a live database: 10 dismissals for the alerts queue, left from before
    // alerts resolved via ackAt. None currently hides an unacked alert, which is luck
    // rather than design. Ignoring them here fixes every install without a data migration,
    // and stays correct if one is written later.
    const ownsResolution = new Set(PENDING_QUEUES.filter((q) => q.handle).map((q) => q.key));
    const hidden = new Set(
      dismissed.filter((d) => !ownsResolution.has(d.queue)).map((d) => `${d.queue}::${d.itemId}`),
    );
    const visible = items.filter((it) => !hidden.has(`${it.queue}::${it.id}`));
    visible.sort((a, b) => new Date(b.at) - new Date(a.at));
    // `queues` carries the destination alongside the count, so a caller outside the admin
    // dashboard (the notification centre) can link to the right tab without re-deriving the
    // mapping — that duplication is how the topbar preview drifted from the real topbar.
    const queues = results.map((r) => ({ key: r.key, to: r.to, n: r.n }));
    return { counts, queues, items: visible.slice(0, 12), dismissed: hidden.size, total: results.reduce((a, r) => a + (r.n || 0), 0) };
  });

  // Clear a row out of the list — "handled" or "archived", which differ only in what the
  // person meant, and that is worth keeping: "I dealt with this" and "I am not going to" are
  // different admissions. Upsert, so two moderators clicking at once is not an error.
  app.post('/admin/pending/dismiss', { preHandler: requireCap('manage_users', 'MOD', 'ADMIN', 'SUPERADMIN') }, async (req, reply) => {
    const b = z.object({
      queue: z.string().min(1).max(40),
      itemId: z.string().min(1).max(80),
      mode: z.enum(['handled', 'archived']).default('handled'),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // A queue that owns a real notion of "done" resolves it there instead. Otherwise the
    // digest and the queue's own screen keep two separate opinions about the same item, and
    // the one you did not click stays stuck — which is exactly how a 6 survived being
    // handled six times.
    const q = PENDING_QUEUES.find((x) => x.key === b.data.queue);
    if (q?.handle) {
      if (!hasCap(req.user, q.cap)) return reply.code(403).send({ error: 'forbidden' });
      await q.handle(p, b.data.itemId, req.user.uid);
      return { ok: true, resolved: true };
    }
    const where = { queue_itemId: { queue: b.data.queue, itemId: b.data.itemId } };
    const data = { mode: b.data.mode, byId: req.user.uid, at: new Date() };
    await p.pendingDismissal.upsert({ where, create: { ...b.data, byId: req.user.uid }, update: data });
    return { ok: true };
  });

  // Undo. The row comes back exactly where it was, because nothing about it changed — which
  // is the whole reason this list is allowed to have a delete button at all.
  app.delete('/admin/pending/dismiss/:queue/:itemId', { preHandler: requireCap('manage_users', 'MOD', 'ADMIN', 'SUPERADMIN') }, async (req) => {
    const p = await db();
    const queue = String(req.params.queue);
    // Undo has to reach wherever the "handled" actually landed. A queue that resolves in its
    // own model left no dismissal row to delete, so undo would have reported success and
    // restored nothing — the one outcome an undo button must never produce.
    const q = PENDING_QUEUES.find((x) => x.key === queue);
    if (q?.unhandle) {
      if (!hasCap(req.user, q.cap)) return reply.code(403).send({ error: 'forbidden' });
      const n = await q.unhandle(p, String(req.params.itemId));
      return { ok: true, restored: n?.count ?? 0 };
    }
    const r = await p.pendingDismissal.deleteMany({ where: { queue, itemId: String(req.params.itemId) } });
    return { ok: true, restored: r.count };
  });

  app.get('/stats', async () => {
    if (_stats && Date.now() - _stats.at < 60_000) return _stats.data;
    const p = await db();
    const [items, dl, members, repos] = await Promise.all([
      p.catalogItem.count({ where: { status: 'PUBLISHED' } }),
      p.catalogItem.aggregate({ where: { status: 'PUBLISHED' }, _sum: { downloads: true } }),
      p.user.count(),
      p.serverRepo.count({ where: { published: true } }),
    ]);
    const data = { items, downloads: dl._sum.downloads || 0, members, repos };
    _stats = { at: Date.now(), data };
    return data;
  });

  // ── Landing reviews / testimonials (admin-curated) ──────────────────────────
  // Public feed: the enabled reviews (ordered) + whether the section is on. Each review
  // carries an EN and a FR body so the client renders the active-locale text.
  app.get('/reviews', async () => {
    const p = await db();
    const [rows, setting] = await Promise.all([
      p.review.findMany({ where: { enabled: true }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
      p.adminSetting.findUnique({ where: { key: 'reviews.enabled' } }),
    ]);
    const enabled = setting?.value?.on !== false; // default ON
    return { enabled, reviews: rows.map((r) => ({ id: r.id, author: r.author, role: r.role, body: r.body, bodyFr: r.bodyFr || r.body, rating: r.rating, avatar: r.avatar })) };
  });

  const reviewSchema = z.object({
    author: z.string().min(1).max(80), role: z.string().max(80).optional(),
    body: z.string().min(1).max(1000), bodyFr: z.string().max(1000).optional(),
    rating: z.number().int().min(1).max(5).nullish(),
    // Structured + bounded (not z.any()) — image must be a real http(s) URL, so an
    // arbitrary/`javascript:` value can't be stored and later rendered as <img src>.
    avatar: z.object({
      variant: z.string().max(20).optional(), seed: z.string().max(80).optional(),
      colors: z.array(z.string().max(24)).max(6).optional(),
      image: z.string().url().startsWith('http').max(500).optional(),
    }).nullish(),
    enabled: z.boolean().optional(), order: z.number().int().min(0).max(100000).optional(),
  });
  app.get('/admin/reviews', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const [reviews, setting] = await Promise.all([
      p.review.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
      p.adminSetting.findUnique({ where: { key: 'reviews.enabled' } }),
    ]);
    return { reviews, enabled: setting?.value?.on !== false };
  });
  app.put('/admin/reviews/settings', { preHandler: requireRole('ADMIN') }, async (req) => {
    const b = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!b.success) return { ok: false };
    const p = await db();
    await p.adminSetting.upsert({ where: { key: 'reviews.enabled' }, create: { key: 'reviews.enabled', value: { on: b.data.enabled } }, update: { value: { on: b.data.enabled } } });
    return { ok: true, enabled: b.data.enabled };
  });
  app.post('/admin/reviews', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = reviewSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const p = await db();
    const max = await p.review.aggregate({ _max: { order: true } });
    const review = await p.review.create({ data: { author: b.data.author, role: b.data.role || '', body: b.data.body, bodyFr: b.data.bodyFr || '', rating: b.data.rating ?? null, avatar: b.data.avatar ?? null, enabled: b.data.enabled ?? true, order: b.data.order ?? ((max._max.order ?? 0) + 1) } });
    return { review };
  });
  app.patch('/admin/reviews/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = reviewSchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = {};
    for (const k of ['author', 'role', 'body', 'bodyFr', 'rating', 'avatar', 'enabled', 'order']) if (b.data[k] !== undefined) data[k] = b.data[k];
    const review = await p.review.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!review) return reply.code(404).send({ error: 'not_found' });
    return { review };
  });
  app.delete('/admin/reviews/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    await p.review.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });

  // ── Admin: storage overview (real object-storage usage + pending deletions) ──
  app.get('/admin/storage', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    // Real bytes in object storage, by area (listed straight from MinIO/S3).
    const [repos, uploads, blog, wholeBucket] = await Promise.all([
      prefixUsage('hosting/'), // hosted Server-Repo files
      prefixUsage('uploads/'), // catalog payloads (apps / plugins / themes)
      prefixUsage('blog/'),    // blog cover images & media
      prefixUsage(''),         // every object in the bucket, regardless of prefix —
                                // diffed against the three known areas below to
                                // surface anything unaccounted for (orphaned keys,
                                // a future feature writing under a new prefix, etc.)
                                // instead of only ever showing what we already expect.
    ]);
    const knownBytes = repos.bytes + uploads.bytes + blog.bytes;
    const knownCount = repos.count + uploads.count + blog.count;
    const other = { bytes: Math.max(0, wholeBucket.bytes - knownBytes), count: Math.max(0, wholeBucket.count - knownCount) };
    // DB-side facts.
    const [hostedAgg, hostedCount, itemsByKind, dueItems, dueRepos, topRepos, promoCount, messageCount, showcaseCount, analyticsCount, cap] = await Promise.all([
      p.serverRepo.aggregate({ where: { hosted: true }, _sum: { storageQuotaBytes: true, storageUsedBytes: true } }),
      p.serverRepo.count({ where: { hosted: true } }),
      p.catalogItem.groupBy({ by: ['kind'], _count: { kind: true } }),
      p.catalogItem.findMany({ where: { deleteAt: { not: null } }, select: { id: true, name: true, kind: true, deleteAt: true }, orderBy: { deleteAt: 'asc' }, take: 100 }),
      p.serverRepo.findMany({ where: { deleteAt: { not: null } }, select: { id: true, name: true, deleteAt: true, owner: { select: { displayName: true } } }, orderBy: { deleteAt: 'asc' }, take: 100 }),
      p.serverRepo.findMany({ where: { hosted: true }, orderBy: { storageUsedBytes: 'desc' }, take: 500, select: { id: true, name: true, storageUsedBytes: true, storageQuotaBytes: true, owner: { select: { displayName: true } } } }),
      p.promoCode.count(),
      p.contactMessage.count(),
      p.showcaseProject.count(),
      p.analyticsEvent.count(),
      capacityStatus(p),
    ]);
    // The database's total real on-disk footprint — every table at once (users,
    // submissions, comments, contact messages, audit/login logs, metric history,
    // etc.), not just the one table we happen to break out above. This is the
    // single number that answers "is anything OTHER than object storage eating
    // disk space" without needing a bespoke line item per model.
    const dbSizeRows = await p.$queryRaw`SELECT pg_database_size(current_database())::bigint AS bytes`.catch(() => [{ bytes: null }]);
    const dbSizeBytes = dbSizeRows?.[0]?.bytes != null ? Number(dbSizeRows[0].bytes) : null;
    // Git-backed version history for file/DB edits made through Advanced server
    // management — its own real disk usage, separate from the app's own data.
    const backupLimitRow = await p.adminSetting.findUnique({ where: { key: 'backup.maxBytes' } });
    const [filesBackupBytes, dbBackupBytes] = await Promise.all([repoSizeBytes(FILES_BACKUP_ROOT), repoSizeBytes(DB_BACKUP_ROOT)]);
    // Telemetry is a SEPARATE service (possibly on another server). Get its REAL storage
    // footprint two ways, most-authoritative first, so we always have a number if it's
    // reachable at all: (1) the service's own accounting via its admin API (used_bytes +
    // configured limit — counts events AND rrweb replays, same- or cross-server); (2) a
    // direct Postgres size query as a fallback. Short timeouts keep an offline telemetry
    // from stalling this endpoint.
    let telemetryBytes = null, telemetryLimitBytes = null, telemetrySource = null;
    try {
      const base = (process.env.TELEMETRY_INTERNAL_URL || '').replace(/\/+$/, '');
      const key = process.env.TELEMETRY_ADMIN_KEY || process.env.TELEMETRY_ADMIN || '';
      if (base && key) {
        const r = await fetch(`${base}/api/admin/config`, { headers: { 'X-Admin-Key': key }, signal: AbortSignal.timeout(2500) });
        if (r.ok) {
          const j = await r.json();
          if (j.used_bytes != null) { telemetryBytes = Number(j.used_bytes); telemetrySource = 'service'; }
          const limMb = j.config?.storageLimitMb ?? j.storageLimitMb;
          if (limMb) telemetryLimitBytes = Number(limMb) * 1024 * 1024;
        }
      }
    } catch { /* service unreachable — try the DB directly below */ }
    if (telemetryBytes == null) {
      try {
        const tpool = telemetryDb();
        if (tpool) {
          const r = await Promise.race([
            tpool.query('SELECT pg_database_size(current_database())::bigint AS bytes'),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
          ]);
          telemetryBytes = Number(r.rows[0].bytes); telemetrySource = 'db';
        }
      } catch { telemetryBytes = null; }
    }
    // ── Storage tiers & where each one physically lives ──────────────────────────
    // Answers "what if a backend is on another server (tier service / a second VPS)?".
    // Object storage (S3/MinIO/R2), the app DB and BMM telemetry can each sit on a
    // different host. We label every tier local-vs-remote from its configured endpoint,
    // and sum a GRAND TOTAL across all measurable tiers — so the headline reflects ALL
    // stored bytes, not just the object bucket, and so "Total capacity" (which meters
    // THIS host's disk) is never mistaken for bytes that live elsewhere.
    const hostOf = (u) => { try { return new URL(u).hostname || null; } catch { return null; } };
    const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db', 'minio', 'postgres', 'redis', 'telemetry']);
    const locOf = (h) => { if (!h) return 'unknown'; const x = String(h).toLowerCase(); return (LOCAL_HOSTS.has(x) || x.endsWith('.localhost') || x.endsWith('.local')) ? 'local' : 'remote'; };
    const s3Host = hostOf(process.env.S3_ENDPOINT || 'http://minio:9000');
    const dbHost = hostOf(process.env.DATABASE_URL || '') || process.env.DB_HOST || 'db';
    const teleHost = hostOf(process.env.TELEMETRY_INTERNAL_URL || process.env.TELEMETRY_DATABASE_URL || '') || null;
    const backupsBytes = filesBackupBytes + dbBackupBytes;
    const tiers = [
      { key: 'object', label: 'Object storage (S3/MinIO)', bytes: wholeBucket.bytes, count: wholeBucket.count, host: s3Host, location: locOf(s3Host), available: true },
      { key: 'database', label: 'Database (Postgres)', bytes: dbSizeBytes, host: dbHost, location: locOf(dbHost), available: dbSizeBytes != null },
      { key: 'backups', label: 'Server backups (app disk)', bytes: backupsBytes, host: null, location: 'local', available: true },
      { key: 'telemetry', label: 'BMM telemetry (separate service)', bytes: telemetryBytes, host: teleHost, location: teleHost ? locOf(teleHost) : 'external', available: telemetryBytes != null, source: telemetrySource },
    ];
    const grandTotalBytes = tiers.reduce((a, x) => a + (Number.isFinite(x.bytes) ? x.bytes : 0), 0);
    const remoteTiers = tiers.some((x) => x.location === 'remote');
    return {
      tiers, grandTotalBytes, remoteTiers,
      areas: [
        { key: 'repos', label: 'Hosted repos', prefix: 'hosting/', ...repos },
        { key: 'catalog', label: 'Catalog payloads (apps/plugins/themes)', prefix: 'uploads/', ...uploads },
        { key: 'blog', label: 'Blog, docs & page media', prefix: 'blog/', ...blog },
        // Only surfaced when non-zero — most instances will never have anything
        // here, and an always-visible empty "Other" card would just be noise.
        ...(other.bytes > 0 ? [{ key: 'other', label: 'Other / unaccounted (object storage)', prefix: '(bucket-wide, minus known prefixes)', ...other }] : []),
      ],
      totals: { bytes: wholeBucket.bytes, count: wholeBucket.count },
      dbSizeBytes,
      db: {
        hostedRepos: hostedCount,
        repoAllocatedBytes: Number(hostedAgg._sum.storageQuotaBytes || 0n),
        repoUsedBytes: Number(hostedAgg._sum.storageUsedBytes || 0n),
        itemsByKind: Object.fromEntries(itemsByKind.map((r) => [r.kind, r._count.kind])),
      },
      topRepos: topRepos.map((r) => ({ id: r.id, name: r.name, owner: r.owner?.displayName, used: Number(r.storageUsedBytes), quota: Number(r.storageQuotaBytes) })),
      capacity: cap, // { totalGB, reservedGB, usableGB, allocatedGB, hostingAllocatedGB, submissionsPublishedGB, freeGB, tempMarginGB, tempUsedGB, diskTotalGB, diskFreeGB }
      // Full ledger — every category that draws on the machine's real storage,
      // each with its own allocated/used footprint, so "where did the space go"
      // is always answerable from real numbers (never invented placeholders).
      ledger: [
        { key: 'hosting', label: 'Server-Repo hosting', usedBytes: repos.bytes, allocatedBytes: Number(hostedAgg._sum.storageQuotaBytes || 0n), count: hostedCount },
        { key: 'submissionsPending', label: 'Pending submissions (temp margin)', usedBytes: cap.tempUsedGB * GiB, allocatedBytes: cap.tempMarginGB * GiB, count: null },
        { key: 'submissionsPublished', label: 'Approved submissions (permanent)', usedBytes: cap.submissionsPublishedGB * GiB, allocatedBytes: null, count: null },
        { key: 'blog', label: 'Blog, docs & page media', usedBytes: blog.bytes, allocatedBytes: null, count: blog.count, note: 'Blog covers, docs images and project-page media (shared blog/ prefix).' },
        { key: 'otherProjects', label: 'Other projects (showcase)', usedBytes: 0, allocatedBytes: null, count: showcaseCount, note: 'Media referenced by URL, not uploaded here.' },
        // The DB's own on-disk size, whole — every table at once (users, catalog
        // rows, submissions/comments, contact messages, login/audit logs, metric
        // history, analytics events, ...). Supersedes a single-table estimate:
        // it's the actual answer to "besides object storage, what else is using
        // real disk" without needing one line item per Prisma model.
        { key: 'database', label: 'Database (all tables — users, content, logs, metrics, analytics)', usedBytes: dbSizeBytes, allocatedBytes: null, count: null, note: `${analyticsCount} analytics events, ${promoCount} promo codes, ${messageCount} contact messages among them.` },
        { key: 'backups', label: 'Server backups (cron — git file & DB edit history)', usedBytes: filesBackupBytes + dbBackupBytes, allocatedBytes: backupLimitRow?.value?.maxBytes ?? null, count: null, note: `${(filesBackupBytes / 1024 / 1024).toFixed(1)} MB file history, ${(dbBackupBytes / 1024 / 1024).toFixed(1)} MB DB row history. Limit configured from Advanced server management.` },
        { key: 'telemetry', label: 'BMM telemetry (separate service)', usedBytes: telemetryBytes, allocatedBytes: telemetryLimitBytes, count: null,
          note: telemetryBytes != null
            ? (telemetrySource === 'service' ? 'Reported by the telemetry service — events + rrweb replays (works even on another server).' : 'Telemetry Postgres on-disk size (service admin API unreachable, DB reached directly).')
            : 'Telemetry service offline or not wired up — size unavailable. Set TELEMETRY_INTERNAL_URL + TELEMETRY_ADMIN_KEY (or TELEMETRY_DATABASE_URL).' },
        ...(other.bytes > 0 ? [{ key: 'other', label: 'Other / unaccounted (object storage)', usedBytes: other.bytes, allocatedBytes: null, count: other.count, note: 'Objects in the bucket outside the known hosting/uploads/blog prefixes.' }] : []),
        { key: 'margin', label: 'Reserved free margin', usedBytes: 0, allocatedBytes: cap.reservedGB * GiB, count: null },
      ],
      pending: {
        items: dueItems.map((i) => ({ id: i.id, name: i.name, kind: i.kind, deleteAt: i.deleteAt })),
        repos: dueRepos.map((r) => ({ id: r.id, name: r.name, owner: r.owner?.displayName, deleteAt: r.deleteAt })),
      },
      // Telemetry (rrweb replays) is stored by the separate telemetry service/DB.
      telemetryExternal: true,
    };
  });

  // ── Notifications ──
  // What this account wants to hear about, and what it has muted.
  //
  // Returns the whole catalogue rather than only the stored overrides, so the screen does not
  // have to keep its own copy of the category list — one of the two would drift, and it
  // would be the one nobody edits.
  app.get('/me/notification-prefs', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid }, select: { notifPrefs: true } });
    const prefs = u?.notifPrefs || {};
    return {
      categories: Object.entries(NOTIF_CATEGORIES).map(([key, def]) => ({
        key, label: def.label, locked: !!def.locked,
        enabled: def.locked ? true : prefs[key] !== false,
      })),
    };
  });

  app.put('/me/notification-prefs', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ category: z.string().min(1).max(40), enabled: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const def = NOTIF_CATEGORIES[b.data.category];
    if (!def) return reply.code(404).send({ error: 'unknown_category' });
    // A locked category refuses rather than pretending to save: a switch that silently does
    // nothing is worse than one that is not there.
    if (def.locked) return reply.code(409).send({ error: 'category_locked', detail: 'Account and security notices cannot be switched off.' });
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid }, select: { notifPrefs: true } });
    const prefs = { ...(u?.notifPrefs || {}) };
    if (b.data.enabled) delete prefs[b.data.category]; else prefs[b.data.category] = false;
    await p.user.update({ where: { id: req.user.uid }, data: { notifPrefs: prefs } });
    return { ok: true, category: b.data.category, enabled: b.data.enabled };
  });

  app.get('/me/notifications', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    return { notifications: await p.notification.findMany({ where: { userId: req.user.uid }, orderBy: { createdAt: 'desc' }, take: 100 }) };
  });
  app.post('/me/notifications/:id/read', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    await p.notification.updateMany({ where: { id: req.params.id, userId: req.user.uid }, data: { readAt: new Date() } });
    return { ok: true };
  });
  app.post('/me/notifications/read-all', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    await p.notification.updateMany({ where: { userId: req.user.uid, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });
  app.delete('/me/notifications/:id', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    await p.notification.deleteMany({ where: { id: req.params.id, userId: req.user.uid } });
    return { ok: true };
  });
  // Real bulk delete (the notification bell's own "Clear" is menu-only/local —
  // this is the actual "delete everything" action, from the dashboard).
  app.delete('/me/notifications', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const { count } = await p.notification.deleteMany({ where: { userId: req.user.uid } });
    return { ok: true, deleted: count };
  });

  // (Blog routes live in routes/blog.mjs.)

  // (Server-repo routes live in routes/repos.mjs.)

  // ── SEO: dynamic sitemap (incl. Other Projects + blog posts) + robots.txt ──
  app.get('/sitemap.xml', async (req, reply) => {
    const p = await db();
    const site = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
    const staticRoutes = ['/', '/catalog', '/blog', '/repos', '/hosting', '/projects', '/contact', '/legal', '/legal/about', '/legal/privacy', '/legal/terms', '/legal/cookies', '/legal/refunds', '/p/bmm', '/p/bsm', '/p/installer'];
    const [showcase, posts] = await Promise.all([
      p.showcaseProject.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }),
      p.blogPost.findMany({ where: { status: 'PUBLISHED' }, select: { slug: true, updatedAt: true } }),
    ]);
    const urls = [
      ...staticRoutes.map((r) => ({ loc: site + r })),
      ...showcase.map((s) => ({ loc: `${site}/project/${s.slug}`, lastmod: s.updatedAt })),
      ...posts.map((b) => ({ loc: `${site}/blog/${b.slug}`, lastmod: b.updatedAt })),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`;
    return reply.header('Content-Type', 'application/xml').header('Cache-Control', 'public, max-age=3600').send(xml);
  });
  app.get('/robots.txt', async (req, reply) => {
    const site = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
    return reply.header('Content-Type', 'text/plain').send(`User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /admin\nDisallow: /profile\nDisallow: /auth\nSitemap: ${site}/sitemap.xml\n`);
  });

  // ── Contact form → stored for Admin + optional Discord webhook ──
  // PoW alone isn't a rate limit (a real client can solve it in ~1s and keep
  // posting) — cap it too, so spam still costs an attacker meaningfully more
  // than "run the page's own JS in a loop". On top of the burst cap below, a
  // daily quota applies: 3/day by IP for anonymous senders, 5/day by account
  // for logged-in senders (checked instead of by IP once linked, since a
  // logged-in sender's IP may be shared/dynamic).
  // The kinds a sender can pick. data_export and data_delete are the reason this exists:
  // they carry a legal deadline, and a deadline that is not countable is one nobody counts.
  const CONTACT_KINDS = ['other', 'data_export', 'data_delete', 'bug', 'billing', 'appeal'];

  app.post('/contact', { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } }, preHandler: optionalAuth() }, async (req, reply) => {
    if (!powVerify(req.body?.pow)) return reply.code(400).send({ error: 'pow_required' });
    const b = z.object({
      name: z.string().min(1).max(100),
      email: z.string().email().max(254),
      body: z.string().min(5).max(2000),
      // Sender-declared and validated against a closed list, so a client cannot invent a
      // kind that no queue counts and no staff member ever sees.
      kind: z.enum(CONTACT_KINDS).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const ip = String(clientIp(req) || '').slice(0, 64);
    const userId = req.user?.uid || null;
    const since = new Date(Date.now() - 864e5);
    const dailyCount = await p.contactMessage.count({ where: { createdAt: { gte: since }, ...(userId ? { userId } : { ip, userId: null }) } });
    if (dailyCount >= (userId ? 5 : 3)) return reply.code(429).send({ error: 'daily_limit' });
    const msg = await p.contactMessage.create({ data: { ...b.data, kind: b.data.kind || 'other', ip, userId } });
    forwardContactToDiscord(msg).catch(() => {}); // best-effort
    return reply.code(201).send({ ok: true });
  });

  app.get('/admin/contact', { preHandler: requireRole('MOD', 'ADMIN') }, async () => {
    const p = await db();
    const messages = await p.contactMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { id: true, displayName: true } } } });
    return { messages, unread: messages.filter((m) => !m.readAt).length };
  });
  app.post('/admin/contact/:id/read', { preHandler: requireRole('MOD', 'ADMIN') }, async (req) => {
    const p = await db();
    await p.contactMessage.updateMany({ where: { id: req.params.id }, data: { status: 'read', readAt: new Date() } });
    return { ok: true };
  });
  app.delete('/admin/contact/:id', { preHandler: requireRole('MOD', 'ADMIN') }, async (req) => {
    const p = await db();
    await p.contactMessage.deleteMany({ where: { id: req.params.id } });
    return { ok: true };
  });

  // ── Any logged-in user: minimal account search, for adding a BetterCommunity or
  // Discord account to a repo's own whitelist/ban list (SettingsTab). Deliberately
  // returns far less than /admin/users (no email/role) since regular repo owners,
  // not just staff, can call this. ──
  app.get('/accounts/search', { preHandler: requireRole() }, async (req) => {
    const q = String(req.query?.q || '').trim();
    if (q.length < 2) return { accounts: [] };
    const p = await db();
    const byCreator = await p.creatorLink.findMany({ where: { creatorId: q }, select: { userId: true } });
    const byDiscord = await p.discordLink.findMany({ where: { OR: [{ discordId: q }, { username: { contains: q, mode: 'insensitive' } }] }, select: { userId: true } });
    const rows = await p.user.findMany({
      where: { OR: [
        { id: q },
        { id: { in: [...byCreator.map((c) => c.userId), ...byDiscord.map((d) => d.userId)] } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ] },
      take: 10,
      select: { id: true, displayName: true, avatar: true, discordLinks: { select: { discordId: true, username: true }, take: 1 } },
    });
    return { accounts: rows.map((u) => ({ id: u.id, displayName: u.displayName, avatar: u.avatar, discord: u.discordLinks[0] ? { id: u.discordLinks[0].discordId, username: u.discordLinks[0].username } : null })) };
  });

  // ── Admin: user search + detail ──
  // Search by exact user id, exact creator id, or a displayName/email substring.
  app.get('/admin/users', { preHandler: requireCap('manage_users', 'MOD') }, async (req) => {
    const p = await db();
    const q = String(req.query?.q || '').trim();
    const take = Math.min(Number(req.query?.take) || 30, 100);
    const skip = Math.max(0, Number(req.query?.skip) || 0);
    let where = {};
    if (q) {
      const byCreator = await p.creatorLink.findMany({ where: { creatorId: q }, select: { userId: true } });
      // Also match a Discord id or username, so a linked account is findable either way.
      const byDiscord = await p.discordLink.findMany({ where: { OR: [{ discordId: q }, { username: { contains: q, mode: 'insensitive' } }] }, select: { userId: true } });
      // Also match a pasted Unique BC id ("BC-XXXX-XXXX") by recomputing it over accounts.
      const bcUserId = looksLikeBcId(q) ? await findUserIdByBcId(p, q) : null;
      where = { OR: [
        { id: q },
        { id: { in: [...byCreator.map((c) => c.userId), ...byDiscord.map((d) => d.userId), ...(bcUserId ? [bcUserId] : [])] } },
        { displayName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ] };
    }
    // No query → list everyone (newest first), paginated with a "load more" cursor.
    const rows = await p.user.findMany({
      where, take: take + 1, skip, orderBy: { createdAt: 'desc' },
      select: { id: true, displayName: true, email: true, role: true, avatar: true, createdAt: true,
        totpEnabled: true, canControlServer: true, canViewTelemetry: true, permissions: true, customRoleIds: true,
        status: true, moderationUntil: true, moderationReason: true,
        creatorLinks: { select: { creatorId: true } }, discordLinks: { select: { discordId: true, username: true } },
        _count: { select: { serverRepos: true, items: true } } },
    });
    const hasMore = rows.length > take;
    // Surface the CURRENT effective moderation state — a temp lock whose date has
    // passed reads as active (it auto-lifts at next login) so the admin isn't misled.
    const effStatus = (u) => (u.status && u.status !== 'active' && (!u.moderationUntil || new Date(u.moderationUntil) > new Date())) ? u.status : 'active';
    return {
      hasMore,
      users: rows.slice(0, take).map((u) => ({
        id: u.id, bcId: userBcId(u.id), displayName: u.displayName, email: u.email, role: u.role, avatar: u.avatar, createdAt: u.createdAt,
        totpEnabled: u.totpEnabled, canControlServer: u.canControlServer, canViewTelemetry: u.canViewTelemetry, permissions: u.permissions || [],
        status: effStatus(u), moderationUntil: u.moderationUntil, moderationReason: u.moderationReason,
        creatorIds: u.creatorLinks.map((c) => c.creatorId),
        discord: u.discordLinks[0] ? { id: u.discordLinks[0].discordId, username: u.discordLinks[0].username } : null,
        repoCount: u._count.serverRepos, itemCount: u._count.items,
      })),
    };
  });

  // Sign one of a user's devices out. SUPERADMIN only — the same tier that may SEE the
  // list, since being able to evict someone from their own account is at least as strong
  // as reading where they signed in from.
  //
  // Scoped by userId as well as session id, so a mistyped id can only ever reach the user
  // being looked at. updateMany makes it idempotent, and the revocation takes effect on
  // that device's next request (every auth guard checks it), not whenever its token lapses.
  app.delete('/admin/users/:id/sessions/:sid', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const p = await db();
    const r = await p.session.updateMany({
      where: { id: String(req.params.sid || ''), userId: String(req.params.id || ''), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!r.count) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // ── Admin mail ───────────────────────────────────────────────────────────────
  // One place to reach users by email. It exists because the alternative — exporting
  // addresses and pasting them into a mail client — is how people end up putting a
  // customer list in the To: field.
  //
  // Audiences are QUERIES, not stored lists, so "everyone on a hosting plan" is right at
  // the moment you press send rather than whenever the list was last exported.
  const audienceWhere = async (p, aud, planId) => {
    if (aud === 'all') return {};
    if (aud === 'hosting') {
      // Anyone with a live subscription. Through the relation rather than a snapshot, so
      // a lapsed customer is not mailed about a price they no longer pay.
      const subs = await p.subscription.findMany({
        where: { status: 'active', ...(planId ? { planId } : {}) },
        select: { userId: true },
      });
      return { id: { in: [...new Set(subs.map((x) => x.userId))] } };
    }
    if (aud === 'verified') return { emailVerified: true };
    // Anyone who has EVER paid, subscribed or not. The audience for "we are changing how
    // billing works" — which reaches past customers that `hosting` deliberately excludes.
    if (aud === 'paid') {
      const rows = await p.payment.findMany({ where: { status: 'paid' }, select: { userId: true } });
      return { id: { in: [...new Set(rows.map((x) => x.userId))] } };
    }
    // Lapsed: they paid once and have no live subscription now. The one audience you
    // actually want for a win-back, and the one a naive "all customers" query gets wrong.
    if (aud === 'lapsed') {
      const [paid, live] = await Promise.all([
        p.payment.findMany({ where: { status: 'paid' }, select: { userId: true } }),
        p.subscription.findMany({ where: { status: 'active' }, select: { userId: true } }),
      ]);
      const liveIds = new Set(live.map((x) => x.userId));
      return { id: { in: [...new Set(paid.map((x) => x.userId))].filter((id) => !liveIds.has(id)) } };
    }
    // People hosting something for free — the audience for a capacity or policy change
    // that only touches the free tier.
    if (aud === 'freehost') {
      const repos = await p.serverRepo.findMany({ where: { hosted: true, freePlan: true }, select: { ownerId: true } });
      return { id: { in: [...new Set(repos.map((x) => x.ownerId))] } };
    }
    // Anyone who has published something. Reaches creators without reaching every
    // account that ever signed up to download.
    if (aud === 'creators') {
      const [items, repos] = await Promise.all([
        p.catalogItem.findMany({ where: { status: 'PUBLISHED' }, select: { ownerId: true } }),
        p.serverRepo.findMany({ select: { ownerId: true } }),
      ]);
      return { id: { in: [...new Set([...items.map((x) => x.ownerId), ...repos.map((x) => x.ownerId)])] } };
    }
    if (aud === 'staff') return { role: { in: ['MOD', 'ADMIN', 'SUPERADMIN'] } };
    return null;
  };

  app.get('/admin/mail/audience', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    const where = await audienceWhere(p, String(req.query?.audience || 'all'), req.query?.planId || null);
    if (!where) return reply.code(400).send({ error: 'invalid_audience' });
    // A COUNT before sending, because the number is the last chance to notice that
    // "everyone" meant something larger than intended.
    return { count: await p.user.count({ where }) };
  });

  // Exactly what the send will produce, without sending it.
  //
  // Built by calling the same three functions in the same order as the send below, on
  // purpose: a preview assembled by its own copy of the template is a preview of a
  // different email, and the first time they drift is the first time somebody trusts it.
  app.post('/admin/mail/preview', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      subject: z.string().max(200).default(''),
      body: z.string().max(20000).default(''),
      // Pin the preview's palette regardless of the admin's own theme — an email is read
      // in the recipient's client, not in this dashboard.
      scheme: z.enum(['auto', 'light', 'dark']).default('auto'),
      cta: z.object({ label: z.string().max(60), url: z.string().max(500) }).nullable().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const preheader = String(b.data.body).replace(/[#>*_`|\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    const cta = b.data.cta?.label && /^https?:\/\//i.test(b.data.cta.url || '') ? b.data.cta : undefined;
    return {
      html: mailShell(b.data.subject || '(no subject)', mdToEmailHtml(b.data.body), cta, { preheader, scheme: b.data.scheme }),
      // Shown beside the preview: this is the line an inbox displays next to the subject,
      // and it is derived rather than typed, so it is worth seeing before sending.
      preheader,
    };
  });

  app.post('/admin/mail/send', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      audience: z.enum(['all', 'hosting', 'verified', 'paid', 'lapsed', 'freehost', 'creators', 'staff', 'user']),
      planId: z.string().optional(),
      userId: z.string().optional(),
      subject: z.string().min(1).max(200),
      body: z.string().min(1).max(20000),   // markdown
      testOnly: z.boolean().default(false), // send to the sender alone
      // An optional button. Rendered by the shell exactly as the system emails render
      // theirs, with the "or paste this link" fallback for clients that strip buttons.
      cta: z.object({ label: z.string().min(1).max(60), url: z.string().max(500) }).nullable().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!emailEnabled()) return reply.code(503).send({ error: 'email_disabled' });
    const p = await db();

    let recipients;
    if (b.data.testOnly) {
      const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { email: true, displayName: true } });
      recipients = me ? [me] : [];
    } else if (b.data.audience === 'user') {
      if (!b.data.userId) return reply.code(400).send({ error: 'invalid_input' });
      const u = await p.user.findUnique({ where: { id: b.data.userId }, select: { email: true, displayName: true } });
      recipients = u ? [u] : [];
    } else {
      const where = await audienceWhere(p, b.data.audience, b.data.planId || null);
      if (!where) return reply.code(400).send({ error: 'invalid_audience' });
      recipients = await p.user.findMany({ where, select: { email: true, displayName: true } });
    }
    if (!recipients.length) return reply.code(400).send({ error: 'no_recipients' });

    // A preheader taken from the message's own opening line, so the inbox preview shows
    // what the mail says instead of whatever text the client finds first.
    const preheader = String(b.data.body).replace(/[#>*_`|\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    // http(s) only. The CTA lands in an href, and a `javascript:` there would be a stored
    // XSS aimed at every recipient at once (CWE-79/601) — the shell escapes it, but a link
    // that cannot be a web page has no business being offered as one.
    const cta = b.data.cta?.label && /^https?:\/\//i.test(b.data.cta.url || '') ? b.data.cta : undefined;
    const html = mailShell(b.data.subject, mdToEmailHtml(b.data.body), cta, { preheader });
    let sent = 0, failed = 0;
    // The first rejection, kept verbatim. Swallowing it left the admin with "the mail
    // server rejected every message" and nowhere to go — while the server was saying
    // something completely actionable, e.g.
    //   450 4.1.2 <admin@bettercommunity.local>: Recipient address rejected: Domain not found
    // which names the problem (a seeded account whose domain does not exist) in one line.
    // Safe to pass through: this endpoint is admin-only and the text is the SMTP server's
    // own response about an address the admin can already see.
    let firstError = null;
    for (const r of recipients) {
      // ONE message per address. A shared To: or Cc: would publish every customer's email
      // to every other customer, which is a data breach and not a mailing list.
      // Per-recipient try/catch, NOT one around the loop. sendMail THROWS when the SMTP
      // server rejects an address, and a single bad mailbox in a 400-person broadcast
      // would otherwise abort the run half-way — with no record of who was already
      // reached, so a retry would double-mail them.
      try {
        const ok = await sendMail({ to: r.email, subject: b.data.subject, html, text: b.data.body });
        if (ok === false) { failed++; firstError = firstError || { email: r.email, reason: 'email_disabled' }; }
        else sent++;
      } catch (e) {
        failed++;
        if (!firstError) {
          firstError = { email: r.email, reason: String(e?.message || e).split(String.fromCharCode(10))[0].slice(0, 300) };
          req.log?.warn?.({ to: r.email, err: firstError.reason }, 'mail send rejected');
        }
      }
    }
    // Every single message failed — report it as a FAILURE, not as `ok: true, sent: 0`.
    // A "sent to 0 recipients" toast reads like an empty audience, so a misconfigured SMTP
    // server would look like a successful broadcast nobody happened to be in.
    if (sent === 0 && failed > 0) return reply.code(502).send({ error: 'all_failed', failed, ...firstError });
    if (!b.data.testOnly) {
      await logAudit(p, req.user.uid, 'mail.send', `"${b.data.subject}" → ${b.data.audience} (${sent} sent, ${failed} failed)`, clientIp(req));
    }
    return { ok: true, sent, failed, total: recipients.length, ...(failed ? { firstError } : {}) };
  });

  // ── Password recovery, on the user's behalf ──────────────────────────────────
  // Sends the SAME reset link the forgot-password flow sends. Support can unblock someone
  // without ever seeing or choosing their password, which is the version of this that
  // should be reached for first.
  app.post('/admin/users/:id/password-reset', { preHandler: requireCap('manage_users') }, async (req, reply) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, displayName: true } });
    if (!u) return reply.code(404).send({ error: 'not_found' });
    const token = crypto.randomBytes(24).toString('hex');
    await p.passwordReset.create({ data: { userId: u.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600e3) } });
    const url = `${SITE_URL}/auth?reset=${token}`;   // the module const: trailing slash already stripped
    const sent = await sendMail({
      to: u.email,
      subject: 'Reset your BetterCommunity password',
      html: mailShell('Reset your password', `<p>A member of the team started a password reset for your account. The link is valid for one hour.</p><p>If you did not ask for this, you can ignore this email — your current password still works.</p>`, { label: 'Choose a new password', url }),
      text: `Reset your password: ${url}`,
    }).catch(() => false);   // an SMTP failure must not 500 away a token already minted
    await logAudit(p, req.user.uid, 'user.password_reset_sent', `for ${u.displayName} <${u.email}>`, clientIp(req));
    // The token is returned ONLY when there is no mail backend, matching the public reset
    // flow — otherwise a dev instance could never test this, and nobody would notice it
    // was broken until a real user needed it.
    return { ok: true, emailed: sent !== false, ...(sent === false ? { devUrl: url } : {}) };
  });

  // Setting a password outright is SUPERADMIN + a fresh TOTP code. It bypasses the owner
  // entirely, so it is gated harder than anything else here and always audited: knowing
  // WHO did it is the only control left once the password is known to someone else.
  app.put('/admin/users/:id/password', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const b = z.object({ password: z.string().min(8).max(200), code: z.string().default('') }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { totpEnabled: true, totpSecret: true } });
    // 2FA is REQUIRED here, not merely checked when present. An account that can silently
    // take over any other account must not be reachable by a stolen session cookie alone.
    if (!me?.totpEnabled || !me.totpSecret) return reply.code(403).send({ error: '2fa_required' });
    if (!verifyTotp(me.totpSecret, String(b.data.code).replace(/\s+/g, ''))) return reply.code(403).send({ error: 'bad_code' });

    const u = await p.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, displayName: true } });
    if (!u) return reply.code(404).send({ error: 'not_found' });
    await p.user.update({ where: { id: u.id }, data: { passwordHash: await argon2.hash(b.data.password, { type: argon2.argon2id }) } });
    // Every existing device is signed out: a password changed by someone else must not
    // leave whoever prompted it still logged in.
    await p.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await logAudit(p, req.user.uid, 'user.password_set', `for ${u.displayName} <${u.email}>`, clientIp(req));
    // The owner is TOLD. A silent password change is indistinguishable from a compromise.
    await sendMail({
      to: u.email,
      subject: 'Your BetterCommunity password was changed',
      html: mailShell('Your password was changed', '<p>An administrator set a new password on your account, and all your signed-in devices were signed out.</p><p>If you did not expect this, reply to this email immediately.</p>'),
      text: 'An administrator set a new password on your account and signed out all your devices.',
    }).catch(() => {});
    return { ok: true };
  });

  // Everything held about one person, as a file.
  //
  // ADMIN rather than MOD, and audited on every call. This is the single request on the
  // platform that returns one person's whole record in one response: a moderator needs to
  // read a case, not to take a copy of somebody's life here. The audit line is the record
  // that it happened, which is the only thing that makes the capability reviewable.
  //
  // Producing it does NOT mark the request handled. Somebody still has to look at the file
  // and send it, and a queue that empties itself when a button is pressed stops being a
  // record of what was actually delivered.
  app.get('/admin/users/:id/export', { preHandler: requireCap('manage_users', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const doc = await exportUser(p, req.params.id, Prisma.dmmf, new Date().toISOString());
    if (!doc) return reply.code(404).send({ error: 'not_found' });
    await logAudit(p, req.user.uid, 'user.data_export', `${doc.subject.email} (${Object.keys(doc.data).length} tables)`, req.ip).catch(() => {});
    // Sent as a download rather than rendered: it is a deliverable, and the filename is
    // what somebody attaches to a reply.
    reply.header('Content-Disposition', `attachment; filename="bettercommunity-data-${doc.subject.id}.json"`);
    return doc;
  });

  // What erasing this account WOULD do. There is no commit endpoint on purpose: the plan
  // currently blocks on one relation, and an irreversible deletion reachable in one click
  // from a screen full of ordinary buttons is an accident waiting for a tired afternoon.
  app.get('/admin/users/:id/erase/preview', { preHandler: requireCap('manage_users', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!u) return reply.code(404).send({ error: 'not_found' });
    // commit is not passed. The default is dry, and this route never overrides it.
    return eraseUser(p, u.id, buildErasePlan(Prisma.dmmf));
  });

  /**
   * Actually erase. The preview above had no counterpart, so an erasure could be inspected and
   * never performed — the whole GDPR path stopped one click short of doing anything.
   *
   * SUPERADMIN, not manage_users: the preview is an inspection and this is irreversible. And it
   * takes the account's own email as confirmation rather than a boolean, because a body that
   * says {confirm:true} is one copied curl away from being sent at the wrong id.
   */
  app.post('/admin/users/:id/erase', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const b = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true } });
    if (!u) return reply.code(404).send({ error: 'not_found' });
    if (u.email.toLowerCase() !== b.data.email.trim().toLowerCase()) return reply.code(409).send({ error: 'email_mismatch' });

    const plan = buildErasePlan(Prisma.dmmf);
    // Re-run dry first: `blocked` is what stops an erasure that would break referential
    // integrity, and the preview the admin looked at may be minutes old.
    const dry = await eraseUser(p, u.id, plan);
    if (dry.blocked?.length) return reply.code(409).send({ error: 'blocked', blocked: dry.blocked });

    const done = await eraseUser(p, u.id, plan, { commit: true });
    // totals.deleted / .detached — checked against the library's actual return shape rather
    // than guessed; `rows` does not exist on it.
    await logAudit(p, req.user.uid, 'user.erased',
      `${u.email} (${done.totals?.deleted ?? 0} deleted, ${done.totals?.detached ?? 0} detached)`, req.ip).catch(() => {});
    return { ok: true, ...done };
  });

  // Mail it to the ADDRESS ON THE ACCOUNT, and nowhere else.
  //
  // Not to an address in the request, and not to the address the contact message came from.
  // A subject access request is the one message where "reply to whoever asked" is the
  // vulnerability: anybody can write asking for somebody else's data, and the only address
  // we know belongs to the account is the one on it. If the person has lost access to it,
  // that is an identity problem to solve first, not a delivery option.
  app.post('/admin/users/:id/export/send', { preHandler: requireCap('manage_users', 'ADMIN') }, async (req, reply) => {
    if (!emailEnabled()) return reply.code(503).send({ error: 'email_disabled' });
    const p = await db();
    const doc = await exportUser(p, req.params.id, Prisma.dmmf, new Date().toISOString());
    if (!doc) return reply.code(404).send({ error: 'not_found' });

    const json = JSON.stringify(doc, null, 2);
    const partial = doc.couldNotRead.length;
    const body = [
      `Hello ${doc.subject.displayName || ''},`.trim(),
      '',
      'Attached is a copy of the personal data BetterCommunity holds about your account, as of the date on this message.',
      '',
      'A few things worth saying plainly:',
      '',
      '- Records where you acted on somebody else’s content appear as a reference — the date and the fact that it was you — rather than in full. Sending them whole would disclose another person’s data to you.',
      '- Credentials (your password hash, two-factor secret, any tokens) are not included. They are not what this request is for, and putting them in an e-mail would create a risk that does not currently exist.',
      '- The file lists every place we looked, not only the places that held something, so you can see the difference between "nothing" and "not checked".',
      partial
        ? `- ${partial} table(s) could not be read while producing this file. They are named inside it under couldNotRead, and we are looking at why.`
        : '',
      '',
      'If something looks wrong or missing, reply to this message and say which part.',
    ].filter((l) => l !== '').join('\n');

    await sendMail({
      to: doc.subject.email,
      subject: 'Your BetterCommunity data',
      // POSITIONAL — mailShell(title, bodyHtml, cta, opts). Called with an object, `title`
      // received the object itself and rendered as "[object Object]", and bodyHtml received
      // nothing and rendered as "undefined". The mail sent, the attachment was correct, and
      // the body said undefined: a GDPR data export that arrives looking broken.
      html: mailShell('Your data', mdToEmailHtml(body)),
      text: body,
      attachments: [{ filename: `bettercommunity-data-${doc.subject.id}.json`, content: json, contentType: 'application/json' }],
    });
    await logAudit(p, req.user.uid, 'user.data_export_sent', `${doc.subject.email} (${Math.round(json.length / 1024)} KB)`, req.ip).catch(() => {});
    return { ok: true, to: doc.subject.email, bytes: json.length, tables: Object.keys(doc.data).length, couldNotRead: doc.couldNotRead.length };
  });

  app.get('/admin/users/:id', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.params.id }, select: {
      id: true, displayName: true, email: true, role: true, permissions: true, avatar: true, bio: true, createdAt: true, stripeCustomerId: true,
      status: true, moderationUntil: true, moderationReason: true, moderatedAt: true, totpEnabled: true,
      // A pending closure changes what every other action on this screen means — banning
      // an account that is deleting itself in nine days, or chasing a payment from one, is
      // work nobody needed to do.
      closureRequestedAt: true, closureScheduledFor: true, closedAt: true, closureReason: true, closureBy: true,
      closureCancellable: true,
      serverRepos: { select: { id: true, name: true, hosted: true, status: true, listed: true, verified: true }, orderBy: { createdAt: 'desc' } },
      items: { select: { id: true, name: true, slug: true, kind: true, status: true }, orderBy: { updatedAt: 'desc' } },
      creatorLinks: { select: { creatorId: true, displayName: true, linkedAt: true, unlinkableAt: true } },
      discordLinks: { select: { discordId: true, username: true, linkedAt: true } },
      payments: { select: { id: true, kind: true, description: true, amountCents: true, currency: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 },
    } });
    if (!u) return reply.code(404).send({ error: 'not_found' });

    // API keys, SUPERADMIN only. This endpoint is reachable by a MOD, and a key list
    // is a map of what an account can be made to do — a different kind of fact from
    // the moderation history a MOD is here for. Never the `hash`: that IS the
    // credential, and a list that leaks it hands the account over rather than
    // describing it. `prefix` is enough to tell two keys apart, which is exactly why
    // it is the part stored in clear.
    let apiKeys = null;
    if (req.user?.role === 'SUPERADMIN') {
      apiKeys = await p.apiKey.findMany({
        where: { userId: u.id },
        select: { id: true, label: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
    }
    // Signed-in devices, SUPERADMIN only, for the same reason as the API keys above and
    // a sharper one: each row carries the IP a sign-in came from and the town it resolves
    // to. That is a person's whereabouts over time, which is a different kind of fact from
    // the moderation history a MOD is here to read. `null` rather than `[]` when not
    // permitted, so the UI can say "not permitted" instead of "none".
    let sessions = null;
    if (req.user?.role === 'SUPERADMIN') {
      sessions = await p.session.findMany({
        where: { userId: u.id, revokedAt: null },
        select: {
          id: true, ip: true, device: true, browser: true, os: true,
          country: true, region: true, city: true, createdAt: true, lastSeenAt: true,
        },
        orderBy: { lastSeenAt: 'desc' },
        take: 100,
      });
    }
    // The account-level Unique BC id + a per-element BC id on every repo/item, all
    // folded from the same owner identity (creator ids / Discord / Ko-fi).
    const idn = (await loadOwnerIdentities(p, [u.id])).get(u.id) || { creatorIds: [], discordIds: [], kofi: false };
    // Active Stripe subscriptions + this user's recurring monthly revenue (best-effort).
    let subscriptions = [], mrrCents = 0;
    try {
      const sk = await stripe();
      if (sk && u.stripeCustomerId) {
        const subs = await sk.subscriptions.list({ customer: u.stripeCustomerId, status: 'active', limit: 50 });
        const monthlyCents = (unit, interval, count) => { count = count || 1; unit = unit || 0; if (interval === 'year') return unit / (12 * count); if (interval === 'week') return (unit * 4.345) / count; if (interval === 'day') return (unit * 30.44) / count; return unit / count; };
        subscriptions = subs.data.map((s) => {
          const price = s.items?.data?.[0]?.price;
          const m = monthlyCents(price?.unit_amount, price?.recurring?.interval, price?.recurring?.interval_count);
          mrrCents += m;
          return { id: s.id, kind: s.metadata?.kind === 'feature' ? 'boost' : 'hosting', amountCents: price?.unit_amount ?? 0, currency: price?.currency || 'usd', interval: price?.recurring?.interval || 'month', intervalCount: price?.recurring?.interval_count || 1, mrrCents: Math.round(m), currentPeriodEnd: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null };
        });
      }
    } catch (e) { req.log?.warn?.({ err: e?.message }, 'user subs fetch failed'); }
    return { user: {
      ...u,
      bcId: userBcId(u.id),
      // null (not []) for a non-SUPERADMIN caller, so the UI can tell "you may not
      // see this" apart from "this user has no keys" — two very different answers to
      // show an administrator.
      apiKeys, sessions,
      subscriptions, mrrCents: Math.round(mrrCents),
      serverRepos: u.serverRepos.map((r) => ({ ...r, fingerprint: repoFingerprint({ repoId: r.id, ownerId: u.id, ...idn }) })),
      items: u.items.map((it) => ({ ...it, fingerprint: itemFingerprint({ itemId: it.id, ownerId: u.id, creatorIds: idn.creatorIds }) })),
    } };
  });

  // ── SUPERADMIN only: manage role assignments. A SUPERADMIN can't change their own
  // role here — self-demotion/self-modification only via another SUPERADMIN, so the
  // account can't be accidentally locked out of its own management screen. ──
  // Revoking someone else's key is a SUPERADMIN action: it takes away access, from an
  // account that is not yours, without the owner doing anything. Scoped by userId as
  // well as key id so a mistyped id cannot reach into another account, and idempotent
  // — revoking an already-revoked key changes nothing and still answers ok, because
  // the caller's intent is already satisfied.
  app.post('/admin/users/:id/api-keys/:keyId/revoke', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const p = await db();
    const r = await p.apiKey.updateMany({
      where: { id: req.params.keyId, userId: req.params.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!r.count) {
      const exists = await p.apiKey.findFirst({ where: { id: req.params.keyId, userId: req.params.id }, select: { id: true } });
      if (!exists) return reply.code(404).send({ error: 'not_found' });
    }
    return { ok: true };
  });

  app.put('/admin/users/:id/role', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const b = z.object({ role: z.enum(['USER', 'MOD', 'ADMIN', 'SUPERADMIN']) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (req.params.id === req.user.uid) return reply.code(400).send({ error: 'cannot_change_own_role' });
    const p = await db();
    const target = await p.user.findUnique({ where: { id: req.params.id } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    const user = await p.user.update({ where: { id: req.params.id }, data: { role: b.data.role }, select: { id: true, displayName: true, email: true, role: true } });
    clearUserCache(target.id); // role change takes effect within ~15s, no re-login needed
    await logAudit(p, req.user.uid, 'user.role_change', `${target.displayName} (${target.email}): ${target.role} -> ${b.data.role}`, clientIp(req));
    return { user };
  });

  // ── SUPERADMIN? no — ADMIN can grant fine-grained capabilities to any user (layered on
  // top of their role). Only real ADMIN/SUPERADMIN can grant (a granted user can't escalate
  // itself). Cleared live so the grantee sees their new access without re-login. ──
  app.put('/admin/users/:id/permissions', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ permissions: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (req.params.id === req.user.uid) return reply.code(400).send({ error: 'cannot_change_own_permissions' });
    const p = await db();
    const target = await p.user.findUnique({ where: { id: req.params.id }, select: { id: true, displayName: true, email: true } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    const perms = [...new Set(b.data.permissions)];
    await p.user.update({ where: { id: req.params.id }, data: { permissions: perms } });
    clearUserCache(target.id);
    await logAudit(p, req.user.uid, 'user.permissions', `${target.displayName} (${target.email}): [${perms.join(', ')}]`, clientIp(req));
    return { ok: true, permissions: perms };
  });

  // ── Admin: suspend / ban / reactivate an account ──────────────────────────────
  // suspend = a lighter temporary lock; ban = the harsher one. Both take an optional
  // durationHours (absent/0 = permanent) and a reason that is shown to the user, emailed
  // to them, and dropped in their notifications. A locked account is signed out within
  // ~15s (lib.mjs accountLock cache) and can't sign back in until the lock lifts —
  // permanent locks point the user at support to appeal. Staff can't be moderated here,
  // and you can't moderate yourself.
  app.post('/admin/users/:id/moderate', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const b = z.object({
      action: z.enum(['suspend', 'ban', 'reactivate']),
      durationHours: z.number().int().positive().max(24 * 3650).optional(), // absent = permanent
      reason: z.string().trim().max(1000).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (req.params.id === req.user.uid) return reply.code(400).send({ error: 'cannot_moderate_self' });
    const p = await db();
    const target = await p.user.findUnique({ where: { id: req.params.id }, select: { id: true, displayName: true, email: true, role: true, status: true } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    // Moderation hierarchy: you can only act on someone strictly below your own level.
    //   MOD (1)  → regular users (suspend only, never ban)
    //   ADMIN (2) → users + MODs
    //   SUPERADMIN (3) → users + MODs + ADMINs
    // Nobody can moderate a peer or anyone above them (and not another SUPERADMIN).
    if (MOD_RANK[req.user.role] <= MOD_RANK[target.role ?? 'USER']) return reply.code(403).send({ error: 'cannot_moderate_higher' });
    // Mods may temporarily suspend but never permanently ban.
    if (req.user.role === 'MOD' && b.data.action === 'ban') return reply.code(403).send({ error: 'mod_cannot_ban' });

    if (b.data.action === 'reactivate') {
      // Put their content back where it was BEFORE we froze it — a repo that was OFFLINE
      // returns to OFFLINE. Subscriptions are NOT resurrected: they were cancelled at
      // Stripe, and re-creating a payment agreement on somebody's behalf is not ours to do.
      const frozen = await p.user.findUnique({ where: { id: target.id }, select: { moderationSuspendState: true } });
      const restored = await restoreOwned(p, target.id, frozen?.moderationSuspendState);
      await p.user.update({ where: { id: target.id }, data: { status: 'active', moderationUntil: null, moderationReason: null, moderatedAt: new Date(), moderatedById: req.user.uid, moderationSuspendState: null } });
      clearAccountLockCache(target.id);
      await notify(p, target.id, 'account', `Your account is active again. ${restored.repos + restored.catalogs + restored.items} item(s) were restored to the state they were in. Any subscription that was cancelled has to be taken out again.`).catch(() => {});
      // Close whatever is still open against the account, so its history reads as ended
      // rather than as a sanction that simply stopped being enforced.
      await p.sanction.updateMany({
        where: { userId: target.id, scope: 'account', status: 'active', kind: { in: ['suspension', 'ban'] } },
        data: { status: 'lifted', liftedAt: new Date(), liftedById: req.user.uid, liftReason: 'Account reactivated by staff.' },
      }).catch(() => {});
      await logAudit(p, req.user.uid, 'user.reactivate', `${target.displayName} (${target.email})`, clientIp(req));
      await notify(p, target.id, 'account', 'Your account has been reactivated — welcome back.').catch(() => {});
      if (emailEnabled()) sendMail({ to: target.email, subject: 'Your BetterCommunity account has been reactivated',
        html: mailShell('Account reactivated', `<p>Hi ${escapeHtml(target.displayName)},</p><p>Your account has been reactivated. You can sign in again.</p>`, { url: `${SITE_URL}/auth`, label: 'Sign in' }),
        text: `Your BetterCommunity account has been reactivated. Sign in: ${SITE_URL}/auth` }).catch(() => {});
      return { ok: true, status: 'active' };
    }

    const status = b.data.action === 'ban' ? 'banned' : 'suspended';
    const until = b.data.durationHours ? new Date(Date.now() + b.data.durationHours * 3600e3) : null;
    const reason = b.data.reason || null;
    await p.user.update({ where: { id: target.id }, data: { status, moderationUntil: until, moderationReason: reason, moderatedAt: new Date(), moderatedById: req.user.uid } });
    clearAccountLockCache(target.id);
    // Cut the OIDC grants too, not just the sessions. Every app they signed into with this
    // account holds a refresh token that renews itself for as long as the app keeps asking,
    // so a ban that only ends sessions leaves those apps working — moderation the moderator
    // cannot see failing. The token endpoint re-checks the account on every refresh as well;
    // this is the half that acts immediately instead of at the next renewal.
    await p.oAuthRefreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {});

    // A sanction has to reach the SERVICE, not just the login. Both a suspension and a ban
    // stop the account's content being served and end its subscriptions; the difference is
    // that a suspension leaves the person able to sign in — to read why, to appeal, to get
    // their invoices — while a ban does not.
    //
    // Content is suspended, never deleted: the sanction may be temporary or reversed, and a
    // moderator undoing their own decision must find everything where it was. Subscriptions
    // ARE cancelled outright, because billing somebody you have locked out is the one
    // failure nobody forgives — and because a paused subscription that silently resumes
    // months later is worse than asking them to subscribe again.
    const frozenState = await suspendOwned(p, target.id);
    await p.user.update({ where: { id: target.id }, data: { moderationSuspendState: frozenState } }).catch(() => {});
    // Only the terms that would run out DURING the suspension are cancelled. A term that
    // outlives it is left alone: the person comes back to what they already paid for, and we
    // have not taken a decision on their behalf that they would then have to undo. A
    // permanent sanction has no "after", so it cancels everything.
    const subs = await p.subscription.findMany({
      where: { userId: target.id },
      select: { id: true, stripeSubId: true, planId: true, hostingGroupId: true, serverRepoId: true,
        currentPeriodEnd: true, plan: { select: { name: true, priceMonthlyCents: true } } },
    }).catch(() => []);
    const { cancel, keep } = splitSubscriptionsByTerm(subs, until);
    const cancelledList = await cancelSubscriptionList(p, cancel, req.log);
    const cancelledSubs = cancelledList.length;
    const label = status === 'banned' ? 'banned' : 'suspended';
    const dur = until ? `until ${until.toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC` : 'permanently';
    // The paperwork. issueSanction writes the row AND sends the notice from it, so the
    // reference in the person's inbox and the reference in the admin are the same string by
    // construction rather than by care.
    const sanction = await issueSanction(p, {
      userId: target.id, kind: status === 'banned' ? 'ban' : 'suspension',
      reason: reason || 'No reason given.', issuedById: req.user.uid, expiresAt: until, log: req.log,
      meta: { cancelledSubs: cancelledList, keptSubs: keep.map((k) => ({ id: k.id, planName: k.plan?.name || null, currentPeriodEnd: k.currentPeriodEnd })) },
    });
    await logAudit(p, req.user.uid, `user.${status}`, `${target.displayName} (${target.email}) ${until ? `until ${until.toISOString()}` : 'permanently'}${reason ? ` — ${reason}` : ''}`, clientIp(req));
    await notify(p, target.id, 'account_sanction', `Your account has been ${label} ${dur} (${sanction.code}).${reason ? ` Reason: ${reason}` : ''} Your repositories and catalogs are suspended.${cancelledSubs ? ` ${cancelledSubs} subscription(s) ending before then were cancelled.` : ''}${keep.length ? ` ${keep.length} kept — their term outlasts the suspension.` : ''}${status === 'suspended' ? ' You can still sign in to read this and contest it.' : ''}`).catch(() => {});
    return { ok: true, status, sanction: sanction.code, until: until ? until.toISOString() : null,
      cancelledSubs, keptSubs: keep.length,
      frozen: { repos: Object.keys(frozenState.repos || {}).length, catalogs: Object.keys(frozenState.catalogs || {}).length, items: Object.keys(frozenState.items || {}).length } };
  });

  // ── Admin: reset a user's 2FA (lost-authenticator recovery) ───────────────────
  // Two-factor is a personal auth factor: normally ONLY the owner can disable it, and
  // only by proving both their password AND a current TOTP/recovery code. A user who
  // loses their authenticator AND their recovery codes is otherwise locked out for good.
  // This is the sole staff escape hatch — it CLEARS the secret + recovery codes so the
  // user can sign in with their password alone and re-enrol from scratch. It never reveals
  // or sets a secret. Because disabling someone's 2FA is a security downgrade it's ADMIN+
  // only (not MODs), still bounded by the moderation seniority rule (act strictly below
  // your own rank), you can't reset your own (that would bypass the password+code gate on
  // /me/2fa/disable), and every reset is audited + emailed to the user as a security event.
  app.post('/admin/users/:id/2fa/reset', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    if (req.params.id === req.user.uid) return reply.code(400).send({ error: 'cannot_reset_self' });
    const p = await db();
    const target = await p.user.findUnique({ where: { id: req.params.id }, select: { id: true, displayName: true, email: true, role: true, totpEnabled: true } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    // Can only act on someone strictly below your own level (USER<MOD<ADMIN<SUPERADMIN).
    if (MOD_RANK[req.user.role] <= MOD_RANK[target.role ?? 'USER']) return reply.code(403).send({ error: 'cannot_moderate_higher' });
    if (!target.totpEnabled) return { ok: true, wasEnabled: false };

    await p.user.update({ where: { id: target.id }, data: { totpSecret: null, totpEnabled: false, totpRecoveryCodes: [] } });
    clearUserCache(target.id); // any live 2FA-gated admin session re-evaluates within ~15s
    await logAudit(p, req.user.uid, 'user.2fa_reset', `${target.displayName} (${target.email})`, clientIp(req));
    await notify(p, target.id, 'account', 'An administrator reset the two-factor authentication on your account. 2FA is now OFF — please re-enable it from Settings.').catch(() => {});
    if (emailEnabled()) sendMail({ to: target.email, subject: 'Two-factor authentication was reset on your BetterCommunity account',
      html: mailShell('Two-factor authentication reset', `<p>Hi ${escapeHtml(target.displayName)},</p><p>An administrator has <b>reset the two-factor authentication</b> on your account — for example, to help you recover after losing your authenticator app. Two-factor is now <b>disabled</b>, so you can sign in with just your password.</p><p style="margin-top:12px">For your security, please sign in and re-enable two-factor authentication right away. If you did <b>not</b> request this, change your password immediately.</p>`, { url: `${SITE_URL}/settings`, label: 'Re-enable 2FA' }),
      text: `An administrator reset the two-factor authentication on your BetterCommunity account. 2FA is now disabled; sign in with your password and re-enable it: ${SITE_URL}/settings . If you did not request this, change your password immediately.` }).catch(() => {});
    return { ok: true, wasEnabled: true };
  });

  // ── Admin: free-plan vs. paying vs. archived users ──
  // Classified by CURRENT STATE, not "ever paid": a repo/item/boost only counts
  // toward "paying" while it's actively backed by a real Payment; once a term lapses
  // (repo suspended awaiting its 72h delete) or a boost ends, it moves to "archived".
  // A user can appear in more than one tab (e.g. one free repo + one paid boost).
  // Staff (ADMIN/MOD) are excluded everywhere — they get free hosting via admin tools
  // and would otherwise pollute a report meant to characterize actual customers.
  // Payment.serverRepoId is a plain string column (no relation to traverse), and
  // Payment has no per-catalog-item FK at all — so this classifies in JS from three
  // small queries rather than one complex nested Prisma filter.
  app.get('/admin/billing/users', { preHandler: requireRole('MOD', 'ADMIN') }, async (req) => {
    const p = await db();
    const tab = ['free', 'archived'].includes(req.query?.tab) ? req.query.tab : 'paying';
    const take = Math.min(Number(req.query?.take) || 30, 100);
    const skip = Math.max(0, Number(req.query?.skip) || 0);
    const now = new Date();
    // Staff (ADMIN/MOD) are excluded by default — a "customers" report shouldn't be
    // polluted by admins who get free hosting via admin tools. `includeStaff=1` lifts
    // that filter (useful for testing on an admin-owned instance).
    const includeStaff = req.query?.includeStaff === '1' || req.query?.includeStaff === 'true';
    const ownerFilter = includeStaff ? {} : { role: 'USER' };

    const [repos, items, payments] = await Promise.all([
      p.serverRepo.findMany({ where: { hosted: true, owner: ownerFilter }, select: { id: true, ownerId: true, name: true, status: true, deleteAt: true, featuredUntil: true, storageQuotaBytes: true, uploadLimitKbps: true, cpuShare: true } }),
      p.catalogItem.findMany({ where: { payloadKey: { not: null }, owner: ownerFilter }, select: { id: true, ownerId: true, name: true, status: true, kind: true, payloadSize: true, meta: true } }),
      p.payment.findMany({ where: { serverRepoId: { not: null } }, select: { id: true, serverRepoId: true, kind: true, amountCents: true, currency: true, createdAt: true, days: true, description: true } }),
    ]);
    const paidHostingRepoIds = new Set(payments.filter((x) => x.kind === 'HOSTING').map((x) => x.serverRepoId));
    const paidFeatureRepoIds = new Set(payments.filter((x) => x.kind === 'FEATURE').map((x) => x.serverRepoId));
    const invNo = (id) => `BCW-${String(id).slice(-8).toUpperCase()}`; // same scheme as /me/invoices
    // Per-repo × kind spend rollup so each detail row can show real amounts/dates/invoices.
    const spendKey = (repoId, kind) => `${repoId}::${kind}`;
    const repoSpend = new Map(); // "repoId::KIND" -> { spentCents, count, lastAt, currency, lastDesc, invoiceNos[] }
    for (const x of payments) {
      const k = spendKey(x.serverRepoId, x.kind);
      const cur = repoSpend.get(k) || { spentCents: 0, count: 0, lastAt: null, currency: x.currency || 'usd', lastDesc: null, invoiceNos: [] };
      cur.spentCents += x.amountCents || 0; cur.count += 1;
      cur.invoiceNos.push(invNo(x.id));
      if (!cur.lastAt || x.createdAt > cur.lastAt) { cur.lastAt = x.createdAt; cur.lastDesc = x.description; }
      repoSpend.set(k, cur);
    }
    const spendFor = (repoId, kind) => repoSpend.get(spendKey(repoId, kind)) || null;

    const byUser = new Map(); // userId -> { paying: [detail...], free: [...], archived: [...] }
    const bucket = (userId) => { if (!byUser.has(userId)) byUser.set(userId, { paying: [], free: [], archived: [] }); return byUser.get(userId); };

    for (const r of repos) {
      const b = bucket(r.ownerId);
      const specs = { storageGB: Math.round(Number(r.storageQuotaBytes) / (1024 ** 3) * 10) / 10, uploadMbps: Math.round((r.uploadLimitKbps || 0) / 1024 * 10) / 10, cpuShare: r.cpuShare };
      if (r.status === 'SUSPENDED' && r.deleteAt) {
        b.archived.push({ type: 'hosting', paid: paidHostingRepoIds.has(r.id), label: `Server-Repo (expired) — ${r.name}`, name: r.name, repoId: r.id, status: r.status, deleteAt: r.deleteAt, specs, spend: spendFor(r.id, 'HOSTING') });
      } else {
        const paid = paidHostingRepoIds.has(r.id);
        (paid ? b.paying : b.free).push({ type: 'hosting', paid, label: `Server-Repo hosting${paid ? '' : ' (free)'} — ${r.name}`, name: r.name, repoId: r.id, status: r.status, specs, spend: spendFor(r.id, 'HOSTING') });
      }
      if (r.featuredUntil) {
        const paid = paidFeatureRepoIds.has(r.id);
        if (r.featuredUntil > now) (paid ? b.paying : b.free).push({ type: 'boost', paid, label: `Featured boost${paid ? '' : ' (free)'} — ${r.name}`, name: r.name, repoId: r.id, featuredUntil: r.featuredUntil, spend: spendFor(r.id, 'FEATURE') });
        else if (paid) b.archived.push({ type: 'boost', paid: true, label: `Featured boost (ended) — ${r.name}`, name: r.name, repoId: r.id, featuredUntil: r.featuredUntil, spend: spendFor(r.id, 'FEATURE') });
      }
    }
    for (const it of items) {
      const b = bucket(it.ownerId);
      const sizeMB = it.payloadSize ? Math.round(Number(it.payloadSize) / (1024 ** 2) * 10) / 10 : null;
      if (it.status === 'HIDDEN' && it.meta?._hostingUnpaid) b.archived.push({ type: 'catalog', paid: false, label: `Catalog file hosting (expired) — ${it.name}`, name: it.name, itemId: it.id, kind: it.kind, sizeMB });
      else if (it.status === 'PUBLISHED') { const paid = !!it.meta?._hostingSubId; (paid ? b.paying : b.free).push({ type: 'catalog', paid, label: `Catalog file hosting${paid ? '' : ' (free)'} — ${it.name}`, name: it.name, itemId: it.id, kind: it.kind, sizeMB }); }
    }

    // ── Recurring revenue (MRR) from live Stripe subscriptions ──
    // Adds each active subscription as a "paying" entry (so subs are counted even for
    // a user with no other paid item) and normalizes every sub's price to a monthly
    // figure so the report can answer "how much do I make per month". Best-effort:
    // if Stripe is down/unset, the report still renders without MRR.
    const mrrByUser = new Map(); // userId -> cents/month
    let siteMrrCents = 0, siteSubCount = 0;
    // Active Stripe subscriptions with no matching local user — a wiped database, a
    // shared Stripe account, or a customer whose account was deleted. Reported rather
    // than dropped in silence: otherwise the figure here is quietly smaller than the one
    // in the Stripe dashboard and there is nothing on screen to explain the gap.
    let orphanSubs = 0, orphanMrrCents = 0;
    const monthlyCents = (unit, interval, count) => {
      count = count || 1; unit = unit || 0;
      if (interval === 'year') return unit / (12 * count);
      if (interval === 'week') return (unit * 4.345) / count;
      if (interval === 'day') return (unit * 30.44) / count;
      return unit / count; // month (or unknown → treat as monthly)
    };
    let stripeOk = false;
    try {
      const sk = await stripe();
      if (sk) {
        stripeOk = true;
        const custUsers = await p.user.findMany({ where: { stripeCustomerId: { not: null }, ...(includeStaff ? {} : { role: 'USER' }) }, select: { id: true, stripeCustomerId: true } });
        const userByCust = new Map(custUsers.map((u) => [u.stripeCustomerId, u.id]));
        let starting_after; let guard = 0;
        do {
          const pageSubs = await sk.subscriptions.list({ status: 'active', limit: 100, ...(starting_after ? { starting_after } : {}) });
          for (const s of pageSubs.data) {
            const price = s.items?.data?.[0]?.price;
            const m = monthlyCents(price?.unit_amount, price?.recurring?.interval, price?.recurring?.interval_count);
            const uid = userByCust.get(typeof s.customer === 'string' ? s.customer : s.customer?.id);
            // Count it ONLY if it belongs to somebody on this site.
            //
            // The totals used to be incremented before this lookup, i.e. for every active
            // subscription in the whole Stripe account. On a shared or previously-seeded
            // test account that produced the report's worst possible failure: a headline
            // reading "$35.39/mo · 5 active subscriptions" directly above a list saying
            // "no paying customers". Both were computed correctly; they were just
            // answering different questions.
            if (!uid) { orphanSubs += 1; orphanMrrCents += m; continue; }
            siteMrrCents += m; siteSubCount += 1;
            mrrByUser.set(uid, (mrrByUser.get(uid) || 0) + m);
            const kind = s.metadata?.kind === 'feature' ? 'boost' : 'hosting';
            bucket(uid).paying.push({
              type: 'subscription', paid: true, subKind: kind,
              label: `${kind === 'boost' ? 'Boost' : 'Hosting'} subscription`,
              name: `${kind === 'boost' ? 'Boost' : 'Hosting'} subscription`,
              amountCents: price?.unit_amount ?? 0, currency: price?.currency || 'usd',
              interval: price?.recurring?.interval || 'month', intervalCount: price?.recurring?.interval_count || 1,
              mrrCents: Math.round(m), currentPeriodEnd: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
            });
          }
          starting_after = pageSubs.has_more ? pageSubs.data[pageSubs.data.length - 1].id : null;
        } while (starting_after && ++guard < 10);
      }
    } catch (e) { stripeOk = false; req.log?.warn?.({ err: e?.message }, 'MRR compute failed'); }

    // Optional search: restrict to users matching name / email / creator id.
    const q = String(req.query?.q || '').trim();
    let allowedIds = null;
    if (q) {
      const matched = await p.user.findMany({ where: { OR: [
        { displayName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { creatorLinks: { some: { creatorId: { contains: q, mode: 'insensitive' } } } },
      ] }, select: { id: true }, take: 500 });
      allowedIds = new Set(matched.map((u) => u.id));
    }
    const entries = [...byUser.entries()].filter(([id, v]) => v[tab].length > 0 && (!allowedIds || allowedIds.has(id))).sort((a, b2) => b2[1][tab].length - a[1][tab].length);
    const hasMore = entries.length > skip + take;
    const page = entries.slice(skip, skip + take);
    const users = await p.user.findMany({ where: { id: { in: page.map(([id]) => id) } }, select: { id: true, displayName: true, email: true, avatar: true, role: true } });
    const byId = Object.fromEntries(users.map((u) => [u.id, u]));

    // The paying tab keeps its lifetime spend summary too — useful context alongside "what's active now".
    let spendById = {};
    if (tab === 'paying' && page.length) {
      const grouped = await p.payment.groupBy({ by: ['userId'], where: { userId: { in: page.map(([id]) => id) } }, _sum: { amountCents: true }, _count: { _all: true }, _max: { createdAt: true } });
      spendById = Object.fromEntries(grouped.map((g) => [g.userId, { totalSpentCents: g._sum.amountCents || 0, paymentCount: g._count._all, lastPaymentAt: g._max.createdAt }]));
    }
    return {
      tab, hasMore,
      mrr: {
        totalCents: Math.round(siteMrrCents), subCount: siteSubCount, annualCents: Math.round(siteMrrCents * 12),
        orphanSubs, orphanMrrCents: Math.round(orphanMrrCents),
        // Whether Stripe answered at all. Without it the UI cannot tell "nobody is
        // paying" from "we could not ask", and it would show a confident 0 for both.
        stripe: stripeOk,
      },
      users: page.map(([id, v]) => ({ ...(byId[id] || { id, displayName: '(deleted)', email: '' }), active: v[tab], mrrCents: Math.round(mrrByUser.get(id) || 0), ...(spendById[id] || {}) })),
    };
  });

  // ── Admin settings (global hosting cap, pricing knobs…) ──
  app.get('/admin/settings', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const rows = await p.adminSetting.findMany();
    return { settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  });
  app.put('/admin/settings/:key', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    const value = req.body?.value ?? req.body;
    // The configured Total capacity can never promise more than the machine can
    // physically hold — checked against a REAL statfs() read of the disk, never
    // an assumed/faked number. (Prevents e.g. setting 10 TB on a 200 GB box.)
    if (req.params.key === 'hosting.totalCapacityGB') {
      const diskGB = realDiskStats().totalBytes;
      const requestedGB = Number(value);
      if (diskGB != null && Number.isFinite(requestedGB) && requestedGB * (1024 ** 3) > diskGB) {
        return reply.code(400).send({ error: 'exceeds_disk', diskGB: +(diskGB / (1024 ** 3)).toFixed(1) });
      }
    }
    await p.adminSetting.upsert({ where: { key: req.params.key }, create: { key: req.params.key, value }, update: { value } });
    return { ok: true };
  });

  // ── Admin-configurable topbar navigation ──────────────────────────────────────
  // The whole nav is an optional JSON blob in AdminSetting['nav.config'] — no schema
  // change. When disabled or empty the frontend falls back to its hardcoded NAV, so
  // this is purely additive. `to` is constrained to an internal path (leading "/") so
  // a configured link can never become an open-redirect or a javascript: URL. Labels
  // render as React text (no XSS) but are length-capped anyway.
  const navChild = z.object({
    label: z.string().trim().min(1).max(40),
    labelFr: z.string().trim().max(40).optional().default(''),
    to: z.string().trim().min(1).max(200).refine((v) => v.startsWith('/'), 'must be an internal path'),
    desc: z.string().trim().max(120).optional().default(''),
    descFr: z.string().trim().max(120).optional().default(''),
    icon: z.string().trim().max(60).optional().default(''),
  });
  const navItem = z.object({
    type: z.enum(['link', 'group']),
    label: z.string().trim().min(1).max(40),
    labelFr: z.string().trim().max(40).optional().default(''),
    to: z.string().trim().max(200).optional().default(''),
    icon: z.string().trim().max(60).optional().default(''),
    children: z.array(navChild).max(12).optional().default([]),
  }).refine((it) => it.type === 'group' || (it.to && it.to.startsWith('/')), { message: 'a link needs an internal "to"' })
    .refine((it) => it.type === 'link' || it.children.length > 0, { message: 'a group needs at least one link' });
  // Built-in topbar utility elements the admin can show/hide + reorder (App.jsx UTIL_KEYS).
  const UTIL_KEYS = ['notifications', 'projects', 'lang', 'theme', 'settings', 'dashboard', 'admin', 'profile', 'logout', 'login'];
  const utilEntry = z.object({ visible: z.boolean().optional(), order: z.number().int().min(0).max(50).optional() });
  const utilitySchema = z.record(z.enum(UTIL_KEYS), utilEntry).optional().default({});
  const navSchema = z.object({
    enabled: z.boolean(),
    items: z.array(navItem).max(16),
    utility: utilitySchema,
    // How admin-pinned showcase projects appear in the topbar: as their own inline
    // pills, or grouped under a single "Projects" hover-dropdown. Icons stay each
    // project's own either way.
    projectsMode: z.enum(['inline', 'dropdown']).optional().default('inline'),
    // Mobile bottom tab bar. Its contents are derived from the nav items (home + the
    // first few links), so there's nothing to list here — just an on/off toggle.
    downbar: z.object({ enabled: z.boolean().optional().default(true) }).optional().default({ enabled: true }),
    // Desktop topbar layout. align = where the nav sits; density = spacing; labels = whether
    // link/group text shows next to icons ('icons' hides it, saving room). Applied identically
    // by the real topbar (App.jsx) and the admin Live preview from one shared reader.
    layout: z.object({
      align: z.enum(['start', 'center', 'end']).optional().default('start'),
      density: z.enum(['comfortable', 'compact']).optional().default('comfortable'),
      labels: z.enum(['both', 'icons']).optional().default('both'),
    }).optional().default({}),
  });

  // ── Admin-configurable FOOTER ─────────────────────────────────────────────────
  // Same shape of idea as the topbar above: an optional JSON blob in
  // AdminSetting['footer.config'], so there is no schema change and no migration, and when
  // it is disabled or empty the frontend keeps its hardcoded footer. Purely additive.
  //
  app.get('/admin/footer', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'footer.config' } });
    return { footer: row?.value || { enabled: false, columns: [] } };
  });
  app.put('/admin/footer', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const parsed = footerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', detail: parsed.error.issues?.[0]?.message });
    const p = await db();
    await p.adminSetting.upsert({ where: { key: 'footer.config' }, create: { key: 'footer.config', value: parsed.data }, update: { value: parsed.data } });
    await logAudit(p, req.user.uid, 'footer.config', `${parsed.data.columns.length} columns · ${parsed.data.enabled ? 'enabled' : 'disabled'}`, clientIp(req));
    return { ok: true };
  });
  // Public: what the site renders. Disabled config returns null so the frontend keeps its
  // built-in footer rather than rendering an empty one.
  app.get('/footer', async (req, reply) => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'footer.config' } });
    reply.header('Cache-Control', 'public, max-age=60');
    const cfg = row?.value;
    return { footer: cfg?.enabled ? cfg : null };
  });

  // Admin editor reads the RAW config (even when disabled) so it can be edited.
  app.get('/admin/nav', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'nav.config' } });
    return { nav: row?.value || { enabled: false, items: [] } };
  });
  app.put('/admin/nav', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const parsed = navSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input', detail: parsed.error.issues?.[0]?.message });
    const p = await db();
    await p.adminSetting.upsert({ where: { key: 'nav.config' }, create: { key: 'nav.config', value: parsed.data }, update: { value: parsed.data } });
    await logAudit(p, req.user.uid, 'nav.config', `${parsed.data.items.length} items · ${parsed.data.enabled ? 'enabled' : 'disabled'}`, clientIp(req));
    return { ok: true };
  });
  // Public: the effective nav for the topbar. Returns null unless it's enabled AND has
  // items, so the client cleanly falls back to its built-in NAV.
  app.get('/nav', async () => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: 'nav.config' } });
    const cfg = row?.value;
    const usable = cfg && cfg.enabled && Array.isArray(cfg.items) && cfg.items.length > 0;
    // Utility (topbar button show/hide/order) applies independently of custom nav items —
    // an admin may want to hide the login button without configuring the whole nav.
    const utility = cfg?.utility && Object.keys(cfg.utility).length ? cfg.utility : null;
    // projectsMode + downbar + layout apply independently of custom items (like utility).
    const projectsMode = cfg?.projectsMode === 'dropdown' ? 'dropdown' : null; // 'inline' is the default → omit
    const downbar = cfg?.downbar && cfg.downbar.enabled === false ? cfg.downbar : null; // enabled is the default → omit
    // layout: only forward it when it differs from the defaults (start/comfortable/both), so an
    // untouched install still gets nav:null and the built-in look.
    const L = cfg?.layout;
    const layout = L && ((L.align && L.align !== 'start') || (L.density && L.density !== 'comfortable') || (L.labels && L.labels !== 'both')) ? L : null;
    if (!usable && !utility && !projectsMode && !downbar && !layout) return { nav: null };
    return { nav: {
      ...(usable ? { items: cfg.items } : {}),
      ...(utility ? { utility } : {}),
      ...(projectsMode ? { projectsMode } : {}),
      ...(downbar ? { downbar } : {}),
      ...(layout ? { layout } : {}),
    } };
  });
}
