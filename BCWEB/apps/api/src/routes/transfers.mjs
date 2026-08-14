// Handing a repository or a catalog item to somebody else.
//
// The rule that shapes this file: a transfer is a REQUEST. The recipient inherits storage
// they will be billed for, content they answer for, and any reports attached to the
// object. Moving that onto an account without asking makes somebody the owner of a
// problem they have never seen — so nothing changes hands until they say yes.
//
// Ownership is re-checked at ACCEPT, not only at creation. Between the two the sender may
// have sold, deleted or already transferred the thing; accepting on the strength of a
// week-old check would hand over something they no longer have.
import { z } from 'zod';
import { db, requireRole, notify, logAudit, clientIp } from '../lib/lib.mjs';
import { sendMail, mailShell, escapeHtml } from '../lib/mail.mjs';

const KINDS = ['repo', 'catalog'];
const TTL_DAYS = 14;

const SITE = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');

/** The object, if this user owns it right now. Null for "not yours" and "not there" alike
 *  — telling those apart would let anyone probe which ids exist. */
async function ownedTarget(p, kind, id, userId) {
  if (kind === 'repo') {
    const r = await p.serverRepo.findUnique({ where: { id }, select: { id: true, name: true, ownerId: true } });
    return r && r.ownerId === userId ? r : null;
  }
  const c = await p.catalogItem.findUnique({ where: { id }, select: { id: true, name: true, ownerId: true } });
  return c && c.ownerId === userId ? c : null;
}

/** Why this object cannot be handed over yet, or null if it can.
 *
 *  Billing is the one that matters. A hosted repo is paid for by a subscription anchored
 *  to its owner's Stripe customer; move the repo and the new owner holds something the old
 *  owner is still being charged for, with neither able to fix it from their own dashboard.
 *  Cancel or move the billing first — refusing here is the only honest option, because the
 *  alternative is a silent double-bind discovered on the next invoice. */
async function transferBlocker(p, kind, target) {
  if (kind !== 'repo') return null;
  const repo = await p.serverRepo.findUnique({ where: { id: target.id }, select: { hosted: true, hostingGroupId: true } });
  if (!repo?.hosted) return null;
  const sub = await p.subscription.findFirst({
    where: { status: 'active', OR: [{ serverRepoId: target.id }, ...(repo.hostingGroupId ? [{ hostingGroupId: repo.hostingGroupId }] : [])] },
    select: { id: true },
  });
  return sub ? 'active_subscription' : null;
}

