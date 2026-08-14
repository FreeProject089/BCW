// Sanctions: the record, the contest, and the staff side of both.
//
// Deliberately thin. Enforcement lives where it already lived — accountLock for the account,
// suspendOwned for the content, the repo and catalog status columns for a takedown — and this
// file only writes the paperwork and calls those. Duplicating the enforcement here would give
// the project two answers to "is this repo online", which is exactly the kind of pair that
// drifts.
import { z } from 'zod';
import { db, requireRole, requireCap, logAudit, notify, hasCap } from '../lib/lib.mjs';
import { issueSanction, mailSanction, serSanctionForUser, KINDS, TARGET_TYPES } from '../lib/sanctions.mjs';
import { sendMail, mailShell, emailEnabled } from '../lib/mail.mjs';

const SITE_URL = process.env.SITE_URL || 'http://localhost:5176';
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A content sanction has to reach the content, and the content already knows how to be
// suspended. One entry per type so a takedown cannot invent a state the rest of the app has
// never heard of.
const CONTENT = {
  repo: {
    model: (p) => p.serverRepo,
    owner: 'ownerId',
    name: (r) => r.name,
    down: { status: 'SUSPENDED' },
    // Restoring puts it back ONLINE rather than to whatever it was: a takedown is a decision
    // about the content, not a freeze of the account, so there is no earlier state to return
    // to beyond "served again".
    up: { status: 'ONLINE' },
  },
  catalog: {
    model: (p) => p.communityCatalog,
    owner: 'ownerId',
    name: (c) => c.name,
    down: { status: 'SUSPENDED', listed: false },
    up: { status: 'PUBLISHED', listed: true },
  },
  item: {
    model: (p) => p.catalogItem,
    owner: 'ownerId',
    name: (i) => i.name,
    down: { status: 'SUSPENDED' },
    up: { status: 'PUBLISHED' },
  },
};

/** Load a piece of content and who answers for it. Returns null when it does not exist, so a
 *  staff member cannot use a takedown form to discover which ids are real. */
async function loadTarget(p, type, id) {
  const def = CONTENT[type];
  if (!def) return null;
  const row = await def.model(p).findUnique({ where: { id }, select: { id: true, name: true, [def.owner]: true } }).catch(() => null);
  if (!row) return null;
  return { def, id: row.id, name: def.name(row), ownerId: row[def.owner] };
}

/** Staff view. Includes who issued it, which the user's view never does. */
const serForStaff = (s) => ({
  id: s.id, code: s.code, kind: s.kind, scope: s.scope, status: s.status,
  reason: s.reason, request: s.request, requiresAction: s.requiresAction,
  targetType: s.targetType, targetId: s.targetId, targetName: s.targetName, relatedIds: s.relatedIds,
  issuedAt: s.issuedAt, expiresAt: s.expiresAt,
  liftedAt: s.liftedAt, liftReason: s.liftReason,
  contestedAt: s.contestedAt, contestBody: s.contestBody,
  contestOutcome: s.contestOutcome, contestAnswer: s.contestAnswer, contestAnsweredAt: s.contestAnsweredAt,
  user: s.user ? { id: s.user.id, displayName: s.user.displayName, email: s.user.email } : null,
  issuedBy: s.issuedBy ? { id: s.issuedBy.id, displayName: s.issuedBy.displayName } : null,
  meta: s.meta || null,
});

