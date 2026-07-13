import { z } from 'zod';
import { db, requireRole, requireCap, optionalAuth, slugify, logAudit, notify, clearAccountLockCache, clearUserCache, CAPABILITIES } from '../lib/lib.mjs';
import { sendMail, mailShell, emailEnabled, escapeHtml } from '../lib/mail.mjs';

const SITE_URL = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');
// Staff seniority for moderation: an actor can only moderate a strictly lower rank.
const MOD_RANK = { USER: 0, MOD: 1, ADMIN: 2, SUPERADMIN: 3 };
import { prefixUsage } from '../lib/storage.mjs';
import { capacityStatus, realDiskStats, stripe } from './hosting.mjs';
import { powVerify } from './auth.mjs';
import { FILES_BACKUP_ROOT, DB_BACKUP_ROOT, repoSizeBytes } from '../lib/gitbackup.mjs';
import { userBcId, itemFingerprint, repoFingerprint, loadOwnerIdentities, looksLikeBcId, findUserIdByBcId } from '../lib/repofingerprint.mjs';
import { telemetryDb } from './server-control.mjs';

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
export default async function miscRoutes(app) {
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
  app.post('/contact', { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } }, preHandler: optionalAuth() }, async (req, reply) => {
    if (!powVerify(req.body?.pow)) return reply.code(400).send({ error: 'pow_required' });
    const b = z.object({
      name: z.string().min(1).max(100),
      email: z.string().email().max(254),
      body: z.string().min(5).max(2000),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const ip = String(clientIp(req) || '').slice(0, 64);
    const userId = req.user?.uid || null;
    const since = new Date(Date.now() - 864e5);
    const dailyCount = await p.contactMessage.count({ where: { createdAt: { gte: since }, ...(userId ? { userId } : { ip, userId: null }) } });
    if (dailyCount >= (userId ? 5 : 3)) return reply.code(429).send({ error: 'daily_limit' });
    const msg = await p.contactMessage.create({ data: { ...b.data, ip, userId } });
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
        totpEnabled: true, canControlServer: true, canViewTelemetry: true, permissions: true,
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

  app.get('/admin/users/:id', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.params.id }, select: {
      id: true, displayName: true, email: true, role: true, permissions: true, avatar: true, bio: true, createdAt: true, stripeCustomerId: true,
      status: true, moderationUntil: true, moderationReason: true, moderatedAt: true,
      serverRepos: { select: { id: true, name: true, hosted: true, status: true, listed: true, verified: true }, orderBy: { createdAt: 'desc' } },
      items: { select: { id: true, name: true, slug: true, kind: true, status: true }, orderBy: { updatedAt: 'desc' } },
      creatorLinks: { select: { creatorId: true, displayName: true, linkedAt: true, unlinkableAt: true } },
      discordLinks: { select: { discordId: true, username: true, linkedAt: true } },
      payments: { select: { id: true, kind: true, description: true, amountCents: true, currency: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 },
    } });
    if (!u) return reply.code(404).send({ error: 'not_found' });
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
      subscriptions, mrrCents: Math.round(mrrCents),
      serverRepos: u.serverRepos.map((r) => ({ ...r, fingerprint: repoFingerprint({ repoId: r.id, ownerId: u.id, ...idn }) })),
      items: u.items.map((it) => ({ ...it, fingerprint: itemFingerprint({ itemId: it.id, ownerId: u.id, creatorIds: idn.creatorIds }) })),
    } };
  });

  // ── SUPERADMIN only: manage role assignments. A SUPERADMIN can't change their own
  // role here — self-demotion/self-modification only via another SUPERADMIN, so the
  // account can't be accidentally locked out of its own management screen. ──
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
      await p.user.update({ where: { id: target.id }, data: { status: 'active', moderationUntil: null, moderationReason: null, moderatedAt: new Date(), moderatedById: req.user.uid } });
      clearAccountLockCache(target.id);
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
    const label = status === 'banned' ? 'banned' : 'suspended';
    const dur = until ? `until ${until.toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })} UTC` : 'permanently';
    await logAudit(p, req.user.uid, `user.${status}`, `${target.displayName} (${target.email}) ${until ? `until ${until.toISOString()}` : 'permanently'}${reason ? ` — ${reason}` : ''}`, clientIp(req));
    await notify(p, target.id, 'account', `Your account has been ${label} ${dur}.${reason ? ` Reason: ${reason}` : ''}`).catch(() => {});
    if (emailEnabled()) sendMail({ to: target.email, subject: `Your BetterCommunity account has been ${label}`,
      html: mailShell(`Account ${label}`, `<p>Hi ${escapeHtml(target.displayName)},</p><p>Your account has been <b>${label}</b> ${dur}.</p>${reason ? `<p style="margin-top:12px"><b>Reason:</b><br>${escapeHtml(reason)}</p>` : ''}${until ? '' : '<p style="margin-top:12px">If you believe this was a mistake, you can appeal by contacting support.</p>'}`, until ? null : { url: `${SITE_URL}/contact?ref=appeal`, label: 'Contact support' }),
      text: `Your BetterCommunity account has been ${label} ${dur}.${reason ? ` Reason: ${reason}` : ''}${until ? '' : ` Appeal: ${SITE_URL}/contact`}` }).catch(() => {});
    return { ok: true, status, until: until ? until.toISOString() : null };
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
    const monthlyCents = (unit, interval, count) => {
      count = count || 1; unit = unit || 0;
      if (interval === 'year') return unit / (12 * count);
      if (interval === 'week') return (unit * 4.345) / count;
      if (interval === 'day') return (unit * 30.44) / count;
      return unit / count; // month (or unknown → treat as monthly)
    };
    try {
      const sk = await stripe();
      if (sk) {
        const custUsers = await p.user.findMany({ where: { stripeCustomerId: { not: null }, ...(includeStaff ? {} : { role: 'USER' }) }, select: { id: true, stripeCustomerId: true } });
        const userByCust = new Map(custUsers.map((u) => [u.stripeCustomerId, u.id]));
        let starting_after; let guard = 0;
        do {
          const pageSubs = await sk.subscriptions.list({ status: 'active', limit: 100, ...(starting_after ? { starting_after } : {}) });
          for (const s of pageSubs.data) {
            const price = s.items?.data?.[0]?.price;
            const m = monthlyCents(price?.unit_amount, price?.recurring?.interval, price?.recurring?.interval_count);
            siteMrrCents += m; siteSubCount += 1;
            const uid = userByCust.get(typeof s.customer === 'string' ? s.customer : s.customer?.id);
            if (!uid) continue;
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
    } catch (e) { req.log?.warn?.({ err: e?.message }, 'MRR compute failed'); }

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
      mrr: { totalCents: Math.round(siteMrrCents), subCount: siteSubCount, annualCents: Math.round(siteMrrCents * 12) },
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
    icon: z.string().trim().max(30).optional().default(''),
  });
  const navItem = z.object({
    type: z.enum(['link', 'group']),
    label: z.string().trim().min(1).max(40),
    labelFr: z.string().trim().max(40).optional().default(''),
    to: z.string().trim().max(200).optional().default(''),
    icon: z.string().trim().max(30).optional().default(''),
    children: z.array(navChild).max(12).optional().default([]),
  }).refine((it) => it.type === 'group' || (it.to && it.to.startsWith('/')), { message: 'a link needs an internal "to"' })
    .refine((it) => it.type === 'link' || it.children.length > 0, { message: 'a group needs at least one link' });
  const navSchema = z.object({ enabled: z.boolean(), items: z.array(navItem).max(16) });

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
    return { nav: usable ? { items: cfg.items } : null };
  });
}
