// FAQ — public Q&A grouped by category. Reading is public (published items only); editing
// is gated to ADMIN/SUPERADMIN (the same "special role" that edits the docs). Answers are
// the BetterCommunity doc-block markdown, rendered client-side with the shared md.jsx.
import { z } from 'zod';
import { db, requireRole, requireCap, optionalAuth } from '../lib/lib.mjs';

const faqSchema = z.object({
  question: z.string().min(1).max(300),
  answer: z.string().max(20_000).optional(),
  answerFr: z.string().max(20_000).nullish(),
  category: z.string().min(1).max(60).optional(),
  order: z.number().int().optional(),
  published: z.boolean().optional(),
});

export default async function faqRoutes(app) {
  const isEditor = (req) => req.user && ['ADMIN', 'SUPERADMIN'].includes(req.user.role);

  // Public feed — published items (editors also see drafts), grouped client-side by category.
  app.get('/faq', { preHandler: optionalAuth() }, async (req) => {
    const p = await db();
    const where = isEditor(req) ? {} : { published: true };
    const items = await p.faqItem.findMany({ where, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
    return { items, canEdit: isEditor(req) };
  });

  // ── Admin CRUD (ADMIN/SUPERADMIN) ───────────────────────────────────────────
  app.get('/admin/faq', { preHandler: requireCap('manage_faq') }, async () => {
    const p = await db();
    return { items: await p.faqItem.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }) };
  });
  app.post('/admin/faq', { preHandler: requireCap('manage_faq') }, async (req, reply) => {
    const b = faqSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const max = await p.faqItem.aggregate({ _max: { order: true } });
    const item = await p.faqItem.create({ data: {
      question: b.data.question, answer: b.data.answer || '', answerFr: b.data.answerFr || null,
      category: b.data.category || 'General', published: b.data.published ?? true,
      order: b.data.order ?? ((max._max.order ?? 0) + 1),
    } });
    return { ok: true, item };
  });
  app.patch('/admin/faq/:id', { preHandler: requireCap('manage_faq') }, async (req, reply) => {
    const b = faqSchema.partial().safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const data = {};
    for (const k of ['question', 'answer', 'category', 'order', 'published']) if (b.data[k] !== undefined) data[k] = b.data[k];
    if (b.data.answerFr !== undefined) data.answerFr = b.data.answerFr || null;
    const item = await p.faqItem.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    return { ok: true, item };
  });
  app.delete('/admin/faq/:id', { preHandler: requireCap('manage_faq') }, async (req) => {
    const p = await db();
    await p.faqItem.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });
}
