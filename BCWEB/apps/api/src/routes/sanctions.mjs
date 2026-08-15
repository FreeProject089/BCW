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
import { presignPut, presignGet, deleteObject } from '../lib/storage.mjs';

const SITE_URL = process.env.SITE_URL || 'http://localhost:5176';
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// A content sanction has to reach the content, and the content already knows how to be
// suspended. One entry per type so a takedown cannot invent a state the rest of the app has
// never heard of.
// Exported so a test can check each status against its own model's vocabulary. Two of the
// three columns are plain Strings, so a wrong value is accepted by Postgres in silence.
export const CONTENT_TARGETS = {
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
    // ACTIVE, not PUBLISHED. A catalog's status is a plain string with exactly three values
    // — ACTIVE | SUSPENDED | HIDDEN — and `isServable` is `status === 'ACTIVE'`. Lifting a
    // takedown used to write PUBLISHED, which is the ITEM vocabulary (an enum that really
    // does have PUBLISHED). Nothing rejected it, because the column is a String: the
    // moderator saw the sanction lifted, the owner saw a catalog that still served nothing,
    // and no error was raised anywhere.
    up: { status: 'ACTIVE', listed: true },
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
  const def = CONTENT_TARGETS[type];
  if (!def) return null;
  const row = await def.model(p).findUnique({ where: { id }, select: { id: true, name: true, [def.owner]: true } }).catch(() => null);
  if (!row) return null;
  return { def, id: row.id, name: def.name(row), ownerId: row[def.owner] };
}

