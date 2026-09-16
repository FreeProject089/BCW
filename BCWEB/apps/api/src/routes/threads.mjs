// Contact threads — reaching the user or team behind a repo, a catalogue or a profile.
//
// A report goes to staff. THIS goes to whoever manages the thing: the owner, and every
// active member of its team. Staff see the threads only to moderate them (hide a message,
// block a sender, close), and the sender does not need an account: an anonymous sender
// leaves an e-mail and follows the thread by a link carrying its access token.
//
//   POST /threads                                   open one { kind, targetId, subject, body, email?, name?, pow? }
//   GET  /me/threads?box=inbox|sent                 mine — inbox = addressed to me or my teams; sent = opened by me
//   GET  /me/threads/:id  · POST …/messages · …/close · …/reopen · …/flag
//   GET  /threads/t/:token · POST /threads/t/:token/messages      the anonymous sender's side
//   GET  /admin/threads?status=&q=  · GET /admin/threads/:id       manage_reports
//   POST /admin/threads/:id/close | /block | /messages/:mid/hide | /messages/:mid/unhide
//   GET/PUT /admin/threads/config                                    limits + blocked senders
//
// Rate limits are the anti-spam: an account gets a handful of new threads an hour, an
// anonymous sender fewer, and both are counted in the database, not in a process, so a
// restart does not reset them. A blocked e-mail or account cannot open or answer anything.
import crypto from 'node:crypto';
import { z } from 'zod';
import { db, requireRole, requireCap, optionalAuth, notify, logAudit, clientIp } from '../lib/lib.mjs';
import { sendMail, mailShell, emailEnabled, escapeHtml } from '../lib/mail.mjs';
import { powVerify } from './auth.mjs';
import { teamIdsOf, managerIdsOf, isStaff } from '../lib/teams.mjs';

const KINDS = ['repo', 'catalog', 'user', 'team'];
const CONFIG_KEY = 'threads.config';

/**
 * Member-to-member conversations, and the two switches that govern them.
 *
 * A `user`-kind thread is the only one addressed to a PERSON rather than to something they
 * published. A repo, a catalogue and a team are things somebody put on the site and owe a
 * contact channel for; a profile is not. So this block governs `user` threads only, and the
 * other three kinds are unaffected by every value in it.
 *
 *   enabled          the site switch. A CEILING — see directMessaging().
 *   maxOpen          how many conversations one sender may have OPEN toward members at once.
 *                    0 = no cap, the house idiom. Archived and closed ones do not count, so
 *                    the cap is a limit on live conversations, not a lifetime quota.
 *   autoArchiveDays  an open conversation nobody has touched for this long is archived. It
 *                    is not deleted and either side can reopen it. 0 = never.
 *   whenOff          the fate of a conversation that is already open when the site switch is
 *                    turned off. 'freeze' (default): both sides keep READING it, nobody can
 *                    write. 'keep': existing conversations stay writable and only new ones
 *                    are refused. Both are read-time rules, so flipping the switch back
 *                    restores exactly what was there — nothing is rewritten either way.
 */
const MEMBER_DIRECT_DEFAULTS = { enabled: true, maxOpen: 5, autoArchiveDays: 30, whenOff: 'freeze' };
const DEFAULTS = {
  enabled: true,
  userPerHour: 6, userPerDay: 20,
  anonPerHour: 3, anonPerDay: 8,
  messagesPerHour: 30,
  maxBody: 4000,
  blockedEmails: [],
  blockedUserIds: [],
  memberDirect: MEMBER_DIRECT_DEFAULTS,
};

async function config(p) {
  const row = await p.adminSetting.findUnique({ where: { key: CONFIG_KEY } }).catch(() => null);
  const stored = row?.value && typeof row.value === 'object' ? row.value : {};
  // Merged one level down on purpose: a stored config written before memberDirect existed,
  // or one that saved a single field of it, must not lose the other three to a shallow
  // spread. That is the shape that turns a default of 5 into `undefined` and a cap into no
  // cap at all, silently.
  return { ...DEFAULTS, ...stored, memberDirect: { ...MEMBER_DIRECT_DEFAULTS, ...(stored.memberDirect && typeof stored.memberDirect === 'object' ? stored.memberDirect : {}) } };
}

