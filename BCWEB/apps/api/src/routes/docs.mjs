// Documentation ("BCWEB docs") — a GitBook-style set of pages rendered with the
// doc-block markdown system. Reading is public (published pages only); creating /
// editing / reordering / deleting is gated to ADMIN (SUPERADMIN implicitly), the
// "special role" the docs are editable with.
import { z } from 'zod';
import { db, requireRole, optionalAuth, slugify, pruneRevisions } from '../lib.mjs';

const LIST_SELECT = { id: true, slug: true, title: true, category: true, icon: true, order: true, published: true, updatedAt: true };
// Must match the heading-anchor slug produced by the renderer (md.jsx slugify).
const headingSlug = (s) => String(s).toLowerCase().trim().replace(/[^\wÀ-ɏ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';

const pageSchema = z.object({
  title: z.string().min(1).max(160),
  category: z.string().min(1).max(60).optional(),
  icon: z.string().max(30).nullish(),
  body: z.string().max(200_000).optional(),
  bodyFr: z.string().max(200_000).nullish(),
  order: z.number().int().optional(),
  published: z.boolean().optional(),
  commentsPublic: z.boolean().optional(),
  // Version the editor loaded from — for git-style concurrent-edit conflict detection.
  baseVersion: z.number().int().optional(),
});

// Save an edit-history snapshot of a page's current content; prune per admin retention. Best-effort.
async function snapshotDoc(p, page, editorId) {
  try {
    await p.docRevision.create({ data: { pageId: page.id, version: page.version, title: page.title, body: page.body, bodyFr: page.bodyFr, editorId } });
    await pruneRevisions(p, p.docRevision, { pageId: page.id });
  } catch { /* best-effort */ }
}

// Live page count + total content bytes (octet_length), optionally excluding one page
// so an edit measures every OTHER page then adds this one's new size.
async function docsUsage(p, excludeId) {
  const ex = excludeId || '';
  const [c] = await p.$queryRaw`SELECT count(*)::int AS n, COALESCE(SUM(octet_length(body) + octet_length(COALESCE("bodyFr",''))),0)::bigint AS bytes FROM "DocPage" WHERE "id" <> ${ex}`;
  return { count: c.n, bytes: Number(c.bytes) };
}

// Site-wide docs caps (Hosting settings: docs.maxTotalPages / docs.maxTotalKB). Returns
// a 409 body or null. On edit, pass `excludeId` — only the size cap applies to edits.
async function checkDocsLimits(p, addBytes, excludeId) {
  const isEdit = !!excludeId;
  const s = Object.fromEntries((await p.adminSetting.findMany()).map((r) => [r.key, r.value]));
  const maxPages = Number(s['docs.maxTotalPages'] ?? 0);
  const maxKB = Number(s['docs.maxTotalKB'] ?? 0);
  if (maxPages > 0 || maxKB > 0) {
    const u = await docsUsage(p, excludeId);
    if (!isEdit && maxPages > 0 && u.count >= maxPages) return { error: 'docs_limit', kind: 'count', limit: maxPages, current: u.count };
    if (maxKB > 0 && u.bytes + addBytes > maxKB * 1024) return { error: 'docs_limit', kind: 'size', limitKB: maxKB, currentKB: Math.round((u.bytes + addBytes) / 1024) };
  }
  return null;
}

// Build the sidebar tree: pages grouped by category, categories ordered by the
// smallest page order they contain (then alphabetically), pages by order then title.
function toTree(pages) {
  const cats = new Map();
  for (const pg of pages) {
    if (!cats.has(pg.category)) cats.set(pg.category, []);
    cats.get(pg.category).push(pg);
  }
  return [...cats.entries()]
    .map(([name, items]) => {
      items.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
      return { category: name, minOrder: items[0]?.order ?? 0, pages: items };
    })
    .sort((a, b) => a.minOrder - b.minOrder || a.category.localeCompare(b.category));
}

export default async function docRoutes(app) {
  // Editing docs is an ADMIN/SUPERADMIN capability (a role only an admin/superadmin
  // assigns) — matches the requireRole('ADMIN') guard on the write routes, so the
  // client never shows New/Edit to someone who would be 403'd on save.
  const isEditor = (req) => req.user && ['ADMIN', 'SUPERADMIN'].includes(req.user.role);

  // Sidebar / index. Editors also see unpublished drafts.
  app.get('/docs', { preHandler: optionalAuth() }, async (req) => {
    const p = await db();
    const where = isEditor(req) ? {} : { published: true };
    const pages = await p.docPage.findMany({ where, select: LIST_SELECT });
    return { tree: toTree(pages), canEdit: isEditor(req) };
  });

  // Full-text-ish search over titles + bodies (for the Ctrl/⌘-K palette). Ranks
  // title hits above body hits and returns a short snippet around the first match.
  app.get('/docs/search', { preHandler: optionalAuth() }, async (req) => {
    const q = String(req.query?.q || '').trim();
    if (q.length < 2) return { results: [] };
    const p = await db();
    const where = isEditor(req) ? {} : { published: true };
    const pages = await p.docPage.findMany({ where, select: { slug: true, title: true, category: true, icon: true, body: true, bodyFr: true } });
    const nq = q.toLowerCase();
    const results = [];
    for (const pg of pages) {
      const hay = `${pg.body || ''}\n${pg.bodyFr || ''}`;
      const inTitle = pg.title.toLowerCase().includes(nq);
      const bi = hay.toLowerCase().indexOf(nq);
      if (inTitle || bi >= 0) {
        let snippet = '';
        if (bi >= 0) {
          const start = Math.max(0, bi - 40);
          // Strip markdown/table/directive noise so snippets read as prose (they
          // were showing raw `| GET | \`/docs\` |` pipes and ::: fences).
          snippet = (start > 0 ? '…' : '') + hay.slice(start, bi + q.length + 70)
            .replace(/:{2,}[\w-]*(\[[^\]]*\])?(\{[^}]*\})?/g, ' ')
            .replace(/[|`{}#>*_[\]]+/g, ' ')
            .replace(/-{3,}/g, ' ')
            .replace(/\s+/g, ' ').trim() + '…';
        }
        results.push({ slug: pg.slug, title: pg.title, category: pg.category, icon: pg.icon, snippet, score: inTitle ? 3 : 1 });
      }
      // Heading-level matches — jump straight to that section (#anchor).
      for (const h of (pg.body || '').match(/^#{2,3}\s+.+$/gm) || []) {
        const text = h.replace(/^#{2,3}\s+/, '').trim();
        if (text.toLowerCase().includes(nq)) results.push({ slug: pg.slug, title: pg.title, category: pg.category, icon: pg.icon, section: text, anchor: headingSlug(text), score: 2 });
      }
    }
    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return { results: results.slice(0, 15) };
  });

  // A single page by slug (draft visible to editors only).
  app.get('/docs/:slug', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const page = await p.docPage.findUnique({ where: { slug: req.params.slug } });
    if (!page || (!page.published && !isEditor(req))) return reply.code(404).send({ error: 'not_found' });
    return { page, canEdit: isEditor(req) };
  });

  // "Was this helpful?" — a single yes/no tally bump. Deduping is client-side
  // (localStorage), so this is intentionally lightweight and unauthenticated.
  app.post('/docs/:id/feedback', async (req, reply) => {
    // 3-face rating: 'good' | 'ok' | 'bad' (legacy: helpful:true→good, false→bad).
    let rating = req.body?.rating;
    if (!rating && typeof req.body?.helpful === 'boolean') rating = req.body.helpful ? 'good' : 'bad';
    const field = { good: 'helpfulYes', ok: 'helpfulOk', bad: 'helpfulNo' }[rating];
    if (!field) return reply.code(400).send({ error: 'invalid_rating' });
    const p = await db();
    const page = await p.docPage.update({ where: { id: req.params.id }, data: { [field]: { increment: 1 } },
      select: { helpfulYes: true, helpfulOk: true, helpfulNo: true } }).catch(() => null);
    if (!page) return reply.code(404).send({ error: 'not_found' });
    return page;
  });

  // Create.
  app.post('/docs', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = pageSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid', detail: b.error.flatten() });
    const p = await db();
    // Site-wide docs caps (count + size) — refuse creation when full.
    const addBytes = Buffer.byteLength(b.data.body || '') + Buffer.byteLength(b.data.bodyFr || '');
    const limitErr = await checkDocsLimits(p, addBytes, null);
    if (limitErr) return reply.code(409).send(limitErr);
    // Unique slug from the title (append -2, -3… on collision).
    let base = slugify(b.data.title), slug = base, n = 1;
    while (await p.docPage.findUnique({ where: { slug } })) slug = `${base}-${++n}`;
    const page = await p.docPage.create({ data: {
      slug, title: b.data.title, category: b.data.category || 'General', icon: b.data.icon || null,
      body: b.data.body || '', bodyFr: b.data.bodyFr || null,
      order: b.data.order ?? 0, published: b.data.published ?? true,
      commentsPublic: !!b.data.commentsPublic,
    } });
    await snapshotDoc(p, page, req.user.uid);
    return reply.code(201).send({ page });
  });

  // Update.
  app.patch('/docs/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = pageSchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid', detail: b.error.flatten() });
    const p = await db();
    const exists = await p.docPage.findUnique({ where: { id: req.params.id } });
    if (!exists) return reply.code(404).send({ error: 'not_found' });
    const d = b.data;
    // Optimistic concurrency — a stale baseVersion means a concurrent save; hand back
    // the current copy so the editor can 3-way merge instead of overwriting it.
    const touchesContent = ['title', 'body', 'bodyFr'].some((k) => d[k] !== undefined);
    if (d.baseVersion !== undefined && touchesContent && d.baseVersion !== exists.version) {
      return reply.code(409).send({ error: 'version_conflict', current: {
        version: exists.version, title: exists.title, body: exists.body, bodyFr: exists.bodyFr,
      } });
    }
    // Size cap also applies on edit (count cap never trips on edit — see checkDocsLimits).
    if (touchesContent) {
      const newBody = d.body !== undefined ? d.body : exists.body;
      const newBodyFr = d.bodyFr !== undefined ? d.bodyFr : exists.bodyFr;
      const limitErr = await checkDocsLimits(p, Buffer.byteLength(newBody || '') + Buffer.byteLength(newBodyFr || ''), req.params.id);
      if (limitErr) return reply.code(409).send(limitErr);
    }
    const page = await p.docPage.update({ where: { id: req.params.id }, data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.category !== undefined ? { category: d.category } : {}),
      ...(d.icon !== undefined ? { icon: d.icon || null } : {}),
      ...(d.body !== undefined ? { body: d.body } : {}),
      ...(d.bodyFr !== undefined ? { bodyFr: d.bodyFr || null } : {}),
      ...(d.order !== undefined ? { order: d.order } : {}),
      ...(d.published !== undefined ? { published: d.published } : {}),
      ...(d.commentsPublic !== undefined ? { commentsPublic: d.commentsPublic } : {}),
      ...(touchesContent ? { version: { increment: 1 } } : {}),
    } });
    if (touchesContent) await snapshotDoc(p, page, req.user.uid);
    return { page };
  });

  // ── Edit history: list snapshots + read one (ADMIN, like the rest of doc editing) ──
  app.get('/docs/:id/history', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const revs = await p.docRevision.findMany({ where: { pageId: req.params.id }, orderBy: { version: 'desc' }, take: 50 });
    const editors = await p.user.findMany({ where: { id: { in: [...new Set(revs.map((r) => r.editorId).filter(Boolean))] } }, select: { id: true, displayName: true } });
    const nameOf = new Map(editors.map((u) => [u.id, u.displayName]));
    return { revisions: revs.map((r) => ({ id: r.id, version: r.version, title: r.title, editor: nameOf.get(r.editorId) || 'Unknown', createdAt: r.createdAt, bytes: Buffer.byteLength(r.body || '') })) };
  });
  app.get('/docs/:id/history/:revId', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    const rev = await p.docRevision.findFirst({ where: { id: req.params.revId, pageId: req.params.id } });
    if (!rev) return reply.code(404).send({ error: 'not_found' });
    return { revision: { version: rev.version, title: rev.title, body: rev.body, bodyFr: rev.bodyFr, createdAt: rev.createdAt } };
  });

  // ── Editor-collaboration comments (threaded, mirror of the blog system) ──
  // Read: docs editors always; published + commentsPublic pages also to readers (read-only).
  // Write/edit/resolve/delete: docs editors (ADMIN/SUPERADMIN) — any editor edits any comment.
  const shapeC = (c, nameOf, avaOf) => ({ id: c.id, parentId: c.parentId, anchor: c.anchor, body: c.body, resolved: c.resolved,
    author: { id: c.authorId, name: nameOf.get(c.authorId) || 'Unknown', avatar: avaOf?.get(c.authorId) || null }, createdAt: c.createdAt, updatedAt: c.updatedAt });

  app.get('/docs/:id/comments', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const page = await p.docPage.findUnique({ where: { id: req.params.id }, select: { published: true, commentsPublic: true } });
    if (!page) return reply.code(404).send({ error: 'not_found' });
    const editor = isEditor(req);
    if (!editor && !(page.commentsPublic && page.published)) return reply.code(403).send({ error: 'forbidden' });
    const comments = await p.docComment.findMany({ where: { pageId: req.params.id }, orderBy: { createdAt: 'asc' } });
    const authors = await p.user.findMany({ where: { id: { in: [...new Set(comments.map((c) => c.authorId))] } }, select: { id: true, displayName: true, avatar: true } });
    const nameOf = new Map(authors.map((u) => [u.id, u.displayName])); const avaOf = new Map(authors.map((u) => [u.id, u.avatar]));
    return { canComment: editor, commentsPublic: page.commentsPublic, comments: comments.map((c) => shapeC(c, nameOf, avaOf)) };
  });

  app.post('/docs/:id/comments', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ body: z.string().min(1).max(5000), anchor: z.string().max(120).nullish(), parentId: z.string().nullish() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const page = await p.docPage.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!page) return reply.code(404).send({ error: 'not_found' });
    if (b.data.parentId) { const parent = await p.docComment.findFirst({ where: { id: b.data.parentId, pageId: req.params.id } }); if (!parent) return reply.code(400).send({ error: 'bad_parent' }); }
    const c = await p.docComment.create({ data: { pageId: req.params.id, authorId: req.user.uid, body: b.data.body, anchor: b.data.anchor || null, parentId: b.data.parentId || null } });
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true, avatar: true } });
    return reply.code(201).send({ comment: shapeC(c, new Map([[req.user.uid, me?.displayName]]), new Map([[req.user.uid, me?.avatar]])) });
  });

  app.patch('/docs/:id/comments/:cid', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ body: z.string().min(1).max(5000).optional(), resolved: z.boolean().optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const exists = await p.docComment.findFirst({ where: { id: req.params.cid, pageId: req.params.id } });
    if (!exists) return reply.code(404).send({ error: 'not_found' });
    const c = await p.docComment.update({ where: { id: req.params.cid }, data: {
      ...(b.data.body !== undefined ? { body: b.data.body } : {}), ...(b.data.resolved !== undefined ? { resolved: b.data.resolved } : {}) } });
    return { comment: { id: c.id, body: c.body, resolved: c.resolved, updatedAt: c.updatedAt } };
  });

  app.delete('/docs/:id/comments/:cid', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    await p.docComment.deleteMany({ where: { pageId: req.params.id, OR: [{ id: req.params.cid }, { parentId: req.params.cid }] } }).catch(() => {});
    return { ok: true };
  });

  // Bulk reorder: [{ id, order, category? }] — used by the sidebar drag/reorder.
  app.patch('/docs', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.array(z.object({ id: z.string(), order: z.number().int(), category: z.string().max(60).optional() })).max(500).safeParse(req.body?.pages);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const p = await db();
    await p.$transaction(b.data.map((r) => p.docPage.update({ where: { id: r.id }, data: { order: r.order, ...(r.category ? { category: r.category } : {}) } })));
    return { ok: true };
  });

  // Delete.
  app.delete('/docs/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    await p.docPage.delete({ where: { id: req.params.id } }).catch(() => {});
    return reply.code(204).send();
  });
}
