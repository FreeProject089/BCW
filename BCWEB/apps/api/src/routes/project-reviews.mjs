// prerelease (agent-prerelease): members' reviews of ONE project, the landing review's rules
// scoped to a project page (model ProjectReview, rules in lib/review-rules.mjs).
//
//   GET    /projects-reviews/:ref            is it on, the approved public reviews, my own, and
//                                            for the project's editors every review of it
//   PUT    /projects-reviews/:ref/mine       write or edit mine (pending until a moderator approves)
//   DELETE /projects-reviews/:ref/mine       delete mine
//   PUT    /projects-reviews/:ref/settings   switch the project's reviews on or off: a RESERVED
//                                            control, the manager capability only (manage_projects
//                                            for an official project, manage_showcase otherwise),
//                                            never a plain page grant. Off by default.
//   GET    /admin/project-reviews            the moderation queue, every project
//   PATCH  /admin/project-reviews/:id        approve / reject, against the version read
//   DELETE /admin/project-reviews/:id
//
// Moderation is staff work, under manage_announcements (the capability of the "Writing &
// notices" group the landing reviews live in): a project's own editors READ what is written
// about their project, private reviews included, and cannot approve or bury it.
import { z } from 'zod';
import { db, optionalAuth, requireRole, requireEditor, requireCap, logAudit, clientIp } from '../lib/lib.mjs';
import { projectByRef, projectsByTargets, canSeeProject, liveUser, canEditTarget, canManageTarget, projectCard } from '../lib/project-target.mjs';
import { memberReviewSchema, REVIEW_HAS_LINK, reviewerRefusal, ANONYMOUS_AVATAR } from '../lib/review-rules.mjs';

const REVIEWS_SHOWN = 100;

async function reviewsOn(p, target) {
  const s = await p.projectReviewSettings.findUnique({ where: { target } }).catch(() => null);
  return !!s?.enabled;
}

/** A review as the public reads it: anonymity applied. */
const publicView = (r) => ({
  id: r.id, author: r.anonymous ? '' : r.author, anonymous: !!r.anonymous, role: r.role, body: r.body, lang: r.lang,
  rating: r.rating, avatar: r.anonymous ? ANONYMOUS_AVATAR : { variant: 'beam', seed: r.userId }, createdAt: r.createdAt,
});
/** The author's own view. */
const ownView = (r) => r && ({ id: r.id, body: r.body, rating: r.rating, role: r.role, lang: r.lang, status: r.status, visibility: r.visibility, anonymous: !!r.anonymous, updatedAt: r.updatedAt });
/** The project team's view: every status and visibility, the name hidden when the member asked
 *  for anonymity (only moderators always see who wrote it). */
const teamView = (r) => ({ ...publicView(r), status: r.status, visibility: r.visibility, updatedAt: r.updatedAt });

const moderationSchema = z.object({
  status: z.enum(['approved', 'pending', 'rejected']),
  // The `updatedAt` of the version the moderator read: an approval publishes THAT text.
  seenUpdatedAt: z.string().max(40).optional(),
});