/**
 * May a member-to-member conversation be opened, and may an existing one be answered?
 *
 * THE PRECEDENCE, written once, here, because a rule written twice diverges:
 *
 *   · The SITE switch is a ceiling. `memberDirect.enabled === false` means no new
 *     conversation with a member, whatever anybody's own settings say. Nobody can opt back
 *     in above it.
 *   · The MEMBER preference is a floor. Within what the site allows, a member who set
 *     `acceptsDirect = false` receives nothing. It only ever subtracts: it cannot grant what
 *     the site refused, and it never stops them writing to somebody else.
 *   · A conversation already OPEN when either switch goes off is frozen, not deleted and not
 *     hidden. Both sides keep reading it. Writing is what stops.
 *
 * The one asymmetry: when the SITE is off and `whenOff === 'keep'`, replies keep working on
 * threads that already exist. That is the admin's explicit choice and it is the only way a
 * switch-off does not strand half-finished conversations. A member's own refusal is never
 * softened that way — they asked to be left alone.
 *
 * Returns `{ openNew, reply, why }`. `why` is the error code the client turns into a
 * sentence; '' when nothing is barred.
 */
async function directMessaging(p, cfg, ownerId) {
  const md = cfg.memberDirect || MEMBER_DIRECT_DEFAULTS;
  if (md.enabled === false) return { openNew: false, reply: md.whenOff === 'keep', why: 'messaging_off_site' };
  if (!ownerId) return { openNew: true, reply: true, why: '' };
  const pref = await p.userMessagingPref.findUnique({ where: { userId: ownerId } }).catch(() => null);
  if (pref && pref.acceptsDirect === false) return { openNew: false, reply: false, why: 'messaging_off_member' };
  return { openNew: true, reply: true, why: '' };
}

/** Idle open conversations with members, archived in one statement. Lazy rather than a
 *  sweeper: the only place it matters is a list somebody is looking at, and a cron job for
 *  a rule this cheap is a second thing to keep running. */
async function autoArchive(p, cfg) {
  const days = Number(cfg.memberDirect?.autoArchiveDays || 0);
  if (!days) return;
  const cutoff = new Date(Date.now() - days * 864e5);
  await p.contactThread.updateMany({ where: { kind: 'user', status: 'open', lastActivityAt: { lt: cutoff } }, data: { status: 'archived' } }).catch(() => {});
}

const site = () => (process.env.SITE_URL || 'https://bettercommunity.ch').replace(/\/+$/, '');
const token = () => crypto.randomBytes(24).toString('base64url');

/** What a target IS, and who answers for it. Null when it does not exist or cannot be contacted. */
async function resolveTarget(p, kind, id) {
  if (kind === 'repo') {
    const r = await p.serverRepo.findUnique({ where: { id }, select: { id: true, name: true, ownerId: true, teamId: true, listed: true, verified: true, pendingReview: true, shareKey: true } });
    if (!r) return null;
    return { kind, id: r.id, label: r.name, ownerId: r.ownerId, teamId: r.teamId };
  }
  if (kind === 'catalog') {
    const c = await p.communityCatalog.findFirst({ where: { OR: [{ slug: id }, { id }] }, select: { id: true, slug: true, name: true, ownerId: true, teamId: true, status: true } });
    if (!c || c.status === 'SUSPENDED') return null;
    return { kind, id: c.slug, label: c.name, ownerId: c.ownerId, teamId: c.teamId };
  }
  if (kind === 'user') {
    const u = await p.user.findUnique({ where: { id }, select: { id: true, displayName: true, status: true } });
    if (!u || (u.status && u.status !== 'active')) return null;
    return { kind, id: u.id, label: u.displayName || 'member', ownerId: u.id, teamId: null };
  }
  if (kind === 'team') {
    const t = await p.team.findFirst({ where: { OR: [{ slug: id }, { id }] }, select: { id: true, slug: true, name: true, ownerId: true } });
    if (!t) return null;
    return { kind, id: t.slug, label: t.name, ownerId: t.ownerId, teamId: t.id };
  }
  return null;
}

