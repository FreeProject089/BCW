import { z } from 'zod';
import crypto from 'node:crypto';
import { db, requireRole, requireCap, notify } from '../lib/lib.mjs';
import { userBcId, findUserIdByBcId, looksLikeBcId } from '../lib/repofingerprint.mjs';
import { sendMail, mailShell, emailEnabled } from '../lib/mail.mjs';
import { powVerify } from './auth.mjs';
import { publishToThread, streamThread } from '../lib/threadbus.mjs';

const STAFF_ROLES = ['MOD', 'ADMIN', 'SUPERADMIN'];

// Report / support-thread subsystem. A user opens a report against another user / repo /
// catalog / catalog item (or a general support thread), then the reporter and staff
// exchange messages GitHub-PR style, optionally with image attachments. Lifecycle:
// open → archived (auto after inactivity or manual) → deleted (after a further delay).
// A reporter may have at most one OPEN report per target at a time.

const TARGET_TYPES = ['user', 'repo', 'catalog', 'item', 'general'];
const SITE_URL = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');

// Admin-configurable knobs (AdminSetting `reports.config`), with sane defaults.
const DEFAULT_CFG = { imageMaxMB: 10, maxImagesPerMsg: 6, archiveDays: 7, deleteDays: 30, archiveEnabled: true, deleteEnabled: true, maxOpenPerUser: 8, maxPerDay: 10 };
async function reportConfig(p) {
  const row = await p.adminSetting.findUnique({ where: { key: 'reports.config' } }).catch(() => null);
  return { ...DEFAULT_CFG, ...(row?.value || {}) };
}

// Can this user read/post in a report? The reporter, a participant, or staff (role/cap).
async function canAccessReport(p, report, user) {
  if (!report || !user) return false;
  if (report.reporterId === user.uid) return true;
  if (STAFF_ROLES.includes(user.role) || user.perms?.includes?.('manage_reports')) return true;
  const part = await p.reportParticipant.findUnique({ where: { reportId_userId: { reportId: report.id, userId: user.uid } } });
  return !!part;
}

// Attachments must be our own uploaded media (the REPORT presign returns a /api/media/…
// path). Restricting to that both matches the real upload flow AND prevents an arbitrary
// external/javascript: URL — the thumbnails are wrapped in <a href> client-side, so any
// other value would be a stored-XSS / SSRF-to-browser sink for whoever opens the thread.
const imageUrl = z.string().max(400).regex(/^\/api\/media\/[\w./-]+$/);
const msgInput = z.object({
  body: z.string().trim().max(4000).optional().default(''),
  images: z.array(imageUrl).max(12).optional().default([]),
});

async function mailReport(p, to, subject, line, reportId) {
  if (!emailEnabled() || !to) return;
  const cta = { label: 'View the conversation', url: `${SITE_URL}/dashboard?s=reports&r=${reportId}` };
  await sendMail({ to, subject, html: mailShell(subject, `<p>${line}</p>`, cta), text: `${line}\n\n${cta.url}` }).catch(() => {});
}

const reportPublic = (r) => ({
  id: r.id, targetType: r.targetType, targetId: r.targetId, targetLabel: r.targetLabel,
  reason: r.reason, status: r.status, userUnread: r.userUnread, staffUnread: r.staffUnread,
  lastActivityAt: r.lastActivityAt, archivedAt: r.archivedAt, createdAt: r.createdAt,
  messageCount: r._count?.messages,
});
const msgPublic = (m) => ({ id: m.id, body: m.body, images: m.images, staff: m.staff, authorId: m.authorId, author: m.author?.displayName || null, createdAt: m.createdAt });

// A status change is a thing that happened to the conversation, so it belongs IN the
// conversation. Before this, closing or reopening a report changed a badge and nothing
// else: the other side saw no reason, no author and no date — and, because nothing was
// published to the thread bus, saw nothing at all until they reloaded the page.
//
// `authorId: null` is the schema's own convention for a system note (see ReportMessage).
// The actor's name is baked into the body rather than linked, so deleting an account later
// cannot turn a history entry into "someone".
const STATUS_NOTE = {
  open: (who) => `${who} reopened this report.`,
  closed: (who) => `${who} closed this report.`,
  archived: (who) => `${who} archived this report.`,
};