export default async function sanctionRoutes(app) {
  // ── The person it landed on ────────────────────────────────────────────────────

  app.get('/me/sanctions', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const rows = await p.sanction.findMany({ where: { userId: req.user.uid }, orderBy: { issuedAt: 'desc' }, take: 100 });
    return { sanctions: rows.map(serSanctionForUser) };
  });

  // By code, because that is what the e-mail gave them. Scoped to their own account: a code
  // is short enough to guess at, and somebody else's sanction is none of their business.
  app.get('/me/sanctions/:code', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const s = await p.sanction.findFirst({ where: { code: String(req.params.code).toUpperCase(), userId: req.user.uid } });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    return { sanction: serSanctionForUser(s) };
  });

  // Contest it. Note what this is NOT: it does not lift anything and it does not pause a
  // clock. An admin closure in particular cannot be cancelled by the person it lands on —
  // that is the whole difference from closing your own account — but it can be argued with,
  // and an argument nobody can file is not a right.
  app.post('/me/sanctions/:code/contest', {
    preHandler: requireRole(), config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const b = z.object({ body: z.string().trim().min(20).max(4000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: 'Say what is wrong, in at least a couple of sentences.' });
    const p = await db();
    const s = await p.sanction.findFirst({ where: { code: String(req.params.code).toUpperCase(), userId: req.user.uid } });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    // One contest per decision. A second one is not new evidence, it is the same complaint
    // arriving twice, and a queue that fills with duplicates is a queue nobody reads.
    if (s.contestedAt) return reply.code(409).send({ error: 'already_contested', contestedAt: s.contestedAt });
    const updated = await p.sanction.update({ where: { id: s.id }, data: { contestedAt: new Date(), contestBody: b.data.body } });
    return { ok: true, sanction: serSanctionForUser(updated) };
  });

  // ── Staff ──────────────────────────────────────────────────────────────────────

  app.get('/admin/sanctions', { preHandler: requireCap('manage_users', 'MOD') }, async (req) => {
    const p = await db();
    const q = String(req.query?.q || '').trim();
    const status = String(req.query?.status || '').trim();
    const kind = String(req.query?.kind || '').trim();
    const scope = String(req.query?.scope || '').trim();
    const where = {};
    if (status === 'contested') { where.contestedAt = { not: null }; where.contestOutcome = null; }
    else if (status) where.status = status;
    if (kind) where.kind = kind;
    if (scope) where.scope = scope;
    if (q) {
      where.OR = [
        { code: { contains: q.toUpperCase() } },
        { reason: { contains: q, mode: 'insensitive' } },
        { targetName: { contains: q, mode: 'insensitive' } },
        { user: { is: { email: { contains: q, mode: 'insensitive' } } } },
        { user: { is: { displayName: { contains: q, mode: 'insensitive' } } } },
      ];
    }
    const [rows, total, openContests] = await Promise.all([
      p.sanction.findMany({
        where, orderBy: { issuedAt: 'desc' }, take: Math.min(Number(req.query?.take) || 50, 200),
        include: { user: { select: { id: true, displayName: true, email: true } }, issuedBy: { select: { id: true, displayName: true } } },
      }),
      p.sanction.count({ where }),
      p.sanction.count({ where: { contestedAt: { not: null }, contestOutcome: null } }),
    ]);
    return { sanctions: rows.map(serForStaff), total, openContests, kinds: KINDS, targetTypes: TARGET_TYPES };
  });

  // Issue one against CONTENT. The account path stays where it was (/admin/users/:id/moderate)
  // — one endpoint per kind of thing being acted on, rather than one endpoint with a mode flag
  // that half the callers get wrong.
  app.post('/admin/sanctions/content', { preHandler: requireCap('manage_catalogs', 'MOD') }, async (req, reply) => {
    const b = z.object({
      targetType: z.enum(['repo', 'catalog', 'item']),
      targetId: z.string().min(1),
      kind: z.enum(['warning', 'takedown']),
      reason: z.string().trim().min(3).max(1000),
      request: z.string().trim().max(2000).optional(),
      // Other items caught by the same decision, so one takedown names them all instead of
      // becoming five unrelated records the person has to piece together.
      relatedIds: z.array(z.string().min(1)).max(50).optional(),
      expiresAt: z.string().datetime().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });

    const p = await db();
    const t = await loadTarget(p, b.data.targetType, b.data.targetId);
    if (!t) return reply.code(404).send({ error: 'not_found' });
    if (t.ownerId === req.user.uid) return reply.code(400).send({ error: 'cannot_moderate_own_content' });

    // A warning leaves the content alone — that is what makes it a warning rather than a
    // takedown with extra words.
    if (b.data.kind === 'takedown') {
      await t.def.model(p).update({ where: { id: t.id }, data: t.def.down }).catch(() => {});
      if (b.data.relatedIds?.length) {
        await t.def.model(p).updateMany({ where: { id: { in: b.data.relatedIds }, [t.def.owner]: t.ownerId }, data: t.def.down }).catch(() => {});
      }
    }

    const s = await issueSanction(p, {
      userId: t.ownerId, kind: b.data.kind, scope: 'content',
      reason: b.data.reason, request: b.data.request || null,
      targetType: b.data.targetType, targetId: t.id, targetName: t.name,
      relatedIds: b.data.relatedIds || [],
      issuedById: req.user.uid,
      expiresAt: b.data.expiresAt ? new Date(b.data.expiresAt) : null,
      log: req.log,
    });
    await logAudit(p, req.user.uid, `content.${b.data.kind}`, `${b.data.targetType} ${t.name} (${s.code}) — ${b.data.reason}`, req.ip);
    return { ok: true, sanction: serForStaff({ ...s, user: null, issuedBy: null }) };
  });

  // Lift one. For a content sanction this also puts the content back; for an account one it
  // does not, because reactivating an account is a bigger decision with its own endpoint and
  // its own restore-to-previous-state logic.
  app.post('/admin/sanctions/:id/lift', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const b = z.object({ reason: z.string().trim().max(1000).optional() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const s = await p.sanction.findUnique({ where: { id: req.params.id } });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    if (s.status !== 'active') return reply.code(409).send({ error: 'not_active', status: s.status });

    if (s.scope === 'content' && s.kind === 'takedown' && s.targetType && s.targetId) {
      const def = CONTENT[s.targetType];
      if (def) {
        await def.model(p).update({ where: { id: s.targetId }, data: def.up }).catch(() => {});
        if (s.relatedIds?.length) await def.model(p).updateMany({ where: { id: { in: s.relatedIds } }, data: def.up }).catch(() => {});
      }
    }
    const updated = await p.sanction.update({
      where: { id: s.id },
      data: { status: 'lifted', liftedAt: new Date(), liftedById: req.user.uid, liftReason: b.data.reason || null },
    });
    await notify(p, s.userId, 'account_sanction', `${s.code} has been lifted.${b.data.reason ? ` ${b.data.reason}` : ''}`).catch(() => {});
    await logAudit(p, req.user.uid, 'sanction.lift', `${s.code}${b.data.reason ? ` — ${b.data.reason}` : ''}`, req.ip);
    return { ok: true, sanction: serForStaff({ ...updated, user: null, issuedBy: null }) };
  });

  // Answer a contest. Overturning lifts it in the same breath — an answer that says "you were
  // right" while the sanction stays in force is not an answer.
  app.post('/admin/sanctions/:id/contest', { preHandler: requireCap('manage_users', 'ADMIN') }, async (req, reply) => {
    const b = z.object({
      outcome: z.enum(['upheld', 'overturned']),
      answer: z.string().trim().min(3).max(4000),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const s = await p.sanction.findUnique({ where: { id: req.params.id }, include: { user: { select: { email: true, displayName: true } } } });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    if (!s.contestedAt) return reply.code(409).send({ error: 'not_contested' });

    const data = {
      contestOutcome: b.data.outcome, contestAnswer: b.data.answer,
      contestAnsweredAt: new Date(), contestAnsweredById: req.user.uid,
    };
    if (b.data.outcome === 'overturned' && s.status === 'active') {
      Object.assign(data, { status: 'lifted', liftedAt: new Date(), liftedById: req.user.uid, liftReason: 'Contest upheld.' });
      if (s.scope === 'content' && s.targetType && s.targetId) {
        const def = CONTENT[s.targetType];
        if (def) await def.model(p).update({ where: { id: s.targetId }, data: def.up }).catch(() => {});
      }
    }
    const updated = await p.sanction.update({ where: { id: s.id }, data });

    await notify(p, s.userId, 'account_sanction', `Your contest of ${s.code} was ${b.data.outcome}. ${b.data.answer.slice(0, 200)}`).catch(() => {});
    if (emailEnabled()) {
      await sendMail({
        to: s.user.email, subject: `[${s.code}] Your contest was ${b.data.outcome}`,
        html: mailShell(`Contest ${b.data.outcome}`, `
          <p>Hi ${escapeHtml(s.user.displayName || '')},</p>
          <p>We have looked again at <code>${s.code}</code>.</p>
          <p style="margin-top:12px"><b>Outcome:</b> ${b.data.outcome}</p>
          <p style="margin-top:12px">${escapeHtml(b.data.answer)}</p>`,
          { url: `${SITE_URL}/sanctions/${s.code}`, label: 'Open it' }),
        text: `Contest of ${s.code}: ${b.data.outcome}. ${b.data.answer}`,
      }).catch(() => {});
    }
    await logAudit(p, req.user.uid, 'sanction.contest', `${s.code} → ${b.data.outcome}`, req.ip);
    return { ok: true, sanction: serForStaff({ ...updated, user: null, issuedBy: null }) };
  });

  // Re-send the notice. Support asks for this constantly ("I never got the mail"), and the
  // alternative — a moderator retyping the decision into a personal e-mail — is how two
  // versions of one sanction start existing.
  app.post('/admin/sanctions/:id/resend', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const p = await db();
    const s = await p.sanction.findUnique({ where: { id: req.params.id } });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    const sent = await mailSanction(p, s);
    return { ok: true, sent };
  });

  // Everything against one account, for the user-detail screen. A MOD looking at somebody
  // needs the history in the same place as the buttons that add to it.
  app.get('/admin/users/:id/sanctions', { preHandler: requireCap('manage_users', 'MOD') }, async (req) => {
    const p = await db();
    const rows = await p.sanction.findMany({
      where: { userId: req.params.id }, orderBy: { issuedAt: 'desc' }, take: 100,
      include: { issuedBy: { select: { id: true, displayName: true } } },
    });
    return { sanctions: rows.map((s) => serForStaff({ ...s, user: null })) };
  });
}
