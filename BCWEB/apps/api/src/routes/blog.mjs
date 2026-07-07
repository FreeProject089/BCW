import { z } from 'zod';
import { db, requireRole, optionalAuth, slugify } from '../lib.mjs';

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
  // Author-configured reactions (up to 3 types) + collaborators (added by email).
  reactionsEnabled: z.boolean().optional(),
  reactionTypes: z.array(z.string().min(1).max(24)).max(3).optional(),
  coAuthorEmails: z.array(z.string().email()).max(10).optional(),
  showToc: z.boolean().optional(),
  tocTitle: z.string().max(60).optional().nullable(),
});

// Resolve a list of emails to user ids (skips unknown emails, dedupes, drops the
// primary author so they're never their own co-author).
async function resolveCoAuthorIds(p, emails, primaryAuthorId) {
  if (!emails?.length) return [];
  const users = await p.user.findMany({ where: { email: { in: [...new Set(emails)] } }, select: { id: true } });
  return [...new Set(users.map((u) => u.id))].filter((id) => id !== primaryAuthorId);
}

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
  titleFr: true, excerptFr: true, bodyFr: true, reactionsEnabled: true, reactionTypes: true, coAuthorIds: true, showToc: true, tocTitle: true,
  project: { select: { key: true, name: true } },
  showcaseProject: { select: { slug: true, name: true, short: true, icon: true } },
  author: { select: { id: true, displayName: true, avatar: true } },
};

// Attach a resolved `authors` array (primary author + co-authors, with avatars) to
// each post in a list — one batched query for every co-author id across the page.
async function attachAuthors(p, posts) {
  const coIds = [...new Set(posts.flatMap((post) => post.coAuthorIds || []))];
  const coUsers = coIds.length ? await p.user.findMany({ where: { id: { in: coIds } }, select: { id: true, displayName: true, avatar: true } }) : [];
  const coMap = new Map(coUsers.map((u) => [u.id, u]));
  for (const post of posts) {
    post.authors = [post.author, ...(post.coAuthorIds || []).map((id) => coMap.get(id)).filter(Boolean)].filter(Boolean);
  }
  return posts;
}

