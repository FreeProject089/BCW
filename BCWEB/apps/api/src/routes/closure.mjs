// Closing an account.
//
// Three rules shape this file.
//
// 1. Nothing happens today. A closure is scheduled a month out, and the cancel link works
//    for that whole month — the point of a grace period is that it survives regret, and
//    regret usually arrives after the anger that caused the click.
//
// 2. Closing is ANONYMISATION, not deletion. Twenty-nine tables reference a user, and the
//    ones that must legally outlive them (payments, the audit chain) are the ones a real
//    DELETE would take with it. The row stays and everything personal is scrubbed, so an
//    invoice still points at something without still pointing at somebody.
//
// 3. You cannot leave a mess behind — if you asked for this yourself. Anything still owned
//    blocks a SELF request, with the list of what and where, because the owner can go and
//    deal with it. A closure staff decided cannot be held hostage by the same list, or an
//    account would become unclosable by acquiring a repo; it tears the content down at the
//    end instead.
//
// 4. Pending is SUSPENDED, not deleted. For the whole grace period the account stops
//    serving — repos, catalogs and items are suspended — and nothing is destroyed until the
//    date arrives. Cancelling restores each one to the state it was IN, which is why that
//    state is written down when the closure is scheduled: a repo that was OFFLINE comes back
//    OFFLINE, not ONLINE. A grace period that deleted first would not be a grace period.
import { z } from 'zod';
import { issueSanction } from '../lib/sanctions.mjs';
import crypto from 'node:crypto';
import { db, requireRole, requireCap, logAudit, clientIp, clearSession, notify } from '../lib/lib.mjs';
import { sendMail, mailShell, escapeHtml } from '../lib/mail.mjs';
import { deleteObject } from '../lib/storage.mjs';

const GRACE_DAYS = 30;
// Mirrors misc.mjs, where the same ladder governs suspending and banning. Duplicated
// rather than exported across route modules: both copies are three words long, and a
// closure route importing a moderation route to borrow a constant is a worse coupling
// than the repetition.
const MOD_RANK = { USER: 0, MOD: 1, ADMIN: 2, SUPERADMIN: 3 };
/** SHA-256 of a normalised address — the only form of it a closed account keeps. */
export const emailHash = (email) => crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');
const SITE = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');
const money = (c, cur) => `${((c || 0) / 100).toFixed(2)} ${String(cur || 'usd').toUpperCase()}`;

/** Everything standing between this account and closure. Empty array = good to go. */
async function closureBlockers(p, userId) {
  const [subs, repos, items, pools] = await Promise.all([
    p.subscription.count({ where: { userId, status: 'active' } }),
    p.serverRepo.count({ where: { ownerId: userId } }),
    p.catalogItem.count({ where: { ownerId: userId } }),
    p.hostingGroup.count({ where: { ownerId: userId } }).catch(() => 0),
  ]);
  const out = [];
  // Ordered by what has to be dealt with FIRST: you cannot transfer a repo whose
  // subscription is still live, so telling someone about the repo before the subscription
  // sends them round a loop.
  if (subs) out.push({ kind: 'subscription', count: subs, where: '/dashboard#billing' });
  if (pools) out.push({ kind: 'pool', count: pools, where: '/dashboard#billing' });
  if (repos) out.push({ kind: 'repo', count: repos, where: '/repos' });
  if (items) out.push({ kind: 'item', count: items, where: '/dashboard#items' });
  return out;
}


/** End every subscription this account holds, at Stripe and here.
 *
 *  Shared by the closure teardown and by moderation, because they want the same thing for
 *  the same reason: an account that cannot use the service must stop being charged for it.
 *  Billing somebody you have locked out is the one failure mode nobody forgives.
 *
 *  Stripe failures are logged, not fatal: a subscription we could not reach is a billing
 *  problem to chase by hand, and it must not stop the rest of the sanction landing.
 */
