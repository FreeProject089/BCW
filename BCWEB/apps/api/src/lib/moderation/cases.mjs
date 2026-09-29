// The review queue: what a moderator can do to a case, and what that does to the content.
//
// A case points at its content through `subjectType` + `subjectId`. Each subject type has an
// ADAPTER that knows the one or two things the queue can do to that content, using the
// mechanism the content already had: a thread message has `hidden`, a feedback row has its
// statuses, a project review has `rejected`, a held contact message lives in the case's own
// payload until it is released into the inbox. Nothing here invents a second way of hiding
// something the site already knew how to hide.
//
// Actions:
//   approve         the content is fine: release it if it was held, close the case
//   release         the same, named for a quarantine (kept separate for the audit trail)
//   remove          the content goes: taken out of its audience, case closed
//   sanction        a warning on the author's record (lib/sanctions.mjs), optionally with remove
//   false_positive  approve, and teach the rules: the text hash joins the false-positive list
//                   (the same text never scores again) and chosen domains join the allowlist
//   dismiss         nothing to do, nothing to change
//
// Every action is one line in the staff audit chain (lib.mjs logAudit).
import { Prisma } from '@prisma/client';
import { logAudit, hasCap } from '../lib.mjs';
import { issueSanction } from '../sanctions.mjs';
import { KEYS, loadConfig, normalizeRules, saveSetting } from './config.mjs';

export const ACTIONS = Object.freeze(['approve', 'release', 'remove', 'sanction', 'false_positive', 'dismiss']);

/** What each subject type can do. `release` puts held content back; `remove` takes it out. */
const ADAPTERS = {
  contact_held: {
    // The message never reached the inbox: releasing it files it there now, dated when it was sent.
    async release(p, c) {
      const d = c.payload && typeof c.payload === 'object' ? c.payload : null;
      if (!d?.email || !d?.body) return { error: 'payload_gone' };
      const msg = await p.contactMessage.create({ data: { name: String(d.name || '').slice(0, 100), email: String(d.email).slice(0, 254), body: String(d.body).slice(0, 12000), kind: String(d.kind || 'other').slice(0, 40), ip: String(d.ip || '').slice(0, 64), userId: d.userId || null, createdAt: c.createdAt } });
      return { subjectType: 'contact_message', subjectId: msg.id };
    },
    async remove() { return {}; },
  },
  contact_message: {
    async release() { return {}; },
    // Staff-only content: "remove" takes it off the unread queues rather than deleting what
    // somebody sent us.
    async remove(p, c) { await p.contactMessage.updateMany({ where: { id: c.subjectId }, data: { status: 'read', readAt: new Date() } }); return {}; },
  },
  thread_message: {
    async release(p, c) { await p.contactThreadMessage.updateMany({ where: { id: c.subjectId }, data: { hidden: false } }); return {}; },
    async remove(p, c) { await p.contactThreadMessage.updateMany({ where: { id: c.subjectId }, data: { hidden: true } }); return {}; },
  },
  feedback: {
    async release(p, c) { await p.feedback.updateMany({ where: { id: c.subjectId, status: 'ignored' }, data: { status: 'new' } }); return {}; },
    async remove(p, c) { await p.feedback.updateMany({ where: { id: c.subjectId }, data: { status: 'ignored' } }); return {}; },
  },
  project_review: {
    // Approval stays with the project-reviews screen (it is where a review is published).
    async release() { return {}; },
    async remove(p, c) { await p.projectReview.updateMany({ where: { id: c.subjectId }, data: { status: 'rejected' } }); return {}; },
  },
};
const NOOP = { async release() { return {}; }, async remove() { return {}; } };
const adapterFor = (type) => ADAPTERS[type] || NOOP;

/** Which actions make sense for a case (the UI draws only these). */
export function actionsFor(c) {
  if (c.status !== 'open') return [];
  const out = ['approve'];
  if (c.held) out.push('release');
  if (ADAPTERS[c.subjectType]) out.push('remove');
  if (c.authorId) out.push('sanction');
  out.push('false_positive', 'dismiss');
  return out;
}

/**
 * Carry out one action on one case.
 * @param actor  req.user ({ uid, role, perms })
 * @param body   { note?, reason? (sanction), remove? (sanction), allowDomains? (false_positive) }
 * @returns { ok, case } | { error, status }
 */