export default async function transferRoutes(app) {
  // ── Start a transfer ────────────────────────────────────────────────────────
  app.post('/me/transfers', { preHandler: requireRole(), config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = z.object({
      kind: z.enum(['repo', 'catalog']),
      targetId: z.string().min(1).max(64),
      // By email: it is what you know about the person you are handing something to. A
      // user id would mean asking them for it first, which most people cannot find.
      toEmail: z.string().email().max(160),
      message: z.string().max(500).default(''),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const target = await ownedTarget(p, b.data.kind, b.data.targetId, req.user.uid);
    if (!target) return reply.code(404).send({ error: 'not_found' });

    const blocker = await transferBlocker(p, b.data.kind, target);
    if (blocker) return reply.code(409).send({ error: blocker });

    const to = await p.user.findUnique({ where: { email: b.data.toEmail.toLowerCase() }, select: { id: true, email: true, displayName: true, status: true } });
    // Deliberately explicit rather than a silent no-op: "we sent it" to an address with no
    // account means the sender waits forever for an answer nobody was asked for.
    if (!to) return reply.code(404).send({ error: 'no_such_user' });
    if (to.id === req.user.uid) return reply.code(400).send({ error: 'self_transfer' });
    if (to.status && to.status !== 'active') return reply.code(409).send({ error: 'recipient_unavailable' });

    // One live request per object. Two pending transfers of the same repo to two people is
    // a race whose loser finds out by having it vanish.
    const existing = await p.ownershipTransfer.findFirst({ where: { kind: b.data.kind, targetId: target.id, status: 'pending' } });
    if (existing) return reply.code(409).send({ error: 'already_pending' });

    const tr = await p.ownershipTransfer.create({ data: {
      kind: b.data.kind, targetId: target.id, targetName: target.name || target.id,
      fromUserId: req.user.uid, toUserId: to.id, message: b.data.message,
      expiresAt: new Date(Date.now() + TTL_DAYS * 864e5),
    } });

    const from = await p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true } });
    const what = b.data.kind === 'repo' ? 'repository' : 'catalog item';
    const subject = `${from?.displayName || 'Someone'} wants to transfer "${tr.targetName}" to you`;
    await notify(p, to.id, 'Ownership transfer offered',
      `${from?.displayName || 'Someone'} offered you the ${what} "${tr.targetName}". Accept or decline it in your profile.`).catch(() => {});
    await sendMail({
      to: to.email,
      subject,
      html: mailShell(subject, `
        <p><b>${escapeHtml(from?.displayName || 'Someone')}</b> would like to transfer the ${what}
           <b>${escapeHtml(tr.targetName)}</b> to your account.</p>
        ${b.data.message ? `<p style="padding:10px 14px;border-left:3px solid #f97316;color:#6f685d">${escapeHtml(b.data.message)}</p>` : ''}
        <p>Nothing has changed yet — it becomes yours only if you accept. If you do, you take on
           its content and any storage it uses.</p>
        <p>This offer expires in ${TTL_DAYS} days.</p>`,
      { label: 'Review the transfer', url: `${SITE}/profile#transfers` }),
      text: `${subject}\n${SITE}/profile#transfers`,
    }).catch(() => {});

    return reply.code(201).send({ ok: true, transfer: { id: tr.id, status: tr.status, expiresAt: tr.expiresAt } });
  });

  // ── Both sides of the exchange ──────────────────────────────────────────────
  app.get('/me/transfers', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const [incoming, outgoing] = await Promise.all([
      p.ownershipTransfer.findMany({ where: { toUserId: req.user.uid }, orderBy: { createdAt: 'desc' }, take: 50 }),
      p.ownershipTransfer.findMany({ where: { fromUserId: req.user.uid }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const ids = [...new Set([...incoming.map((x) => x.fromUserId), ...outgoing.map((x) => x.toUserId)])];
    const users = ids.length ? await p.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, avatar: true } }) : [];
    const byId = Object.fromEntries(users.map((u) => [u.id, u]));
    // Expiry is computed on read rather than swept: a request that has run out is over
    // whether or not a background job has noticed yet, and showing it as actionable for
    // ten more minutes would let somebody accept something that had already lapsed.
    const view = (t, side) => ({
      id: t.id, kind: t.kind, targetId: t.targetId, targetName: t.targetName,
      status: t.status === 'pending' && t.expiresAt < new Date() ? 'expired' : t.status,
      message: t.message, createdAt: t.createdAt, respondedAt: t.respondedAt, expiresAt: t.expiresAt,
      counterparty: byId[side === 'in' ? t.fromUserId : t.toUserId] || { displayName: '(deleted)' },
    });
    return { incoming: incoming.map((t) => view(t, 'in')), outgoing: outgoing.map((t) => view(t, 'out')) };
  });

  // ── Accept ──────────────────────────────────────────────────────────────────
  app.post('/me/transfers/:id/accept', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const tr = await p.ownershipTransfer.findUnique({ where: { id: String(req.params.id) } });
    if (!tr || tr.toUserId !== req.user.uid) return reply.code(404).send({ error: 'not_found' });
    if (tr.status !== 'pending') return reply.code(409).send({ error: 'not_pending' });
    if (tr.expiresAt < new Date()) return reply.code(409).send({ error: 'expired' });

    // Re-check at accept time. In the days since the offer the sender may have deleted it,
    // sold it, or transferred it elsewhere — accepting on the strength of the original
    // check would hand over something they no longer own.
    const target = await ownedTarget(p, tr.kind, tr.targetId, tr.fromUserId);
    if (!target) {
      await p.ownershipTransfer.update({ where: { id: tr.id }, data: { status: 'cancelled', respondedAt: new Date() } });
      return reply.code(409).send({ error: 'no_longer_owned' });
    }
    const blocker = await transferBlocker(p, tr.kind, target);
    if (blocker) return reply.code(409).send({ error: blocker });

    // Claim the request BEFORE moving anything: two accepts racing must not both move it.
    const claimed = await p.ownershipTransfer.updateMany({ where: { id: tr.id, status: 'pending' }, data: { status: 'accepted', respondedAt: new Date() } });
    if (!claimed.count) return reply.code(409).send({ error: 'not_pending' });

    if (tr.kind === 'repo') await p.serverRepo.update({ where: { id: tr.targetId }, data: { ownerId: req.user.uid } });
    else await p.catalogItem.update({ where: { id: tr.targetId }, data: { ownerId: req.user.uid } });

    await logAudit(p, req.user.uid, 'ownership.accepted', `${tr.kind} "${tr.targetName}" from ${tr.fromUserId}`, clientIp(req));
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true } });
    const from = await p.user.findUnique({ where: { id: tr.fromUserId }, select: { email: true } });
    await notify(p, tr.fromUserId, 'Transfer accepted', `${me?.displayName || 'They'} accepted "${tr.targetName}". It is no longer yours.`).catch(() => {});
    if (from?.email) {
      const subject = `"${tr.targetName}" has been transferred`;
      await sendMail({ to: from.email, subject, html: mailShell(subject, `<p><b>${escapeHtml(me?.displayName || 'The recipient')}</b> accepted the transfer of <b>${escapeHtml(tr.targetName)}</b>. It now belongs to them and no longer appears in your dashboard.</p>`), text: subject }).catch(() => {});
    }
    return { ok: true };
  });

  // ── Decline / cancel ────────────────────────────────────────────────────────
  // One handler: declining (recipient) and cancelling (sender) are the same state change
  // seen from two sides, and splitting them would mean two chances to forget a guard.
  app.post('/me/transfers/:id/decline', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const tr = await p.ownershipTransfer.findUnique({ where: { id: String(req.params.id) } });
    if (!tr) return reply.code(404).send({ error: 'not_found' });
    const isRecipient = tr.toUserId === req.user.uid;
    const isSender = tr.fromUserId === req.user.uid;
    if (!isRecipient && !isSender) return reply.code(404).send({ error: 'not_found' });
    if (tr.status !== 'pending') return reply.code(409).send({ error: 'not_pending' });
    const status = isRecipient ? 'declined' : 'cancelled';
    const claimed = await p.ownershipTransfer.updateMany({ where: { id: tr.id, status: 'pending' }, data: { status, respondedAt: new Date() } });
    if (!claimed.count) return reply.code(409).send({ error: 'not_pending' });
    // Only a decline is worth telling the other side about: the sender cancelling their
    // own offer is not news to the sender, and the recipient never asked for it.
    if (isRecipient) {
      await notify(p, tr.fromUserId, 'Transfer declined', `Your offer of "${tr.targetName}" was declined. It is still yours.`).catch(() => {});
    }
    return { ok: true, status };
  });
}
