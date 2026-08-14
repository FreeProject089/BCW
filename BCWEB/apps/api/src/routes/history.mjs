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
import { signBytes, publicVerifyInfo } from '../lib/signing.mjs';
import { resolveRetention, RETENTION_DEFAULTS } from '../lib/retention.mjs';

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
  // ── Retention: what is TRUE, not what this tab wishes were true ───────────────
  //
  // A single "history retention" setting was the obvious thing to build and would have
  // been a lie. This tab stores nothing — every entry is read from a table that already
  // has its own retention, owned by the subsystem that writes it:
  //
  //   • analytics.retention  (AdminSetting) → sign-in attempts, and the analytics tables
  //   • audit.maxDays        (AdminSetting) → the staff audit chain
  //   • hardcoded 30 days    (lib.mjs)      → per-repository activity
  //   • never deleted                       → payments, which are financial records
  //
  // One slider over the top of that could only do one of two things: quietly fail to
  // shorten what another subsystem keeps, or start deleting another subsystem's data
  // behind its back. So this reports each source's REAL window and says who owns it,
  // and the two that are genuinely configurable are edited where they already live.
  const RETENTION_SOURCES = (analytics, auditMaxDays) => ([
    { source: 'staff', days: auditMaxDays || 0, owner: 'audit.maxDays', where: 'Security log', configurable: true },
    { source: 'auth', days: analytics.loginDays, owner: 'analytics.retention.loginDays', where: 'Analytics → retention', configurable: true },
    { source: 'repo', days: 30, owner: 'code', where: 'lib.mjs (repoLog)', configurable: false },
    { source: 'catalog', days: 0, owner: 'none', where: '—', configurable: false },
    { source: 'blog', days: 0, owner: 'blog history caps', where: 'Blog settings', configurable: false },
    { source: 'docs', days: 0, owner: 'doc history caps', where: 'Docs settings', configurable: false },
    { source: 'project', days: 0, owner: 'last 50 per project', where: 'code', configurable: false },
    { source: 'payment', days: 0, owner: 'never deleted', where: '—', configurable: false },
  ]);

  app.get('/admin/history/retention', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const [an, au] = await Promise.all([
      p.adminSetting.findUnique({ where: { key: 'analytics.retention' } }),
      p.adminSetting.findUnique({ where: { key: 'audit.maxDays' } }),
    ]);
    const analytics = resolveRetention(an?.value);
    const auditMaxDays = Number(au?.value?.maxDays ?? au?.value ?? 0) || 0;
    return {
      sources: RETENTION_SOURCES(analytics, auditMaxDays),
      defaults: RETENTION_DEFAULTS,
      // Said explicitly so the tab can explain itself rather than implying it owns any
      // of this. 0 means "kept until something else removes it", not "kept one day".
      note: 'This view stores nothing. Each row is kept by the subsystem that records it.',
    };
  });

  // The public half of the signing identity, so a downloaded export can be checked in the
  // browser — or on another machine entirely — without uploading it back here. An import
  // that has to be sent to the server to be read is not an independent check of anything.
  app.get('/admin/history/pubkey', { preHandler: requireRole('ADMIN') }, async () => publicVerifyInfo(await db()));

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

  // ── Signed export ────────────────────────────────────────────────────────────
  //
  // The same window the tab is showing, as one JSON file, signed with the server's key.
  //
  // The signature is over the EXACT bytes served, so it is computed from the serialised
  // string and not re-serialised anywhere — re-encoding the same object with different key
  // order or spacing produces different bytes and a signature that fails for no reason a
  // reader could diagnose.
  //
  // `take` is raised well above the browsing limit here: paging is a reading convenience,
  // while an export that silently stopped at 60 rows would be a file that looks complete
  // and is not. It is still bounded — an export is a snapshot, not a stream.
  app.get('/admin/history/export', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const q = z.object({
      days: z.coerce.number().int().min(1).max(365).default(30),
      sources: z.string().default(''),
      q: z.string().default(''),
      actorId: z.string().default(''),
    }).safeParse(req.query || {});
    if (!q.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // Reuse the browsing endpoint's own logic by calling it with a big page, so the export
    // can never drift from what the screen shows.
    const res = await app.inject({
      method: 'GET',
      url: `/admin/history?days=${q.data.days}&take=200&skip=0&sources=${encodeURIComponent(q.data.sources)}&q=${encodeURIComponent(q.data.q)}&actorId=${encodeURIComponent(q.data.actorId)}`,
      headers: { cookie: req.headers.cookie || '' },
    });
    if (res.statusCode !== 200) return reply.code(502).send({ error: 'export_failed' });
    const body = res.json();
    const doc = {
      kind: 'bcweb.history.export',
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: req.user.uid,
      filters: { days: q.data.days, sources: q.data.sources || 'all', q: q.data.q || null, actorId: q.data.actorId || null },
      // Stated in the file itself: a reader months later must not have to guess whether a
      // short export means a quiet month or a truncated download.
      truncated: body.hasMore === true,
      count: (body.entries || []).length,
      totalInWindow: body.total,
      entries: body.entries || [],
    };
    const json = JSON.stringify(doc, null, 2);
    const sig = await signBytes(json, p);
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="bcweb-history-${stamp}.json"`);
    reply.header('X-History-Signature', sig);
    reply.header('X-History-Signature-Alg', 'Ed25519');
    reply.header('Access-Control-Expose-Headers', 'X-History-Signature, X-History-Signature-Alg');
    return reply.send(json);
  });
}