const serMsg = (m) => ({ id: m.id, side: m.side, body: m.hidden ? '' : m.body, hidden: m.hidden, authorId: m.authorId, author: m.author?.displayName || null, createdAt: m.createdAt });
const serThread = (t, { withMessages = false, staff = false, anon = false } = {}) => ({
  id: t.id, kind: t.kind, targetId: t.targetId, targetLabel: t.targetLabel, subject: t.subject, status: t.status,
  ownerUnread: t.ownerUnread, senderUnread: t.senderUnread, staffFlag: staff ? t.staffFlag : undefined,
  sender: t.sender ? { id: t.sender.id, displayName: t.sender.displayName } : null,
  senderName: t.senderName, senderEmail: staff ? t.senderEmail : (t.senderEmail ? '(e-mail)' : ''),
  ownerUser: t.ownerUser ? { id: t.ownerUser.id, displayName: t.ownerUser.displayName } : null,
  ownerTeam: t.ownerTeam ? { id: t.ownerTeam.id, slug: t.ownerTeam.slug, name: t.ownerTeam.name } : null,
  lastActivityAt: t.lastActivityAt, createdAt: t.createdAt, anon,
  ...(withMessages ? { messages: (t.messages || []).filter((m) => staff || !m.hidden).map(serMsg) } : {}),
});
const INCLUDE = { sender: { select: { id: true, displayName: true } }, ownerUser: { select: { id: true, displayName: true } }, ownerTeam: { select: { id: true, slug: true, name: true } } };
const INCLUDE_FULL = { ...INCLUDE, messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { displayName: true } } } } };

async function tellManagers(p, thread, text, href) {
  const ids = await managerIdsOf(p, { ownerId: thread.ownerUserId, teamId: thread.ownerTeamId });
  for (const id of ids) if (id !== thread.senderId) notify(p, id, 'thread', text, { href }).catch(() => {});
}

async function mailAnonSender(thread, subject, intro) {
  if (!thread.senderEmail || !emailEnabled()) return;
  const link = `${site()}/messages/t/${thread.accessToken}`;
  await sendMail({
    to: thread.senderEmail, subject,
    html: mailShell(subject, `<p>${escapeHtml(intro)}</p><p><a href="${link}">${escapeHtml(link)}</a></p><p style="color:#888;font-size:12px">Anyone with this link can read and answer the conversation — keep it to yourself.</p>`, { label: 'Open the conversation', href: link }),
    text: `${intro}\n\n${link}`,
  }).catch(() => {});
}

