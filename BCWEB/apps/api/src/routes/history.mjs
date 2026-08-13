// One timeline over everything the site already records.
//
// The deliberate constraint: this route STORES NOTHING. Every entry is read from a table
// that already existed for its own reasons — staff actions, repo activity, catalog
// changes, blog and doc edits, project-config saves, payments, sign-ins. A new
// "site_history" table would have meant writing every event twice, and the copy would
// drift from the original the first time somebody added an action and forgot the mirror.
//
// The cost of that choice is that filtering and paging happen HERE rather than in one
// indexed query: each source is fetched with its own limit, the results are merged, and
// the merged list is sliced. That is fine at this scale (each source is capped, and the
// window is bounded by `days`) and it is the reason the endpoint takes a `days` window
// rather than offering unbounded scrollback.
import { z } from 'zod';
import { db, requireRole } from '../lib/lib.mjs';

// Every source, in one table so adding one is a single entry rather than three edits.
//
// `label` is what the filter chip says. `fetch` returns raw rows; `map` normalises them
// to the shared shape. Keeping map separate from fetch is what lets the actor lookup be
// done once for all sources instead of per-row.
const SOURCES = {
  staff: { label: 'Staff actions' },
  repo: { label: 'Repositories' },
  catalog: { label: 'Catalog' },
  blog: { label: 'Blog edits' },
  docs: { label: 'Doc edits' },
  project: { label: 'Project config' },
  payment: { label: 'Payments' },
  auth: { label: 'Sign-ins' },
};

const money = (c, cur) => `${((c || 0) / 100).toFixed(2)} ${String(cur || 'usd').toUpperCase()}`;