/** Staff view. Includes who issued it, which the user's view never does. */
const serForStaff = (s) => ({
  id: s.id, code: s.code, kind: s.kind, scope: s.scope, status: s.status,
  reason: s.reason, request: s.request, requiresAction: s.requiresAction,
  // Staff only. serSanctionForUser is a separate allowlist and must never gain this.
  internalNote: s.internalNote || null,
  targetType: s.targetType, targetId: s.targetId, targetName: s.targetName, relatedIds: s.relatedIds,
  issuedAt: s.issuedAt, expiresAt: s.expiresAt,
  liftedAt: s.liftedAt, liftReason: s.liftReason,
  contestedAt: s.contestedAt, contestBody: s.contestBody,
  contestOutcome: s.contestOutcome, contestAnswer: s.contestAnswer, contestAnsweredAt: s.contestAnsweredAt,
  user: s.user ? { id: s.user.id, displayName: s.user.displayName, email: s.user.email } : null,
  issuedBy: s.issuedBy ? { id: s.issuedBy.id, displayName: s.issuedBy.displayName } : null,
  meta: s.meta || null,
  // An allowlist, not a spread — a field missing here is a field the client never sees,
  // with a 200 and no error to suggest why.
  archivedAt: s.archivedAt || null,
  edits: Array.isArray(s.edits) ? s.edits : [],
  attachments: (s.attachments || []).map((a) => ({
    id: a.id, kind: a.kind, name: a.name, url: a.url, mime: a.mime, bytes: a.bytes,
    note: a.note, createdAt: a.createdAt,
    // The storage key is deliberately NOT sent. Clients fetch through the download route,
    // which re-checks the caller is staff; handing out the key would make the object
    // reachable by anyone who learned it.
    hasFile: !!a.storageKey,
  })),
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
    else if (status === 'archived') where.archivedAt = { not: null };
    else if (status) where.status = status;
    // Archived rows are OUT of every other view unless asked for by name. A settled case
    // from three years ago in the default list is why nobody reads the list, and an unread
    // list is how an open contest gets missed. Nothing is deleted — 'archived' brings it back.
    if (status !== 'archived') where.archivedAt = null;
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
        include: {
          user: { select: { id: true, displayName: true, email: true } },
          issuedBy: { select: { id: true, displayName: true } },
          // Loaded, or serForStaff reports every sanction as having no evidence — the same
          // shape of bug as catalogFingerprint hashing a relation the query never fetched.
          attachments: { orderBy: { createdAt: 'asc' } },
        },
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
      internalNote: z.string().trim().max(4000).optional(),
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
      internalNote: b.data.internalNote || null,
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
      const def = CONTENT_TARGETS[s.targetType];
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

  // Edit a sanction. Recorded, never silent.
  //
  // The reason is quoted in the e-mail the person received and in any contest they filed, so
  // changing it without a trace leaves them holding a document that no longer matches the
  // record — and leaves the next moderator unable to tell whether the wording they are
  // reading is the wording that was sent. Every change appends to `edits`.
  app.patch('/admin/sanctions/:id', { preHandler: requireCap('manage_users', 'ADMIN') }, async (req, reply) => {
    const b = z.object({
      reason: z.string().trim().min(1).max(4000).optional(),
      internalNote: z.string().trim().max(4000).optional(),
      request: z.string().trim().max(4000).nullable().optional(),
      requiresAction: z.boolean().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });

    const p = await db();
    const s = await p.sanction.findUnique({ where: { id: req.params.id } });
    if (!s) return reply.code(404).send({ error: 'not_found' });

    const at = new Date().toISOString();
    const edits = Array.isArray(s.edits) ? [...s.edits] : [];
    const data = {};
    // internalNote is in this list, not just in the zod schema above. A field that is
    // validated and then not iterated here is accepted with a 200 and silently dropped.
    for (const field of ['reason', 'internalNote', 'request', 'requiresAction', 'expiresAt']) {
      if (b.data[field] === undefined) continue;
      const to = field === 'expiresAt' && b.data[field] ? new Date(b.data[field]) : b.data[field];
      const from = s[field];
      // Compared as strings so a Date and its ISO form do not read as a change every time
      // somebody opens the editor and saves without touching anything.
      if (String(from ?? '') === String(to ?? '')) continue;
      data[field] = to;
      edits.push({ at, byId: req.user.uid, field, from: from ?? null, to: to ?? null });
    }
    if (!Object.keys(data).length) return { ok: true, unchanged: true, sanction: serForStaff({ ...s, user: null, issuedBy: null }) };

    data.edits = edits;
    const updated = await p.sanction.update({
      where: { id: s.id }, data,
      include: { attachments: true },
    });
    // The person is told — but only when something they can SEE changed. An edited decision
    // they are not told about is a different decision they are still expected to comply with;
    // a staff note they are not allowed to read is neither, and mailing "your sanction has
    // been updated" about it tells them staff are discussing them and nothing else.
    const visibleChanged = Object.keys(data).some((k) => k !== 'edits' && k !== 'internalNote');
    if (visibleChanged) {
      await notify(p, s.userId, 'account_sanction', `${s.code} has been updated.`).catch(() => {});
    }
    await logAudit(p, req.user.uid, 'sanction.edit', `${s.code} — ${Object.keys(data).filter((k) => k !== 'edits').join(', ')}`, req.ip);
    return { ok: true, sanction: serForStaff({ ...updated, user: null, issuedBy: null }) };
  });

  // Put a lifted or expired sanction back in force.
  //
  // A new row would be the wrong shape: the person already has an e-mail quoting this code,
  // and a second code for the same decision means two records to reconcile when they contest.
  // Reinstating keeps one history — the lift stays in `edits`, so "was lifted, then reapplied"
  // is readable rather than erased.
  app.post('/admin/sanctions/:id/reapply', { preHandler: requireCap('manage_users', 'ADMIN') }, async (req, reply) => {
    const b = z.object({
      reason: z.string().trim().max(1000).optional(),
      expiresAt: z.string().datetime().nullable().optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });

    const p = await db();
    const s = await p.sanction.findUnique({ where: { id: req.params.id } });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    if (s.status === 'active') return reply.code(409).send({ error: 'already_active' });
    // An overturned contest means somebody decided this was wrong. Re-imposing it silently
    // through the same button would undo a ruling without answering it; that needs a new
    // decision, with its own reason, not a reinstatement of the old one.
    if (s.contestOutcome === 'overturned') return reply.code(409).send({ error: 'contest_overturned' });

    const edits = Array.isArray(s.edits) ? [...s.edits] : [];
    edits.push({
      at: new Date().toISOString(), byId: req.user.uid, field: 'status',
      from: s.status, to: 'active', note: b.data.reason || null,
    });

    // Content takedowns hid something when they were imposed. Reapplying has to hide it
    // again, or the record says "in force" while the content is public.
    if (s.scope === 'content' && s.kind === 'takedown' && s.targetType && s.targetId) {
      const def = CONTENT_TARGETS[s.targetType];
      if (def) {
        await def.model(p).update({ where: { id: s.targetId }, data: def.down }).catch(() => {});
        if (s.relatedIds?.length) await def.model(p).updateMany({ where: { id: { in: s.relatedIds } }, data: def.down }).catch(() => {});
      }
    }

    const updated = await p.sanction.update({
      where: { id: s.id },
      data: {
        status: 'active', liftedAt: null, liftedById: null, liftReason: null,
        expiresAt: b.data.expiresAt === undefined ? s.expiresAt : (b.data.expiresAt ? new Date(b.data.expiresAt) : null),
        archivedAt: null, archivedById: null,   // back in force is not "filed away"
        edits,
      },
      include: { attachments: true },
    });
    await notify(p, s.userId, 'account_sanction', `${s.code} is in force again.${b.data.reason ? ` ${b.data.reason}` : ''}`).catch(() => {});
    await logAudit(p, req.user.uid, 'sanction.reapply', `${s.code}${b.data.reason ? ` — ${b.data.reason}` : ''}`, req.ip);
    return { ok: true, sanction: serForStaff({ ...updated, user: null, issuedBy: null }) };
  });

  // File it away, or take it back out. Never delete: a sanction is the record of a decision
  // made about a person, and a record that can be removed is not a record.
  app.post('/admin/sanctions/:id/archive', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const b = z.object({ archived: z.boolean() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const s = await p.sanction.findUnique({ where: { id: req.params.id } });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    // Refused for an active one. Archiving is "this is settled, stop showing it to me", and
    // a decision still in force is not settled — filing it away is how it stops being
    // reviewed while it is still doing something.
    if (b.data.archived && s.status === 'active') return reply.code(409).send({ error: 'still_active' });
    // An unanswered contest is somebody waiting for a reply. Hiding it is how they never get one.
    if (b.data.archived && s.contestedAt && !s.contestOutcome) return reply.code(409).send({ error: 'contest_open' });

    const updated = await p.sanction.update({
      where: { id: s.id },
      data: b.data.archived
        ? { archivedAt: new Date(), archivedById: req.user.uid }
        : { archivedAt: null, archivedById: null },
      include: { attachments: true },
    });
    await logAudit(p, req.user.uid, b.data.archived ? 'sanction.archive' : 'sanction.unarchive', s.code, req.ip);
    return { ok: true, sanction: serForStaff({ ...updated, user: null, issuedBy: null }) };
  });

  // ── Evidence ───────────────────────────────────────────────────────────────────
  //
  // Staff-only, in both directions. A report's evidence routinely names the account that
  // filed it, so serving this to the person the sanction is about would make reporting
  // unsafe. None of these routes are reachable from /me/sanctions.

  // Presign a direct upload. The key is minted HERE, under a fixed prefix, so a client can
  // never aim the PUT at another part of the bucket.
  app.post('/admin/sanctions/:id/evidence/presign', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const b = z.object({
      filename: z.string().min(1).max(200),
      contentType: z.string().max(120).optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const s = await p.sanction.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    const safeName = b.data.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `sanctions/${s.id}/${Date.now()}-${safeName}`;
    const url = await presignPut(storageKey, b.data.contentType || 'application/octet-stream');
    return { url, storageKey };
  });

  // Record an attachment: either a completed upload, or a link.
  app.post('/admin/sanctions/:id/evidence', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(['image', 'video', 'file', 'link']),
      name: z.string().trim().min(1).max(200),
      note: z.string().trim().max(2000).optional(),
      url: z.string().trim().max(2000).optional(),
      storageKey: z.string().max(300).optional(),
      mime: z.string().max(120).optional(),
      bytes: z.number().int().nonnegative().max(2 * 1024 ** 3).optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const d = b.data;

    // Exactly one of the two. A row with both is ambiguous about where the bytes are, and a
    // row with neither is an attachment that attaches nothing.
    if (d.kind === 'link') {
      if (!d.url || d.storageKey) return reply.code(400).send({ error: 'link_needs_url' });
      // http(s) only. A `javascript:` or `data:` value here would be rendered as a link on a
      // staff page, which is a stored-XSS delivery route aimed squarely at moderators.
      if (!/^https?:\/\//i.test(d.url)) return reply.code(400).send({ error: 'bad_url_scheme' });
    } else {
      if (!d.storageKey || d.url) return reply.code(400).send({ error: 'file_needs_key' });
      // Confined to this sanction's own prefix. Without it, a moderator could attach — and
      // therefore download through the staff route below — any object in the bucket by
      // naming its key (CWE-22).
      if (!d.storageKey.startsWith(`sanctions/${req.params.id}/`) || d.storageKey.includes('..')) {
        return reply.code(400).send({ error: 'bad_storage_key' });
      }
    }

    const p = await db();
    const s = await p.sanction.findUnique({ where: { id: req.params.id }, select: { id: true, code: true } });
    if (!s) return reply.code(404).send({ error: 'not_found' });
    const row = await p.sanctionAttachment.create({
      data: {
        sanctionId: s.id, kind: d.kind, name: d.name, note: d.note || null,
        url: d.kind === 'link' ? d.url : null,
        storageKey: d.kind === 'link' ? null : d.storageKey,
        mime: d.mime || null, bytes: d.bytes || 0, addedById: req.user.uid,
      },
    });
    await logAudit(p, req.user.uid, 'sanction.evidence.add', `${s.code} — ${d.kind} ${d.name}`, req.ip);
    return { ok: true, attachment: { id: row.id, kind: row.kind, name: row.name, url: row.url, mime: row.mime, bytes: row.bytes, note: row.note, createdAt: row.createdAt, hasFile: !!row.storageKey } };
  });

  // Download one. Goes through the API rather than handing out the storage key, so the
  // staff check happens on every fetch instead of once when the page was built.
  app.get('/admin/sanctions/:id/evidence/:aid', { preHandler: requireCap('manage_users', 'MOD') }, async (req, reply) => {
    const p = await db();
    const a = await p.sanctionAttachment.findUnique({ where: { id: req.params.aid } });
    if (!a || a.sanctionId !== req.params.id) return reply.code(404).send({ error: 'not_found' });
    if (!a.storageKey) return reply.code(409).send({ error: 'is_a_link', url: a.url });
    const url = await presignGet(a.storageKey, 120);
    return { url };
  });

  app.delete('/admin/sanctions/:id/evidence/:aid', { preHandler: requireCap('manage_users', 'ADMIN') }, async (req, reply) => {
    const p = await db();
    const a = await p.sanctionAttachment.findUnique({ where: { id: req.params.aid }, include: { sanction: { select: { code: true } } } });
    if (!a || a.sanctionId !== req.params.id) return reply.code(404).send({ error: 'not_found' });
    // The blob goes with the row. A stored object nothing references is one nobody will ever
    // find to delete, and this bucket holds evidence about real people.
    if (a.storageKey) await deleteObject(a.storageKey).catch(() => {});
    await p.sanctionAttachment.delete({ where: { id: a.id } });
    await logAudit(p, req.user.uid, 'sanction.evidence.remove', `${a.sanction?.code || a.sanctionId} — ${a.name}`, req.ip);
    return { ok: true };
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
        const def = CONTENT_TARGETS[s.targetType];
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