export async function cancelSubscriptions(p, userId, log) {
  const subs = await p.subscription.findMany({ where: { userId }, select: { id: true, stripeSubId: true } }).catch(() => []);
  for (const sub of subs) {
    if (!sub.stripeSubId) continue;
    try {
      const { stripe } = await import('./hosting.mjs');
      const sk = await stripe();
      if (sk) await sk.subscriptions.cancel(sub.stripeSubId);
    } catch (e) { log?.warn?.(`could not cancel ${sub.stripeSubId}: ${String(e?.message || e)}`); }
  }
  return (await p.subscription.deleteMany({ where: { userId } }).catch(() => ({ count: 0 }))).count;
}

/** Suspend everything this account serves, remembering what each thing was.
 *
 *  A pending closure should stop the account SERVING without destroying anything: the grace
 *  month exists so a decision can be taken back, and it cannot be taken back if the content
 *  is already gone. So repos, catalogs and items are suspended, and their previous state is
 *  written down — because "restore" means putting each one back where it was, not setting
 *  them all to the same optimistic value. A repo that was OFFLINE returns to OFFLINE.
 *
 *  Returns the snapshot to store on the user. Anything already suspended is recorded as it
 *  is, so cancelling leaves it suspended rather than quietly publishing it.
 */
export async function suspendOwned(p, userId) {
  const [repos, catalogs, items] = await Promise.all([
    p.serverRepo.findMany({ where: { ownerId: userId }, select: { id: true, status: true } }).catch(() => []),
    p.communityCatalog.findMany({ where: { ownerId: userId }, select: { id: true, status: true, listed: true } }).catch(() => []),
    p.catalogItem.findMany({ where: { ownerId: userId }, select: { id: true, status: true } }).catch(() => []),
  ]);
  const state = {
    repos: Object.fromEntries(repos.map((r) => [r.id, r.status])),
    // `listed` travels with the status: suspending a catalog unlists it, and restoring the
    // status while leaving it unlisted would put it back in a state it was never in.
    catalogs: Object.fromEntries(catalogs.map((c) => [c.id, { status: c.status, listed: c.listed }])),
    items: Object.fromEntries(items.map((i) => [i.id, i.status])),
    at: new Date().toISOString(),
  };
  await Promise.all([
    p.serverRepo.updateMany({ where: { ownerId: userId }, data: { status: 'SUSPENDED' } }).catch(() => {}),
    p.communityCatalog.updateMany({ where: { ownerId: userId }, data: { status: 'SUSPENDED', listed: false } }).catch(() => {}),
    p.catalogItem.updateMany({ where: { ownerId: userId }, data: { status: 'SUSPENDED' } }).catch(() => {}),
  ]);
  return state;
}

/** Put everything back exactly as `suspendOwned` found it.
 *
 *  Row by row rather than one updateMany, because each row goes back to its OWN previous
 *  value. Anything not in the snapshot — created during the grace period — is left alone:
 *  we never suspended it, so we have no business changing it now.
 */
export async function restoreOwned(p, userId, state) {
  if (!state || typeof state !== 'object') return { repos: 0, catalogs: 0, items: 0 };
  const out = { repos: 0, catalogs: 0, items: 0 };
  for (const [id, status] of Object.entries(state.repos || {})) {
    // updateMany with the owner in the WHERE: a row that changed hands during the grace
    // period must not be rewritten from a stale snapshot.
    const r = await p.serverRepo.updateMany({ where: { id, ownerId: userId }, data: { status } }).catch(() => ({ count: 0 }));
    out.repos += r.count;
  }
  for (const [id, prev] of Object.entries(state.catalogs || {})) {
    const r = await p.communityCatalog.updateMany({ where: { id, ownerId: userId }, data: { status: prev.status, listed: prev.listed } }).catch(() => ({ count: 0 }));
    out.catalogs += r.count;
  }
  for (const [id, status] of Object.entries(state.items || {})) {
    const r = await p.catalogItem.updateMany({ where: { id, ownerId: userId }, data: { status } }).catch(() => ({ count: 0 }));
    out.items += r.count;
  }
  return out;
}