async function noteStatusChange(p, report, status, actorName) {
  const body = (STATUS_NOTE[status] || ((w) => `${w} set the status to ${status}.`))(actorName);
  const m = await p.reportMessage.create({
    data: { reportId: report.id, authorId: null, staff: false, body, images: [] },
  });
  publishToThread('report', report.id, { type: 'message', message: msgPublic({ ...m, author: null }) });
  return m;
}

export default async function reportRoutes(app) {
  // Public: the config a client needs (max image size / count) to build the composer.
  app.get('/reports/config', async () => {
    const cfg = await reportConfig(await db());
    return { imageMaxMB: cfg.imageMaxMB, maxImagesPerMsg: cfg.maxImagesPerMsg };
  });

  // Open a report (logged-in). Logged-out users are directed to /contact by the client.
  // Antispam: a proof-of-work token (like /contact), a per-user cap on OPEN reports, and a
  // rolling 24h new-report cap — on top of the burst rate limit.
  app.post('/reports', { preHandler: requireRole(), config: { rateLimit: { max: 12, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z.object({
      targetType: z.enum(TARGET_TYPES),
      targetId: z.string().max(60).optional().default(''),
      targetLabel: z.string().max(160).optional().default(''),
      reason: z.string().max(120).optional().default(''),
      body: z.string().trim().min(1).max(4000),
      images: z.array(imageUrl).max(12).optional().default([]),
      pow: z.any().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!powVerify(req.body?.pow)) return reply.code(400).send({ error: 'pow_required' });
    const p = await db();
    const cfg = await reportConfig(p);
    if (b.data.images.length > cfg.maxImagesPerMsg) return reply.code(400).send({ error: 'too_many_images', max: cfg.maxImagesPerMsg });
    // You can't report yourself, and only one OPEN report per target at a time.
    if (b.data.targetType === 'user' && b.data.targetId === req.user.uid) return reply.code(400).send({ error: 'cannot_report_self' });
    // Antispam caps.
    if (cfg.maxOpenPerUser > 0) {
      const open = await p.report.count({ where: { reporterId: req.user.uid, status: 'open' } });
      if (open >= cfg.maxOpenPerUser) return reply.code(429).send({ error: 'too_many_open', max: cfg.maxOpenPerUser });
    }
    if (cfg.maxPerDay > 0) {
      const since = new Date(Date.now() - 864e5);
      const today = await p.report.count({ where: { reporterId: req.user.uid, createdAt: { gte: since } } });
      if (today >= cfg.maxPerDay) return reply.code(429).send({ error: 'daily_limit', max: cfg.maxPerDay });
    }
    const dup = await p.report.findFirst({ where: { reporterId: req.user.uid, targetType: b.data.targetType, targetId: b.data.targetId, status: 'open' } });
    if (dup) return reply.code(409).send({ error: 'already_open', reportId: dup.id });
    const report = await p.report.create({ data: {
      targetType: b.data.targetType, targetId: b.data.targetId, targetLabel: b.data.targetLabel,
      reason: b.data.reason, reporterId: req.user.uid, staffUnread: true,
      messages: { create: { authorId: req.user.uid, body: b.data.body, images: b.data.images } },
    } });
    // Ping staff who can handle reports.
    const staff = await p.user.findMany({ where: { OR: [{ role: { in: ['MOD', 'ADMIN', 'SUPERADMIN'] } }, { permissions: { has: 'manage_reports' } }] }, select: { id: true, email: true } });
    for (const s of staff) {
      notify(p, s.id, 'report_new', `New report on ${b.data.targetType}${b.data.targetLabel ? ` "${b.data.targetLabel}"` : ''}.`).catch(() => {});
    }
    // Email the first staff member (best-effort) so an open report is never silent.
    if (staff[0]) mailReport(p, staff[0].email, 'New report opened', `A user opened a report on ${b.data.targetType}${b.data.targetLabel ? ` "${b.data.targetLabel}"` : ''}.`, report.id);
    return reply.code(201).send({ report: reportPublic(report) });
  });

  // ── Reporter's own reports + threads they were added to ("Reports & contact") ──
  app.get('/me/reports', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const partIds = (await p.reportParticipant.findMany({ where: { userId: req.user.uid }, select: { reportId: true } })).map((x) => x.reportId);
    const rows = await p.report.findMany({ where: { OR: [{ reporterId: req.user.uid }, { id: { in: partIds } }] }, orderBy: { lastActivityAt: 'desc' }, take: 100, include: { _count: { select: { messages: true } } } });
    return { reports: rows.map((r) => ({ ...reportPublic(r), participant: r.reporterId !== req.user.uid })) };
  });

  app.get('/me/reports/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id }, include: { messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { displayName: true } } } }, participants: { include: { user: { select: { displayName: true } } } }, _count: { select: { messages: true } } } });
    if (!(await canAccessReport(p, r, req.user))) return reply.code(404).send({ error: 'not_found' });
    if (r.reporterId === req.user.uid && r.userUnread) await p.report.update({ where: { id: r.id }, data: { userUnread: false } });
    return { report: { ...reportPublic(r), participants: r.participants.map((x) => ({ userId: x.userId, name: x.user?.displayName, role: x.role })), messages: r.messages.map(msgPublic) } };
  });

  app.post('/me/reports/:id/messages', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = msgInput.safeParse(req.body);
    if (!b.success || (!b.data.body.trim() && !b.data.images.length)) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cfg = await reportConfig(p);
    if (b.data.images.length > cfg.maxImagesPerMsg) return reply.code(400).send({ error: 'too_many_images', max: cfg.maxImagesPerMsg });
    const r = await p.report.findUnique({ where: { id: req.params.id } });
    if (!(await canAccessReport(p, r, req.user))) return reply.code(404).send({ error: 'not_found' });
    if (r.status === 'closed') return reply.code(409).send({ error: 'closed' });
    // A staff participant posting counts as a staff message — BUT the reporter always posts
    // as the "user" side, even if they hold a staff role (they opened the thread as a user).
    const asStaff = (STAFF_ROLES.includes(req.user.role) || req.user.perms?.includes?.('manage_reports')) && r.reporterId !== req.user.uid;
    const m = await p.reportMessage.create({ data: { reportId: r.id, authorId: req.user.uid, staff: asStaff, body: b.data.body, images: b.data.images } });
    // A message reopens an archived thread; flag the "other side" as unread.
    await p.report.update({ where: { id: r.id }, data: { status: 'open', archivedAt: null, staffUnread: !asStaff ? true : r.staffUnread, userUnread: asStaff ? true : r.userUnread, lastActivityAt: new Date() } });
    publishToThread('report', r.id, { type: 'message', message: msgPublic({ ...m, author: null }) });
    return { message: msgPublic({ ...m, author: null }) };
  });

  // The reporter can close their own report, and reopen it while it is still theirs to
  // reopen. Asking staff to close a thread you no longer need is friction with no purpose —
  // and someone who solved their own problem is exactly who should be able to say so.
  //
  // Deliberately narrower than the staff endpoint: only the reporter (not a participant),
  // and only open <-> closed. Archiving stays a staff decision because it is about the
  // queue, not about the conversation.
  app.post('/me/reports/:id/status', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ status: z.enum(['open', 'closed']) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id } });
    if (!r || r.reporterId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    if (r.status === b.data.status) return { ok: true };
    await p.report.update({
      where: { id: r.id },
      data: { status: b.data.status, archivedAt: null, lastActivityAt: new Date(), staffUnread: true },
    });
    const actor = await p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true } });
    await noteStatusChange(p, r, b.data.status, actor?.displayName || 'The reporter');
    return { ok: true };
  });

  // Live thread (SSE). canAccessReport is the SAME predicate GET /me/reports/:id uses —
  // reporter, participant, or staff — so a stream can never reveal a thread a read would
  // hide. Note it 404s rather than 403s, exactly as the read does: whether a report exists
  // is itself not public.
  app.get('/me/reports/:id/stream', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id } });
    if (!(await canAccessReport(p, r, req.user))) return reply.code(404).send({ error: 'not_found' });
    streamThread(req, reply, 'report', r.id);
  });

  // ── Admin/mod (cap: manage_reports) ──
  app.get('/admin/reports', { preHandler: requireCap('manage_reports', 'MOD') }, async (req) => {
    const p = await db();
    const status = String(req.query?.status || '').trim();
    const where = status && ['open', 'archived', 'closed'].includes(status) ? { status } : {};
    const rows = await p.report.findMany({
      where, orderBy: [{ staffUnread: 'desc' }, { lastActivityAt: 'desc' }], take: 200,
      include: { reporter: { select: { id: true, displayName: true, email: true } }, _count: { select: { messages: true } } },
    });
    const counts = await p.report.groupBy({ by: ['status'], _count: { status: true } });
    return {
      reports: rows.map((r) => ({ ...reportPublic(r), reporterId: r.reporterId, reporter: r.reporter?.displayName, reporterEmail: r.reporter?.email, reporterBcId: r.reporter ? userBcId(r.reporter.id) : null })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count.status])),
    };
  });

  app.get('/admin/reports/:id', { preHandler: requireCap('manage_reports', 'MOD') }, async (req, reply) => {
    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id }, include: { reporter: { select: { id: true, displayName: true, email: true } }, messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { displayName: true } } } }, participants: { include: { user: { select: { id: true, displayName: true, email: true } } } }, invites: { orderBy: { createdAt: 'desc' } }, sanctions: { orderBy: { issuedAt: 'desc' }, select: { id: true, code: true, kind: true, status: true, reason: true, issuedAt: true } } } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (r.staffUnread) await p.report.update({ where: { id: r.id }, data: { staffUnread: false } });
    return { report: {
      ...reportPublic(r), reporterId: r.reporterId, reporter: r.reporter?.displayName, reporterEmail: r.reporter?.email, reporterBcId: r.reporter ? userBcId(r.reporter.id) : null,
      messages: r.messages.map(msgPublic),
      participants: r.participants.map((x) => ({ userId: x.userId, name: x.user?.displayName, email: x.user?.email, bcId: userBcId(x.userId), role: x.role })),
      invites: r.invites.map((iv) => ({ id: iv.id, token: iv.token, url: `${SITE_URL}/reports/join/${iv.token}`, maxUses: iv.maxUses, uses: iv.uses, targetType: iv.targetType, targetValue: iv.targetValue, expiresAt: iv.expiresAt })),
      // What came of it. Without this the next moderator opens a handled case and starts
      // from nothing, which is how the same complaint gets acted on twice.
      sanctions: r.sanctions,
    } };
  });

  // Add a participant to a thread by account id / email / BC id (role: staff | invited).
  app.post('/admin/reports/:id/participants', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const b = z.object({ who: z.string().min(1).max(200), role: z.enum(['staff', 'invited']).default('invited') }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (r.reporterId === req.user.uid) return reply.code(403).send({ error: 'own_report' });
    const who = b.data.who.trim();
    let user = null;
    if (who.includes('@')) user = await p.user.findFirst({ where: { email: who } });
    else if (looksLikeBcId(who)) { const uid = await findUserIdByBcId(p, who); if (uid) user = await p.user.findUnique({ where: { id: uid } }); }
    if (!user) user = await p.user.findUnique({ where: { id: who } }).catch(() => null);
    if (!user) return reply.code(404).send({ error: 'no_such_user' });
    if (user.id === r.reporterId) return reply.code(400).send({ error: 'already_reporter' });
    await p.reportParticipant.upsert({
      where: { reportId_userId: { reportId: r.id, userId: user.id } },
      create: { reportId: r.id, userId: user.id, role: b.data.role, addedById: req.user.uid },
      update: { role: b.data.role },
    });
    notify(p, user.id, 'report_added', 'You were added to a report conversation.').catch(() => {});
    mailReport(p, user.email, 'You were added to a conversation', 'A moderator added you to a report conversation.', r.id);
    return { ok: true, userId: user.id, name: user.displayName };
  });

  app.delete('/admin/reports/:id/participants/:userId', { preHandler: requireCap('manage_reports') }, async (req) => {
    const p = await db();
    await p.reportParticipant.deleteMany({ where: { reportId: req.params.id, userId: req.params.userId } });
    return { ok: true };
  });

  // Create an invite link (optionally capped by uses / locked to an account, email or creator id).
  app.post('/admin/reports/:id/invites', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const b = z.object({
      maxUses: z.number().int().min(0).max(1000).optional().default(1),
      targetType: z.enum(['any', 'user', 'email', 'creator']).optional().default('any'),
      targetValue: z.string().max(200).optional().default(''),
      expiresInDays: z.number().int().min(1).max(365).nullish(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (b.data.targetType !== 'any' && !b.data.targetValue.trim()) return reply.code(400).send({ error: 'target_value_required' });
    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (r.reporterId === req.user.uid) return reply.code(403).send({ error: 'own_report' });
    const token = crypto.randomBytes(18).toString('base64url');
    const inv = await p.reportInvite.create({ data: {
      reportId: r.id, token, maxUses: b.data.maxUses, targetType: b.data.targetType, targetValue: b.data.targetValue.trim(),
      expiresAt: b.data.expiresInDays ? new Date(Date.now() + b.data.expiresInDays * 864e5) : null, createdById: req.user.uid,
    } });
    return reply.code(201).send({ invite: { id: inv.id, token, url: `${SITE_URL}/reports/join/${token}` } });
  });

  app.delete('/admin/reports/:id/invites/:inviteId', { preHandler: requireCap('manage_reports') }, async (req) => {
    const p = await db();
    await p.reportInvite.deleteMany({ where: { id: req.params.inviteId, reportId: req.params.id } });
    return { ok: true };
  });

  // Preview + consume an invite link (logged-in). Validates target constraint, uses, expiry.
  app.get('/reports/join/:token', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const inv = await p.reportInvite.findUnique({ where: { token: req.params.token }, include: { report: { select: { id: true, targetLabel: true, targetType: true, reporterId: true } } } });
    if (!inv || !inv.report) return reply.code(404).send({ error: 'invalid_invite' });
    if (inv.expiresAt && inv.expiresAt < new Date()) return reply.code(410).send({ error: 'invite_expired' });
    if (inv.maxUses > 0 && inv.uses >= inv.maxUses) return reply.code(410).send({ error: 'invite_used_up' });
    return { report: { id: inv.report.id, label: inv.report.targetLabel, type: inv.report.targetType }, targetType: inv.targetType };
  });

  app.post('/reports/join/:token', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const inv = await p.reportInvite.findUnique({ where: { token: req.params.token }, include: { report: true } });
    if (!inv || !inv.report) return reply.code(404).send({ error: 'invalid_invite' });
    if (inv.expiresAt && inv.expiresAt < new Date()) return reply.code(410).send({ error: 'invite_expired' });
    if (inv.maxUses > 0 && inv.uses >= inv.maxUses) return reply.code(410).send({ error: 'invite_used_up' });
    // Already the reporter or a participant → just let them in (don't consume a use).
    if (inv.report.reporterId === req.user.uid) return { ok: true, reportId: inv.report.id };
    const existing = await p.reportParticipant.findUnique({ where: { reportId_userId: { reportId: inv.reportId, userId: req.user.uid } } });
    if (existing) return { ok: true, reportId: inv.report.id };
    // Enforce the invite's target constraint against the joining account.
    if (inv.targetType !== 'any') {
      const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { id: true, email: true } });
      let okTarget = false;
      if (inv.targetType === 'user') okTarget = inv.targetValue === me.id;
      else if (inv.targetType === 'email') okTarget = inv.targetValue.toLowerCase() === (me.email || '').toLowerCase();
      else if (inv.targetType === 'creator') okTarget = !!(await p.creatorLink.findFirst({ where: { userId: me.id, creatorId: inv.targetValue } }));
      if (!okTarget) return reply.code(403).send({ error: 'invite_not_for_you' });
    }
    await p.reportParticipant.create({ data: { reportId: inv.reportId, userId: req.user.uid, role: 'invited' } });
    await p.reportInvite.update({ where: { id: inv.id }, data: { uses: { increment: 1 } } });
    return { ok: true, reportId: inv.report.id };
  });

  app.post('/admin/reports/:id/messages', { preHandler: requireCap('manage_reports', 'MOD') }, async (req, reply) => {
    const b = msgInput.safeParse(req.body);
    if (!b.success || (!b.data.body.trim() && !b.data.images.length)) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id }, include: { reporter: { select: { email: true } } } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    // You can't moderate a report you opened — reply to it from your own dashboard instead.
    if (r.reporterId === req.user.uid) return reply.code(403).send({ error: 'own_report' });
    const m = await p.reportMessage.create({ data: { reportId: r.id, authorId: req.user.uid, staff: true, body: b.data.body, images: b.data.images } });
    // A staff reply reopens an archived thread and flags the reporter (notif + email).
    await p.report.update({ where: { id: r.id }, data: { status: r.status === 'closed' ? 'closed' : 'open', archivedAt: r.status === 'closed' ? r.archivedAt : null, userUnread: true, lastActivityAt: new Date() } });
    notify(p, r.reporterId, 'report_reply', 'A staff member replied to your report.').catch(() => {});
    mailReport(p, r.reporter?.email, 'Reply to your report', 'A staff member replied to your report.', r.id);
    publishToThread('report', r.id, { type: 'message', message: msgPublic({ ...m, author: null }) });
    return { message: msgPublic({ ...m, author: null }) };
  });

  // Act on a report, from the report.
  //
  // The decision and the complaint that caused it were two records that had never met: a
  // sanction carried no reason for existing, the report showed nothing so the next moderator
  // re-read a case already handled, and the person who reported it was told nothing — which
  // is how a report queue teaches people that reporting is pointless.
  //
  // The report's own target is used rather than one supplied in the body: a moderator acting
  // on report #7 means the thing report #7 is about, and letting the caller name a different
  // target would make the link a decoration.
  app.post('/admin/reports/:id/sanction', { preHandler: requireCap('manage_reports', 'MOD') }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(['warning', 'takedown']),
      reason: z.string().trim().min(3).max(1000),
      request: z.string().trim().max(2000).optional(),
      // Whether to tell the reporter that something was done. On by default: the whole point
      // of closing the loop. Off exists because naming an action to the reporter is sometimes
      // exactly what the reported person should not have handed to them.
      tellReporter: z.boolean().default(true),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });

    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id }, include: { reporter: { select: { email: true } } } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (r.reporterId === req.user.uid) return reply.code(403).send({ error: 'own_report' });
    if (!['repo', 'catalog', 'item'].includes(r.targetType) || !r.targetId) {
      // A report about a person or about nothing in particular is not a content decision, and
      // guessing which account it means from a free-text label is how the wrong person gets
      // sanctioned. Those go through the account screen, where the target is unambiguous.
      return reply.code(400).send({ error: 'not_content', detail: 'This report is not about a repo, catalog or item — sanction the account from its own screen.' });
    }

    const out = await app.inject({
      method: 'POST', url: '/admin/sanctions/content',
      headers: { cookie: req.headers.cookie || '' },
      payload: { targetType: r.targetType, targetId: r.targetId, kind: b.data.kind, reason: b.data.reason, request: b.data.request },
    });
    if (out.statusCode !== 200) return reply.code(out.statusCode).send(out.json());
    const sanction = out.json().sanction;

    await p.sanction.update({ where: { id: sanction.id }, data: { reportId: r.id } }).catch(() => {});

    // The thread gets a line, so the record of what happened lives with the complaint rather
    // than only in a moderation log the reporter cannot see.
    const note = b.data.kind === 'takedown'
      ? 'Staff reviewed this and took the content down.'
      : 'Staff reviewed this and issued a warning.';
    if (b.data.tellReporter) {
      const m = await p.reportMessage.create({ data: { reportId: r.id, authorId: req.user.uid, staff: true, body: note, images: [] } });
      await p.report.update({ where: { id: r.id }, data: { userUnread: true, lastActivityAt: new Date() } });
      notify(p, r.reporterId, 'report_reply', note).catch(() => {});
      mailReport(p, r.reporter?.email, 'Your report was acted on', note, r.id);
      publishToThread('report', r.id, { type: 'message', message: msgPublic({ ...m, author: null }) });
    }
    // Handled, not deleted: archiving starts the same countdown as any other resolution, and
    // the thread stays readable for as long as that lasts.
    await p.report.update({ where: { id: r.id }, data: { status: 'archived', archivedAt: new Date(), staffUnread: false } }).catch(() => {});

    return { ok: true, sanction: { id: sanction.id, code: sanction.code, kind: sanction.kind } };
  });

  app.post('/admin/reports/:id/status', { preHandler: requireCap('manage_reports', 'MOD') }, async (req, reply) => {
    const b = z.object({ status: z.enum(['open', 'archived', 'closed']) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id }, include: { reporter: { select: { email: true } } } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (r.reporterId === req.user.uid) return reply.code(403).send({ error: 'own_report' });
    const data = { status: b.data.status, lastActivityAt: new Date() };
    if (b.data.status === 'archived') data.archivedAt = new Date();
    if (b.data.status === 'open') data.archivedAt = null;
    await p.report.update({ where: { id: r.id }, data });
    const actor = await p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true } });
    await noteStatusChange(p, r, b.data.status, actor?.displayName || 'Staff');
    if (b.data.status === 'archived') mailReport(p, r.reporter?.email, 'Your report was archived', 'Your report was archived. Reply any time to reopen it.', r.id);
    return { ok: true };
  });

  app.delete('/admin/reports/:id', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const p = await db();
    await p.report.delete({ where: { id: req.params.id } }).catch(() => null); // cascades messages
    return { ok: true };
  });

  // Admin config (image size / count caps + archive/delete lifecycle).
  app.get('/admin/reports/config', { preHandler: requireCap('manage_reports', 'MOD') }, async () => ({ config: await reportConfig(await db()) }));
  app.put('/admin/reports/config', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const b = z.object({
      imageMaxMB: z.number().min(1).max(50).optional(),
      maxImagesPerMsg: z.number().int().min(1).max(20).optional(),
      archiveDays: z.number().int().min(1).max(365).optional(),
      deleteDays: z.number().int().min(1).max(3650).optional(),
      archiveEnabled: z.boolean().optional(),
      deleteEnabled: z.boolean().optional(),
      maxOpenPerUser: z.number().int().min(0).max(1000).optional(),
      maxPerDay: z.number().int().min(0).max(1000).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cur = await reportConfig(p);
    const value = { ...cur, ...b.data };
    await p.adminSetting.upsert({ where: { key: 'reports.config' }, create: { key: 'reports.config', value }, update: { value } });
    // Mirror the per-image cap where the presign handler reads it.
    await p.adminSetting.upsert({ where: { key: 'reports.imageMaxMB' }, create: { key: 'reports.imageMaxMB', value: { mb: value.imageMaxMB } }, update: { value: { mb: value.imageMaxMB } } });
    return { ok: true, config: value };
  });
}

