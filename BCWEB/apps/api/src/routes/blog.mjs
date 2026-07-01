import { z } from 'zod';
import { db, requireRole, slugify } from '../lib.mjs';

const postSchema = z.object({
  projectKey: z.enum(['community', 'bmm', 'bsm']),
  title: z.string().min(2).max(160),
  excerpt: z.string().max(400).default(''),
  cover: z.string().max(500).optional().nullable(),
  body: z.string().min(1),
  publish: z.boolean().default(true),
});

export default async function blogRoutes(app) {
  // Public: published posts (optionally filtered by project).
  app.get('/blog', async (req) => {
    const p = await db();
    const where = { status: 'PUBLISHED' };
    if (req.query?.project) where.project = { key: req.query.project };
    const posts = await p.blogPost.findMany({
      where, orderBy: { publishedAt: 'desc' },
      select: { id: true, slug: true, title: true, excerpt: true, cover: true, publishedAt: true,
                project: { select: { key: true, name: true } }, author: { select: { displayName: true } } },
    });
    return { posts };
  });

  app.get('/blog/:slug', async (req, reply) => {
    const p = await db();
    const post = await p.blogPost.findUnique({ where: { slug: req.params.slug }, include: { project: true, author: { select: { displayName: true } } } });
    if (!post || post.status !== 'PUBLISHED') return reply.code(404).send({ error: 'not_found' });
    return { post };
  });

  // Admin: every post incl. drafts (for the editor list).
  app.get('/blog-admin', { preHandler: requireRole('MOD', 'ADMIN') }, async () => {
    const p = await db();
    return { posts: await p.blogPost.findMany({ orderBy: { createdAt: 'desc' }, include: { project: { select: { key: true, name: true } }, author: { select: { displayName: true } } } }) };
  });

  app.post('/blog', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const b = postSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    const p = await db();
    const project = await p.project.findUnique({ where: { key: b.data.projectKey } });
    const post = await p.blogPost.create({ data: {
      projectId: project.id, authorId: req.user.uid, title: b.data.title, excerpt: b.data.excerpt,
      cover: b.data.cover || null, body: b.data.body, slug: `${slugify(b.data.title)}-${Math.random().toString(36).slice(2, 6)}`,
      status: b.data.publish ? 'PUBLISHED' : 'DRAFT', publishedAt: b.data.publish ? new Date() : null,
    } });
    return reply.code(201).send({ post });
  });

  app.patch('/blog/:id', { preHandler: requireRole('MOD', 'ADMIN') }, async (req, reply) => {
    const b = postSchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const d = b.data;
    const data = {};
    for (const k of ['title', 'excerpt', 'cover', 'body']) if (d[k] !== undefined) data[k] = d[k];
    if (d.projectKey) { const pr = await p.project.findUnique({ where: { key: d.projectKey } }); if (pr) data.projectId = pr.id; }
    if (d.publish !== undefined) { data.status = d.publish ? 'PUBLISHED' : 'DRAFT'; data.publishedAt = d.publish ? new Date() : null; }
    const post = await p.blogPost.update({ where: { id: req.params.id }, data });
    return { post };
  });

  app.delete('/blog/:id', { preHandler: requireRole('MOD', 'ADMIN') }, async (req) => {
    const p = await db();
    await p.blogPost.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });
}
