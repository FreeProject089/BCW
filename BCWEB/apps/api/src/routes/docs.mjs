// Documentation ("BCWEB docs") — a GitBook-style set of pages rendered with the
// doc-block markdown system. Reading is public (published pages only); creating /
// editing / reordering / deleting is gated to ADMIN (SUPERADMIN implicitly), the
// "special role" the docs are editable with.
import { z } from 'zod';
import { db, requireRole, optionalAuth, slugify } from '../lib.mjs';

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
});

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
    // Unique slug from the title (append -2, -3… on collision).
    let base = slugify(b.data.title), slug = base, n = 1;
    while (await p.docPage.findUnique({ where: { slug } })) slug = `${base}-${++n}`;
    const page = await p.docPage.create({ data: {
      slug, title: b.data.title, category: b.data.category || 'General', icon: b.data.icon || null,
      body: b.data.body || '', bodyFr: b.data.bodyFr || null,
      order: b.data.order ?? 0, published: b.data.published ?? true,
    } });
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
    const page = await p.docPage.update({ where: { id: req.params.id }, data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.category !== undefined ? { category: d.category } : {}),
      ...(d.icon !== undefined ? { icon: d.icon || null } : {}),
      ...(d.body !== undefined ? { body: d.body } : {}),
      ...(d.bodyFr !== undefined ? { bodyFr: d.bodyFr || null } : {}),
      ...(d.order !== undefined ? { order: d.order } : {}),
      ...(d.published !== undefined ? { published: d.published } : {}),
    } });
    return { page };
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
