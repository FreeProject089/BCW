import { z } from 'zod';
import { db, requireRole, requireCap, notify } from '../lib/lib.mjs';
import { userBcId } from '../lib/repofingerprint.mjs';
import { sendMail, mailShell, emailEnabled } from '../lib/mail.mjs';

// Report / support-thread subsystem. A user opens a report against another user / repo /
// catalog / catalog item (or a general support thread), then the reporter and staff
// exchange messages GitHub-PR style, optionally with image attachments. Lifecycle:
// open → archived (auto after inactivity or manual) → deleted (after a further delay).
// A reporter may have at most one OPEN report per target at a time.

const TARGET_TYPES = ['user', 'repo', 'catalog', 'item', 'general'];
const SITE_URL = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');

// Admin-configurable knobs (AdminSetting `reports.config`), with sane defaults.
const DEFAULT_CFG = { imageMaxMB: 10, maxImagesPerMsg: 6, archiveDays: 7, deleteDays: 30, archiveEnabled: true, deleteEnabled: true };
async function reportConfig(p) {
  const row = await p.adminSetting.findUnique({ where: { key: 'reports.config' } }).catch(() => null);
  return { ...DEFAULT_CFG, ...(row?.value || {}) };
}

const msgInput = z.object({
  body: z.string().trim().max(4000).optional().default(''),
  images: z.array(z.string().url().max(400)).max(12).optional().default([]),
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

export default async function reportRoutes(app) {
  // Public: the config a client needs (max image size / count) to build the composer.
  app.get('/reports/config', async () => {
    const cfg = await reportConfig(await db());
    return { imageMaxMB: cfg.imageMaxMB, maxImagesPerMsg: cfg.maxImagesPerMsg };
  });

  // Open a report (logged-in). Logged-out users are directed to /contact by the client.
  app.post('/reports', { preHandler: requireRole(), config: { rateLimit: { max: 12, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = z.object({
      targetType: z.enum(TARGET_TYPES),
      targetId: z.string().max(60).optional().default(''),
      targetLabel: z.string().max(160).optional().default(''),
      reason: z.string().max(120).optional().default(''),
      body: z.string().trim().min(1).max(4000),
      images: z.array(z.string().url().max(400)).max(12).optional().default([]),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cfg = await reportConfig(p);
    if (b.data.images.length > cfg.maxImagesPerMsg) return reply.code(400).send({ error: 'too_many_images', max: cfg.maxImagesPerMsg });
    // You can't report yourself, and only one OPEN report per target at a time.
    if (b.data.targetType === 'user' && b.data.targetId === req.user.uid) return reply.code(400).send({ error: 'cannot_report_self' });
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

  // ── Reporter's own reports (their "Contact & reports" dashboard section) ──
  app.get('/me/reports', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const rows = await p.report.findMany({ where: { reporterId: req.user.uid }, orderBy: { lastActivityAt: 'desc' }, take: 100, include: { _count: { select: { messages: true } } } });
    return { reports: rows.map(reportPublic) };
  });

  app.get('/me/reports/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id }, include: { messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { displayName: true } } } }, _count: { select: { messages: true } } } });
    if (!r || r.reporterId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    if (r.userUnread) await p.report.update({ where: { id: r.id }, data: { userUnread: false } });
    return { report: { ...reportPublic(r), messages: r.messages.map(msgPublic) } };
  });

  app.post('/me/reports/:id/messages', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = msgInput.safeParse(req.body);
    if (!b.success || (!b.data.body.trim() && !b.data.images.length)) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cfg = await reportConfig(p);
    if (b.data.images.length > cfg.maxImagesPerMsg) return reply.code(400).send({ error: 'too_many_images', max: cfg.maxImagesPerMsg });
    const r = await p.report.findUnique({ where: { id: req.params.id } });
    if (!r || r.reporterId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    if (r.status === 'closed') return reply.code(409).send({ error: 'closed' });
    const m = await p.reportMessage.create({ data: { reportId: r.id, authorId: req.user.uid, body: b.data.body, images: b.data.images } });
    // A reporter message reopens an archived thread and flags staff.
    await p.report.update({ where: { id: r.id }, data: { status: 'open', archivedAt: null, staffUnread: true, lastActivityAt: new Date() } });
    return { message: msgPublic({ ...m, author: null }) };
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
      reports: rows.map((r) => ({ ...reportPublic(r), reporter: r.reporter?.displayName, reporterEmail: r.reporter?.email, reporterBcId: r.reporter ? userBcId(r.reporter.id) : null })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count.status])),
    };
  });

  app.get('/admin/reports/:id', { preHandler: requireCap('manage_reports', 'MOD') }, async (req, reply) => {
    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id }, include: { reporter: { select: { id: true, displayName: true, email: true } }, messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { displayName: true } } } } } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (r.staffUnread) await p.report.update({ where: { id: r.id }, data: { staffUnread: false } });
    return { report: { ...reportPublic(r), reporter: r.reporter?.displayName, reporterEmail: r.reporter?.email, reporterBcId: r.reporter ? userBcId(r.reporter.id) : null, messages: r.messages.map(msgPublic) } };
  });

  app.post('/admin/reports/:id/messages', { preHandler: requireCap('manage_reports', 'MOD') }, async (req, reply) => {
    const b = msgInput.safeParse(req.body);
    if (!b.success || (!b.data.body.trim() && !b.data.images.length)) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id }, include: { reporter: { select: { email: true } } } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    const m = await p.reportMessage.create({ data: { reportId: r.id, authorId: req.user.uid, staff: true, body: b.data.body, images: b.data.images } });
    // A staff reply reopens an archived thread and flags the reporter (notif + email).
    await p.report.update({ where: { id: r.id }, data: { status: r.status === 'closed' ? 'closed' : 'open', archivedAt: r.status === 'closed' ? r.archivedAt : null, userUnread: true, lastActivityAt: new Date() } });
    notify(p, r.reporterId, 'report_reply', 'A staff member replied to your report.').catch(() => {});
    mailReport(p, r.reporter?.email, 'Reply to your report', 'A staff member replied to your report.', r.id);
    return { message: msgPublic({ ...m, author: null }) };
  });

  app.post('/admin/reports/:id/status', { preHandler: requireCap('manage_reports', 'MOD') }, async (req, reply) => {
    const b = z.object({ status: z.enum(['open', 'archived', 'closed']) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await p.report.findUnique({ where: { id: req.params.id }, include: { reporter: { select: { email: true } } } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    const data = { status: b.data.status, lastActivityAt: new Date() };
    if (b.data.status === 'archived') data.archivedAt = new Date();
    if (b.data.status === 'open') data.archivedAt = null;
    await p.report.update({ where: { id: r.id }, data });
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
