import { z } from 'zod';
import crypto from 'node:crypto';
import { db, requireCap, optionalAuth, notify } from '../lib/lib.mjs';
import { findUserIdByBcId, looksLikeBcId } from '../lib/repofingerprint.mjs';
import { putObject, getObject, deleteObject, prefixUsage } from '../lib/storage.mjs';
import { sendMail, mailShell, emailEnabled } from '../lib/mail.mjs';

// Feedback & crash centre. One inbox per project (BMM, BSM, whatever comes next) that any app
// can post feedback, bug reports and crash dumps to — the thing BMM used BetaHub for, now on
// the platform where the person's account already lives. Each project has its own switch,
// size caps, crash sampling and filters; the admin reads everything on one screen.
//
// Who sent it decides where the answer goes. A submission from a linked account (session, or
// the BMM creator id header) opens a thread in the sender's "Messages & reports" dashboard, so
// a staff reply is a notification, a mail and a line in BMM's own notification centre. An
// anonymous one with an e-mail address is answered by mail. One with neither is read-only.

const SITE_URL = (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
const KINDS = ['feedback', 'bug', 'crash'];
const STATUSES = ['new', 'triaged', 'resolved', 'ignored'];

export const DEFAULT_PROJECT = {
  enabled: false,
  kinds: { feedback: true, bug: true, crash: true },
  crashSampling: 100,     // % of crash reports kept (the rest are acknowledged and dropped)
  maxBodyKB: 64,
  maxAttachMB: 25,        // total per submission
  maxAttachments: 6,
  dedupeMinutes: 10,      // same fingerprint from the same sender inside this window = +1, not a new row
  minVersion: '',         // "1.4.0" → older app versions are refused (they should update first)
  blockedVersions: [],    // exact versions refused (a build known to spam)
  blockedWords: [],       // any of these in title/body → refused
  requireContact: false,  // anonymous submissions need an e-mail
  openThread: true,       // linked senders get a dashboard thread
  mailFallback: true,     // anonymous senders with an e-mail get a confirmation + replies by mail
};
/** Where the attachments live and how long — Hosting settings → Feedback storage. */
export const DEFAULT_STORAGE = {
  retentionDays: 90,      // attachments older than this are deleted (the report stays)
  maxTotalMB: 2048,       // above this the oldest attachments go first
  closedRowDays: 365,     // resolved / ignored reports older than this are deleted outright (0 = never)
};
export const DEFAULT_LIMITS = {
  perIp: { max: 10, windowMin: 60 },
  perAccount: { max: 20, windowMin: 60 },
  perProjectDay: 2000,
  // The platform-wide API limiter (server.mjs) — per IP and, new, per signed-in account.
  // Kept here so one screen owns every rate limit an admin can set. 0 = off.
  apiPerIpMin: 0,
  apiPerAccountMin: 0,
};

let cache = { at: 0, cfg: null };
export async function feedbackConfig(p) {
  if (Date.now() - cache.at < 15_000 && cache.cfg) return cache.cfg;
  const row = await p.adminSetting.findUnique({ where: { key: 'feedback.config' } }).catch(() => null);
  const v = row?.value || {};
  const projects = {};
  for (const [k, pc] of Object.entries(v.projects || {})) projects[k] = { ...DEFAULT_PROJECT, ...pc, kinds: { ...DEFAULT_PROJECT.kinds, ...(pc?.kinds || {}) } };
  const cfg = { projects, limits: { ...DEFAULT_LIMITS, ...(v.limits || {}), perIp: { ...DEFAULT_LIMITS.perIp, ...(v.limits?.perIp || {}) }, perAccount: { ...DEFAULT_LIMITS.perAccount, ...(v.limits?.perAccount || {}) } }, storage: { ...DEFAULT_STORAGE, ...(v.storage || {}) } };
  cache = { at: Date.now(), cfg };
  return cfg;
}

// Sliding-window counters, in memory. A feedback endpoint is low-volume by nature; the
// limiter's job is to stop one client from filling the inbox, not to survive a fleet.
const windows = new Map();
function hit(key, max, windowMs) {
  if (!max || max <= 0) return true;
  const now = Date.now();
  const arr = (windows.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { windows.set(key, arr); return false; }
  arr.push(now); windows.set(key, arr);
  if (windows.size > 20_000) for (const [k, v] of windows) { if (!v.length || now - v[v.length - 1] > windowMs) windows.delete(k); }
  return true;
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip || '0.0.0.0';
}
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const ipHash = (ip) => sha1(`fb:${ip}`).slice(0, 24);

/** "1.4.2" < "1.10.0" — numeric segments, missing = 0, anything else compares as 0. */
function cmpVersion(a, b) {
  const A = String(a || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const B = String(b || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(A.length, B.length); i++) { const d = (A[i] || 0) - (B[i] || 0); if (d) return d; }
  return 0;
}

const safeName = (n) => String(n || 'file').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'file';
const attachmentIn = z.object({
  name: z.string().min(1).max(160),
  type: z.string().max(100).optional().default('application/octet-stream'),
  data: z.string().min(1), // base64
});
const submitIn = z.object({
  kind: z.enum(['feedback', 'bug', 'crash']),
  title: z.string().trim().max(200).optional().default(''),
  body: z.string().max(2_000_000).optional().default(''),
  email: z.string().trim().email().max(160).optional().or(z.literal('')).default(''),
  discord: z.string().trim().max(80).optional().default(''),
  appVersion: z.string().trim().max(40).optional().default(''),
  os: z.string().trim().max(120).optional().default(''),
  meta: z.record(z.any()).optional(),
  fingerprint: z.string().trim().max(120).optional().default(''),
  attachments: z.array(attachmentIn).max(40).optional().default([]),
});

const pub = (f) => ({
  id: f.id, projectKey: f.projectKey, kind: f.kind, title: f.title, body: f.body, appVersion: f.appVersion, os: f.os,
  meta: f.meta, attachments: (f.attachments || []).map((a, i) => ({ i, name: a.name, type: a.type, size: a.size })),
  fingerprint: f.fingerprint, count: f.count, status: f.status, userId: f.userId, email: f.email, creatorId: f.creatorId,
  reportId: f.reportId, createdAt: f.createdAt, updatedAt: f.updatedAt,
});

export default async function feedbackRoutes(app) {
  // ── Public: what a client may send, before it builds the payload ──
  app.get('/feedback/:project/config', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const p = await db();
    const cfg = await feedbackConfig(p);
    const pc = cfg.projects[req.params.project];
    if (!pc || !pc.enabled) return { enabled: false };
    return { enabled: true, kinds: pc.kinds, crashSampling: pc.crashSampling, maxBodyKB: pc.maxBodyKB, maxAttachMB: pc.maxAttachMB, maxAttachments: pc.maxAttachments, requireContact: pc.requireContact, minVersion: pc.minVersion };
  });

  // ── Public: submit ──
  app.post('/feedback/:project', { preHandler: optionalAuth(), bodyLimit: 64 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const cfg = await feedbackConfig(p);
    const key = String(req.params.project || '').slice(0, 40);
    const pc = cfg.projects[key];
    if (!pc || !pc.enabled) return reply.code(404).send({ error: 'project_disabled' });
    const b = submitIn.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: b.error.issues?.[0]?.message });
    const d = b.data;
    if (!pc.kinds[d.kind]) return reply.code(403).send({ error: 'kind_disabled' });

    // Who is this. Session first, then the creator id BMM sends on every call it makes.
    let userId = req.user?.uid || null;
    const creatorId = String(req.headers['x-creator-id'] || '').slice(0, 80);
    if (!userId && creatorId && looksLikeBcId(creatorId)) userId = await findUserIdByBcId(p, creatorId).catch(() => null);
    const ip = clientIp(req);

    // Limits: per IP, per account, per project per day.
    const L = cfg.limits;
    if (!hit(`ip:${ip}`, L.perIp.max, L.perIp.windowMin * 60_000)) return reply.code(429).send({ error: 'rate_limited', retryAfterSec: L.perIp.windowMin * 60 });
    if (userId && !hit(`acct:${userId}`, L.perAccount.max, L.perAccount.windowMin * 60_000)) return reply.code(429).send({ error: 'rate_limited', retryAfterSec: L.perAccount.windowMin * 60 });
    if (!hit(`proj:${key}`, L.perProjectDay, 86_400_000)) return reply.code(429).send({ error: 'project_quota', retryAfterSec: 3600 });

    // Filters.
    if (pc.minVersion && d.appVersion && cmpVersion(d.appVersion, pc.minVersion) < 0) return reply.code(422).send({ error: 'version_too_old', minVersion: pc.minVersion });
    if (pc.blockedVersions?.includes(d.appVersion)) return reply.code(422).send({ error: 'version_blocked' });
    const text = `${d.title}\n${d.body}`.toLowerCase();
    if ((pc.blockedWords || []).some((w) => w && text.includes(String(w).toLowerCase()))) return reply.code(422).send({ error: 'filtered' });
    if (Buffer.byteLength(d.body, 'utf8') > pc.maxBodyKB * 1024) return reply.code(413).send({ error: 'body_too_large', maxBodyKB: pc.maxBodyKB });
    if (!userId && !d.email && pc.requireContact) return reply.code(422).send({ error: 'contact_required' });
    if (d.attachments.length > pc.maxAttachments) return reply.code(413).send({ error: 'too_many_attachments', max: pc.maxAttachments });

    // Crash sampling: acknowledged, not stored. The client is told so it does not retry.
    if (d.kind === 'crash' && pc.crashSampling < 100 && Math.random() * 100 >= pc.crashSampling) return reply.code(202).send({ ok: true, sampled: false });

    // Dedupe: the same thing from the same sender inside the window bumps the counter.
    const fingerprint = d.fingerprint || sha1(`${key}|${d.kind}|${d.title}|${d.body.slice(0, 2000)}`).slice(0, 40);
    if (pc.dedupeMinutes > 0) {
      const since = new Date(Date.now() - pc.dedupeMinutes * 60_000);
      const dup = await p.feedback.findFirst({ where: { projectKey: key, fingerprint, createdAt: { gte: since }, ...(userId ? { userId } : { ipHash: ipHash(ip) }) }, select: { id: true, reportId: true } });
      if (dup) { await p.feedback.update({ where: { id: dup.id }, data: { count: { increment: 1 } } }); return { ok: true, id: dup.id, threadId: dup.reportId, duplicate: true, linked: !!userId }; }
    }

    // Attachments: decoded, capped, stored. Never served publicly — a crash zip is the
    // sender's machine in a bottle.
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    const stored = []; let total = 0;
    for (let i = 0; i < d.attachments.length; i++) {
      const a = d.attachments[i];
      let buf; try { buf = Buffer.from(a.data, 'base64'); } catch { return reply.code(400).send({ error: 'bad_attachment' }); }
      total += buf.length;
      if (total > pc.maxAttachMB * 1024 * 1024) return reply.code(413).send({ error: 'attachments_too_large', maxAttachMB: pc.maxAttachMB });
      const skey = `feedback/${key}/${id}/${i}-${safeName(a.name)}`;
      try { await putObject(skey, buf, a.type || 'application/octet-stream'); }
      catch (e) { req.log.warn({ e: String(e) }, 'feedback attachment store failed'); return reply.code(503).send({ error: 'storage_unavailable' }); }
      stored.push({ key: skey, name: safeName(a.name), type: a.type || 'application/octet-stream', size: buf.length });
    }

    const meta = d.meta && typeof d.meta === 'object' ? JSON.parse(JSON.stringify(d.meta).slice(0, 16_000)) : undefined;
    const row = await p.feedback.create({ data: {
      id, projectKey: key, kind: d.kind, title: d.title.slice(0, 200), body: d.body, appVersion: d.appVersion, os: d.os, meta: meta ?? undefined,
      attachments: stored, fingerprint, userId, email: d.email, creatorId, ipHash: ipHash(ip),
    } });

    // Where the conversation lives.
    let threadId = null;
    if (userId && pc.openThread) {
      const label = d.title || `${d.kind} · ${key}`;
      const lines = [d.body || '(no description)', '', `-# ${key} ${d.appVersion || ''} · ${d.os || ''}`.trim()];
      if (stored.length) lines.push(`-# ${stored.length} attachment(s) kept with the report — staff can open them from the feedback centre.`);
      const r = await p.report.create({ data: {
        targetType: 'feedback', targetId: id, targetLabel: label.slice(0, 160), reporterId: userId, reason: d.kind,
        messages: { create: { authorId: userId, staff: false, body: lines.join('\n').slice(0, 4000) } },
      } }).catch(() => null);
      if (r) { threadId = r.id; await p.feedback.update({ where: { id }, data: { reportId: r.id } }); }
    } else if (d.email && pc.mailFallback && emailEnabled()) {
      sendMail({
        to: d.email,
        subject: `We received your ${d.kind === 'feedback' ? 'feedback' : d.kind === 'bug' ? 'bug report' : 'crash report'} (${key})`,
        html: mailShell('Thanks — we have it', `Your ${d.kind} for <b>${key}</b> reached the team. Reference: <code>${id}</code>. If we need more, or once it is handled, we will answer at this address. Create a BetterCommunity account with this e-mail to follow it from your dashboard instead.`, { url: `${SITE_URL}/auth`, label: 'Open BetterCommunity' }),
        text: `We received your ${d.kind} for ${key}. Reference: ${id}.`,
      }).catch(() => {});
    }
    return { ok: true, id: row.id, threadId, linked: !!userId, sampled: true };
  });

  // ── Admin ──
  const READ = requireCap('manage_reports', 'MOD');
  const WRITE = requireCap('manage_reports');

  app.get('/admin/feedback/config', { preHandler: READ }, async () => {
    const p = await db();
    const cfg = await feedbackConfig(p);
    const [projects, showcase] = await Promise.all([
      p.project.findMany({ select: { key: true, name: true } }).catch(() => []),
      p.showcaseProject.findMany({ select: { slug: true, name: true } }).catch(() => []),
    ]);
    const known = [...projects.map((x) => ({ key: x.key, name: x.name })), ...showcase.map((x) => ({ key: x.slug, name: x.name }))];
    for (const k of Object.keys(cfg.projects)) if (!known.some((x) => x.key === k)) known.push({ key: k, name: k });
    return { ...cfg, knownProjects: known, defaults: { project: DEFAULT_PROJECT, limits: DEFAULT_LIMITS } };
  });

  const projectIn = z.object({
    enabled: z.boolean(), kinds: z.object({ feedback: z.boolean(), bug: z.boolean(), crash: z.boolean() }),
    crashSampling: z.number().min(0).max(100), maxBodyKB: z.number().int().min(1).max(4096), maxAttachMB: z.number().int().min(0).max(200),
    maxAttachments: z.number().int().min(0).max(40), dedupeMinutes: z.number().int().min(0).max(1440), minVersion: z.string().max(40),
    blockedVersions: z.array(z.string().max(40)).max(50), blockedWords: z.array(z.string().max(60)).max(200),
    requireContact: z.boolean(), openThread: z.boolean(), mailFallback: z.boolean(),
  });
  const limitsIn = z.object({
    perIp: z.object({ max: z.number().int().min(0).max(100000), windowMin: z.number().int().min(1).max(1440) }),
    perAccount: z.object({ max: z.number().int().min(0).max(100000), windowMin: z.number().int().min(1).max(1440) }),
    perProjectDay: z.number().int().min(0).max(10_000_000),
    apiPerIpMin: z.number().int().min(0).max(100000), apiPerAccountMin: z.number().int().min(0).max(100000),
  });
  app.put('/admin/feedback/config', { preHandler: WRITE }, async (req, reply) => {
    const storageIn = z.object({ retentionDays: z.number().int().min(0).max(3650), maxTotalMB: z.number().int().min(0).max(1_000_000), closedRowDays: z.number().int().min(0).max(3650) });
    const b = z.object({ projects: z.record(z.string().regex(/^[a-z0-9_-]{1,40}$/), projectIn), limits: limitsIn, storage: storageIn.optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: b.error.issues?.[0] });
    const p = await db();
    // Storage is edited on the Hosting screen; a save from the feedback screen keeps it.
    const prev = await p.adminSetting.findUnique({ where: { key: 'feedback.config' } }).catch(() => null);
    const value = { ...b.data, storage: b.data.storage || prev?.value?.storage || DEFAULT_STORAGE };
    await p.adminSetting.upsert({ where: { key: 'feedback.config' }, create: { key: 'feedback.config', value }, update: { value } });
    // The platform-wide limiter reads its own keys (server.mjs polls them every 15 s).
    const upd = (key, v) => p.adminSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
    await upd('hosting.apiRateLimitMax', b.data.limits.apiPerIpMin || null);
    await upd('hosting.apiRateLimitPerAccount', b.data.limits.apiPerAccountMin || null);
    cache = { at: 0, cfg: null };
    return { ok: true };
  });

  app.get('/admin/feedback', { preHandler: READ }, async (req) => {
    const p = await db();
    const q = req.query || {};
    const where = {};
    if (q.project) where.projectKey = String(q.project).slice(0, 40);
    if (q.kind && KINDS.includes(q.kind)) where.kind = q.kind;
    if (q.status && STATUSES.includes(q.status)) where.status = q.status;
    if (q.version) where.appVersion = String(q.version).slice(0, 40);
    if (q.q) { const s = String(q.q).slice(0, 120); where.OR = [{ title: { contains: s, mode: 'insensitive' } }, { body: { contains: s, mode: 'insensitive' } }, { email: { contains: s, mode: 'insensitive' } }, { fingerprint: { contains: s } }]; }
    const page = Math.max(0, parseInt(q.page, 10) || 0); const take = 50;
    // Sort: newest (default), oldest, or BY SEVERITY (crash > bug > feedback, newest within a
    // kind). Severity has no DB column to order on, so it ranks a bounded window in memory —
    // feedback volumes per project are small, so a 1000-row window covers it comfortably.
    const sort = ['new', 'old', 'severity'].includes(q.sort) ? q.sort : 'new';
    const total = await p.feedback.count({ where });
    let rows;
    if (sort === 'severity') {
      const RANK = { crash: 0, bug: 1, feedback: 2 };
      const win = await p.feedback.findMany({ where, orderBy: { createdAt: 'desc' }, take: 1000 });
      win.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9)); // stable → keeps newest-first within a kind
      rows = win.slice(page * take, page * take + take);
    } else {
      rows = await p.feedback.findMany({ where, orderBy: { createdAt: sort === 'old' ? 'asc' : 'desc' }, skip: page * take, take });
    }
    const [byStatus, versions] = await Promise.all([
      p.feedback.groupBy({ by: ['status'], where: where.projectKey ? { projectKey: where.projectKey } : {}, _count: { _all: true } }),
      p.feedback.groupBy({ by: ['appVersion'], where: where.projectKey ? { projectKey: where.projectKey } : {}, _count: { _all: true }, orderBy: { _count: { appVersion: 'desc' } }, take: 30 }).catch(() => []),
    ]);
    const users = rows.some((r) => r.userId) ? await p.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter(Boolean))] } }, select: { id: true, displayName: true } }) : [];
    const uname = Object.fromEntries(users.map((u) => [u.id, u.displayName]));
    return {
      items: rows.map((r) => ({ ...pub(r), body: r.body.slice(0, 400), userName: r.userId ? uname[r.userId] || null : null })),
      total, page, take,
      counts: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      versions: versions.map((v) => ({ version: v.appVersion, n: v._count._all })),
    };
  });

  app.get('/admin/feedback/:id', { preHandler: READ }, async (req, reply) => {
    const p = await db();
    const r = await p.feedback.findUnique({ where: { id: req.params.id } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    const u = r.userId ? await p.user.findUnique({ where: { id: r.userId }, select: { id: true, displayName: true, email: true } }) : null;
    return { item: { ...pub(r), user: u } };
  });

  app.get('/admin/feedback/:id/attachments/:i', { preHandler: READ }, async (req, reply) => {
    const p = await db();
    const r = await p.feedback.findUnique({ where: { id: req.params.id }, select: { attachments: true } });
    const a = r?.attachments?.[parseInt(req.params.i, 10)];
    if (!a?.key) return reply.code(404).send({ error: 'not_found' });
    try {
      const obj = await getObject(a.key);
      reply.header('Content-Type', a.type || 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${a.name}"`);
      if (obj.length) reply.header('Content-Length', obj.length);
      return reply.send(obj.body);
    } catch { return reply.code(404).send({ error: 'not_found' }); }
  });

  app.post('/admin/feedback/:id/status', { preHandler: READ }, async (req, reply) => {
    const b = z.object({ status: z.enum(['new', 'triaged', 'resolved', 'ignored']) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await p.feedback.update({ where: { id: req.params.id }, data: { status: b.data.status } }).catch(() => null);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    // A resolved feedback closes its thread too, with a line saying so — the sender sees the
    // outcome where they have been following it.
    if (r.reportId && (b.data.status === 'resolved' || b.data.status === 'ignored')) {
      await p.report.update({ where: { id: r.reportId }, data: { status: 'closed', userUnread: true, lastActivityAt: new Date(), messages: { create: { staff: true, body: b.data.status === 'resolved' ? 'Marked as resolved by the team.' : 'Closed without action.' } } } }).catch(() => {});
      if (r.userId) notify(p, r.userId, 'report_closed', `Your ${r.kind} "${r.title || r.id}" was ${b.data.status === 'resolved' ? 'resolved' : 'closed'}.`, { bodyFr: `Ton ${r.kind} « ${r.title || r.id} » a été ${b.data.status === 'resolved' ? 'résolu' : 'fermé'}.`, href: `/dashboard?s=reports&r=${r.reportId}` }).catch(() => {});
    }
    return { ok: true, item: pub(r) };
  });

  // Reply: into the dashboard thread when there is one, by mail otherwise.
  app.post('/admin/feedback/:id/reply', { preHandler: READ }, async (req, reply) => {
    const b = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const r = await p.feedback.findUnique({ where: { id: req.params.id } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    if (r.reportId) {
      await p.report.update({ where: { id: r.reportId }, data: { userUnread: true, lastActivityAt: new Date(), status: 'open', messages: { create: { authorId: req.user.uid, staff: true, body: b.data.body } } } });
      if (r.userId) notify(p, r.userId, 'report_reply', `Staff replied about your ${r.kind} "${r.title || r.id}".`, { bodyFr: `L’équipe a répondu à ton ${r.kind} « ${r.title || r.id} ».`, href: `/dashboard?s=reports&r=${r.reportId}` }).catch(() => {});
      if (r.status === 'new') await p.feedback.update({ where: { id: r.id }, data: { status: 'triaged' } });
      return { ok: true, via: 'thread' };
    }
    if (r.email && emailEnabled()) {
      const sent = await sendMail({
        to: r.email, subject: `About your ${r.kind} (${r.projectKey}) — BetterCommunity`,
        html: mailShell('A reply from the team', `<p style="white-space:pre-wrap">${b.data.body.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p><p>Reference: <code>${r.id}</code></p>`, { url: `${SITE_URL}/auth`, label: 'Open BetterCommunity' }),
        text: `${b.data.body}\n\nReference: ${r.id}`,
      }).catch(() => false);
      if (!sent) return reply.code(503).send({ error: 'mail_failed' });
      if (r.status === 'new') await p.feedback.update({ where: { id: r.id }, data: { status: 'triaged' } });
      return { ok: true, via: 'mail' };
    }
    return reply.code(409).send({ error: 'no_channel' });
  });

  // ── Storage: what the attachments weigh, the retention, and a purge ──
  app.get('/admin/feedback/storage', { preHandler: READ }, async () => {
    const p = await db();
    const cfg = await feedbackConfig(p);
    const [usage, rows, closed] = await Promise.all([
      prefixUsage('feedback/').catch(() => ({ bytes: 0, count: 0 })),
      p.feedback.count(),
      p.feedback.count({ where: { status: { in: ['resolved', 'ignored'] } } }),
    ]);
    return { storage: cfg.storage, usage, rows, closed, prefix: 'feedback/' };
  });
  app.put('/admin/feedback/storage', { preHandler: WRITE }, async (req, reply) => {
    const b = z.object({ retentionDays: z.number().int().min(0).max(3650), maxTotalMB: z.number().int().min(0).max(1_000_000), closedRowDays: z.number().int().min(0).max(3650) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const prev = (await p.adminSetting.findUnique({ where: { key: 'feedback.config' } }).catch(() => null))?.value || {};
    const value = { ...prev, storage: b.data };
    await p.adminSetting.upsert({ where: { key: 'feedback.config' }, create: { key: 'feedback.config', value }, update: { value } });
    cache = { at: 0, cfg: null };
    return { ok: true };
  });
  app.post('/admin/feedback/storage/purge', { preHandler: WRITE }, async (req) => {
    const p = await db();
    const cfg = await feedbackConfig(p);
    const result = await sweepFeedbackStorage(p, cfg.storage, { force: !!req.body?.all });
    return { ok: true, ...result };
  });

  // Hourly: attachments past their retention go, the oldest go when the total is over the
  // cap, and closed reports past their own retention go with everything they carry.
  const timer = setInterval(async () => {
    try { const p = await db(); const cfg = await feedbackConfig(p); await sweepFeedbackStorage(p, cfg.storage, {}); } catch { /* next hour */ }
  }, 60 * 60 * 1000);
  timer.unref?.();

  app.delete('/admin/feedback/:id', { preHandler: WRITE }, async (req, reply) => {
    const p = await db();
    const r = await p.feedback.findUnique({ where: { id: req.params.id }, select: { attachments: true } });
    if (!r) return reply.code(404).send({ error: 'not_found' });
    for (const a of r.attachments || []) await deleteObject(a.key);
    await p.feedback.delete({ where: { id: req.params.id } });
    return { ok: true };
  });
}

/** The retention rules, applied. `force` drops every attachment regardless of age. */
export async function sweepFeedbackStorage(p, storage = DEFAULT_STORAGE, { force = false } = {}) {
  const st = { ...DEFAULT_STORAGE, ...(storage || {}) };
  let deletedFiles = 0, freedBytes = 0, deletedRows = 0;
  const strip = async (row, keep) => {
    const gone = (row.attachments || []).filter((a) => !keep(a));
    if (!gone.length) return;
    for (const a of gone) { await deleteObject(a.key); deletedFiles++; freedBytes += Number(a.size) || 0; }
    await p.feedback.update({ where: { id: row.id }, data: { attachments: (row.attachments || []).filter(keep) } }).catch(() => {});
  };
  // 1. Age.
  if (force || st.retentionDays > 0) {
    const cutoff = new Date(Date.now() - st.retentionDays * 86_400_000);
    const rows = await p.feedback.findMany({ where: force ? {} : { createdAt: { lt: cutoff } }, select: { id: true, attachments: true } });
    for (const r of rows) if ((r.attachments || []).length) await strip(r, () => false);
  }
  // 2. Closed reports past their retention.
  if (st.closedRowDays > 0) {
    const cutoff = new Date(Date.now() - st.closedRowDays * 86_400_000);
    const rows = await p.feedback.findMany({ where: { status: { in: ['resolved', 'ignored'] }, updatedAt: { lt: cutoff } }, select: { id: true, attachments: true } });
    for (const r of rows) { for (const a of r.attachments || []) { await deleteObject(a.key); deletedFiles++; freedBytes += Number(a.size) || 0; } await p.feedback.delete({ where: { id: r.id } }).catch(() => {}); deletedRows++; }
  }
  // 3. The cap: oldest attachments first until under it.
  if (st.maxTotalMB > 0) {
    const cap = st.maxTotalMB * 1024 * 1024;
    const rows = await p.feedback.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, attachments: true } });
    let total = rows.reduce((n, r) => n + (r.attachments || []).reduce((m, a) => m + (Number(a.size) || 0), 0), 0);
    for (const r of rows) {
      if (total <= cap) break;
      const size = (r.attachments || []).reduce((m, a) => m + (Number(a.size) || 0), 0);
      if (!size) continue;
      await strip(r, () => false);
      total -= size;
    }
  }
  return { deletedFiles, freedBytes, deletedRows };
}
