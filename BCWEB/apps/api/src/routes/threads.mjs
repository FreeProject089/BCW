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
import { managerIdsOf, isStaff } from '../lib/teams.mjs';
import { markRead, markDelivered, cursorsOf, withReceipts } from '../lib/receipts.mjs';
import { resolveProjectRef } from '../lib/project-ref.mjs';
import { settingsFor, isTopicOf, inboxAccess, inboxWhere, inboxRecipients } from '../lib/project-contact.mjs';
import { answeringTeamIds, teamAnswerers, teamInboxFull } from '../lib/team-contact.mjs';
import { prepareFiles, commitFiles, deleteThreadFiles, filePolicyFor, serFile, threadFileStore } from '../lib/thread-files.mjs';
import { userBcId } from '../lib/repofingerprint.mjs';
import { buildPayload, signPayload, buildCopyZip, renderHtml, verifyCopy, keyIdOf } from '../lib/conversation-copy.mjs';
import { publicVerifyInfo } from '../lib/signing.mjs';

// A message may carry up to three files inline (base64), so the three write routes take a
// larger body than the 1 MB default. The per-file and per-inbox caps are checked in
// lib/thread-files.mjs; this is only the envelope.
const FILE_BODY_LIMIT = 48 * 1024 * 1024;
const fileSchema = z.array(z.object({ name: z.string().max(200), type: z.string().max(120), data: z.string().max(40 * 1024 * 1024) })).max(3).optional();
const fileError = (reply, r) => reply.code(r.error === 'too_large' || r.error === 'storage_full' ? 413 : r.error === 'unsupported_type' ? 415 : 400).send(r);

// 'project': a project's own contact inbox (lib/project-contact.mjs). Its targetId is the
// project REF, it has no owner user or team, and its receiving side is decided by
// inboxAccess() rather than by ownership.
const KINDS = ['repo', 'catalog', 'user', 'team', 'project'];
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
 *   autoArchiveDays  an open conversation nobody has touched for this long is archived. It
 *                    is not deleted and either side can reopen it. 0 = never.
 *   autoArchiveAnonDays  the same clock for a conversation opened by an ANONYMOUS sender
 *                    (no account, followed by an e-mailed link). Shorter by default: nobody
 *                    comes back to a dashboard for those, so an idle one is a dead one.
 *   openPerHour / openPerDay  how many conversations with MEMBERS one sender may start in a
 *                    window, on top of the general contact limits below. 0 = no extra limit.
 *   whenOff          the fate of a conversation that is already open when the site switch is
 *                    turned off. 'freeze' (default): both sides keep READING it, nobody can
 *                    write. 'keep': existing conversations stay writable and only new ones
 *                    are refused. Both are read-time rules, so flipping the switch back
 *                    restores exactly what was there — nothing is rewritten either way.
 *
 * There is deliberately NO cap on how many conversations a member may have. There was one
 * (`maxOpen`, 5): it punished the people who use the feature most and did nothing against a
 * spammer, who opens conversations faster than they close. The rate limits are what stop a
 * flood; the archive clock is what keeps the lists short. A stored `maxOpen` is ignored.
 */
const MEMBER_DIRECT_DEFAULTS = { enabled: true, autoArchiveDays: 30, autoArchiveAnonDays: 7, openPerHour: 4, openPerDay: 12, whenOff: 'freeze' };
const DEFAULTS = {
  enabled: true,
  userPerHour: 6, userPerDay: 20,
  anonPerHour: 3, anonPerDay: 8,
  messagesPerHour: 30,
  maxBody: 4000,
  // Minutes between the first reply of a burst and the ONE mail an anonymous sender gets
  // about it ("you have N unread messages"). 0 = mail at once, still one per burst.
  anonMailDebounceMin: 10,
  // Mail each participant a signed copy when a conversation is closed.
  copyOnClose: true,
  blockedEmails: [],
  blockedUserIds: [],
  memberDirect: MEMBER_DIRECT_DEFAULTS,
};

// For the tests, and only in the process that sets it: a config that is never written to the
// database. The suite runs its files in parallel against ONE database, and a test that
// flipped the stored switch or squeezed a stored rate limit changed the rules for every other
// file running at the same moment.
let configOverride = null;
export function setThreadsConfigOverride(v) { configOverride = v || null; }

