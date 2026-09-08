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
import { db, requireRole, requireCap, notify, logAudit, clientIp, poolFreeBytes } from '../lib/lib.mjs';
import { sendMail, mailShell, escapeHtml } from '../lib/mail.mjs';

/** Send, and if it fails say so in the log instead of nowhere.
 *
 *  Still swallows — a transfer must not fail because a mail host is unreachable — but a
 *  swallowed error with no record is why "it never sends an e-mail" and "it sent one and
 *  the address bounced" were the same observation. `to` is an address, not a secret, and
 *  nothing else about the mail is logged. */
async function mail(app, what, opts) {
  try {
    const sent = await sendMail(opts);
    if (!sent) app.log.info({ what, to: opts.to }, 'transfer mail skipped: e-mail is disabled');
  } catch (e) {
    app.log.warn({ what, to: opts.to, err: e?.message }, 'transfer mail failed');
  }
}

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
 *  Billing is the one that matters, and there are two kinds of it.
 *
 *  A **solo hosted repo** is paid for by a subscription anchored to the repo itself. Move
 *  it and the old owner keeps being charged for something they no longer have, with
 *  neither side able to fix it from their own dashboard. That still refuses.
 *
 *  A repo **in a pool** is different: the pool is the thing that was bought, and the repo
 *  is a slice of it. Accepting moves the slice into one of the RECIPIENT's pools (see
 *  `movePlan`), so the sender's pool simply has room again afterwards and nobody is billed
 *  for anybody else's content. That is also what stops the failure this design exists to
 *  prevent: leave the repo in the sender's pool and the day they stop paying, the sweeper
 *  suspends a repo that belongs to somebody else. */
async function transferBlocker(p, kind, target) {
  if (kind !== 'repo') return null;
  const repo = await p.serverRepo.findUnique({ where: { id: target.id }, select: { hosted: true, groupId: true, freePlan: true } });
  // A free-plan repo is not transferable, and cannot be: the free tier is one per ACCOUNT
  // (FreeTierClaim), so handing one over either gives the recipient a second free repo or
  // silently spends a free claim they never made. Both are wrong, and the second is the
  // kind of wrong nobody notices until they try to claim the tier they still thought they
  // had. Deleting it and letting them claim their own is the honest path.
  if (repo?.freePlan) return 'free_plan';
  if (!repo?.hosted) return null;
  if (repo.groupId) return null;                       // a pool slice — it can move, see movePlan
  const sub = await p.subscription.findFirst({
    where: { status: 'active', serverRepoId: target.id },
    select: { id: true },
  });
  return sub ? 'active_subscription' : null;
}

/**
 * Where the recipient would put this, and whether it fits.
 *
 * Storage does not follow the object and it does not stay behind either: the object moves
 * INTO a pool the recipient already owns. Anything else leaves one of them paying for the
 * other's content — and if the slice stayed in the sender's pool, the sender cancelling
 * their subscription would suspend a repo that is no longer theirs.
 *
 * Deliberately NOT allowed to create a free pool on the recipient's behalf: the free tier
 * is one claim per account (FreeTierClaim), and spending somebody's claim for them, inside
 * a flow they think is "accept a gift", is exactly the silent wrong this file already
 * refuses to do for `free_plan` repos.
 *
 * Returns { need, pools, chosen, ok }. `need` is the reserved QUOTA, not the bytes on disk:
 * the quota is what the pool has given away, and admitting a repo on its current usage
 * would let it grow past a ceiling the pool never agreed to.
 */
async function movePlan(p, kind, targetId, toUserId, preferredPoolId = null) {
  if (kind !== 'repo') return { need: 0n, pools: [], chosen: null, ok: true };
  const repo = await p.serverRepo.findUnique({ where: { id: targetId }, select: { storageQuotaBytes: true, groupId: true, hosted: true } });
  const need = repo?.hosted ? (repo.storageQuotaBytes || 0n) : 0n;
  if (!need) return { need: 0n, pools: [], chosen: null, ok: true };

  const groups = await p.hostingGroup.findMany({ where: { ownerId: toUserId }, select: { id: true, name: true, poolBytes: true, freePlan: true } });
  const pools = [];
  for (const g of groups) {
    const free = await poolFreeBytes(p, g);
    pools.push({ id: g.id, name: g.name, freePlan: g.freePlan, freeBytes: free, fits: free >= need });
  }
  return { need, ...choosePool(need, pools, preferredPoolId) };
}

