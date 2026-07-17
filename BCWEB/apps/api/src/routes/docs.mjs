// Documentation ("BCWEB docs") — a GitBook-style set of pages rendered with the
// doc-block markdown system. Reading is public (published pages only); creating /
// editing / reordering / deleting is gated to ADMIN (SUPERADMIN implicitly), the
// "special role" the docs are editable with.
import { z } from 'zod';
import { db, requireRole, optionalAuth, slugify, pruneRevisions } from '../lib/lib.mjs';

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
    // Multi-term (AND) matching: split the query into words and require a page to contain ALL
    // of them somewhere. The old single-substring match meant "plugin permission" only hit if
    // that exact phrase existed — now it finds the page that mentions both, in any order. The
    // terms are returned so the client highlights each one, not just the raw query string.
    const terms = [...new Set(nq.split(/\s+/).filter((w) => w.length >= 2))];
    if (!terms.length) return { results: [] };
    const clean = (s) => s.replace(/:{2,}[\w-]*(\[[^\]]*\])?(\{[^}]*\})?/g, ' ').replace(/[|`{}#>*_[\]]+/g, ' ').replace(/-{3,}/g, ' ').replace(/\s+/g, ' ').trim();
    const results = [];
    for (const pg of pages) {
      const hay = `${pg.body || ''}\n${pg.bodyFr || ''}`;
      const titleLow = pg.title.toLowerCase();
      const hayLow = hay.toLowerCase();
      // A page qualifies only if EVERY term appears (title or body). Score rewards title hits
      // and full-title coverage, so "server repo" ranks the "Server repos" page top.
      const inTitle = terms.filter((tm) => titleLow.includes(tm));
      const present = terms.every((tm) => titleLow.includes(tm) || hayLow.includes(tm));
      if (present) {
        let score = 1 + inTitle.length * 3;
        if (inTitle.length === terms.length) score += 4; // whole query is in the title
        // Snippet centred on the first term found in the body.
        let snippet = '';
        const first = terms.map((tm) => hayLow.indexOf(tm)).filter((x) => x >= 0).sort((a, b) => a - b)[0];
        if (first != null && first >= 0) {
          const start = Math.max(0, first - 40);
          snippet = (start > 0 ? '…' : '') + clean(hay.slice(start, first + 110)) + '…';
        }
        results.push({ slug: pg.slug, title: pg.title, category: pg.category, icon: pg.icon, snippet, terms, score });
      }
      // Heading-level matches — jump straight to that section (#anchor). All terms in one heading.
      for (const h of (pg.body || '').match(/^#{2,3}\s+.+$/gm) || []) {
        const text = h.replace(/^#{2,3}\s+/, '').trim();
        const hl = text.toLowerCase();
        if (terms.every((tm) => hl.includes(tm))) results.push({ slug: pg.slug, title: pg.title, category: pg.category, icon: pg.icon, section: text, anchor: headingSlug(text), terms, score: 2 + terms.length });
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
    // Contributors — everyone who has edited this page, earliest first (the original
    // author leads). Derived from the revision history, so collaborators are credited
    // automatically (like a blog post's author + co-authors).
    const revs = await p.docRevision.findMany({ where: { pageId: page.id }, orderBy: { version: 'asc' }, select: { editorId: true } });
    const orderedIds = [...new Set(revs.map((r) => r.editorId).filter(Boolean))];
    const users = orderedIds.length ? await p.user.findMany({ where: { id: { in: orderedIds } }, select: { id: true, displayName: true, avatar: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const contributors = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    return { page, canEdit: isEditor(req), contributors };
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

  // ── Edit history: editors get full history + restore; anyone can view a PUBLISHED
  //    page's history read-only (drafts stay editor-only). ──
  app.get('/docs/:id/history', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const page = await p.docPage.findUnique({ where: { id: req.params.id }, select: { published: true } });
    if (!page) return reply.code(404).send({ error: 'not_found' });
    const editor = isEditor(req);
    if (!editor && !page.published) return reply.code(403).send({ error: 'forbidden' });
    const revs = await p.docRevision.findMany({ where: { pageId: req.params.id }, orderBy: { version: 'desc' }, take: 50 });
    const editors = await p.user.findMany({ where: { id: { in: [...new Set(revs.map((r) => r.editorId).filter(Boolean))] } }, select: { id: true, displayName: true, avatar: true } });
    const userOf = new Map(editors.map((u) => [u.id, u]));
    return { canRestore: editor, revisions: revs.map((r) => { const u = userOf.get(r.editorId);
      return { id: r.id, version: r.version, title: r.title, editor: u?.displayName || 'Unknown', editorUser: u ? { id: u.id, displayName: u.displayName, avatar: u.avatar } : null, createdAt: r.createdAt, bytes: Buffer.byteLength(r.body || '') }; }) };
  });
  app.get('/docs/:id/history/:revId', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const page = await p.docPage.findUnique({ where: { id: req.params.id }, select: { published: true } });
    if (!page) return reply.code(404).send({ error: 'not_found' });
    if (!isEditor(req) && !page.published) return reply.code(403).send({ error: 'forbidden' });
    const rev = await p.docRevision.findFirst({ where: { id: req.params.revId, pageId: req.params.id } });
    if (!rev) return reply.code(404).send({ error: 'not_found' });
    return { revision: { version: rev.version, title: rev.title, body: rev.body, bodyFr: rev.bodyFr, createdAt: rev.createdAt } };
  });

  // ── Editor-collaboration comments (threaded, mirror of the blog system) ──
  // Read: docs editors always; published + commentsPublic pages also to readers (read-only).
  // Write/edit/resolve/delete: docs editors (ADMIN/SUPERADMIN) — any editor edits any comment.
  // participants = author + everyone who edited it (pfps shown on the comment).
  const shapeC = (c, umap) => {
    const who = (id) => ({ id, name: umap.get(id)?.name || 'Unknown', avatar: umap.get(id)?.avatar || null });
    const partIds = [...new Set([c.authorId, ...(c.editorIds || [])])];
    return { id: c.id, parentId: c.parentId, anchor: c.anchor, body: c.body, resolved: c.resolved,
      author: who(c.authorId), participants: partIds.map(who), edited: (c.editorIds || []).length > 0,
      createdAt: c.createdAt, updatedAt: c.updatedAt };
  };
  const usersMap = async (p, ids) => new Map((await p.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, displayName: true, avatar: true } })).map((u) => [u.id, { name: u.displayName, avatar: u.avatar }]));

  app.get('/docs/:id/comments', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const page = await p.docPage.findUnique({ where: { id: req.params.id }, select: { published: true, commentsPublic: true } });
    if (!page) return reply.code(404).send({ error: 'not_found' });
    const editor = isEditor(req);
    if (!editor && !(page.commentsPublic && page.published)) return reply.code(403).send({ error: 'forbidden' });
    const comments = await p.docComment.findMany({ where: { pageId: req.params.id }, orderBy: { createdAt: 'asc' } });
    const umap = await usersMap(p, comments.flatMap((c) => [c.authorId, ...(c.editorIds || [])]));
    return { canComment: editor, commentsPublic: page.commentsPublic, comments: comments.map((c) => shapeC(c, umap)) };
  });

  app.post('/docs/:id/comments', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ body: z.string().min(1).max(5000), anchor: z.string().max(120).nullish(), parentId: z.string().nullish() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const page = await p.docPage.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!page) return reply.code(404).send({ error: 'not_found' });
    if (b.data.parentId) { const parent = await p.docComment.findFirst({ where: { id: b.data.parentId, pageId: req.params.id } }); if (!parent) return reply.code(400).send({ error: 'bad_parent' }); }
    const c = await p.docComment.create({ data: { pageId: req.params.id, authorId: req.user.uid, body: b.data.body, anchor: b.data.anchor || null, parentId: b.data.parentId || null } });
    await p.commentRevision.create({ data: { commentId: c.id, kind: 'doc', body: c.body, editorId: c.authorId } }).catch(() => {}); // v1
    return reply.code(201).send({ comment: shapeC(c, await usersMap(p, [c.authorId])) });
  });

  app.patch('/docs/:id/comments/:cid', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({ body: z.string().min(1).max(5000).optional(), resolved: z.boolean().optional(), baseBody: z.string().max(5000).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const exists = await p.docComment.findFirst({ where: { id: req.params.cid, pageId: req.params.id } });
    if (!exists) return reply.code(404).send({ error: 'not_found' });
    // Optimistic concurrency (mirror of blog comments): stale base → 409 + current body
    // so the client resolves a 3-way merge instead of overwriting a concurrent edit.
    if (b.data.body !== undefined && b.data.baseBody !== undefined && b.data.baseBody !== exists.body) {
      return reply.code(409).send({ error: 'comment_conflict', current: { body: exists.body } });
    }
    const addEditor = b.data.body !== undefined && req.user.uid !== exists.authorId && !(exists.editorIds || []).includes(req.user.uid);
    const c = await p.docComment.update({ where: { id: req.params.cid }, data: {
      ...(b.data.body !== undefined ? { body: b.data.body } : {}), ...(b.data.resolved !== undefined ? { resolved: b.data.resolved } : {}),
      ...(addEditor ? { editorIds: { push: req.user.uid } } : {}) } });
    if (b.data.body !== undefined && b.data.body !== exists.body) await p.commentRevision.create({ data: { commentId: c.id, kind: 'doc', body: c.body, editorId: req.user.uid } }).catch(() => {});
    return { comment: shapeC(c, await usersMap(p, [c.authorId, ...(c.editorIds || [])])) };
  });

  app.get('/docs/:id/comments/:cid/history', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const page = await p.docPage.findUnique({ where: { id: req.params.id }, select: { published: true, commentsPublic: true } });
    if (!page) return reply.code(404).send({ error: 'not_found' });
    if (!isEditor(req) && !(page.commentsPublic && page.published)) return reply.code(403).send({ error: 'forbidden' });
    // The comment must belong to THIS page — pairing a public page's id with another
    // page's comment id would otherwise leak that comment's history (CWE-639 / IDOR).
    const owns = await p.docComment.findFirst({ where: { id: req.params.cid, pageId: req.params.id }, select: { id: true } });
    if (!owns) return reply.code(404).send({ error: 'not_found' });
    const revs = await p.commentRevision.findMany({ where: { commentId: req.params.cid, kind: 'doc' }, orderBy: { createdAt: 'desc' }, take: 50 });
    const umap = await usersMap(p, revs.map((r) => r.editorId).filter(Boolean));
    return { revisions: revs.map((r) => ({ id: r.id, body: r.body, editor: umap.get(r.editorId)?.name || null, createdAt: r.createdAt })) };
  });

  app.delete('/docs/:id/comments/:cid', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    const doomed = await p.docComment.findMany({ where: { pageId: req.params.id, OR: [{ id: req.params.cid }, { parentId: req.params.cid }] }, select: { id: true } });
    const ids = doomed.map((d) => d.id);
    if (ids.length) await p.commentRevision.deleteMany({ where: { commentId: { in: ids } } }).catch(() => {});
    await p.docComment.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
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
