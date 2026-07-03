import { z } from 'zod';
import { db, requireRole, optionalAuth, slugify, logAudit } from '../lib.mjs';
import { prefixUsage } from '../storage.mjs';
import { capacityStatus, realDiskStats } from './hosting.mjs';
import { powVerify } from './auth.mjs';
import { FILES_BACKUP_ROOT, DB_BACKUP_ROOT, repoSizeBytes } from '../gitbackup.mjs';
import { userBcId, itemFingerprint, repoFingerprint, loadOwnerIdentities, looksLikeBcId, findUserIdByBcId } from '../repofingerprint.mjs';

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
      p.serverRepo.findMany({ where: { hosted: true }, orderBy: { storageUsedBytes: 'desc' }, take: 8, select: { id: true, name: true, storageUsedBytes: true, storageQuotaBytes: true, owner: { select: { displayName: true } } } }),
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
    return {
      areas: [
        { key: 'repos', label: 'Hosted repos', prefix: 'hosting/', ...repos },
        { key: 'catalog', label: 'Catalog payloads (apps/plugins/themes)', prefix: 'uploads/', ...uploads },
        { key: 'blog', label: 'Blog media', prefix: 'blog/', ...blog },
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
        { key: 'blog', label: 'Blog media', usedBytes: blog.bytes, allocatedBytes: null, count: blog.count },
        { key: 'otherProjects', label: 'Other projects (showcase)', usedBytes: 0, allocatedBytes: null, count: showcaseCount, note: 'Media referenced by URL, not uploaded here.' },
        // The DB's own on-disk size, whole — every table at once (users, catalog
        // rows, submissions/comments, contact messages, login/audit logs, metric
        // history, analytics events, ...). Supersedes a single-table estimate:
        // it's the actual answer to "besides object storage, what else is using
        // real disk" without needing one line item per Prisma model.
        { key: 'database', label: 'Database (all tables — users, content, logs, metrics, analytics)', usedBytes: dbSizeBytes, allocatedBytes: null, count: null, note: `${analyticsCount} analytics events, ${promoCount} promo codes, ${messageCount} contact messages among them.` },
        { key: 'backups', label: 'Server backups (git — file & DB edit history)', usedBytes: filesBackupBytes + dbBackupBytes, allocatedBytes: backupLimitRow?.value?.maxBytes ?? null, count: null, note: `${(filesBackupBytes / 1024 / 1024).toFixed(1)} MB file history, ${(dbBackupBytes / 1024 / 1024).toFixed(1)} MB DB row history. Limit configured from Advanced server management.` },
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
    const staticRoutes = ['/', '/catalog', '/blog', '/repos', '/hosting', '/projects', '/contact', '/privacy', '/terms', '/cookies', '/p/bmm', '/p/bsm', '/p/installer'];
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
  app.get('/admin/users', { preHandler: requireRole('MOD', 'ADMIN') }, async (req) => {
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
        totpEnabled: true, canControlServer: true,
        creatorLinks: { select: { creatorId: true } }, discordLinks: { select: { discordId: true, username: true } },
        _count: { select: { serverRepos: true, items: true } } },
    });
    const hasMore = rows.length > take;
    return {
      hasMore,
      users: rows.slice(0, take).map((u) => ({
        id: u.id, bcId: userBcId(u.id), displayName: u.displayName, email: u.email, role: u.role, avatar: u.avatar, createdAt: u.createdAt,
        totpEnabled: u.totpEnabled, canControlServer: u.canControlServer,
        creatorIds: u.creatorLinks.map((c) => c.creatorId),
        discord: u.discordLinks[0] ? { id: u.discordLinks[0].discordId, username: u.discordLinks[0].username } : null,
        repoCount: u._count.serverRepos, itemCount: u._count.items,
      })),
    };
  });

  app.get('/admin/users/:id', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.params.id }, select: {
      id: true, displayName: true, email: true, role: true, avatar: true, bio: true, createdAt: true,
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
    return { user: {
      ...u,
      bcId: userBcId(u.id),
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
    await logAudit(p, req.user.uid, 'user.role_change', `${target.displayName} (${target.email}): ${target.role} -> ${b.data.role}`, clientIp(req));
    return { user };
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

    const [repos, items, payments] = await Promise.all([
      p.serverRepo.findMany({ where: { hosted: true, owner: { role: 'USER' } }, select: { id: true, ownerId: true, name: true, status: true, deleteAt: true, featuredUntil: true } }),
      p.catalogItem.findMany({ where: { payloadKey: { not: null }, owner: { role: 'USER' } }, select: { id: true, ownerId: true, name: true, status: true, meta: true } }),
      p.payment.findMany({ where: { serverRepoId: { not: null } }, select: { serverRepoId: true, kind: true } }),
    ]);
    const paidHostingRepoIds = new Set(payments.filter((x) => x.kind === 'HOSTING').map((x) => x.serverRepoId));
    const paidFeatureRepoIds = new Set(payments.filter((x) => x.kind === 'FEATURE').map((x) => x.serverRepoId));

    const byUser = new Map(); // userId -> { paying: [label...], free: [...], archived: [...] }
    const bucket = (userId) => { if (!byUser.has(userId)) byUser.set(userId, { paying: [], free: [], archived: [] }); return byUser.get(userId); };

    for (const r of repos) {
      const b = bucket(r.ownerId);
      if (r.status === 'SUSPENDED' && r.deleteAt) { b.archived.push(`Server-Repo (expired) — ${r.name}`); }
      else { (paidHostingRepoIds.has(r.id) ? b.paying : b.free).push(`Server-Repo hosting${paidHostingRepoIds.has(r.id) ? '' : ' (free)'} — ${r.name}`); }
      if (r.featuredUntil) {
        if (r.featuredUntil > now) (paidFeatureRepoIds.has(r.id) ? b.paying : b.free).push(`Featured boost${paidFeatureRepoIds.has(r.id) ? '' : ' (free)'} — ${r.name}`);
        else if (paidFeatureRepoIds.has(r.id)) b.archived.push(`Featured boost (ended) — ${r.name}`);
      }
    }
    for (const it of items) {
      const b = bucket(it.ownerId);
      if (it.status === 'HIDDEN' && it.meta?._hostingUnpaid) b.archived.push(`Catalog file hosting (expired) — ${it.name}`);
      else if (it.status === 'PUBLISHED') (it.meta?._hostingSubId ? b.paying : b.free).push(`Catalog file hosting${it.meta?._hostingSubId ? '' : ' (free)'} — ${it.name}`);
    }

    const entries = [...byUser.entries()].filter(([, v]) => v[tab].length > 0).sort((a, b2) => b2[1][tab].length - a[1][tab].length);
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
      users: page.map(([id, v]) => ({ ...(byId[id] || { id, displayName: '(deleted)', email: '' }), active: v[tab], ...(spendById[id] || {}) })),
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
}