export async function actOnCase(p, caseId, action, actor, body = {}, ip = '') {
  if (!ACTIONS.includes(action)) return { error: 'unknown_action', status: 400 };
  const c = await p.moderationCase.findUnique({ where: { id: caseId } });
  if (!c) return { error: 'not_found', status: 404 };
  if (c.status !== 'open') return { error: 'not_open', status: 409 };
  const ad = adapterFor(c.subjectType);
  const note = String(body.note || '').trim().slice(0, 1000) || null;
  let patch = {};
  let resolution = action === 'approve' ? 'approved' : action === 'release' ? 'released' : action === 'remove' ? 'removed' : action === 'sanction' ? 'sanctioned' : action === 'false_positive' ? 'false_positive' : 'dismissed';
  let sanctionCode = null;

  if (action === 'approve' || action === 'release' || action === 'false_positive') {
    if (c.held) {
      const r = await ad.release(p, c);
      if (r.error) return { error: r.error, status: 409 };
      patch = { ...patch, ...(r.subjectType ? { subjectType: r.subjectType, subjectId: r.subjectId } : {}), held: false };
    }
  }
  if (action === 'remove' || (action === 'sanction' && body.remove === true)) {
    await ad.remove(p, c);
    patch.held = false;
  }
  if (action === 'sanction') {
    // Sanctions are the account-moderation team's power (the /admin/sanctions routes ask for
    // manage_users); the queue does not hand it to somebody who only works the queue.
    if (!hasCap(actor, 'manage_users')) return { error: 'missing_permission', capability: 'manage_users', status: 403 };
    if (!c.authorId) return { error: 'no_author', status: 409 };
    const reason = String(body.reason || '').trim().slice(0, 1000);
    if (reason.length < 3) return { error: 'reason_required', status: 400 };
    const exists = await p.user.findUnique({ where: { id: c.authorId }, select: { id: true } });
    if (!exists) return { error: 'author_gone', status: 409 };
    const s = await issueSanction(p, { userId: c.authorId, kind: 'warning', scope: 'account', reason, issuedById: actor.uid, internalNote: `Moderation case ${c.id} (${c.surface})`, meta: { moderationCaseId: c.id } });
    sanctionCode = s.code;
  }
  if (action === 'false_positive') await learnFalsePositive(p, c, body.allowDomains);

  const updated = await p.moderationCase.update({
    where: { id: c.id },
    data: { ...patch, status: action === 'dismiss' ? 'dismissed' : 'resolved', resolution, resolverId: actor.uid, resolvedAt: new Date(), note: sanctionCode ? `${note ? `${note} · ` : ''}${sanctionCode}` : note },
  });
  await logAudit(p, actor.uid, `moderation.${action}`, `case=${c.id} surface=${c.surface} subject=${c.subjectType}:${c.subjectId}${sanctionCode ? ` sanction=${sanctionCode}` : ''}`, ip);
  return { ok: true, case: updated, sanctionCode };
}

/** A false positive teaches the rules: the text never scores again, and the domains the
 *  moderator ticked are allowed from now on. */
async function learnFalsePositive(p, c, allowDomains) {
  const row = await p.adminSetting.findUnique({ where: { key: KEYS.rules } }).catch(() => null);
  const cur = row?.value && typeof row.value === 'object' ? row.value : {};
  const fps = Array.isArray(cur.falsePositives) ? cur.falsePositives : [];
  const next = { ...cur };
  if (c.textHash && !fps.some((f) => f.hash === c.textHash)) next.falsePositives = [...fps, { hash: c.textHash, at: new Date().toISOString(), caseId: c.id }].slice(-2000);
  const doms = (Array.isArray(allowDomains) ? allowDomains : []).map((d) => String(d).toLowerCase().trim()).filter(Boolean).slice(0, 10);
  if (doms.length) next.allowDomains = [...new Set([...(Array.isArray(cur.allowDomains) ? cur.allowDomains : []), ...doms])];
  const { rules } = normalizeRules(next, { probe: false });
  await saveSetting(p, KEYS.rules, rules);
}