export default async function historyRoutes(app) {
  app.get('/admin/history', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const q = z.object({
      days: z.coerce.number().int().min(1).max(365).default(30),
      take: z.coerce.number().int().min(1).max(200).default(60),
      skip: z.coerce.number().int().min(0).default(0),
      // Comma-separated source keys; empty = all.
      sources: z.string().default(''),
      q: z.string().default(''),
      actorId: z.string().default(''),
    }).safeParse(req.query || {});
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' });
    const { days, take, skip, q: search, actorId } = q.data;
    const want = q.data.sources ? new Set(q.data.sources.split(',').filter((k) => k in SOURCES)) : null;
    const on = (k) => !want || want.has(k);
    const since = new Date(Date.now() - days * 864e5);
    const p = await db();

    // Per-source cap. Generous enough that a busy source still fills the page, bounded so
    // one chatty table cannot pull the whole database into memory.
    const CAP = 400;
    const out = [];
    const userIds = new Set();

    const jobs = [];
    if (on('staff')) jobs.push(p.auditLogEntry.findMany({ where: { createdAt: { gte: since }, ...(actorId ? { actorId } : {}) }, orderBy: { createdAt: 'desc' }, take: CAP })
      .then((rows) => { for (const r of rows) { userIds.add(r.actorId); out.push({ at: r.createdAt, source: 'staff', action: r.action, detail: r.detail, actorId: r.actorId, ip: r.ip || '' }); } }));

    if (on('repo')) jobs.push(p.repoAuditLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: CAP, include: { repo: { select: { id: true, name: true } } } })
      // `actor` here is a display label the repo layer wrote, not a user id — so it is
      // passed through as `actorName` and never looked up.
      .then((rows) => { for (const r of rows) out.push({ at: r.createdAt, source: 'repo', action: r.action, detail: [r.repo?.name, r.detail].filter(Boolean).join(' — '), actorName: r.actor, link: r.repo ? `/r/${r.repo.id}` : null }); }));

    if (on('catalog')) jobs.push(p.catalogAuditLog.findMany({ where: { createdAt: { gte: since }, ...(actorId ? { ownerId: actorId } : {}) }, orderBy: { createdAt: 'desc' }, take: CAP })
      .then((rows) => { for (const r of rows) { if (r.ownerId) userIds.add(r.ownerId); out.push({ at: r.createdAt, source: 'catalog', action: r.action, detail: [r.slug, r.version, r.detail].filter(Boolean).join(' · '), actorId: r.ownerId || null, link: `/item/${r.slug}` }); } }));

    if (on('blog')) jobs.push(p.blogRevision.findMany({ where: { createdAt: { gte: since }, ...(actorId ? { editorId: actorId } : {}) }, orderBy: { createdAt: 'desc' }, take: CAP, include: { post: { select: { slug: true } } } })
      .then((rows) => { for (const r of rows) { if (r.editorId) userIds.add(r.editorId); out.push({ at: r.createdAt, source: 'blog', action: `edit v${r.version}`, detail: r.title, actorId: r.editorId, link: r.post ? `/blog/${r.post.slug}` : null }); } }));

    if (on('docs')) jobs.push(p.docRevision.findMany({ where: { createdAt: { gte: since }, ...(actorId ? { editorId: actorId } : {}) }, orderBy: { createdAt: 'desc' }, take: CAP, include: { page: { select: { slug: true } } } })
      .then((rows) => { for (const r of rows) { if (r.editorId) userIds.add(r.editorId); out.push({ at: r.createdAt, source: 'docs', action: `edit v${r.version}`, detail: r.title, actorId: r.editorId, link: r.page ? `/docs/${r.page.slug}` : null }); } }));

    if (on('project')) jobs.push(p.projectConfigRevision.findMany({ where: { createdAt: { gte: since }, ...(actorId ? { editorId: actorId } : {}) }, orderBy: { createdAt: 'desc' }, take: CAP })
      .then((rows) => { for (const r of rows) { if (r.editorId) userIds.add(r.editorId); out.push({ at: r.createdAt, source: 'project', action: 'config saved', detail: r.target, actorId: r.editorId }); } }));

    if (on('payment')) jobs.push(p.payment.findMany({ where: { createdAt: { gte: since }, ...(actorId ? { userId: actorId } : {}) }, orderBy: { createdAt: 'desc' }, take: CAP })
      .then((rows) => { for (const r of rows) { userIds.add(r.userId); out.push({ at: r.createdAt, source: 'payment', action: String(r.kind).toLowerCase(), detail: `${money(r.amountCents, r.currency)} — ${r.description || ''}`.trim(), actorId: r.userId }); } }));

    if (on('auth')) jobs.push(p.loginAttempt.findMany({ where: { createdAt: { gte: since }, ...(actorId ? { userId: actorId } : {}) }, orderBy: { createdAt: 'desc' }, take: CAP })
      // Failures included on purpose: "who tried and failed" is the half of a sign-in log
      // that matters when something is wrong.
      .then((rows) => { for (const r of rows) { if (r.userId) userIds.add(r.userId); out.push({ at: r.createdAt, source: 'auth', action: r.success ? 'sign-in' : `failed (${r.reason || 'unknown'})`, detail: r.email || '', actorId: r.userId || null, ip: r.ip || '' }); } }));

    await Promise.all(jobs);

    // One lookup for every actor across every source.
    const users = userIds.size
      ? await p.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, displayName: true, email: true, avatar: true, role: true } })
      : [];
    const byId = Object.fromEntries(users.map((u) => [u.id, u]));

    let merged = out;
    if (search) {
      const s = search.toLowerCase();
      merged = merged.filter((e) => `${e.action} ${e.detail} ${e.actorName || ''} ${byId[e.actorId]?.displayName || ''} ${byId[e.actorId]?.email || ''}`.toLowerCase().includes(s));
    }
    merged.sort((a, b) => new Date(b.at) - new Date(a.at));
    const total = merged.length;
    const page = merged.slice(skip, skip + take);

    return {
      entries: page.map((e) => ({ ...e, actor: e.actorId ? (byId[e.actorId] || { id: e.actorId, displayName: '(deleted)' }) : null })),
      total,
      hasMore: total > skip + take,
      // `total` is the number of entries INSIDE the window, not of all time — said out
      // loud because a count that silently means something narrower is how a number lies.
      window: { days, since },
      sources: Object.entries(SOURCES).map(([k, v]) => ({ key: k, label: v.label })),
    };
  });
}