export default async function closureRoutes(app) {
  // What is in the way, and what the account is carrying. Read-only: a screen that offers
  // to close an account should be able to say why it cannot before anyone presses
  // anything.
  app.get('/me/closure', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const me = await p.user.findUnique({
      where: { id: req.user.uid },
      select: { closureRequestedAt: true, closureScheduledFor: true, email: true },
    });
    const [blockers, invoices] = await Promise.all([
      closureBlockers(p, req.user.uid),
      p.payment.count({ where: { userId: req.user.uid } }),
    ]);
    return {
      pending: !!me?.closureScheduledFor,
      requestedAt: me?.closureRequestedAt || null,
      scheduledFor: me?.closureScheduledFor || null,
      graceDays: GRACE_DAYS,
      blockers,
      invoiceCount: invoices,
      email: me?.email || '',
    };
  });

  // ── Request closure ─────────────────────────────────────────────────────────
  app.post('/me/closure', { preHandler: requireRole(), config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const p = await db();
    const me = await p.user.findUnique({ where: { id: req.user.uid } });
    if (!me) return reply.code(404).send({ error: 'not_found' });
    if (me.closureScheduledFor) return reply.code(409).send({ error: 'already_pending', scheduledFor: me.closureScheduledFor });

    const blockers = await closureBlockers(p, me.id);
    if (blockers.length) return reply.code(409).send({ error: 'has_blockers', blockers });

    const token = crypto.randomBytes(24).toString('base64url');
    const when = new Date(Date.now() + GRACE_DAYS * 864e5);
    // Suspended, not deleted: the grace month is only a grace month if what it protects is
    // still there at the end of it.
    const suspended = await suspendOwned(p, me.id);
    await p.user.update({ where: { id: me.id }, data: { closureRequestedAt: new Date(), closureScheduledFor: when, closureToken: token, closureSuspendState: suspended } });

    // Any offer they had out is withdrawn: an account on its way out should not be able to
    // hand somebody something a month from now.
    await p.ownershipTransfer.updateMany({ where: { fromUserId: me.id, status: 'pending' }, data: { status: 'cancelled', respondedAt: new Date() } }).catch(() => {});

    // Their invoices travel WITH the notice. After the account is gone they will have no
    // way to fetch them, and "download them before you go" is advice nobody reads in time.
    const payments = await p.payment.findMany({ where: { userId: me.id }, orderBy: { createdAt: 'desc' }, take: 200 });
    const invoiceRows = payments.length
      ? `<table role="presentation" style="border-collapse:collapse;width:100%;font-size:13px;margin:8px 0 16px">
           <thead><tr>
             <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #eae4da">Date</th>
             <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #eae4da">What</th>
             <th style="text-align:right;padding:6px 10px;border-bottom:2px solid #eae4da">Amount</th>
           </tr></thead><tbody>
           ${payments.map((x) => `<tr>
             <td style="padding:6px 10px;border-bottom:1px solid #f0ece4">${x.createdAt.toISOString().slice(0, 10)}</td>
             <td style="padding:6px 10px;border-bottom:1px solid #f0ece4">${escapeHtml(x.description || x.kind)}</td>
             <td style="padding:6px 10px;border-bottom:1px solid #f0ece4;text-align:right">${money(x.amountCents, x.currency)}</td>
           </tr>`).join('')}
           </tbody></table>`
      : '<p>You have no payments on record.</p>';

    const cancelUrl = `${SITE}/account/closure/cancel?token=${token}`;
    const day = when.toISOString().slice(0, 10);
    const subject = 'Your BetterCommunity account will close on ' + day;
    await sendMail({
      to: me.email,
      subject,
      html: mailShell('Your account is scheduled to close', `
        <p>We have scheduled <b>${escapeHtml(me.displayName || me.email)}</b> for closure on <b>${escapeHtml(day)}</b>.</p>
        <p><b>You have ${GRACE_DAYS} days to change your mind.</b> Until that date, nothing is
           deleted and the button below puts everything back exactly as it was — you do not
           even need to be signed in to use it.</p>
        <h2 style="font-size:16px;margin:22px 0 4px">Your payment history</h2>
        <p style="margin:0 0 6px">Keep this email: after the account closes we can no longer
           show these to you, though we keep our own copies for as long as the law requires.</p>
        ${invoiceRows}
        <h2 style="font-size:16px;margin:22px 0 4px">What closing does</h2>
        <p>Your name, email and profile are erased. Your payment records and moderation
           history are kept — they are legal records about transactions, not about your
           profile, and they stay whether or not you have an account.</p>`,
      { label: 'Keep my account', url: cancelUrl }),
      text: `Your account closes on ${day}. Changed your mind? ${cancelUrl}`,
    }).catch(() => {});

    await logAudit(p, me.id, 'account.closure_requested', `scheduled for ${day}`, clientIp(req));
    return { ok: true, scheduledFor: when, graceDays: GRACE_DAYS };
  });

  // ── Cancel ──────────────────────────────────────────────────────────────────
  // By TOKEN and without a session on purpose: the person stopping this may be reading the
  // email on a phone they have never signed in on, and a login wall in front of "stop
  // deleting my account" is the worst possible place for one. The token is single-purpose,
  // random, and only ever un-does something.
  //
  // Idempotent: opening the link twice, or after cancelling, says "your account is active"
  // rather than erroring. A link that works once and then looks broken is a link people
  // panic about.
  const cancelByToken = async (req, reply) => {
    const token = String(req.query?.token || req.body?.token || '');
    if (!token) return reply.code(400).send({ error: 'missing_token' });
    const p = await db();
    const u = await p.user.findUnique({ where: { closureToken: token }, select: { id: true, closureScheduledFor: true, closureCancellable: true, closureSuspendState: true } });
    // An unknown token is an error, and has to be — the common way to get one is an email
    // client that cut the link in half, and telling that reader "your account is safe" is
    // the single worst thing this endpoint could say. It would be true of nobody's account.
    if (!u) return reply.code(404).send({ error: 'invalid_token' });
    // Belt and braces: a final closure mints no token, so this should be unreachable —
    // but a token that outlived a change of mind must not become a way around the decision.
    if (u.closureCancellable === false) return reply.code(403).send({ error: 'not_cancellable' });
    // Already cancelled: the token is deliberately kept alive below, so this branch is
    // reachable and means what it says. Same link, third click, same reassuring answer.
    if (!u.closureScheduledFor) return { ok: true, alreadyActive: true };
    // Note the token is NOT cleared. That is what makes "cancelled" and "never existed"
    // distinguishable at all; it grants nothing once there is no closure to cancel, and
    // requesting a closure again mints a fresh one.
    await restoreOwned(p, u.id, u.closureSuspendState);
    await p.user.update({ where: { id: u.id }, data: { closureRequestedAt: null, closureScheduledFor: null, closureSuspendState: null } });
    await logAudit(p, u.id, 'account.closure_cancelled', 'via emailed link', clientIp(req));
    return { ok: true, cancelled: true, userId: u.id };
  };
  app.get('/account/closure/cancel', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, cancelByToken);
  app.post('/account/closure/cancel', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, cancelByToken);

  // The signed-in route, for someone who is simply on the site.
  app.post('/me/closure/cancel', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { closureScheduledFor: true, closureCancellable: true, closureSuspendState: true } });
    if (!me?.closureScheduledFor) return reply.code(409).send({ error: 'not_pending' });
    if (me.closureCancellable === false) return reply.code(403).send({ error: 'not_cancellable' });
    // Token kept here too, so a link cancelled from the site still answers honestly when the
    // same person later clicks the one in their inbox.
    await restoreOwned(p, req.user.uid, me.closureSuspendState);
    await p.user.update({ where: { id: req.user.uid }, data: { closureRequestedAt: null, closureScheduledFor: null, closureSuspendState: null } });
    await logAudit(p, req.user.uid, 'account.closure_cancelled', 'from the site', clientIp(req));
    return { ok: true };
  });


  // ── Staff-initiated closure ─────────────────────────────────────────────────
  //
  // Same machinery as a self-request — same grace, same sweeper, same blockers — because a
  // closure that behaved differently depending on who pressed the button would be a second
  // deletion path, and the second one is always the one with the bug.
  //
  // What differs is the email. Somebody who did not ask for this needs three things the
  // self-service notice does not carry: WHY, WHO decided, and a way to argue. The cancel
  // link is deliberately NOT in it — an account closed by staff is not one the account
  // holder can un-close with a click, or moderation would be a suggestion. They get the
  // contact page instead, and a human decides.
  app.post('/admin/users/:id/closure', { preHandler: requireCap('manage_users') }, async (req, reply) => {
    const b = z.object({
      reason: z.string().min(3).max(1000),
      days: z.number().int().min(0).max(365).optional(),
      // Default TRUE: the reversible closure is the one that cannot go badly wrong, so it
      // is what you get when nobody made a choice.
      cancellable: z.boolean().optional(),
    }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input', detail: 'A reason is required.' });

    const p = await db();
    const target = await p.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, email: true, displayName: true, role: true, closureScheduledFor: true, closedAt: true },
    });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    if (target.closedAt) return reply.code(409).send({ error: 'already_closed' });
    if (target.closureScheduledFor) return reply.code(409).send({ error: 'already_pending' });
    if (target.id === req.user.uid) return reply.code(400).send({ error: 'self', detail: 'Close your own account from your profile.' });
    // The same rank rule that governs suspending and banning, with the same error code —
    // an admin must not be able to delete the account of someone senior to them.
    if (MOD_RANK[req.user.role] <= MOD_RANK[target.role ?? 'USER']) return reply.code(403).send({ error: 'cannot_moderate_higher' });

    const days = b.data.days ?? GRACE_DAYS;
    const cancellable = b.data.cancellable !== false;
    const when = new Date(Date.now() + days * 86400_000);
    // No token when they cannot cancel: a link that exists and refuses is worse than none.
    const token = cancellable ? crypto.randomBytes(32).toString('hex') : null;
    // Reported, NOT enforced. A self-request is blocked by what the account still owns
    // because the owner can go and deal with it; a staff closure cannot be held hostage by
    // the same list, or an account would become unclosable by acquiring a repo. What it
    // owns is torn down at closure instead — see sweepAccountClosures.
    const blockers = await closureBlockers(p, target.id);

    const suspended = await suspendOwned(p, target.id);
    await p.user.update({
      where: { id: target.id },
      data: {
        closureRequestedAt: new Date(), closureScheduledFor: when, closureToken: token,
        closureReason: b.data.reason.trim(), closureBy: req.user.uid,
        closureCancellable: cancellable,
        closureSuspendState: suspended,
      },
    });
    await logAudit(p, req.user.uid, 'account.closure_staff', `${target.email} in ${days}d, ${cancellable ? 'cancellable' : 'FINAL'} — ${b.data.reason.trim().slice(0, 120)}`, clientIp(req));

    // The paperwork, created before the notice so the mail can quote its reference. A staff
    // closure is the one sanction the person cannot call off themselves — which is exactly
    // why it needs somewhere to be argued with. issueSanction also sends its own notice; the
    // closure-specific mail below stays because it carries the timetable and what happens to
    // the content, which a generic notice cannot.
    const sanction = await issueSanction(p, {
      userId: target.id, kind: 'closure', reason: b.data.reason.trim(),
      request: cancellable
        ? 'If this is wrong, contest it before the closing date and we can call it off.'
        : 'This closure cannot be called off from your side, but you can contest it and a person will read it.',
      issuedById: req.user.uid, expiresAt: when, log: req.log,
      meta: { cancellable, days },
    }).catch(() => null);

    const day = when.toISOString().slice(0, 10);
    const subject = 'Your BetterCommunity account is scheduled for closure';
    const html = mailShell(subject, `
      <p>Your account <b>${escapeHtml(target.email)}</b> has been scheduled for closure by our team.</p>
      <table style="margin:14px 0;font-size:15px">
        <tr><td style="padding:2px 14px 2px 0;color:#94a3b8">Reason</td><td><b>${escapeHtml(b.data.reason.trim())}</b></td></tr>
        <tr><td style="padding:2px 14px 2px 0;color:#94a3b8">Closes on</td><td><b>${escapeHtml(day)}</b></td></tr>
      </table>
      <p>Until that date nothing has been deleted. Your invoices and the records we are required to keep
         are retained either way; everything personal on the account is removed when it closes.</p>
      ${blockers.length ? `<p><b>What happens to what the account holds.</b> Your repositories, catalogs and items
         are <b>suspended now</b> — they stop being served, and nothing is deleted. On ${escapeHtml(day)} any active
         subscription is cancelled and all of it is deleted for good. Nothing is transferred to anyone else. If you
         want to keep any of it, move it to another account before that date${cancellable ? ', or ask us to call this off — everything comes back exactly as it was' : ''}.</p>` : ''}
      <p>${cancellable
        ? `If you want to keep the account, contest it before ${escapeHtml(day)} and we can stop it.`
        : `This closure is final and cannot be called off from your side — but you can still contest it, and a person reads every contest.`}</p>
      ${sanction ? `<p style="margin-top:12px"><b>Reference:</b> <code>${escapeHtml(sanction.code)}</code> — quote it in anything you send us.</p>` : ''}
      <p style="margin:22px 0"><a href="${escapeHtml(SITE)}${sanction ? `/sanctions/${escapeHtml(sanction.code)}` : '/contact'}"
         style="background:#6366f1;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:600">${sanction ? 'Read it and contest' : 'Contact us'}</a></p>`);
    let mailed = false;
    try { mailed = (await sendMail({ to: target.email, subject, html, text: `Your account closes on ${day}. Reason: ${b.data.reason.trim()}` })) !== false; }
    catch { /* the closure stands; the notice is best-effort and the in-app one still lands */ }
    await notify(p, target.id, 'account_closure', `Your account is scheduled to close on ${day}${sanction ? ` (${sanction.code})` : ''}. Reason: ${b.data.reason.trim()}`).catch(() => {});

    return { ok: true, scheduledFor: when, days, mailed, blockers, sanction: sanction?.code || null };
  });

  /** Call it off. Staff-side counterpart, and the only way back from a staff closure. */
  app.delete('/admin/users/:id/closure', { preHandler: requireCap('manage_users') }, async (req, reply) => {
    const p = await db();
    const target = await p.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, role: true, closureScheduledFor: true, closedAt: true, closureSuspendState: true } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    if (target.closedAt) return reply.code(409).send({ error: 'already_closed' });
    if (!target.closureScheduledFor) return reply.code(409).send({ error: 'not_pending' });
    if (MOD_RANK[req.user.role] <= MOD_RANK[target.role ?? 'USER']) return reply.code(403).send({ error: 'cannot_moderate_higher' });
    const restored = await restoreOwned(p, target.id, target.closureSuspendState);
    await p.user.update({
      where: { id: target.id },
      data: { closureRequestedAt: null, closureScheduledFor: null, closureReason: null, closureBy: null, closureSuspendState: null },
    });
    await p.sanction.updateMany({
      where: { userId: target.id, kind: 'closure', status: 'active' },
      data: { status: 'lifted', liftedAt: new Date(), liftedById: req.user.uid, liftReason: 'Closure called off by staff.' },
    }).catch(() => {});
    await logAudit(p, req.user.uid, 'account.closure_staff_cancelled', target.email, clientIp(req));
    await notify(p, target.id, 'Account closure called off', 'The closure scheduled for your account has been cancelled. Nothing was deleted, and everything is back the way it was.').catch(() => {});
    return { ok: true, restored };
  });

  // ── The survey ──────────────────────────────────────────────────────────────
  // Optional, always. Asked after the decision is already recorded so it can never be the
  // thing standing between someone and leaving — a form in that position stops being a
  // question and becomes an obstacle.
  app.post('/me/closure/survey', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      outcome: z.enum(['closed', 'cancelled']),
      reason: z.string().max(120).default(''),
      comment: z.string().max(2000).default(''),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    await p.accountClosureSurvey.create({ data: { userId: req.user.uid, outcome: b.data.outcome, reason: b.data.reason, comment: b.data.comment } });
    return { ok: true };
  });

  // Staff view of the answers.
  app.get('/admin/closure-surveys', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    const days = Math.min(365, Math.max(1, Number(req.query?.days) || 90));
    const since = new Date(Date.now() - days * 864e5);
    const rows = await p.accountClosureSurvey.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 500 });
    const byReason = {};
    for (const r of rows) { const k = `${r.outcome}:${r.reason || 'unspecified'}`; byReason[k] = (byReason[k] || 0) + 1; }
    return {
      total: rows.length,
      closed: rows.filter((r) => r.outcome === 'closed').length,
      cancelled: rows.filter((r) => r.outcome === 'cancelled').length,
      byReason,
      recent: rows.slice(0, 100).map((r) => ({ outcome: r.outcome, reason: r.reason, comment: r.comment, createdAt: r.createdAt })),
    };
  });
}