/**
 * Which pool takes it, and if none, why not.
 *
 * Split out from the counting above and exported because this is the part with rules in
 * it, and rules are worth testing without a database in the way. The counting is a SUM;
 * this is the decision.
 *
 *   · A pool the caller NAMED is used, or refused by name — never silently swapped for
 *     another one. Somebody who picked a pool has a reason, and quietly using a different
 *     one moves their content somewhere they did not choose.
 *   · With no preference, the roomiest that fits. Accepting a gift should not require
 *     first understanding your own pool layout.
 *   · "You have no pools" and "none of your pools is big enough" are different problems
 *     with different fixes, so they are different reasons.
 */
export function choosePool(need, pools, preferredPoolId = null) {
  const preferred = preferredPoolId ? pools.find((x) => x.id === preferredPoolId) : null;
  if (preferredPoolId && !preferred) return { pools, chosen: null, ok: false, reason: 'no_such_pool' };
  if (preferred && !preferred.fits) return { pools, chosen: null, ok: false, reason: 'pool_too_small' };
  const chosen = preferred
    || pools.filter((x) => x.fits).sort((a, b) => (b.freeBytes > a.freeBytes ? 1 : -1))[0]
    || null;
  return { pools, chosen, ok: !!chosen, reason: chosen ? null : (pools.length ? 'insufficient_pool_space' : 'no_pool') };
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
    // The body used to say "accept or decline it in your profile", which is prose pointing at
    // a page — the reader still had to go and find it. It carries the destination now.
    await notify(p, to.id, 'Ownership transfer offered',
      `${from?.displayName || 'Someone'} offered you the ${what} "${tr.targetName}".`,
      { href: '/dashboard#transfers' }).catch(() => {});
    await mail(app, 'transfer-offer', {
      to: to.email,
      mailId: 'transfer-offer',
      subject,
      html: mailShell(subject, `
        <p><b>${escapeHtml(from?.displayName || 'Someone')}</b> would like to transfer the ${what}
           <b>${escapeHtml(tr.targetName)}</b> to your account.</p>
        ${b.data.message ? `<p style="padding:10px 14px;border-left:3px solid #f97316;color:#6f685d">${escapeHtml(b.data.message)}</p>` : ''}
        <p>Nothing has changed yet — it becomes yours only if you accept. If you do, you take on
           its content and any storage it uses.</p>
        <p>This offer expires in ${TTL_DAYS} days.</p>`,
      { label: 'Review the transfer', url: `${SITE}/dashboard#transfers` }),
      text: `${subject}\n${SITE}/dashboard#transfers`,
    });

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
      message: t.message, reason: t.reason || '', createdAt: t.createdAt, respondedAt: t.respondedAt, expiresAt: t.expiresAt,
      counterparty: byId[side === 'in' ? t.fromUserId : t.toUserId] || { displayName: '(deleted)' },
    });
    // What accepting would cost, per incoming offer, so the answer is on the screen with
    // the button rather than behind it. A 409 explaining the pool is full AFTER somebody
    // pressed Accept is a refusal; the same sentence before they press it is information.
    const inbound = incoming.map((t) => view(t, 'in'));
    for (const t of inbound) {
      if (t.status !== 'pending' || t.kind !== 'repo') continue;
      const plan = await movePlan(p, t.kind, t.targetId, req.user.uid).catch(() => null);
      if (!plan) continue;
      t.storage = {
        needBytes: String(plan.need),
        fits: plan.ok,
        reason: plan.reason || null,
        pools: plan.pools.map((x) => ({ id: x.id, name: x.name, freeBytes: String(x.freeBytes), fits: x.fits })),
        chosenPoolId: plan.chosen?.id || null,
      };
    }
    return { incoming: inbound, outgoing: outgoing.map((t) => view(t, 'out')) };
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

    // Where it lands, and whether there is room — checked HERE and not when the offer was
    // sent. Two offers accepted an hour apart against the same pool would both have passed
    // a check made at send time, and the pool would be over its ceiling with no way to tell
    // which acceptance did it.
    const wanted = z.object({ poolId: z.string().max(64).nullish() }).safeParse(req.body || {});
    const plan = await movePlan(p, tr.kind, tr.targetId, req.user.uid, wanted.success ? (wanted.data.poolId || null) : null);
    if (!plan.ok) {
      return reply.code(409).send({
        error: plan.reason || 'insufficient_pool_space',
        needBytes: String(plan.need),
        pools: plan.pools.map((x) => ({ id: x.id, name: x.name, freeBytes: String(x.freeBytes), fits: x.fits })),
      });
    }

    // Claim the request BEFORE moving anything: two accepts racing must not both move it.
    const claimed = await p.ownershipTransfer.updateMany({ where: { id: tr.id, status: 'pending' }, data: { status: 'accepted', respondedAt: new Date() } });
    if (!claimed.count) return reply.code(409).send({ error: 'not_pending' });

    if (tr.kind === 'repo') {
      // Owner and pool in ONE write. Splitting them leaves a window where the repo belongs
      // to the recipient and still draws on the sender's pool — which is the exact state
      // the sweeper turns into "somebody else's repo suspended because I stopped paying".
      await p.serverRepo.update({
        where: { id: tr.targetId },
        data: { ownerId: req.user.uid, ...(plan.chosen ? { groupId: plan.chosen.id } : {}) },
      });
    } else {
      await p.catalogItem.update({ where: { id: tr.targetId }, data: { ownerId: req.user.uid } });
    }

    await logAudit(p, req.user.uid, 'ownership.accepted',
      `${tr.kind} "${tr.targetName}" from ${tr.fromUserId}${plan.chosen ? ` → pool ${plan.chosen.name}` : ''}`, clientIp(req));
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true } });
    const from = await p.user.findUnique({ where: { id: tr.fromUserId }, select: { email: true } });
    await notify(p, tr.fromUserId, 'Transfer accepted', `${me?.displayName || 'They'} accepted "${tr.targetName}". It is no longer yours.`).catch(() => {});
    if (from?.email) {
      const subject = `"${tr.targetName}" has been transferred`;
      await mail(app, 'transfer-accepted', { to: from.email, mailId: 'transfer-accepted', subject, html: mailShell(subject, `<p><b>${escapeHtml(me?.displayName || 'The recipient')}</b> accepted the transfer of <b>${escapeHtml(tr.targetName)}</b>. It now belongs to them and no longer appears in your dashboard.</p>`), text: subject });
    }
    return { ok: true };
  });

  // ── Staff: who handed what to whom ─────────────────────────────────────
  //
  // Every ownership question staff get asked is a history question — "who owned this when
  // it was reported", "why is this repo in that person's pool", "did anyone actually agree
  // to this". The rows have always held the answer; nothing read them back.
  //
  // Read-only, deliberately. Staff moving content between accounts by hand is a different
  // and much heavier power than watching it move, and the whole design of this file is
  // that nothing changes hands without the recipient saying yes.
  app.get('/admin/transfers', { preHandler: requireCap('manage_repos', 'MOD') }, async (req) => {
    const p = await db();
    const q = z.object({
      status: z.enum(['all', 'pending', 'accepted', 'declined', 'cancelled']).default('all'),
      kind: z.enum(['all', 'repo', 'catalog']).default('all'),
      // Matches the object's name or either party's e-mail — the three things somebody
      // arrives with. A support message never opens with a cuid.
      search: z.string().max(120).default(''),
      take: z.coerce.number().int().min(1).max(200).default(100),
    }).safeParse(req.query || {});
    const f = q.success ? q.data : { status: 'all', kind: 'all', search: '', take: 100 };

    const search = f.search.trim();
    // The search has to reach USERS, and the transfer table only holds their ids.
    const matchedUsers = search
      ? await p.user.findMany({ where: { email: { contains: search, mode: 'insensitive' } }, select: { id: true }, take: 50 })
      : [];
    const uids = matchedUsers.map((u) => u.id);

    const where = {
      ...(f.status === 'all' ? {} : { status: f.status }),
      ...(f.kind === 'all' ? {} : { kind: f.kind }),
      ...(search ? { OR: [
        { targetName: { contains: search, mode: 'insensitive' } },
        { targetId: search },
        ...(uids.length ? [{ fromUserId: { in: uids } }, { toUserId: { in: uids } }] : []),
      ] } : {}),
    };

    const rows = await p.ownershipTransfer.findMany({ where, orderBy: { createdAt: 'desc' }, take: f.take });
    const ids = [...new Set(rows.flatMap((r) => [r.fromUserId, r.toUserId]))];
    const users = ids.length
      ? await p.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, email: true } })
      : [];
    const byId = Object.fromEntries(users.map((u) => [u.id, u]));
    const gone = { displayName: '(deleted)', email: '' };

    // Whether the object still exists, and who holds it NOW. An accepted transfer from
    // last year is only half an answer: the question is usually "and where is it today",
    // and the row cannot know — it may have moved twice more since.
    const repoIds = rows.filter((r) => r.kind === 'repo').map((r) => r.targetId);
    const itemIds = rows.filter((r) => r.kind === 'catalog').map((r) => r.targetId);
    const [repos, items] = await Promise.all([
      repoIds.length ? p.serverRepo.findMany({ where: { id: { in: repoIds } }, select: { id: true, ownerId: true, name: true, groupId: true } }) : [],
      itemIds.length ? p.catalogItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, ownerId: true, name: true } }) : [],
    ]);
    const nowOwner = Object.fromEntries([...repos, ...items].map((x) => [x.id, x]));

    const counts = await p.ownershipTransfer.groupBy({ by: ['status'], _count: { _all: true } }).catch(() => []);
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      transfers: rows.map((r) => {
        const live = nowOwner[r.targetId];
        return {
          id: r.id, kind: r.kind, targetId: r.targetId, targetName: r.targetName,
          status: r.status === 'pending' && r.expiresAt < new Date() ? 'expired' : r.status,
          message: r.message, reason: r.reason || '',
          createdAt: r.createdAt, respondedAt: r.respondedAt, expiresAt: r.expiresAt,
          from: byId[r.fromUserId] || gone,
          to: byId[r.toUserId] || gone,
          // null when the object is gone — which is itself the answer to "where is it now".
          current: live ? { exists: true, name: live.name, ownerId: live.ownerId, isRecipient: live.ownerId === r.toUserId } : { exists: false },
        };
      }),
    };
  });

  // ── Decline / cancel ────────────────────────────────────────────────────────
  // One handler: declining (recipient) and cancelling (sender) are the same state change
  // seen from two sides, and splitting them would mean two chances to forget a guard.
  app.post('/me/transfers/:id/decline', { preHandler: requireRole() }, async (req, reply) => {
    // The reason is optional and is only kept on a decline. A body this route cannot parse
    // must not be what stops somebody saying no, so it degrades to no reason rather than a
    // 400 — the refusal is the part that matters.
    const parsed = z.object({ reason: z.string().max(300).default('') }).safeParse(req.body || {});
    const reason = parsed.success ? parsed.data.reason.trim() : '';
    const p = await db();
    const tr = await p.ownershipTransfer.findUnique({ where: { id: String(req.params.id) } });
    if (!tr) return reply.code(404).send({ error: 'not_found' });
    const isRecipient = tr.toUserId === req.user.uid;
    const isSender = tr.fromUserId === req.user.uid;
    if (!isRecipient && !isSender) return reply.code(404).send({ error: 'not_found' });
    if (tr.status !== 'pending') return reply.code(409).send({ error: 'not_pending' });
    const status = isRecipient ? 'declined' : 'cancelled';
    const claimed = await p.ownershipTransfer.updateMany({
      where: { id: tr.id, status: 'pending' },
      data: { status, respondedAt: new Date(), ...(isRecipient && reason ? { reason } : {}) },
    });
    if (!claimed.count) return reply.code(409).send({ error: 'not_pending' });
    // Only a decline is worth telling the other side about: the sender cancelling their
    // own offer is not news to the sender, and the recipient never asked for it.
    //
    // It goes out by MAIL as well as in-app now. The offer arrived in the sender's inbox;
    // the answer to it arriving only as a bell they must be logged in to see meant the
    // usual outcome of a decline was the sender waiting fourteen days for an expiry.
    if (isRecipient) {
      const who = await p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true } });
      const name = who?.displayName || 'They';
      await notify(p, tr.fromUserId, 'Transfer declined',
        `${name} declined "${tr.targetName}". It is still yours.${reason ? ` \u2014 \u201c${reason}\u201d` : ''}`,
        { href: '/dashboard#transfers' }).catch(() => {});
      const from = await p.user.findUnique({ where: { id: tr.fromUserId }, select: { email: true } });
      if (from?.email) {
        const subject = `Your transfer of "${tr.targetName}" was declined`;
        await mail(app, 'transfer-declined', {
          to: from.email,
          mailId: 'transfer-declined',
          subject,
          html: mailShell(subject, `
            <p><b>${escapeHtml(name)}</b> declined the transfer of <b>${escapeHtml(tr.targetName)}</b>.
               Nothing moved \u2014 it is still yours, and still in your dashboard.</p>
            ${reason ? `<p style="padding:10px 14px;border-left:3px solid #f97316;color:#6f685d">${escapeHtml(reason)}</p>` : ''}
            <p>You can offer it to somebody else whenever you like.</p>`,
            { label: 'Open your dashboard', url: `${SITE}/dashboard#transfers` }),
          text: `${subject}${reason ? `\n${reason}` : ''}\n${SITE}/dashboard#transfers`,
        });
      }
    }
    return { ok: true, status };
  });
}
