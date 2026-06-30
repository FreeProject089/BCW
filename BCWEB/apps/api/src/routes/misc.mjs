import { z } from 'zod';
import { db, requireRole, slugify } from '../lib.mjs';

export default async function miscRoutes(app) {
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

  // ── Blog (public read; MOD/ADMIN write) ──
  app.get('/blog', async (req) => {
    const p = await db();
    const where = { status: 'PUBLISHED' };
    if (req.query?.project) where.project = { key: req.query.project };
    return { posts: await p.blogPost.findMany({ where, orderBy: { publishedAt: 'desc' }, include: { project: { select: { key: true, name: true } }, author: { select: { displayName: true } } } }) };
  });
  app.get('/blog/:slug', async (req, reply) => {
    const p = await db();
    const post = await p.blogPost.findUnique({ where: { slug: req.params.slug }, include: { project: true, author: { select: { displayName: true } } } });
    if (!post || post.status !== 'PUBLISHED') return reply.code(404).send({ error: 'not_found' });
    return { post };
  });
  app.post('/blog', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const b = z.object({ projectKey: z.enum(['community', 'bmm', 'bsm']), title: z.string().min(2).max(160), body: z.string().min(1), publish: z.boolean().default(true) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const project = await p.project.findUnique({ where: { key: b.data.projectKey } });
    const post = await p.blogPost.create({ data: {
      projectId: project.id, authorId: req.user.uid, title: b.data.title,
      slug: `${slugify(b.data.title)}-${Math.random().toString(36).slice(2, 6)}`,
      body: b.data.body, status: b.data.publish ? 'PUBLISHED' : 'DRAFT', publishedAt: b.data.publish ? new Date() : null,
    } });
    return reply.code(201).send({ post });
  });

  // ── Server repos (public list of hosted/online; mine when authed) ──
  app.get('/repos', async () => {
    const p = await db();
    const repos = await p.serverRepo.findMany({
      where: { hosted: true, status: 'ONLINE' }, orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, publicUrl: true, status: true, storageQuotaBytes: true, storageUsedBytes: true, owner: { select: { displayName: true } } },
    });
    return { repos: repos.map((r) => ({ ...r, storageQuotaBytes: Number(r.storageQuotaBytes), storageUsedBytes: Number(r.storageUsedBytes) })) };
  });
  app.get('/me/repos', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const repos = await p.serverRepo.findMany({ where: { ownerId: req.user.uid }, include: { subscription: { include: { plan: true } } } });
    return { repos: repos.map((r) => ({ ...r, storageQuotaBytes: Number(r.storageQuotaBytes), storageUsedBytes: Number(r.storageUsedBytes) })) };
  });

  // ── Admin settings (global hosting cap, pricing knobs…) ──
  app.get('/admin/settings', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const rows = await p.adminSetting.findMany();
    return { settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  });
  app.put('/admin/settings/:key', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const value = req.body?.value ?? req.body;
    await p.adminSetting.upsert({ where: { key: req.params.key }, create: { key: req.params.key, value }, update: { value } });
    return { ok: true };
  });
}