/// Close the accounts whose month is up.
///
/// Anonymisation in place, for the reason at the top of this file. Exported for the
/// sweeper, and written so running it twice is harmless: `closedAt` is the guard, and the
/// scrubbed values do not depend on the ones being replaced.
/** Cancel and delete everything a staff-closed account still holds.
 *
 *  Only ever called for a closure STAFF scheduled. Ordered so nothing is left paying for
 *  something that no longer exists: subscriptions first, then the content, then the pools
 *  the content drew from.
 *
 *  Stripe is cancelled best-effort and its failure does not stop the rest — a subscription
 *  we could not reach is a billing problem to chase, not a reason to leave the account and
 *  its content standing after the date the person was given.
 */
async function tearDownOwned(p, userId, log) {
  const out = { subscriptions: 0, repos: 0, catalogs: 0, items: 0, pools: 0 };

  out.subscriptions = await cancelSubscriptions(p, userId, log);

  // Hosted bytes go with the rows. Object storage is not covered by any database cascade,
  // so it is deleted explicitly or it stays on disk paying for nobody.
  const repos = await p.serverRepo.findMany({ where: { ownerId: userId }, select: { id: true, files: { select: { key: true } } } }).catch(() => []);
  for (const r of repos) {
    for (const f of r.files) { try { await deleteObject(f.key); } catch { /* already gone */ } }
  }
  out.repos = (await p.serverRepo.deleteMany({ where: { ownerId: userId } }).catch(() => ({ count: 0 }))).count;

  const cats = await p.communityCatalog.findMany({ where: { ownerId: userId }, select: { id: true, items: { select: { payloadKey: true } } } }).catch(() => []);
  for (const c of cats) {
    for (const it of c.items) { if (it.payloadKey) { try { await deleteObject(it.payloadKey); } catch { /* already gone */ } } }
  }
  out.catalogs = (await p.communityCatalog.deleteMany({ where: { ownerId: userId } }).catch(() => ({ count: 0 }))).count;

  const items = await p.catalogItem.findMany({ where: { ownerId: userId }, select: { id: true, payloadKey: true } }).catch(() => []);
  for (const it of items) { if (it.payloadKey) { try { await deleteObject(it.payloadKey); } catch { /* already gone */ } } }
  out.items = (await p.catalogItem.deleteMany({ where: { ownerId: userId } }).catch(() => ({ count: 0 }))).count;

  // Last: a pool only means something while something draws from it.
  out.pools = (await p.hostingGroup.deleteMany({ where: { ownerId: userId } }).catch(() => ({ count: 0 }))).count;
  return out;
}