export default async function threadRoutes(app) {
  // ── opening one ────────────────────────────────────────────────────────────────────────
  app.post('/threads', { preHandler: optionalAuth(), config: { rateLimit: { max: 12, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const cfg = await config(p);
    if (!cfg.enabled) return reply.code(503).send({ error: 'disabled' });
    const b = z.object({
      kind: z.enum(KINDS), targetId: z.string().trim().min(1).max(120),
      subject: z.string().trim().min(2).max(140), body: z.string().trim().min(10).max(cfg.maxBody),
      email: z.string().trim().email().max(254).optional(), name: z.string().trim().max(80).optional(),
      pow: z.any().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const uid = req.user?.uid || null;
    if (!uid) {
      if (!powVerify(b.data.pow)) return reply.code(400).send({ error: 'pow_required' });
      if (!b.data.email) return reply.code(400).send({ error: 'email_required' });
    }
    const email = uid ? '' : b.data.email.toLowerCase();
    if ((uid && cfg.blockedUserIds.includes(uid)) || (email && cfg.blockedEmails.includes(email))) return reply.code(403).send({ error: 'blocked' });
    const target = await resolveTarget(p, b.data.kind, b.data.targetId);
    if (!target) return reply.code(404).send({ error: 'not_found' });
    if (uid && target.ownerId === uid) return reply.code(400).send({ error: 'yourself' });
    // Member-to-member, refused SERVER-SIDE. The button is hidden in the UI too, but a
    // hidden button is a decoration: this is the rule.
    if (target.kind === 'user') {
      const gate = await directMessaging(p, cfg, target.ownerId);
      if (!gate.openNew) return reply.code(403).send({ error: gate.why });
      const cap = Number(cfg.memberDirect?.maxOpen || 0);
      if (cap > 0 && uid) {
        const open = await p.contactThread.count({ where: { senderId: uid, kind: 'user', status: 'open' } });
        if (open >= cap) return reply.code(429).send({ error: 'too_many_open', limit: cap });
      }
    }
    // Counted in the database: a process restart must not reopen the tap.
    const ip = String(clientIp(req) || '').slice(0, 64);
    const hour = new Date(Date.now() - 3600e3), day = new Date(Date.now() - 864e5);
    // An anonymous sender is counted among anonymous threads only: an office behind one IP
    // with three signed-in members must not find the form closed for the fourth.
    const who = uid ? { senderId: uid } : { senderId: null, OR: [{ senderEmail: email }, { ip }] };
    const [h, d] = await Promise.all([p.contactThread.count({ where: { ...who, createdAt: { gte: hour } } }), p.contactThread.count({ where: { ...who, createdAt: { gte: day } } })]);
    if (h >= (uid ? cfg.userPerHour : cfg.anonPerHour) || d >= (uid ? cfg.userPerDay : cfg.anonPerDay)) return reply.code(429).send({ error: 'rate_limited' });
    const t = await p.contactThread.create({
      data: {
        kind: target.kind, targetId: target.id, targetLabel: target.label,
        ownerUserId: target.teamId ? null : target.ownerId, ownerTeamId: target.teamId || null,
        senderId: uid, senderEmail: email, senderName: uid ? '' : (b.data.name || ''), accessToken: token(),
        subject: b.data.subject, ip,
        messages: { create: { authorId: uid, side: 'sender', body: b.data.body } },
      },
      include: INCLUDE_FULL,
    });
    await tellManagers(p, t, `New message about “${t.targetLabel}”: ${t.subject}`, `/dashboard?s=reports&thread=${t.id}`);
    await mailAnonSender(t, `Your message to ${t.targetLabel}`, `Your message “${t.subject}” has been sent. You will be e-mailed when they answer; you can also follow the conversation here:`);
    return reply.code(201).send({ thread: serThread(t, { withMessages: true, anon: !uid }), ...(uid ? {} : { accessToken: t.accessToken }) });
  });

  // ── the signed-in participant ───────────────────────────────────────────────────────────
  const mine = async (p, req) => {
    const teams = await teamIdsOf(p, req.user.uid);
    return { OR: [{ ownerUserId: req.user.uid }, ...(teams.length ? [{ ownerTeamId: { in: teams } }] : [])] };
  };
  const participant = async (p, req, reply, id) => {
    const t = await p.contactThread.findUnique({ where: { id }, include: INCLUDE_FULL });
    if (!t) { reply.code(404).send({ error: 'not_found' }); return null; }
    const teams = t.ownerTeamId ? await teamIdsOf(p, req.user.uid) : [];
    const owner = t.ownerUserId === req.user.uid || (t.ownerTeamId && teams.includes(t.ownerTeamId));
    const sender = t.senderId === req.user.uid;
    if (!owner && !sender && !isStaff(req.user)) { reply.code(404).send({ error: 'not_found' }); return null; }
    return { t, side: owner ? 'owner' : sender ? 'sender' : 'staff' };
  };

  app.get('/me/threads', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    await autoArchive(p, await config(p));
    const box = req.query?.box === 'sent' ? 'sent' : 'inbox';
    const where = box === 'sent' ? { senderId: req.user.uid } : await mine(p, req);
    const rows = await p.contactThread.findMany({ where, include: INCLUDE, orderBy: { lastActivityAt: 'desc' }, take: 200 });
    const unread = box === 'sent' ? rows.filter((r) => r.senderUnread).length : rows.filter((r) => r.ownerUnread).length;
    return { box, unread, threads: rows.map((r) => serThread(r)) };
  });

  app.get('/me/threads/:id', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const got = await participant(p, req, reply, req.params.id); if (!got) return;
    if (got.side === 'owner' && got.t.ownerUnread) await p.contactThread.update({ where: { id: got.t.id }, data: { ownerUnread: false } });
    if (got.side === 'sender' && got.t.senderUnread) await p.contactThread.update({ where: { id: got.t.id }, data: { senderUnread: false } });
    // A frozen conversation looks exactly like an open one until you press Send, and a reply
    // box that accepts text and then refuses it is worse than no reply box. So the read tells
    // the client what the write is going to decide, with the same function.
    const gate = got.t.kind === 'user' ? await directMessaging(p, await config(p), got.t.ownerUserId) : { reply: true, why: '' };
    return { thread: serThread(got.t, { withMessages: true, staff: isStaff(req.user) }), side: got.side, canWrite: gate.reply, frozen: gate.reply ? '' : gate.why };
  });

  const post = async (p, t, { authorId, side, body }) => {
    const m = await p.contactThreadMessage.create({ data: { threadId: t.id, authorId, side, body } });
    await p.contactThread.update({ where: { id: t.id }, data: { lastActivityAt: new Date(), ownerUnread: side !== 'owner', senderUnread: side !== 'sender' } });
    return m;
  };

  app.post('/me/threads/:id/messages', { preHandler: requireRole(), config: { rateLimit: { max: 40, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const cfg = await config(p);
    const b = z.object({ body: z.string().trim().min(1).max(cfg.maxBody) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (cfg.blockedUserIds.includes(req.user.uid)) return reply.code(403).send({ error: 'blocked' });
    const got = await participant(p, req, reply, req.params.id); if (!got) return;
    if (got.t.status !== 'open') return reply.code(409).send({ error: got.t.status });
    // A frozen conversation is readable and unwritable. Staff are exempt: moderation has to
    // keep working on a conversation the participants can no longer add to.
    if (got.t.kind === 'user' && got.side !== 'staff') {
      const gate = await directMessaging(p, cfg, got.t.ownerUserId);
      if (!gate.reply) return reply.code(403).send({ error: gate.why });
    }
    const m = await post(p, got.t, { authorId: req.user.uid, side: got.side, body: b.data.body });
    if (got.side === 'owner' || got.side === 'staff') {
      if (got.t.senderId) notify(p, got.t.senderId, 'thread', `Reply about “${got.t.targetLabel}”: ${got.t.subject}`, { href: `/dashboard?s=reports&thread=${got.t.id}` }).catch(() => {});
      else await mailAnonSender(got.t, `Reply: ${got.t.subject}`, `${got.t.targetLabel} answered your message.`);
    } else await tellManagers(p, got.t, `Reply on “${got.t.targetLabel}”: ${got.t.subject}`, `/dashboard?s=reports&thread=${got.t.id}`);
    return { message: serMsg({ ...m, author: { displayName: req.user.displayName } }) };
  });

  // Literal paths on purpose: the API-reference test and grep find routes by their string.
  const setState = (verb, data) => async (req, reply) => {
    const p = await db();
    const got = await participant(p, req, reply, req.params.id); if (!got) return;
    if (verb === 'reopen' && got.t.status === 'blocked') return reply.code(403).send({ error: 'blocked' });
    await p.contactThread.update({ where: { id: got.t.id }, data });
    return { ok: true };
  };
  app.post('/me/threads/:id/close', { preHandler: requireRole() }, setState('close', { status: 'closed' }));
  app.post('/me/threads/:id/reopen', { preHandler: requireRole() }, setState('reopen', { status: 'open' }));
  app.post('/me/threads/:id/flag', { preHandler: requireRole() }, setState('flag', { staffFlag: 'flagged' }));
  // Archived is a fourth status alongside open / closed / blocked, and the difference from
  // closed is who chose it: closed is a decision, archived is the passage of time. Reopen
  // takes both back to open, so nothing here is one-way.
  app.post('/me/threads/:id/archive', { preHandler: requireRole() }, setState('archive', { status: 'archived' }));

  // ── the member's own switch ────────────────────────────────────────────────────────────
  //
  // Lives here rather than on PATCH /me because it is read on exactly one path, and because
  // the answer is useless without the SITE's ceiling beside it: "you accept conversations"
  // and "the site allows them" are two different facts and a settings screen that shows only
  // the first one lies by omission the day an admin switches the feature off.
  app.get('/me/messaging', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const cfg = await config(p);
    const pref = await p.userMessagingPref.findUnique({ where: { userId: req.user.uid } }).catch(() => null);
    const md = cfg.memberDirect || MEMBER_DIRECT_DEFAULTS;
    const openCount = await p.contactThread.count({ where: { senderId: req.user.uid, kind: 'user', status: 'open' } });
    return {
      acceptsDirect: pref ? pref.acceptsDirect !== false : true,
      site: { enabled: md.enabled !== false, maxOpen: Number(md.maxOpen || 0), autoArchiveDays: Number(md.autoArchiveDays || 0), whenOff: md.whenOff === 'keep' ? 'keep' : 'freeze' },
      openCount,
    };
  });

  app.put('/me/messaging', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ acceptsDirect: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.userMessagingPref.upsert({ where: { userId: req.user.uid }, create: { userId: req.user.uid, acceptsDirect: b.data.acceptsDirect }, update: { acceptsDirect: b.data.acceptsDirect } });
    // Nothing is rewritten. Conversations already open are frozen by the read-time rule in
    // directMessaging(), which is what makes switching back on a no-op rather than a repair.
    return { acceptsDirect: b.data.acceptsDirect };
  });

  // ── the anonymous sender, by token ─────────────────────────────────────────────────────
  app.get('/threads/t/:token', { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const t = await p.contactThread.findUnique({ where: { accessToken: req.params.token }, include: INCLUDE_FULL });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    if (t.senderUnread) await p.contactThread.update({ where: { id: t.id }, data: { senderUnread: false } });
    const gate = t.kind === 'user' ? await directMessaging(p, await config(p), t.ownerUserId) : { reply: true, why: '' };
    return { thread: serThread(t, { withMessages: true, anon: true }), side: 'sender', canWrite: gate.reply, frozen: gate.reply ? '' : gate.why };
  });

  app.post('/threads/t/:token/messages', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const cfg = await config(p);
    const b = z.object({ body: z.string().trim().min(1).max(cfg.maxBody) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const t = await p.contactThread.findUnique({ where: { accessToken: req.params.token } });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    if (t.status !== 'open') return reply.code(409).send({ error: t.status });
    if (t.senderEmail && cfg.blockedEmails.includes(t.senderEmail)) return reply.code(403).send({ error: 'blocked' });
    if (t.kind === 'user') {
      const gate = await directMessaging(p, cfg, t.ownerUserId);
      if (!gate.reply) return reply.code(403).send({ error: gate.why });
    }
    const m = await post(p, t, { authorId: null, side: 'sender', body: b.data.body });
    await tellManagers(p, t, `Reply on “${t.targetLabel}”: ${t.subject}`, `/dashboard?s=reports&thread=${t.id}`);
    return { message: serMsg(m) };
  });

  // ── staff: moderation only ─────────────────────────────────────────────────────────────
  app.get('/admin/threads', { preHandler: requireCap('manage_reports') }, async (req) => {
    const p = await db();
    const q = String(req.query?.q || '').trim();
    const status = String(req.query?.status || '');
    const where = {
      ...(status === 'flagged' ? { staffFlag: 'flagged' } : status ? { status } : {}),
      ...(q ? { OR: [{ subject: { contains: q, mode: 'insensitive' } }, { targetLabel: { contains: q, mode: 'insensitive' } }, { senderEmail: { contains: q, mode: 'insensitive' } }] } : {}),
    };
    const rows = await p.contactThread.findMany({ where, include: INCLUDE, orderBy: { lastActivityAt: 'desc' }, take: 200 });
    const flagged = await p.contactThread.count({ where: { staffFlag: 'flagged' } });
    return { flagged, threads: rows.map((r) => serThread(r, { staff: true })) };
  });

  app.get('/admin/threads/:id', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const p = await db();
    const t = await p.contactThread.findUnique({ where: { id: req.params.id }, include: INCLUDE_FULL });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    return { thread: { ...serThread(t, { withMessages: true, staff: true }), ip: t.ip, messages: t.messages.map((m) => ({ ...serMsg(m), body: m.body })) } };
  });

  app.post('/admin/threads/:id/close', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const p = await db();
    const t = await p.contactThread.update({ where: { id: req.params.id }, data: { status: 'closed', staffFlag: '' } }).catch(() => null);
    if (!t) return reply.code(404).send({ error: 'not_found' });
    await logAudit(p, req.user.uid, 'thread.close', `thread=${t.id}`).catch(() => {});
    return { ok: true };
  });

  app.post('/admin/threads/:id/block', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const p = await db();
    const t = await p.contactThread.findUnique({ where: { id: req.params.id } });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    const cfg = await config(p);
    if (t.senderId && !cfg.blockedUserIds.includes(t.senderId)) cfg.blockedUserIds.push(t.senderId);
    if (t.senderEmail && !cfg.blockedEmails.includes(t.senderEmail)) cfg.blockedEmails.push(t.senderEmail);
    await p.adminSetting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: cfg }, update: { value: cfg } });
    await p.contactThread.updateMany({ where: { OR: [...(t.senderId ? [{ senderId: t.senderId }] : []), ...(t.senderEmail ? [{ senderEmail: t.senderEmail }] : [])] }, data: { status: 'blocked', staffFlag: '' } });
    await logAudit(p, req.user.uid, 'thread.block', `thread=${t.id} sender=${t.senderId || t.senderEmail}`).catch(() => {});
    return { ok: true };
  });

  const setHidden = (verb, hidden) => async (req, reply) => {
    const p = await db();
    const m = await p.contactThreadMessage.findFirst({ where: { id: req.params.mid, threadId: req.params.id } });
    if (!m) return reply.code(404).send({ error: 'not_found' });
    await p.contactThreadMessage.update({ where: { id: m.id }, data: { hidden } });
    await logAudit(p, req.user.uid, `thread.message.${verb}`, `thread=${req.params.id} message=${m.id}`).catch(() => {});
    return { ok: true };
  };
  app.post('/admin/threads/:id/messages/:mid/hide', { preHandler: requireCap('manage_reports') }, setHidden('hide', true));
  app.post('/admin/threads/:id/messages/:mid/unhide', { preHandler: requireCap('manage_reports') }, setHidden('unhide', false));

  app.get('/admin/threads/config', { preHandler: requireCap('manage_reports') }, async () => ({ config: await config(await db()) }));
  app.put('/admin/threads/config', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const b = z.object({
      enabled: z.boolean().optional(),
      userPerHour: z.number().int().min(0).max(1000).optional(), userPerDay: z.number().int().min(0).max(10000).optional(),
      anonPerHour: z.number().int().min(0).max(1000).optional(), anonPerDay: z.number().int().min(0).max(10000).optional(),
      messagesPerHour: z.number().int().min(1).max(1000).optional(), maxBody: z.number().int().min(200).max(20000).optional(),
      blockedEmails: z.array(z.string().trim().email().max(254)).max(2000).optional(),
      blockedUserIds: z.array(z.string().min(1).max(64)).max(2000).optional(),
      // Declared explicitly, because zod strips what it does not name: leave this out and
      // the admin's save returns 200 and writes nothing.
      memberDirect: z.object({
        enabled: z.boolean().optional(),
        maxOpen: z.number().int().min(0).max(1000).optional(),
        autoArchiveDays: z.number().int().min(0).max(3650).optional(),
        whenOff: z.enum(['freeze', 'keep']).optional(),
      }).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const prev = await config(p);
    const cfg = { ...prev, ...b.data, memberDirect: { ...prev.memberDirect, ...(b.data.memberDirect || {}) } };
    if (cfg.blockedEmails) cfg.blockedEmails = cfg.blockedEmails.map((e) => e.toLowerCase());
    await p.adminSetting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: cfg }, update: { value: cfg } });
    return { config: cfg };
  });
}
