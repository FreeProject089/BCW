import { z } from 'zod';
import { db, requireRole, slugify } from '../lib.mjs';

// A post belongs to exactly one blog "space": a fixed Project (bmm/bsm/community/
// installer) OR an admin-created ShowcaseProject ("custom" page, e.g. an Other
// Projects entry). Never both, never neither — checked explicitly in the POST
// handler (kept out of the schema itself via .refine() so `.partial()` still
// works for PATCH — ZodEffects, which .refine() produces, has no .partial()).
const postSchema = z.object({
  projectKey: z.enum(['community', 'bmm', 'bsm', 'installer']).optional(),
  showcaseSlug: z.string().max(80).optional(),
  title: z.string().min(2).max(160),
  excerpt: z.string().max(2000).default(''),
  cover: z.string().max(500).optional().nullable(),
  body: z.string().min(1),
  // Optional French translation (posted together with the base/EN version).
  titleFr: z.string().max(160).optional().nullable(),
  excerptFr: z.string().max(2000).optional().nullable(),
  bodyFr: z.string().optional().nullable(),
  publish: z.boolean().default(true),
});

const STAFF = ['MOD', 'ADMIN', 'SUPERADMIN'];

// Staff can post anywhere. A regular USER needs an explicit BlogPermission grant —
// either global (projectKey and showcaseProjectId both null) or scoped to this
// specific blog.
async function canPostTo(p, user, { projectKey, showcaseSlug }) {
  if (STAFF.includes(user.role)) return true;
  const grants = await p.blogPermission.findMany({ where: { userId: user.uid } });
  if (grants.some((g) => !g.projectKey && !g.showcaseProjectId)) return true;
  if (projectKey && grants.some((g) => g.projectKey === projectKey)) return true;
  if (showcaseSlug) {
    const sp = await p.showcaseProject.findUnique({ where: { slug: showcaseSlug } });
    if (sp && grants.some((g) => g.showcaseProjectId === sp.id)) return true;
  }
  return false;
}

const POST_SELECT = {
  id: true, slug: true, title: true, excerpt: true, cover: true, publishedAt: true, status: true, authorId: true,
  titleFr: true, excerptFr: true, bodyFr: true,
  project: { select: { key: true, name: true } },
  showcaseProject: { select: { slug: true, name: true, short: true } },
  author: { select: { displayName: true } },
};