/**
 * End an account as an IDENTITY: the address, the name, and every way back in.
 *
 * Exported because two paths need it and only one had it. A closure reaching its date came
 * through here; an admin pressing "erase" did not — `eraseUser` walks the relations and
 * skips the User model itself by design, so an account could be told it was erased
 * permanently while its email, display name and role sat untouched in the table. The words
 * on the button were true of the person's data and false of the person's account.
 *
 * Not a deletion, and cannot be: AuditLogEntry keeps `actorId` inside its HMAC chain and the
 * column is required, so the row is undeletable for any account that has ever acted. What is
 * removable is everything that identifies them and everything that authenticates them, which
 * is what this does.
 *
 * Safe to run twice — `closedAt` is the guard the sweeper filters on, and every write here is
 * idempotent.
 */
export async function anonymiseAccount(p, user) {
  await p.user.update({
    where: { id: user.id },
    data: {
      // The hash goes in as the address goes out, in the same write. Recorded here and
      // not at request time so that a cancelled closure leaves nothing behind.
      closedEmailHash: emailHash(user.email),
      email: `closed+${user.id}@account.invalid`,
      displayName: 'Closed account',
      passwordHash: null,
      bio: '', website: null, avatar: null,
      totpSecret: null, totpEnabled: false, totpRecoveryCodes: [],
      emailVerified: false, profilePublic: false,
      stripeCustomerId: null,
      closureToken: null, closedAt: new Date(),
    },
  });
  // Everything that could still let somebody in, or let something in on their behalf.
  await Promise.all([
    p.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {}),
    p.oAuthRefreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {}),
    p.oAuthConsent.deleteMany({ where: { userId: user.id } }).catch(() => {}),
    p.apiKey.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {}),
    p.oAuthPairwiseSub.deleteMany({ where: { userId: user.id } }).catch(() => {}),
    p.creatorLink.deleteMany({ where: { userId: user.id } }).catch(() => {}),
    p.discordLink.deleteMany({ where: { userId: user.id } }).catch(() => {}),
    p.socialConnection.deleteMany({ where: { userId: user.id } }).catch(() => {}),
    p.oAuthAccount.deleteMany({ where: { userId: user.id } }).catch(() => {}),
  ]);
}