async function config(p) {
  const row = configOverride ? null : await p.adminSetting.findUnique({ where: { key: CONFIG_KEY } }).catch(() => null);
  const stored = configOverride || (row?.value && typeof row.value === 'object' ? row.value : {});
  // Merged one level down on purpose: a stored config written before memberDirect existed,
  // or one that saved a single field of it, must not lose the other three to a shallow
  // spread. That is the shape that turns a default of 5 into `undefined` and a cap into no
  // cap at all, silently.
  const md = { ...MEMBER_DIRECT_DEFAULTS, ...(stored.memberDirect && typeof stored.memberDirect === 'object' ? stored.memberDirect : {}) };
  delete md.maxOpen; // retired: see the note above MEMBER_DIRECT_DEFAULTS
  return { ...DEFAULTS, ...stored, memberDirect: md };
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

/** Idle open conversations with members, archived. Two clocks: a conversation opened by
 *  an anonymous sender (senderId null) runs on the shorter one. Lazy rather than a sweeper:
 *  the only place it matters is a list somebody is looking at, and a cron job for a rule
 *  this cheap is a second thing to keep running. Exported for the tests. */
export async function autoArchive(p, cfg, now = Date.now()) {
  const md = cfg.memberDirect || MEMBER_DIRECT_DEFAULTS;
  const days = Number(md.autoArchiveDays || 0);
  const anonDays = Number(md.autoArchiveAnonDays || 0);
  let n = 0;
  if (days) n += (await p.contactThread.updateMany({ where: { kind: 'user', status: 'open', senderId: { not: null }, lastActivityAt: { lt: new Date(now - days * 864e5) } }, data: { status: 'archived' } }).catch(() => ({ count: 0 }))).count;
  if (anonDays) n += (await p.contactThread.updateMany({ where: { kind: 'user', status: 'open', senderId: null, lastActivityAt: { lt: new Date(now - anonDays * 864e5) } }, data: { status: 'archived' } }).catch(() => ({ count: 0 }))).count;
  return n;
}

/**
 * Has this author sent too many messages in the last hour? Counted in the database, so a
 * restart does not reset it, and across every conversation, so spreading a flood over ten
 * threads does not multiply the allowance. `messagesPerHour` was in the config (and on the
 * admin screen) for a long time without anything reading it. An anonymous author is counted
 * by the e-mail their threads carry.
 */
async function overMessageRate(p, cfg, { authorId = null, senderEmail = '' }) {
  const max = Number(cfg.messagesPerHour || 0);
  if (!max) return false;
  const since = new Date(Date.now() - 3600e3);
  const where = authorId
    ? { authorId, createdAt: { gte: since } }
    : { authorId: null, side: 'sender', createdAt: { gte: since }, thread: { senderEmail } };
  if (!authorId && !senderEmail) return false;
  return (await p.contactThreadMessage.count({ where })) >= max;
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
  if (kind === 'project') {
    const proj = await resolveProjectRef(p, id);
    // A private page is not contactable: its existence is not public. Unlisted and
    // whitelisted pages are reachable by link, so their contact is too.
    if (!proj || proj.visibility === 'private') return null;
    return { kind, id: proj.ref, label: proj.name, ownerId: null, teamId: null, proj };
  }
  return null;
}

const serMsg = (m) => ({ id: m.id, side: m.side, body: m.hidden ? '' : m.body, hidden: m.hidden, authorId: m.authorId, author: m.author?.displayName || null, createdAt: m.createdAt, files: m.hidden ? [] : (m.files || []) });
/**
 * Who wrote in, as the ANSWERING side sees them. A signed-in sender is shown as a person:
 * their name, picture, BC id, how long they have been here and a link to their public
 * profile, which is what "who is this" means to somebody deciding how to answer. Never their
 * e-mail: an account's address is private, and the conversation is the way to reach them.
 * An anonymous sender is shown with exactly what they gave: the name and the address they
 * typed into the form, which the form told them the recipient would see.
 */
const serSender = (u) => (u ? { id: u.id, displayName: u.displayName, avatar: u.avatar || null, bcId: userBcId(u.id), since: u.createdAt || null, profile: `/u/${u.id}` } : null);
const serThread = (t, { withMessages = false, staff = false, anon = false, owner = false } = {}) => ({
  id: t.id, kind: t.kind, targetId: t.targetId, targetLabel: t.targetLabel, subject: t.subject, status: t.status, topic: t.topic || '',
  ownerUnread: t.ownerUnread, senderUnread: t.senderUnread, staffFlag: staff ? t.staffFlag : undefined,
  sender: t.sender ? (owner || staff ? serSender(t.sender) : { id: t.sender.id, displayName: t.sender.displayName }) : null,
  senderName: t.senderName, senderEmail: staff || owner ? t.senderEmail : (t.senderEmail ? '(e-mail)' : ''),
  ownerUser: t.ownerUser ? { id: t.ownerUser.id, displayName: t.ownerUser.displayName } : null,
  ownerTeam: t.ownerTeam ? { id: t.ownerTeam.id, slug: t.ownerTeam.slug, name: t.ownerTeam.name } : null,
  lastActivityAt: t.lastActivityAt, createdAt: t.createdAt, anon,
  ...(withMessages ? { messages: (t.messages || []).filter((m) => staff || !m.hidden).map(serMsg) } : {}),
});
const INCLUDE = { sender: { select: { id: true, displayName: true, avatar: true, createdAt: true } }, ownerUser: { select: { id: true, displayName: true } }, ownerTeam: { select: { id: true, slug: true, name: true } } };
const INCLUDE_FULL = { ...INCLUDE, messages: { orderBy: { createdAt: 'asc' }, include: { author: { select: { displayName: true } } } }, attachments: { orderBy: { createdAt: 'asc' } } };
/** The thread with each message carrying its files. */
const withFiles = (t) => {
  const by = {};
  for (const a of t.attachments || []) (by[a.messageId || ''] ||= []).push(serFile(a));
  return { ...t, messages: (t.messages || []).map((m) => ({ ...m, files: by[m.id] || [] })) };
};

/** Who answers a project conversation: see lib/project-contact.mjs. */
async function projectRecipients(p, thread) {
  const proj = await resolveProjectRef(p, thread.targetId);
  return proj ? inboxRecipients(p, proj, await settingsFor(p, proj.ref)) : [];
}

async function tellManagers(p, thread, text, href) {
  const ids = thread.kind === 'project' ? await projectRecipients(p, thread)
    : thread.ownerTeamId ? await teamAnswerers(p, thread.ownerTeamId)
      : await managerIdsOf(p, { ownerId: thread.ownerUserId, teamId: thread.ownerTeamId });
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

/**
 * "You have N unread messages": one mail per BURST of replies to an anonymous sender.
 *
 * A reply sets the sender side's `mailDueAt` if it is not already set, and leaves it alone if
 * it is: the first reply of a burst starts the clock and the next nine ride on it. When it
 * falls due, the count is taken THEN, from the sender side's read cursor, so a sender who
 * opened the link in the meantime gets nothing (markRead clears `mailDueAt` too). The link is
 * the thread's existing access-token link; no new secret is minted.
 */
export async function scheduleAnonMail(p, cfg, thread, now = new Date()) {
  if (thread.senderId || !thread.senderEmail) return null;
  const due = new Date(now.getTime() + Math.max(0, Number(cfg.anonMailDebounceMin ?? 10)) * 60e3);
  const key = { kind_conversationId_side: { kind: 'thread', conversationId: thread.id, side: 'sender' } };
  const cur = await p.conversationCursor.findUnique({ where: key }).catch(() => null);
  if (cur?.mailDueAt) return cur.mailDueAt;
  await p.conversationCursor.upsert({ where: key, create: { kind: 'thread', conversationId: thread.id, side: 'sender', mailDueAt: due }, update: { mailDueAt: due } });
  return due;
}

/** Send every due "unread messages" mail. Called by a timer after a reply and by the sweeper. */
export async function flushAnonThreadMails(p, { now = new Date(), send = sendMail, only = null } = {}) {
  // `only` narrows the run to some conversations (the tests: the dev database has real ones).
  const due = await p.conversationCursor.findMany({ where: { kind: 'thread', side: 'sender', mailDueAt: { lte: now }, ...(only ? { conversationId: { in: only } } : {}) }, take: 200 }).catch(() => []);
  let sent = 0;
  for (const c of due) {
    // Claim it first, so two runners (the timer and the sweeper) cannot both send it.
    const claimed = await p.conversationCursor.updateMany({ where: { id: c.id, mailDueAt: c.mailDueAt }, data: { mailDueAt: null } });
    if (!claimed.count) continue;
    const t = await p.contactThread.findUnique({ where: { id: c.conversationId }, select: { id: true, subject: true, targetLabel: true, senderId: true, senderEmail: true, accessToken: true, status: true } });
    if (!t || t.senderId || !t.senderEmail || t.status === 'blocked') continue;
    const unread = await p.contactThreadMessage.count({ where: { threadId: t.id, side: { not: 'sender' }, hidden: false, ...(c.readAt ? { createdAt: { gt: c.readAt } } : {}) } });
    if (!unread) continue;
    const link = `${site()}/messages/t/${t.accessToken}`;
    const subject = unread === 1 ? `1 unread message: ${t.subject}` : `${unread} unread messages: ${t.subject}`;
    const intro = `${t.targetLabel} answered you. You have ${unread} unread message${unread === 1 ? '' : 's'} in this conversation.`;
    await send({
      to: t.senderEmail, subject, mailId: 'thread.unread',
      html: mailShell(subject, `<p>${escapeHtml(intro)}</p><p><a href="${link}">${escapeHtml(link)}</a></p><p style="color:#888;font-size:12px">Anyone with this link can read and answer the conversation, keep it to yourself.</p>`, { label: 'Open the conversation', href: link }),
      text: `${intro}\n\n${link}`,
    }).catch(() => {});
    // The mail is the delivery: the sender's side now HAS the messages, in their inbox.
    await p.conversationCursor.update({ where: { id: c.id }, data: { mailedAt: now, deliveredAt: now } }).catch(() => {});
    sent += 1;
  }
  return sent;
}

// ── Copies of a conversation (lib/conversation-copy.mjs) ──────────────────────────────────
let copyMailer = sendMail;
/** For the tests: capture the copy mails instead of sending them. */
export function setCopyMailer(fn) { copyMailer = fn || sendMail; }

/** One side's signed copy of a thread, and its archive. */
export async function copyOf(p, threadId, side, recipient = '') {
  const t = await p.contactThread.findUnique({ where: { id: threadId }, include: INCLUDE_FULL });
  if (!t) return null;
  const signed = await signPayload(p, buildPayload(t, { side, site: site(), recipient }));
  return { t, signed, zip: await buildCopyZip(p, signed, { site: site() }) };
}

/** Mail one side's copy: the readable conversation as the body, the archive attached. */
async function mailCopy(p, threadId, side, to, recipient = '') {
  if (!to) return false;
  const c = await copyOf(p, threadId, side, recipient);
  if (!c) return false;
  const subject = `Your copy of the conversation: ${c.t.subject}`;
  await copyMailer({
    to, subject, mailId: 'thread.copy',
    html: renderHtml(c.signed.payload),
    text: `A copy of the conversation "${c.t.subject}" is attached, with a signed file that proves it is genuine and unmodified. Check it at ${site()}/verify-copy`,
    attachments: [{ filename: `conversation-${c.t.id}.zip`, content: c.zip, contentType: 'application/zip' }],
  }).catch(() => {});
  return true;
}

/**
 * Who gets a copy when a conversation closes: the sender (their account address, or the
 * address an anonymous sender gave), and on the answering side the people who actually
 * WROTE in it, plus a personal owner. Not every member of a team or every reader of a
 * project inbox: a copy is for the people who were in the conversation.
 */
export async function mailCopiesOnClose(p, threadId) {
  const t = await p.contactThread.findUnique({ where: { id: threadId }, include: { sender: { select: { id: true, email: true, displayName: true } }, messages: { select: { authorId: true, side: true } } } });
  if (!t) return 0;
  let n = 0;
  const senderTo = t.sender?.email || t.senderEmail;
  if (senderTo && await mailCopy(p, t.id, 'sender', senderTo, t.sender?.displayName || t.senderName)) n += 1;
  const ownerIds = new Set(t.messages.filter((m) => m.side === 'owner' && m.authorId).map((m) => m.authorId));
  if (t.ownerUserId) ownerIds.add(t.ownerUserId);
  ownerIds.delete(t.senderId);
  if (ownerIds.size) {
    const users = await p.user.findMany({ where: { id: { in: [...ownerIds] } }, select: { email: true, displayName: true } });
    for (const u of users) if (await mailCopy(p, t.id, 'owner', u.email, u.displayName)) n += 1;
  }
  return n;
}

export default async function threadRoutes(app) {
  // ── opening one ────────────────────────────────────────────────────────────────────────
  app.post('/threads', { preHandler: optionalAuth(), bodyLimit: FILE_BODY_LIMIT, config: { rateLimit: { max: 12, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const cfg = await config(p);
    if (!cfg.enabled) return reply.code(503).send({ error: 'disabled' });
    const b = z.object({
      kind: z.enum(KINDS), targetId: z.string().trim().min(1).max(120),
      subject: z.string().trim().min(2).max(140), body: z.string().trim().min(10).max(cfg.maxBody),
      email: z.string().trim().email().max(254).optional(), name: z.string().trim().max(80).optional(),
      topic: z.string().trim().max(40).optional(),
      files: fileSchema,
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
    // A project's inbox can be closed, and it only takes the topics it offers.
    let topic = '';
    if (target.kind === 'project') {
      const ps = await settingsFor(p, target.id);
      if (!ps.enabled) return reply.code(403).send({ error: 'project_contact_off' });
      if (!b.data.topic || !isTopicOf(ps, b.data.topic)) return reply.code(400).send({ error: 'invalid_topic' });
      topic = b.data.topic;
    }
    if (uid && target.ownerId === uid) return reply.code(400).send({ error: 'yourself' });
    // A team may cap how many conversations its inbox keeps open (lib/team-contact.mjs).
    if (target.teamId) {
      const full = await teamInboxFull(p, target.teamId, { anonymous: !uid });
      if (full) return reply.code(429).send(full);
    }
    // Files are checked before anything is written: a refused file refuses the message.
    const prepared = await prepareFiles(p, { kind: target.kind, targetId: target.id, ownerTeamId: target.teamId || null }, b.data.files);
    if (prepared.error) return fileError(reply, prepared);
    // Member-to-member, refused SERVER-SIDE. The button is hidden in the UI too, but a
    // hidden button is a decoration: this is the rule.
    if (target.kind === 'user') {
      const gate = await directMessaging(p, cfg, target.ownerId);
      if (!gate.openNew) return reply.code(403).send({ error: gate.why });
      // Opening conversations with MEMBERS has its own, tighter tap, counted like the
      // general one below. A person is not a published thing: a burst of new conversations
      // toward members is the shape of harassment and of spam, and it is not the shape of
      // somebody with a question about a repo.
      const md = cfg.memberDirect || MEMBER_DIRECT_DEFAULTS;
      const whoM = uid ? { senderId: uid } : { senderId: null, senderEmail: email };
      const [mh, mdy] = await Promise.all([
        md.openPerHour ? p.contactThread.count({ where: { ...whoM, kind: 'user', createdAt: { gte: new Date(Date.now() - 3600e3) } } }) : 0,
        md.openPerDay ? p.contactThread.count({ where: { ...whoM, kind: 'user', createdAt: { gte: new Date(Date.now() - 864e5) } } }) : 0,
      ]);
      if ((md.openPerHour && mh >= md.openPerHour) || (md.openPerDay && mdy >= md.openPerDay)) return reply.code(429).send({ error: 'rate_limited', scope: 'member' });
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
        subject: b.data.subject, ip, topic,
        messages: { create: { authorId: uid, side: 'sender', body: b.data.body } },
      },
      include: INCLUDE_FULL,
    });
    if (prepared.decoded.length) await commitFiles(p, t, t.messages[0]?.id || null, prepared);
    await tellManagers(p, t, `New message about “${t.targetLabel}”: ${t.subject}`, `/dashboard?s=reports&thread=${t.id}`);
    await mailAnonSender(t, `Your message to ${t.targetLabel}`, `Your message “${t.subject}” has been sent. You will be e-mailed when they answer; you can also follow the conversation here:`);
    const full = prepared.decoded.length ? await p.contactThread.findUnique({ where: { id: t.id }, include: INCLUDE_FULL }) : t;
    return reply.code(201).send({ thread: serThread(withFiles(full), { withMessages: true, anon: !uid }), ...(uid ? {} : { accessToken: t.accessToken }) });
  });

  // ── the signed-in participant ───────────────────────────────────────────────────────────
  const mine = async (p, req) => {
    const teams = await answeringTeamIds(p, req.user.uid);
    const projects = await inboxWhere(p, req.user);
    return { OR: [{ ownerUserId: req.user.uid }, ...(teams.length ? [{ ownerTeamId: { in: teams } }] : []), ...(projects ? [projects] : [])] };
  };
  const participant = async (p, req, reply, id) => {
    const t = await p.contactThread.findUnique({ where: { id }, include: INCLUDE_FULL });
    if (!t) { reply.code(404).send({ error: 'not_found' }); return null; }
    const teams = t.ownerTeamId ? await answeringTeamIds(p, req.user.uid) : [];
    let owner = t.ownerUserId === req.user.uid || (t.ownerTeamId && teams.includes(t.ownerTeamId));
    if (!owner && t.kind === 'project' && t.senderId !== req.user.uid) {
      const proj = await resolveProjectRef(p, t.targetId);
      owner = !!(proj && await inboxAccess(req.user, proj, await settingsFor(p, proj.ref)));
    }
    const sender = t.senderId === req.user.uid;
    if (!owner && !sender && !isStaff(req.user)) { reply.code(404).send({ error: 'not_found' }); return null; }
    return { t, side: owner ? 'owner' : sender ? 'sender' : 'staff' };
  };

  app.get('/me/threads', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    await autoArchive(p, await config(p));
    const box = req.query?.box === 'sent' ? 'sent' : 'inbox';
    const base = box === 'sent' ? { senderId: req.user.uid } : await mine(p, req);
    // ?project=<ref>: one project's inbox, as its "Inbox" button opens it. A NARROWING of what
    // the viewer may already see, never a widening: it is ANDed with the rule above.
    const project = typeof req.query?.project === 'string' ? req.query.project.slice(0, 90) : '';
    const where = project ? { AND: [base, { kind: 'project', targetId: project }] } : base;
    const rows = await p.contactThread.findMany({ where, include: INCLUDE, orderBy: { lastActivityAt: 'desc' }, take: 200 });
    await markDelivered(p, 'thread', rows.map((r) => r.id), box === 'sent' ? 'sender' : 'owner');
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
    if (got.side !== 'staff') await markRead(p, 'thread', got.t.id, got.side);
    const th = serThread(withFiles(got.t), { withMessages: true, staff: isStaff(req.user), owner: got.side === 'owner' });
    th.messages = withReceipts('thread', th.messages, await cursorsOf(p, 'thread', got.t.id), { sideOf: (m) => m.side, isMine: (m) => m.side === got.side });
    const files = await filePolicyFor(p, got.t);
    return { thread: th, side: got.side, canWrite: gate.reply, frozen: gate.reply ? '' : gate.why, files: { allowed: files.allowed, why: files.why, maxBytes: files.maxBytes, maxFiles: files.maxFiles } };
  });

  const post = async (p, t, { authorId, side, body }) => {
    const m = await p.contactThreadMessage.create({ data: { threadId: t.id, authorId, side, body } });
    await p.contactThread.update({ where: { id: t.id }, data: { lastActivityAt: new Date(), ownerUnread: side !== 'owner', senderUnread: side !== 'sender' } });
    return m;
  };

  app.post('/me/threads/:id/messages', { preHandler: requireRole(), bodyLimit: FILE_BODY_LIMIT, config: { rateLimit: { max: 40, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const cfg = await config(p);
    const b = z.object({ body: z.string().trim().min(1).max(cfg.maxBody), files: fileSchema }).safeParse(req.body);
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
    if (got.side !== 'staff' && await overMessageRate(p, cfg, { authorId: req.user.uid })) return reply.code(429).send({ error: 'rate_limited' });
    const prepared = await prepareFiles(p, got.t, b.data.files);
    if (prepared.error) return fileError(reply, prepared);
    const m = await post(p, got.t, { authorId: req.user.uid, side: got.side, body: b.data.body });
    const stored = await commitFiles(p, got.t, m.id, prepared);
    if (got.side === 'owner' || got.side === 'staff') {
      if (got.t.senderId) notify(p, got.t.senderId, 'thread', `Reply about “${got.t.targetLabel}”: ${got.t.subject}`, { href: `/dashboard?s=reports&thread=${got.t.id}` }).catch(() => {});
      else {
        // One mail per burst, not one per message: see scheduleAnonMail.
        const due = await scheduleAnonMail(p, cfg, got.t);
        if (due) setTimeout(() => { flushAnonThreadMails(p).catch(() => {}); }, Math.max(0, due.getTime() - Date.now()) + 1000).unref?.();
      }
    } else await tellManagers(p, got.t, `Reply on “${got.t.targetLabel}”: ${got.t.subject}`, `/dashboard?s=reports&thread=${got.t.id}`);
    return { message: { ...serMsg({ ...m, author: { displayName: req.user.displayName }, files: stored.rows.map(serFile) }), receipt: 'sent' } };
  });

  // Literal paths on purpose: the API-reference test and grep find routes by their string.
  const setState = (verb, data) => async (req, reply) => {
    const p = await db();
    const got = await participant(p, req, reply, req.params.id); if (!got) return;
    if (verb === 'reopen' && got.t.status === 'blocked') return reply.code(403).send({ error: 'blocked' });
    await p.contactThread.update({ where: { id: got.t.id }, data });
    // Closing is the end of the conversation: each participant gets a signed copy of it
    // (threads.config.copyOnClose, on unless an admin switched it off).
    if (verb === 'close' && got.t.status !== 'closed' && (await config(p)).copyOnClose !== false) mailCopiesOnClose(p, got.t.id).catch(() => {});
    return { ok: true };
  };
  app.post('/me/threads/:id/close', { preHandler: requireRole() }, setState('close', { status: 'closed' }));
  app.post('/me/threads/:id/reopen', { preHandler: requireRole() }, setState('reopen', { status: 'open' }));
  app.post('/me/threads/:id/flag', { preHandler: requireRole() }, setState('flag', { staffFlag: 'flagged' }));
  // Archived is a fourth status alongside open / closed / blocked, and the difference from
  // closed is who chose it: closed is a decision, archived is the passage of time. Reopen
  // takes both back to open, so nothing here is one-way.
  app.post('/me/threads/:id/archive', { preHandler: requireRole() }, setState('archive', { status: 'archived' }));

  // ── files, read back by a participant ──────────────────────────────────────────────────
  //
  // Always as a download (Content-Disposition: attachment, nosniff): a file somebody sent is
  // never rendered on our origin, whatever its type claims to be.
  const sendFile = async (p, reply, threadId, fileId) => {
    const a = await p.contactThreadAttachment.findFirst({ where: { id: fileId, threadId } });
    if (!a) return reply.code(404).send({ error: 'not_found' });
    const obj = await threadFileStore().get(a.key).catch(() => null);
    if (!obj) return reply.code(404).send({ error: 'gone' });
    reply.header('Content-Type', a.mime).header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `attachment; filename="${a.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(a.name)}`)
      .header('Cache-Control', 'private, no-store');
    return reply.send(obj.body);
  };
  app.get('/me/threads/:id/files/:fid', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const got = await participant(p, req, reply, req.params.id); if (!got) return;
    return sendFile(p, reply, got.t.id, req.params.fid);
  });
  app.get('/threads/t/:token/files/:fid', { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const t = await p.contactThread.findUnique({ where: { accessToken: req.params.token }, select: { id: true } });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    return sendFile(p, reply, t.id, req.params.fid);
  });

  // ── a copy, on demand ───────────────────────────────────────────────────────────────────
  //
  // GET  …/copy        the archive, downloaded (readable copy + signed copy + key + how to check)
  // POST …/copy/mail   the same, mailed to the participant's own address
  // Each side gets ITS copy: what that side saw, and nothing the other side alone was shown.
  const sendZip = (reply, c) => reply
    .header('Content-Type', 'application/zip')
    .header('Content-Disposition', `attachment; filename="conversation-${c.t.id}.zip"`)
    .header('Cache-Control', 'private, no-store')
    .send(c.zip);
  const sideForCopy = (got) => (got.side === 'sender' ? 'sender' : 'owner');
  app.get('/me/threads/:id/copy', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const got = await participant(p, req, reply, req.params.id); if (!got) return;
    return sendZip(reply, await copyOf(p, got.t.id, sideForCopy(got), req.user.displayName || ''));
  });
  app.post('/me/threads/:id/copy/mail', { preHandler: requireRole(), config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const got = await participant(p, req, reply, req.params.id); if (!got) return;
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { email: true, displayName: true } });
    await mailCopy(p, got.t.id, sideForCopy(got), me?.email, me?.displayName || '');
    return { ok: true, sent: emailEnabled() };
  });
  app.get('/threads/t/:token/copy', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const p = await db();
    const t = await p.contactThread.findUnique({ where: { accessToken: req.params.token }, select: { id: true, senderName: true } });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    return sendZip(reply, await copyOf(p, t.id, 'sender', t.senderName || ''));
  });
  app.post('/threads/t/:token/copy/mail', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const t = await p.contactThread.findUnique({ where: { accessToken: req.params.token }, select: { id: true, senderEmail: true, senderName: true } });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    // Only ever to the address the thread already has: this route takes no address.
    await mailCopy(p, t.id, 'sender', t.senderEmail, t.senderName || '');
    return { ok: true, sent: emailEnabled() };
  });

  // Anyone may check a copy: it is the point of signing one. The file is judged against
  // the key THIS server holds, never against a key the file brings.
  app.post('/conversation-copy/verify', { bodyLimit: 8 * 1024 * 1024, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const doc = req.body?.doc ?? req.body;
    const p = await db();
    const r = await verifyCopy(p, doc);
    if (!r.valid) return { valid: false, reason: r.reason };
    const c = doc.payload.conversation;
    return { valid: true, reason: 'ok', conversation: { subject: c.subject, about: c.about, with: c.with, messages: doc.payload.messages.length, issuedAt: doc.payload.issuedAt, recipient: doc.payload.recipient?.side } };
  });
  app.get('/conversation-copy/key', async () => {
    const info = await publicVerifyInfo(await db());
    return { ...info, keyId: keyIdOf(info.publicKey) };
  });

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
      site: { enabled: md.enabled !== false, autoArchiveDays: Number(md.autoArchiveDays || 0), autoArchiveAnonDays: Number(md.autoArchiveAnonDays || 0), openPerHour: Number(md.openPerHour || 0), openPerDay: Number(md.openPerDay || 0), whenOff: md.whenOff === 'keep' ? 'keep' : 'freeze' },
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
    await autoArchive(p, await config(p));
    const t = await p.contactThread.findUnique({ where: { accessToken: req.params.token }, include: INCLUDE_FULL });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    if (t.senderUnread) await p.contactThread.update({ where: { id: t.id }, data: { senderUnread: false } });
    const gate = t.kind === 'user' ? await directMessaging(p, await config(p), t.ownerUserId) : { reply: true, why: '' };
    await markRead(p, 'thread', t.id, 'sender');
    const th = serThread(withFiles(t), { withMessages: true, anon: true });
    th.messages = withReceipts('thread', th.messages, await cursorsOf(p, 'thread', t.id), { sideOf: (m) => m.side, isMine: (m) => m.side === 'sender' });
    const files = await filePolicyFor(p, t);
    return { thread: th, side: 'sender', canWrite: gate.reply, frozen: gate.reply ? '' : gate.why, files: { allowed: files.allowed, why: files.why, maxBytes: files.maxBytes, maxFiles: files.maxFiles } };
  });

  app.post('/threads/t/:token/messages', { bodyLimit: FILE_BODY_LIMIT, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const cfg = await config(p);
    const b = z.object({ body: z.string().trim().min(1).max(cfg.maxBody), files: fileSchema }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const t = await p.contactThread.findUnique({ where: { accessToken: req.params.token } });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    if (t.status !== 'open') return reply.code(409).send({ error: t.status });
    if (t.senderEmail && cfg.blockedEmails.includes(t.senderEmail)) return reply.code(403).send({ error: 'blocked' });
    if (t.kind === 'user') {
      const gate = await directMessaging(p, cfg, t.ownerUserId);
      if (!gate.reply) return reply.code(403).send({ error: gate.why });
    }
    if (await overMessageRate(p, cfg, { senderEmail: t.senderEmail })) return reply.code(429).send({ error: 'rate_limited' });
    const prepared = await prepareFiles(p, t, b.data.files);
    if (prepared.error) return fileError(reply, prepared);
    const m = await post(p, t, { authorId: null, side: 'sender', body: b.data.body });
    const stored = await commitFiles(p, t, m.id, prepared);
    await tellManagers(p, t, `Reply on “${t.targetLabel}”: ${t.subject}`, `/dashboard?s=reports&thread=${t.id}`);
    return { message: { ...serMsg({ ...m, files: stored.rows.map(serFile) }), receipt: 'sent' } };
  });

  // ── staff: moderation only ─────────────────────────────────────────────────────────────
  app.get('/admin/threads', { preHandler: requireCap('manage_reports') }, async (req) => {
    const p = await db();
    await autoArchive(p, await config(p));
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
    if ((await config(p)).copyOnClose !== false) mailCopiesOnClose(p, t.id).catch(() => {});
    return { ok: true };
  });

  // Archive and reopen: the same two moves a participant has, for any conversation. Staff
  // use them on a conversation that went quiet with a flag on it, or to take back an
  // auto-archive somebody asked about.
  const adminSet = (verb, data) => async (req, reply) => {
    const p = await db();
    const t = await p.contactThread.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    if (verb === 'reopen' && t.status === 'blocked') return reply.code(409).send({ error: 'blocked' });
    await p.contactThread.update({ where: { id: t.id }, data });
    await logAudit(p, req.user.uid, `thread.${verb}`, `thread=${t.id}`).catch(() => {});
    return { ok: true };
  };
  app.post('/admin/threads/:id/archive', { preHandler: requireCap('manage_reports') }, adminSet('archive', { status: 'archived' }));
  app.post('/admin/threads/:id/reopen', { preHandler: requireCap('manage_reports') }, adminSet('reopen', { status: 'open' }));

  // Delete, for real: the conversation and its messages (cascade). The web screen holds it
  // behind an undo window, so the request only leaves once the admin let it. What is kept is
  // the audit line — who deleted which conversation between whom — because a moderation
  // action that leaves no trace is one nobody can be asked about.
  app.delete('/admin/threads/:id', { preHandler: requireCap('manage_reports') }, async (req, reply) => {
    const p = await db();
    const t = await p.contactThread.findUnique({ where: { id: req.params.id }, select: { id: true, kind: true, targetId: true, senderId: true, senderEmail: true, _count: { select: { messages: true } } } });
    if (!t) return reply.code(404).send({ error: 'not_found' });
    await deleteThreadFiles(p, t.id);
    await p.contactThread.delete({ where: { id: t.id } });
    await logAudit(p, req.user.uid, 'thread.delete', `thread=${t.id} kind=${t.kind} target=${t.targetId} messages=${t._count.messages}`).catch(() => {});
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
      anonMailDebounceMin: z.number().int().min(0).max(1440).optional(),
      copyOnClose: z.boolean().optional(),
      blockedEmails: z.array(z.string().trim().email().max(254)).max(2000).optional(),
      blockedUserIds: z.array(z.string().min(1).max(64)).max(2000).optional(),
      // Declared explicitly, because zod strips what it does not name: leave this out and
      // the admin's save returns 200 and writes nothing.
      memberDirect: z.object({
        enabled: z.boolean().optional(),
        autoArchiveDays: z.number().int().min(0).max(3650).optional(),
        autoArchiveAnonDays: z.number().int().min(0).max(3650).optional(),
        openPerHour: z.number().int().min(0).max(1000).optional(),
        openPerDay: z.number().int().min(0).max(10000).optional(),
        whenOff: z.enum(['freeze', 'keep']).optional(),
      }).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const prev = await config(p);
    const cfg = { ...prev, ...b.data, memberDirect: { ...prev.memberDirect, ...(b.data.memberDirect || {}) } };
    delete cfg.memberDirect.maxOpen;
    if (cfg.blockedEmails) cfg.blockedEmails = cfg.blockedEmails.map((e) => e.toLowerCase());
    await p.adminSetting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value: cfg }, update: { value: cfg } });
    return { config: cfg };
  });
}