export default async function blogRoutes(app) {
  // Public: published posts — optionally filtered by a fixed project (?project=),
  // a custom/showcase page (?page=), or the home page's "Latest news" (?home=1,
  // only posts whose blog has showOnHomeNews — posts always show on /blog itself
  // regardless of that flag).
  app.get('/blog', { preHandler: optionalAuth() }, async (req) => {
    const p = await db();
    // Drafts (unpublished) are visible only to staff and to a post's own author —
    // never to logged-out visitors or users without edit rights.
    const isStaff = req.user && ['MOD', 'ADMIN', 'SUPERADMIN'].includes(req.user.role);
    const statusCond = isStaff ? {} : (req.user ? { OR: [{ status: 'PUBLISHED' }, { authorId: req.user.uid }] } : { status: 'PUBLISHED' });
    const AND = [statusCond];
    if (req.query?.project) AND.push({ project: { key: req.query.project } });
    if (req.query?.page) AND.push({ showcaseProject: { slug: req.query.page } });
    if (req.query?.home) AND.push({ OR: [{ project: { showOnHomeNews: true } }, { showcaseProject: { showOnHomeNews: true } }] });
    const posts = await p.blogPost.findMany({ where: { AND }, orderBy: { publishedAt: 'desc' }, select: POST_SELECT });
    await attachAuthors(p, posts);
    return { posts };
  });

  app.get('/blog/:slug', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const post = await p.blogPost.findUnique({ where: { slug: req.params.slug }, include: { project: true, showcaseProject: true, author: { select: { id: true, displayName: true, avatar: true } } } });
    // Drafts are visible only to staff or the author — a 404 to everyone else.
    const isStaff = req.user && ['MOD', 'ADMIN', 'SUPERADMIN'].includes(req.user.role);
    const canSeeDraft = post && (isStaff || (req.user && post.authorId === req.user.uid));
    if (!post || (post.status !== 'PUBLISHED' && !canSeeDraft)) return reply.code(404).send({ error: 'not_found' });
    // Resolve collaborators' avatars + a reaction summary (counts by type + the
    // current viewer's own reaction, if any).
    const coAuthors = post.coAuthorIds.length
      ? await p.user.findMany({ where: { id: { in: post.coAuthorIds } }, select: { id: true, displayName: true, avatar: true } })
      : [];
    let reactionCounts = {}, myReaction = null;
    if (post.reactionsEnabled && post.reactionTypes.length) {
      const grouped = await p.blogReaction.groupBy({ by: ['type'], where: { postId: post.id }, _count: { type: true } });
      reactionCounts = Object.fromEntries(grouped.map((g) => [g.type, g._count.type]));
      if (req.user) { const mine = await p.blogReaction.findUnique({ where: { postId_userId: { postId: post.id, userId: req.user.uid } } }); myReaction = mine?.type || null; }
    }
    return { post: { ...post, coAuthors, reactionCounts, myReaction } };
  });

  // React to a post (toggle): one reaction per user; clicking the same type removes it.
  app.post('/blog/:id/react', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ type: z.string().min(1).max(24) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const post = await p.blogPost.findUnique({ where: { id: req.params.id }, select: { id: true, reactionsEnabled: true, reactionTypes: true, status: true } });
    if (!post || post.status !== 'PUBLISHED') return reply.code(404).send({ error: 'not_found' });
    if (!post.reactionsEnabled || !post.reactionTypes.includes(b.data.type)) return reply.code(400).send({ error: 'reaction_not_allowed' });
    const key = { postId_userId: { postId: post.id, userId: req.user.uid } };
    const existing = await p.blogReaction.findUnique({ where: key });
    if (existing && existing.type === b.data.type) await p.blogReaction.delete({ where: key });
    else await p.blogReaction.upsert({ where: key, update: { type: b.data.type }, create: { postId: post.id, userId: req.user.uid, type: b.data.type } });
    const grouped = await p.blogReaction.groupBy({ by: ['type'], where: { postId: post.id }, _count: { type: true } });
    const mine = await p.blogReaction.findUnique({ where: key });
    return { reactionCounts: Object.fromEntries(grouped.map((g) => [g.type, g._count.type])), myReaction: mine?.type || null };
  });

  // Editor support: the current co-author EMAILS (so the editor can pre-fill them on
  // edit). Author or staff only — emails aren't exposed on the public post.
  app.get('/blog/:id/collab', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const post = await p.blogPost.findUnique({ where: { id: req.params.id }, select: { authorId: true, coAuthorIds: true } });
    if (!post) return reply.code(404).send({ error: 'not_found' });
    if (!STAFF.includes(req.user.role) && post.authorId !== req.user.uid) return reply.code(403).send({ error: 'forbidden' });
    const users = post.coAuthorIds.length ? await p.user.findMany({ where: { id: { in: post.coAuthorIds } }, select: { email: true } }) : [];
    return { coAuthorEmails: users.map((u) => u.email) };
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
      reactionsEnabled: !!b.data.reactionsEnabled,
      reactionTypes: (b.data.reactionTypes || []).slice(0, 3),
      showToc: !!b.data.showToc,
      tocTitle: b.data.tocTitle || null,
      coAuthorIds: await resolveCoAuthorIds(p, b.data.coAuthorEmails, req.user.uid),
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
    if (d.reactionsEnabled !== undefined) data.reactionsEnabled = d.reactionsEnabled;
    if (d.reactionTypes !== undefined) data.reactionTypes = d.reactionTypes.slice(0, 3);
    if (d.showToc !== undefined) data.showToc = d.showToc;
    if (d.tocTitle !== undefined) data.tocTitle = d.tocTitle || null;
    if (d.coAuthorEmails !== undefined) data.coAuthorIds = await resolveCoAuthorIds(p, d.coAuthorEmails, existing.authorId);
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