export async function sweepAccountClosures(p, log) {
  const due = await p.user.findMany({
    where: { closureScheduledFor: { lte: new Date() }, closedAt: null },
    select: { id: true, email: true, closureBy: true },
  });
  let n = 0;
  for (const u of due) {
    // A blocker acquired since the request — they bought hosting during the grace month —
    // stops the closure rather than orphaning it. Silently deleting the owner of a live
    // subscription is how a paid repo ends up with nobody able to cancel it.
    const blockers = await closureBlockers(p, u.id);
    if (blockers.length) {
      if (!u.closureBy) {
        // A closure THEY asked for: held rather than forced. They were told what was in the
        // way and can still deal with it; silently deleting the owner of a live subscription
        // is how a paid repo ends up with nobody able to cancel it.
        log?.warn?.(`[sweeper] closure of ${u.id} held: ${blockers.map((b) => `${b.count} ${b.kind}`).join(', ')}`);
        continue;
      }
      // A closure STAFF decided cannot be blocked by what the account owns, or an account
      // would become unclosable by acquiring a repo. Everything goes, and nothing is
      // transferred — the email said so on the day it was scheduled.
      const torn = await tearDownOwned(p, u.id, log);
      log?.info?.({ ...torn }, `[sweeper] staff closure of ${u.id}: tore down what it owned`);
    }
    await anonymiseAccount(p, u);
    log?.info?.(`[sweeper] account ${u.id} closed and anonymised`);
    n++;
  }
  return n;
}
