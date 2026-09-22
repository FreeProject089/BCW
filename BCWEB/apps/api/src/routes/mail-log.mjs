// "See every e-mail sent": the read side of lib/mail-log.mjs.
//
// THE GUARD. requireCap('manage_users') on both routes (MODs hold it by default, as on every
// /admin/users route). The log's one piece of personal data is the recipient's address, and
// manage_users is the capability that already reads every account's address; any narrower
// grant would show a subset of what its holder can read elsewhere, any wider one would hand
// addresses to somebody who cannot otherwise see them.
//
// The list MASKS the address anyway ("go•••@gm•••.com") and refuses to search by it: a list
// is what ends up on a shared screen or in a screenshot, and a free-text search over
// addresses would be a "was mail sent to X?" oracle over the whole platform. The full address
// is sent by the detail route only, one row at a time, when a reader opens it.
//
// Nothing here can return a body: the table has no body column (see schema.prisma MailLog).
import { db, requireCap } from '../lib/lib.mjs';
import { maskAddress, MAIL_STATUSES, MAIL_LOG_KEEP_DAYS, MAIL_LOG_KEEP_ROWS } from '../lib/mail-log.mjs';

const PAGE = 50;
const noStore = (reply) => reply.header('Cache-Control', 'no-store, private');

const listView = (r) => ({
  id: r.id, to: maskAddress(r.to), mailId: r.mailId, subject: r.subject, status: r.status,
  error: r.error, attachments: r.attachments, createdAt: r.createdAt, linked: !!r.userId,
});

export default async function mailLogRoutes(app) {
  // List, newest first. Filters: status, mailId (exact), q (subject or template id, never the
  // address), since/until (ISO dates), cursor = the last row's id for the next page.
  app.get('/admin/mail/log', { preHandler: requireCap('manage_users') }, async (req, reply) => {
    const p = await db();
    const q = String(req.query?.q || '').trim().slice(0, 80);
    const status = MAIL_STATUSES.includes(req.query?.status) ? req.query.status : null;
    const mailId = typeof req.query?.mailId === 'string' && req.query.mailId ? req.query.mailId.slice(0, 60) : null;
    const date = (v) => { const d = v ? new Date(String(v)) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
    const since = date(req.query?.since); const until = date(req.query?.until);
    const cursor = typeof req.query?.cursor === 'string' && req.query.cursor ? req.query.cursor.slice(0, 40) : null;

    const where = {
      ...(status ? { status } : {}),
      ...(mailId ? { mailId } : {}),
      ...(since || until ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}),
      ...(q ? { OR: [{ subject: { contains: q, mode: 'insensitive' } }, { mailId: { contains: q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, byStatus, byTemplate, total] = await Promise.all([
      p.mailLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PAGE + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }),
      p.mailLog.groupBy({ by: ['status'], _count: { _all: true } }),
      // Sorted here rather than in the query: a template count is small, and test/mail-templates
      // reads every `mailId: '<literal>'` in the routes as a sender naming a gallery mail.
      p.mailLog.groupBy({ by: ['mailId'], _count: { _all: true } }),
      p.mailLog.count(),
    ]);
    const more = rows.length > PAGE;
    const page = more ? rows.slice(0, PAGE) : rows;
    noStore(reply);
    return {
      rows: page.map(listView),
      nextCursor: more ? page[page.length - 1].id : null,
      facets: {
        status: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
        templates: byTemplate.map((t) => ({ mailId: t.mailId, count: t._count._all })).sort((a, b) => b.count - a.count).slice(0, 60),
      },
      total,
      retention: { days: MAIL_LOG_KEEP_DAYS, rows: MAIL_LOG_KEEP_ROWS },
    };
  });

  // One row, with the whole address and the account it belonged to when it was sent.
  app.get('/admin/mail/log/:id', { preHandler: requireCap('manage_users') }, async (req, reply) => {
    const p = await db();
    const r = await p.mailLog.findUnique({ where: { id: String(req.params.id).slice(0, 40) }, include: { user: { select: { id: true, displayName: true } } } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    noStore(reply);
    return { row: { ...listView(r), to: r.to, masked: maskAddress(r.to), user: r.user || null } };
  });
}