export default async function blogRoutes(app) {
  // Public: published posts — optionally filtered by a fixed project (?project=),
  // a custom/showcase page (?page=), or the home page's "Latest news" (?home=1,
  // only posts whose blog has showOnHomeNews — posts always show on /blog itself
  // regardless of that flag).
  app.get('/blog', async (req) => {
    const p = await db();
    const where = { status: 'PUBLISHED' };
    if (req.query?.project) where.project = { key: req.query.project };
    if (req.query?.page) where.showcaseProject = { slug: req.query.page };
    if (req.query?.home) where.OR = [{ project: { showOnHomeNews: true } }, { showcaseProject: { showOnHomeNews: true } }];
    const posts = await p.blogPost.findMany({ where, orderBy: { publishedAt: 'desc' }, select: POST_SELECT });
    return { posts };
  });

  app.get('/blog/:slug', async (req, reply) => {
    const p = await db();
    const post = await p.blogPost.findUnique({ where: { slug: req.params.slug }, include: { project: true, showcaseProject: true, author: { select: { displayName: true } } } });
    if (!post || post.status !== 'PUBLISHED') return reply.code(404).send({ error: 'not_found' });
    return { post };
  });

  // Admin/mod: every post incl. drafts (for the full moderation-style editor list).
  app.get('/blog-admin', { preHandler: requireRole('MOD', 'ADMIN') }, async () => {
    const p = await db();
    return { posts: await p.blogPost.findMany({ orderBy: { createdAt: 'desc' }, select: POST_SELECT }) };
  });

  // A regular user with a blog-post grant only ever sees/manages their own posts —
  // never staff's full list.
  app.get('/blog/mine', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const hasAnyGrant = STAFF.includes(req.user.role) || (await p.blogPermission.count({ where: { userId: req.user.uid } })) > 0;
    if (!hasAnyGrant) return { posts: [], canWrite: false };
    const where = STAFF.includes(req.user.role) ? {} : { authorId: req.user.uid };
    const posts = await p.blogPost.findMany({ where, orderBy: { createdAt: 'desc' }, select: POST_SELECT });
    return { posts, canWrite: true };
  });

  // Which blogs can the current user write to? (drives the project/page picker in
  // the editor — staff sees everything, a granted USER sees only their scopes.)
  app.get('/blog/my-scopes', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const [projects, showcases] = await Promise.all([
      p.project.findMany({ select: { key: true, name: true } }),
      p.showcaseProject.findMany({ where: { published: true }, select: { slug: true, name: true } }),
    ]);
    if (STAFF.includes(req.user.role)) return { projects, showcases, global: true };
    const grants = await p.blogPermission.findMany({ where: { userId: req.user.uid } });
    if (grants.some((g) => !g.projectKey && !g.showcaseProjectId)) return { projects, showcases, global: true };
    const projectKeys = new Set(grants.filter((g) => g.projectKey).map((g) => g.projectKey));
    const showcaseIds = new Set(grants.filter((g) => g.showcaseProjectId).map((g) => g.showcaseProjectId));
    const showcasesById = await p.showcaseProject.findMany({ where: { id: { in: [...showcaseIds] } }, select: { id: true, slug: true, name: true } });
    return {
      projects: projects.filter((pr) => projectKeys.has(pr.key)),
      showcases: showcasesById.map((s) => ({ slug: s.slug, name: s.name })),
      global: false,
    };
  });

  app.post('/blog', { preHandler: requireRole() }, async (req, reply) => {
    const b = postSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', details: b.error.flatten() });
    if (!!b.data.projectKey === !!b.data.showcaseSlug) return reply.code(400).send({ error: 'exactly_one_of_projectKey_or_showcaseSlug' });
    if (!(await canPostTo(await db(), req.user, b.data))) return reply.code(403).send({ error: 'forbidden' });
    const p = await db();
    const data = {
      authorId: req.user.uid, title: b.data.title, excerpt: b.data.excerpt,
      cover: b.data.cover || null, body: b.data.body, slug: `${slugify(b.data.title)}-${Math.random().toString(36).slice(2, 6)}`,
      titleFr: b.data.titleFr || null, excerptFr: b.data.excerptFr || null, bodyFr: b.data.bodyFr || null,
      status: b.data.publish ? 'PUBLISHED' : 'DRAFT', publishedAt: b.data.publish ? new Date() : null,
    };
    if (b.data.projectKey) { const project = await p.project.findUnique({ where: { key: b.data.projectKey } }); data.projectId = project.id; }
    else { const sp = await p.showcaseProject.findUnique({ where: { slug: b.data.showcaseSlug } }); if (!sp) return reply.code(400).send({ error: 'unknown_page' }); data.showcaseProjectId = sp.id; }
    const post = await p.blogPost.create({ data });
    return reply.code(201).send({ post });
  });

  app.patch('/blog/:id', { preHandler: requireRole() }, async (req, reply) => {
    const b = postSchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const existing = await p.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    // Non-staff can only edit their own posts, even with a grant to post in that blog.
    if (!STAFF.includes(req.user.role) && existing.authorId !== req.user.uid) return reply.code(403).send({ error: 'forbidden' });
    const d = b.data;
    const data = {};
    for (const k of ['title', 'excerpt', 'cover', 'body', 'titleFr', 'excerptFr', 'bodyFr']) if (d[k] !== undefined) data[k] = d[k];
    if (d.projectKey || d.showcaseSlug) {
      if (!(await canPostTo(p, req.user, d))) return reply.code(403).send({ error: 'forbidden' });
      if (d.projectKey) { const pr = await p.project.findUnique({ where: { key: d.projectKey } }); if (pr) { data.projectId = pr.id; data.showcaseProjectId = null; } }
      else { const sp = await p.showcaseProject.findUnique({ where: { slug: d.showcaseSlug } }); if (sp) { data.showcaseProjectId = sp.id; data.projectId = null; } }
    }
    if (d.publish !== undefined) { data.status = d.publish ? 'PUBLISHED' : 'DRAFT'; data.publishedAt = d.publish ? new Date() : null; }
    const post = await p.blogPost.update({ where: { id: req.params.id }, data });
    return { post };
  });

  app.delete('/blog/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const existing = await p.blogPost.findUnique({ where: { id: req.params.id } });
    if (!existing) return { ok: true };
    if (!STAFF.includes(req.user.role) && existing.authorId !== req.user.uid) return reply.code(403).send({ error: 'forbidden' });
    await p.blogPost.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });

  // ── Blog-post permission grants (ADMIN/SUPERADMIN only — a MOD can moderate but
  // not hand out new authoring rights) ──
  app.get('/admin/blog-permissions', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const grants = await p.blogPermission.findMany({ orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, displayName: true, email: true, avatar: true } } } });
    const showcaseIds = [...new Set(grants.filter((g) => g.showcaseProjectId).map((g) => g.showcaseProjectId))];
    const showcases = await p.showcaseProject.findMany({ where: { id: { in: showcaseIds } }, select: { id: true, slug: true, name: true } });
    const showcaseById = Object.fromEntries(showcases.map((s) => [s.id, s]));
    return { grants: grants.map((g) => ({ id: g.id, user: g.user, projectKey: g.projectKey, showcase: g.showcaseProjectId ? showcaseById[g.showcaseProjectId] : null, createdAt: g.createdAt })) };
  });

  const grantSchema = z.object({
    userId: z.string().min(1),
    projectKey: z.enum(['community', 'bmm', 'bsm', 'installer']).optional().nullable(),
    showcaseSlug: z.string().max(80).optional().nullable(),
  });
  app.post('/admin/blog-permissions', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = grantSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const user = await p.user.findUnique({ where: { id: b.data.userId } });
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    let showcaseProjectId = null;
    if (b.data.showcaseSlug) { const sp = await p.showcaseProject.findUnique({ where: { slug: b.data.showcaseSlug } }); if (!sp) return reply.code(400).send({ error: 'unknown_page' }); showcaseProjectId = sp.id; }
    const projectKey = b.data.projectKey || null;
    const existing = await p.blogPermission.findFirst({ where: { userId: b.data.userId, projectKey, showcaseProjectId } });
    if (existing) return { grant: existing };
    const grant = await p.blogPermission.create({ data: { userId: b.data.userId, projectKey, showcaseProjectId, grantedBy: req.user.uid } });
    return reply.code(201).send({ grant });
  });
  app.delete('/admin/blog-permissions/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.blogPermission.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });
}