/** The queue. Filters are closed vocabularies; unknown values are ignored. */
export async function listCases(p, q = {}) {
  const where = {};
  const status = ['open', 'resolved', 'dismissed', 'logged', 'all'].includes(q.status) ? q.status : 'open';
  if (status !== 'all') where.status = status;
  if (typeof q.surface === 'string' && /^[a-z_]{2,30}$/.test(q.surface)) where.surface = q.surface;
  if (['ALLOW', 'FLAG', 'REVIEW', 'QUARANTINE', 'BLOCK'].includes(q.decision)) where.decision = q.decision;
  if (q.held === 'true') where.held = true;
  const text = typeof q.q === 'string' ? q.q.trim().slice(0, 80) : '';
  if (text) where.OR = [{ excerpt: { contains: text, mode: 'insensitive' } }, { id: text }, { subjectId: text }, { authorId: text }];
  const page = Math.max(0, parseInt(q.page, 10) || 0);
  const take = 50;
  // Held content and the heaviest decisions first: they are the ones somebody is waiting on.
  const [rows, total] = await Promise.all([
    p.moderationCase.findMany({ where, orderBy: status === 'open' ? [{ held: 'desc' }, { score: 'desc' }, { createdAt: 'asc' }] : [{ createdAt: 'desc' }], skip: page * take, take }),
    p.moderationCase.count({ where }),
  ]);
  return { total, page, pageSize: take, cases: rows };
}

/** Counts for the stats card: per surface and decision over `days`, the resolutions, and the
 *  false-positive rate (false positives among cases a human closed). */
export async function caseStats(p, days = 30) {
  const since = new Date(Date.now() - Math.max(1, Math.min(365, days)) * 864e5);
  const [bySurface, byResolution, open, held] = await Promise.all([
    p.moderationCase.groupBy({ by: ['surface', 'decision', 'status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    p.moderationCase.groupBy({ by: ['resolution'], where: { resolvedAt: { gte: since } }, _count: { _all: true } }),
    p.moderationCase.count({ where: { status: 'open' } }),
    p.moderationCase.count({ where: { status: 'open', held: true } }),
  ]);
  const surfaces = {};
  for (const r of bySurface) {
    const s = (surfaces[r.surface] ||= { total: 0, logged: 0, decisions: {} });
    s.total += r._count._all;
    if (r.status === 'logged') s.logged += r._count._all;
    s.decisions[r.decision] = (s.decisions[r.decision] || 0) + r._count._all;
  }
  const resolutions = Object.fromEntries(byResolution.filter((r) => r.resolution).map((r) => [r.resolution, r._count._all]));
  const closed = Object.values(resolutions).reduce((a, n) => a + n, 0);
  return { days, open, held, surfaces, resolutions, falsePositiveRate: closed ? (resolutions.false_positive || 0) / closed : null };
}

/** Account erasure: the decisions stay, the person does not (routes/closure.mjs). */
export async function forgetAuthor(p, userId) {
  if (!userId) return 0;
  const { count } = await p.moderationCase.updateMany({
    where: { authorId: userId },
    data: { authorId: null, authorKey: '', excerpt: null, payload: Prisma.DbNull, purgedAt: new Date() },
  });
  return count;
}

/**
 * Retention: the text of a closed case is kept `retentionDays`, then dropped. The decision,
 * the reasons and who resolved it stay (they are the audit of the queue, not the content).
 * Analysis-only rows lose their text after the same delay, counted from when they were made.
 */
export async function purgeCaseText(p, { now = Date.now() } = {}) {
  const cfg = await loadConfig(p, { fresh: true });
  const cutoff = new Date(now - cfg.settings.retentionDays * 864e5);
  const { count: closed } = await p.moderationCase.updateMany({
    where: { purgedAt: null, status: { in: ['resolved', 'dismissed'] }, resolvedAt: { lt: cutoff } },
    data: { excerpt: null, payload: Prisma.DbNull, purgedAt: new Date(now) },
  });
  const { count: logged } = await p.moderationCase.updateMany({
    where: { purgedAt: null, status: 'logged', createdAt: { lt: cutoff } },
    data: { excerpt: null, payload: Prisma.DbNull, purgedAt: new Date(now) },
  });
  return closed + logged;
}