export default async function projectReviewRoutes(app) {
  app.get('/projects-reviews/:ref', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const proj = await projectByRef(p, String(req.params.ref || ''));
    if (!proj) return reply.code(404).send({ error: 'unknown_project' });
    const user = await liveUser(req);
    const canEdit = await canEditTarget(user, proj);
    if (!canEdit && !(await canSeeProject(p, proj, req))) return reply.code(404).send({ error: 'not_found' });
    const enabled = await reviewsOn(p, proj.target);
    const canConfigure = canManageTarget(user, proj);
    const mine = user?.uid ? await p.projectReview.findUnique({ where: { userId_target: { userId: user.uid, target: proj.target } } }) : null;
    if (!enabled) return { project: projectCard(proj), enabled: false, reviews: [], count: 0, average: null, mine: ownView(mine), canConfigure, canEdit };
    const where = { target: proj.target, status: 'approved', visibility: 'public', user: { status: 'active', closedAt: null } };
    const [rows, agg, team] = await Promise.all([
      p.projectReview.findMany({ where, orderBy: { createdAt: 'desc' }, take: REVIEWS_SHOWN }),
      p.projectReview.aggregate({ where, _count: { _all: true }, _avg: { rating: true } }),
      canEdit ? p.projectReview.findMany({ where: { target: proj.target }, orderBy: { updatedAt: 'desc' }, take: 300 }) : null,
    ]);
    return {
      project: projectCard(proj), enabled: true, reviews: rows.map(publicView), count: agg._count._all,
      average: agg._avg.rating != null ? Math.round(agg._avg.rating * 10) / 10 : null,
      mine: ownView(mine), canConfigure, canEdit, ...(team ? { team: team.map(teamView) } : {}),
    };
  });

  app.put('/projects-reviews/:ref/mine', { preHandler: requireRole(), config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = memberReviewSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (REVIEW_HAS_LINK.test(b.data.body) || REVIEW_HAS_LINK.test(b.data.role || '')) return reply.code(400).send({ error: 'no_links' });
    const p = await db();
    const proj = await projectByRef(p, String(req.params.ref || ''));
    if (!proj || !(await canSeeProject(p, proj, req))) return reply.code(404).send({ error: 'not_found' });
    if (!(await reviewsOn(p, proj.target))) return reply.code(403).send({ error: 'reviews_off' });
    const me = await p.user.findUnique({ where: { id: req.user.uid }, select: { displayName: true, createdAt: true, status: true } });
    const refusal = reviewerRefusal(me);
    if (refusal) return reply.code(403).send({ error: refusal });
    // moderation (agent-moderation): every review already waits for approval, so the engine
    // cannot hold one; it can refuse an obvious one (auto mode, BLOCK) and flags the rest for
    // the person approving it.
    const { moderate, linkCase } = await import('../lib/moderation/index.mjs');
    const mod = await moderate('community', { text: [b.data.role, b.data.body].filter(Boolean).join('\n'), authorId: req.user.uid, ip: clientIp(req), meta: { target: proj.target } }, { p, subject: { type: 'project_review' }, canRefuse: true, log: req.log });
    if (mod.action === 'refuse') return reply.code(400).send({ error: 'content_refused' });
    // fin moderation (agent-moderation)
    const lang = b.data.lang || 'en';
    const data = {
      author: String(me.displayName || '').slice(0, 80) || 'Member', role: b.data.role || '', body: b.data.body, lang,
      rating: b.data.rating ?? null, status: 'pending', visibility: b.data.visibility, anonymous: b.data.anonymous,
    };
    const r = await p.projectReview.upsert({
      where: { userId_target: { userId: req.user.uid, target: proj.target } },
      create: { ...data, userId: req.user.uid, target: proj.target }, update: data,
    });
    linkCase(p, mod, 'project_review', r.id); // moderation (agent-moderation)
    return { review: ownView(r) };
  });

  app.delete('/projects-reviews/:ref/mine', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const proj = await projectByRef(p, String(req.params.ref || ''));
    if (!proj) return reply.code(404).send({ error: 'not_found' });
    await p.projectReview.deleteMany({ where: { userId: req.user.uid, target: proj.target } });
    return { ok: true };
  });

  app.put('/projects-reviews/:ref/settings', { preHandler: requireEditor(), config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const proj = await projectByRef(p, String(req.params.ref || ''));
    if (!proj) return reply.code(404).send({ error: 'unknown_project' });
    if (!canManageTarget(req.user, proj)) return reply.code(403).send({ error: 'forbidden' });
    await p.projectReviewSettings.upsert({
      where: { target: proj.target },
      create: { target: proj.target, enabled: b.data.enabled, updatedBy: req.user.uid },
      update: { enabled: b.data.enabled, updatedBy: req.user.uid },
    });
    await logAudit(p, req.user.uid, b.data.enabled ? 'project.reviews.enabled' : 'project.reviews.disabled', proj.ref, clientIp(req));
    return { ok: true, enabled: b.data.enabled };
  });

  // ── moderation ────────────────────────────────────────────────────────────────────────
  app.get('/admin/project-reviews', { preHandler: requireCap('manage_announcements') }, async (req) => {
    const p = await db();
    const status = ['pending', 'approved', 'rejected'].includes(req.query?.status) ? req.query.status : undefined;
    const rows = await p.projectReview.findMany({
      where: status ? { status } : {}, orderBy: { updatedAt: 'desc' }, take: 500,
      include: { user: { select: { id: true, displayName: true, status: true } } },
    });
    const projects = await projectsByTargets(p, rows.map((r) => r.target));
    const [settings, pending] = await Promise.all([
      p.projectReviewSettings.findMany({ where: { enabled: true } }),
      p.projectReview.count({ where: { status: 'pending' } }),
    ]);
    const on = await projectsByTargets(p, settings.map((s) => s.target));
    return {
      pending,
      enabledProjects: [...on.values()].map(projectCard),
      // Moderators always see who wrote a review, anonymous or not (the landing rule).
      reviews: rows.map((r) => ({
        id: r.id, project: projectCard(projects.get(r.target)), author: r.author, userId: r.userId, accountStatus: r.user?.status || null,
        anonymous: !!r.anonymous, role: r.role, body: r.body, lang: r.lang, rating: r.rating, status: r.status, visibility: r.visibility,
        createdAt: r.createdAt, updatedAt: r.updatedAt,
      })),
    };
  });

  app.patch('/admin/project-reviews/:id', { preHandler: requireCap('manage_announcements') }, async (req, reply) => {
    const b = moderationSchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cur = await p.projectReview.findUnique({ where: { id: String(req.params.id || '') } });
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    // Approve what was READ: a member can edit between the moderator opening the queue and the
    // click, and approving the newer text would publish something nobody looked at.
    if (b.data.status === 'approved') {
      const seen = Date.parse(b.data.seenUpdatedAt || '');
      if (!Number.isFinite(seen) || seen !== cur.updatedAt.getTime()) return reply.code(409).send({ error: 'changed_since_viewed' });
    }
    // updateMany on (id, updatedAt): the check and the write are one statement.
    const done = await p.projectReview.updateMany({ where: { id: cur.id, updatedAt: cur.updatedAt }, data: { status: b.data.status } });
    if (!done.count) return reply.code(409).send({ error: 'changed_since_viewed' });
    await logAudit(p, req.user.uid, `project.review.${b.data.status}`, `${cur.target} ${cur.id}`, clientIp(req));
    return { review: { id: cur.id, status: b.data.status } };
  });

  app.delete('/admin/project-reviews/:id', { preHandler: requireCap('manage_announcements') }, async (req, reply) => {
    const p = await db();
    const gone = await p.projectReview.deleteMany({ where: { id: String(req.params.id || '') } });
    if (!gone.count) return reply.code(404).send({ error: 'not_found' });
    await logAudit(p, req.user.uid, 'project.review.deleted', String(req.params.id), clientIp(req));
    return { ok: true };
  });
}
