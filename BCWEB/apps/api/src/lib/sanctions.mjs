// Moderation decisions, written down.
//
// The account columns on User (status / moderationUntil / moderationReason) stay exactly where
// they are: they are the fast path every request reads, and moving them here would put a join
// in front of every authenticated call. What lives here is the PAPERWORK — one row per
// decision, with a code you can quote, a reason, an optional request, and somewhere to file a
// contest. Before it there was only ever one sanction per account, nothing could be said about
// a repo or a catalog item, and a person told "your account was suspended" had no number to
// put in a reply.
//
// Nothing in this module enforces anything. Enforcement is still suspendOwned/accountLock in
// their own modules; a Sanction is the record of why they were called.
import crypto from 'node:crypto';
import { notify } from './lib.mjs';
import { sendMail, mailShell, emailEnabled } from './mail.mjs';

const SITE_URL = process.env.SITE_URL || 'http://localhost:5176';

// Ambiguous characters are left out (no O/0, I/1): the code is read off a screen and typed
// into a contest form by somebody who is already annoyed.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function block(n = 4) {
  const b = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[b[i] % ALPHABET.length];
  return out;
}

/** SNC-XXXX-XXXX, retried against the unique index rather than trusted to be unique. */
export async function newSanctionCode(p) {
  for (let i = 0; i < 8; i++) {
    const code = `SNC-${block()}-${block()}`;
    if (!(await p.sanction.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  // Astronomically unlikely; a timestamp suffix is still better than throwing away a decision
  // somebody has already made.
  return `SNC-${block()}-${Date.now().toString(36).toUpperCase().slice(-4)}`;
}

export const KINDS = ['warning', 'suspension', 'ban', 'closure', 'takedown'];
export const TARGET_TYPES = ['repo', 'catalog', 'item'];

const KIND_LABEL = {
  warning: 'Warning', suspension: 'Account suspended', ban: 'Account banned',
  closure: 'Account closure', takedown: 'Content taken down',
};

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The one place a sanction is created, notified and e-mailed.
 *
 *  Every caller goes through here so that no decision can exist without a code, and so the
 *  e-mail can never drift from the record: the mail is rendered FROM the row that was just
 *  written, not from the arguments.
 */
export async function issueSanction(p, {
  userId, kind, scope = 'account', reason, request = null, requiresAction = false,
  targetType = null, targetId = null, targetName = null, relatedIds = [],
  issuedById = null, expiresAt = null, meta = null, log = null,
}) {
  const code = await newSanctionCode(p);
  const s = await p.sanction.create({
    data: {
      code, kind, scope, userId, reason: String(reason || '').trim() || 'No reason given.',
      request, requiresAction: !!requiresAction || !!request,
      targetType, targetId, targetName, relatedIds,
      issuedById, expiresAt, meta,
    },
  });
  await mailSanction(p, s).catch((e) => log?.warn?.(`sanction mail failed: ${String(e?.message || e)}`));
  return s;
}

/** The notice itself. Split out because a re-send has to produce the identical text. */
export async function mailSanction(p, s) {
  const u = await p.user.findUnique({ where: { id: s.userId }, select: { email: true, displayName: true } });
  if (!u) return false;
  const what = s.targetName
    ? `${KIND_LABEL[s.kind] || s.kind} — ${s.targetName}`
    : (KIND_LABEL[s.kind] || s.kind);
  const until = s.expiresAt
    ? `<p style="margin-top:12px">It ends on <b>${s.expiresAt.toUTCString()}</b>.</p>`
    : (s.kind === 'warning' ? '' : '<p style="margin-top:12px">No end date has been set.</p>');
  const body = `
    <p>Hi ${escapeHtml(u.displayName || '')},</p>
    <p>${escapeHtml(what)}.</p>
    <p style="margin-top:12px"><b>Reference:</b> <code>${s.code}</code><br>
       <b>Reason:</b> ${escapeHtml(s.reason)}</p>
    ${s.request ? `<p style="margin-top:12px"><b>What we are asking you to do:</b><br>${escapeHtml(s.request)}</p>` : ''}
    ${until}
    <p style="margin-top:16px">If you think this is wrong, you can contest it — quote the reference above.</p>`;
  const text = `${what}. Reference: ${s.code}. Reason: ${s.reason}${s.request ? ` Asked of you: ${s.request}` : ''}${s.expiresAt ? ` Ends: ${s.expiresAt.toISOString()}` : ''} Contest: ${SITE_URL}/sanctions/${s.code}`;
  await notify(p, s.userId, 'account_sanction', `${what} — reference ${s.code}. ${s.reason}`).catch(() => {});
  if (!emailEnabled()) return false;
  await sendMail({
    to: u.email, subject: `[${s.code}] ${what}`,
    html: mailShell(what, body, { url: `${SITE_URL}/sanctions/${s.code}`, label: 'Read it and contest' }),
    text,
  });
  return true;
}

/** Which subscriptions a suspension should end, and which it must leave alone.
 *
 *  The rule the owner asked for, and it is the fair one: a term that would run out DURING the
 *  suspension is being paid for a service nobody can use, so it is cancelled. A term that
 *  outlives the suspension is not — the person comes back to what they already paid for, and
 *  we have not taken a decision on their behalf that they would have to undo.
 *
 *  A permanent sanction (no end date) cancels everything: there is no coming back to it.
 */
export function splitSubscriptionsByTerm(subs, until) {
  if (!until) return { cancel: subs, keep: [] };
  const cancel = [], keep = [];
  for (const s of subs) {
    // No end date on the row means we cannot say it survives, and billing somebody who is
    // locked out is the one failure nobody forgives — so it goes in the cancel pile.
    const ends = s.currentPeriodEnd ? new Date(s.currentPeriodEnd) : null;
    (!ends || ends <= until ? cancel : keep).push(s);
  }
  return { cancel, keep };
}

/** Cancel exactly the listed subscriptions and return what was cancelled, in enough detail
 *  for the "take it out again" offer to name them months later. */
export async function cancelSubscriptionList(p, subs, log) {
  const done = [];
  for (const sub of subs) {
    if (sub.stripeSubId) {
      try {
        const { stripe } = await import('../routes/hosting.mjs');
        const sk = await stripe();
        if (sk) await sk.subscriptions.cancel(sub.stripeSubId);
      } catch (e) { log?.warn?.(`could not cancel ${sub.stripeSubId}: ${String(e?.message || e)}`); }
    }
    done.push({
      id: sub.id,
      planId: sub.planId || null,
      planName: sub.plan?.name || null,
      priceCents: sub.plan?.priceMonthlyCents ?? null,
      hostingGroupId: sub.hostingGroupId || null,
      serverRepoId: sub.serverRepoId || null,
      endedAt: new Date().toISOString(),
    });
  }
  if (done.length) await p.subscription.deleteMany({ where: { id: { in: done.map((d) => d.id) } } }).catch(() => {});
  return done;
}

/** Public shape. Never leaks who issued it — a moderator's name is not owed to the person
 *  they moderated, and naming them is how moderation turns into harassment. */
export const serSanctionForUser = (s) => ({
  code: s.code, kind: s.kind, scope: s.scope, reason: s.reason, request: s.request,
  requiresAction: s.requiresAction, targetType: s.targetType, targetName: s.targetName,
  issuedAt: s.issuedAt, expiresAt: s.expiresAt, status: s.status,
  liftedAt: s.liftedAt, liftReason: s.liftReason,
  contestedAt: s.contestedAt, contestBody: s.contestBody,
  contestOutcome: s.contestOutcome, contestAnswer: s.contestAnswer, contestAnsweredAt: s.contestAnsweredAt,
  // The offers to re-take a cancelled subscription travel with the sanction that cancelled it.
  cancelledSubs: Array.isArray(s.meta?.cancelledSubs) ? s.meta.cancelledSubs : [],
  keptSubs: Array.isArray(s.meta?.keptSubs) ? s.meta.keptSubs : [],
});