// Lifecycle sweep (called from the shared sweeper): archive open reports idle beyond
// archiveDays, then delete archived ones beyond deleteDays. Emails the reporter on archive.
export async function sweepReports(p) {
  const cfg = await reportConfig(p);
  const now = Date.now();
  if (cfg.archiveEnabled) {
    const cutoff = new Date(now - cfg.archiveDays * 864e5);
    const stale = await p.report.findMany({ where: { status: 'open', lastActivityAt: { lt: cutoff } }, include: { reporter: { select: { email: true } } }, take: 200 });
    for (const r of stale) {
      await p.report.update({ where: { id: r.id }, data: { status: 'archived', archivedAt: new Date() } });
      if (emailEnabled() && r.reporter?.email) {
        const cta = { label: 'View the conversation', url: `${SITE_URL}/dashboard?s=reports&r=${r.id}` };
        sendMail({ to: r.reporter.email, subject: 'Your report was archived', html: mailShell('Your report was archived', '<p>No activity for a while, so your report was archived. Reply any time to reopen it.</p>', cta), text: `Your report was archived. Reply to reopen: ${cta.url}` }).catch(() => {});
      }
    }
  }
  if (cfg.deleteEnabled) {
    const cutoff = new Date(now - cfg.deleteDays * 864e5);
    await p.report.deleteMany({ where: { status: 'archived', archivedAt: { lt: cutoff } } });
  }
}
