// prerelease (agent-prerelease): ANNOUNCING a release a project already wrote.
//
// The release itself is the project's history entry (ProjectRelease, routes/project-content.mjs:
// written by its editors, shown in its Versions tab). Announcing it is a separate, reserved act,
// because it reaches people who never opened the project page:
//
//   blog         a post in the project's own blog, built from the release notes. That is the
//                reuse: a blog post is what the home page's "Latest news" lists (when the
//                project's showOnHomeNews is on), what its Blog tab lists, and what the Discord
//                bot's blog announcements pick up on their own (apps/bot features/blog.mjs,
//                behind the existing bot config). Nothing new to configure anywhere.
//   notify       a bell notification to every account, kind `release_published`, in the mutable
//                "Releases & early access" category, pointing at the project's Versions tab.
//   newsletter   the newsletter helpers (double opt-in list, one-click unsubscribe in every mail).
//
//   POST /projects-releases/:ref/:version/announce   { blog, notify, newsletter, force }
//
// WHO: the project's MANAGERS (manage_projects / manage_showcase), not a plain page grant. A
// grantee writes the release; broadcasting it to every account is a site decision.
// ONCE: a second announce is refused unless `force`, and `force` never re-creates the blog post.
import { z } from 'zod';
import { db, requireEditor, notifyAll, logAudit, clientIp, slugify } from '../lib/lib.mjs';
import { emailEnabled } from '../lib/mail.mjs';
import { sendNewsletter } from './newsletter.mjs';
import { projectByRef, canManageTarget } from '../lib/project-target.mjs';

const SITE_URL = (process.env.SITE_URL || 'http://localhost:5176').replace(/\/$/, '');
// The test seam: a broadcast writes to EVERY account in the database, which a test must not do
// while other suites create and delete accounts beside it. Tests route it through a stub.
let _broadcast = notifyAll;
export function setAnnounceBroadcaster(fn) { _broadcast = typeof fn === 'function' ? fn : notifyAll; }
const bodySchema = z.object({
  blog: z.boolean().default(false),
  notify: z.boolean().default(false),
  newsletter: z.boolean().default(false),
  force: z.boolean().default(false),
});

/** The release notes as B.MD, in one language. Plain concatenation: the notes are already B.MD
 *  written by the project's editors, and the blog renders every post through the sanitiser. */
export function releasePostBody(entry, projectUrl, fr = false) {
  const e = entry || {};
  const out = [];
  if (Array.isArray(e.highlights) && e.highlights.length) {
    out.push(`## ${fr ? 'Points forts' : 'Highlights'}`, '', ...e.highlights.map((h) => `- ${h}`), '');
  }
  if (e.notes) out.push(String(e.notes), '');
  if (Array.isArray(e.breaking) && e.breaking.length) {
    out.push(`## ${fr ? 'Changements incompatibles' : 'Breaking changes'}`, '', ...e.breaking.map((h) => `- ${h}`), '');
  }
  out.push(`[${fr ? 'Toutes les versions' : 'Every version'}](${projectUrl}?tab=versions)`);
  return out.join('\n').trim();
}

export default async function releaseAnnounceRoutes(app) {
  app.post('/projects-releases/:ref/:version/announce', { preHandler: requireEditor(), config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = bodySchema.safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!b.data.blog && !b.data.notify && !b.data.newsletter) return reply.code(400).send({ error: 'nothing_to_do' });
    const p = await db();
    const proj = await projectByRef(p, String(req.params.ref || ''));
    if (!proj) return reply.code(404).send({ error: 'unknown_project' });
    if (!canManageTarget(req.user, proj)) return reply.code(403).send({ error: 'forbidden' });
    const rel = await p.projectRelease.findUnique({ where: { target_version: { target: proj.target, version: String(req.params.version || '') } } });
    if (!rel || !rel.published) return reply.code(404).send({ error: 'not_found' });
    if (rel.announcedAt && !b.data.force) return reply.code(409).send({ error: 'already_announced', announcedAt: rel.announcedAt });
    // Announcing a page nobody may see would announce it anyway.
    if (!proj.published || !(proj.visibility === 'public' || proj.projectKey === 'community')) return reply.code(409).send({ error: 'project_not_public' });

    const en = rel.content?.en || Object.values(rel.content || {})[0] || {};
    const frEntry = rel.content?.fr || null;
    const headline = `${proj.name} ${rel.version}${en.title ? `: ${en.title}` : ''}`.slice(0, 160);
    const headlineFr = frEntry ? `${proj.name} ${rel.version}${frEntry.title ? ` : ${frEntry.title}` : ''}`.slice(0, 160) : null;
    const prev = rel.announcement && typeof rel.announcement === 'object' ? rel.announcement : {};
    const done = { ...prev, by: req.user.uid };

    if (b.data.blog && !prev.blogSlug) {
      const space = proj.official
        ? { projectId: (await p.project.findUnique({ where: { key: proj.projectKey }, select: { id: true } }))?.id }
        : { showcaseProjectId: proj.showcaseProjectId };
      if (!space.projectId && !space.showcaseProjectId) return reply.code(409).send({ error: 'no_blog_space' });
      const excerpt = (en.highlights || []).slice(0, 3).join(' · ').slice(0, 300) || `${proj.name} ${rel.version} is out.`;
      const post = await p.blogPost.create({
        data: {
          ...space, authorId: req.user.uid, title: headline, excerpt,
          body: releasePostBody(en, proj.url, false), slug: `${slugify(`${proj.name} ${rel.version}`)}-${Math.random().toString(36).slice(2, 6)}`,
          titleFr: headlineFr, excerptFr: frEntry ? ((frEntry.highlights || []).slice(0, 3).join(' · ').slice(0, 300) || null) : null,
          bodyFr: frEntry ? releasePostBody(frEntry, proj.url, true) : null,
          status: 'PUBLISHED', publishedAt: new Date(),
        },
      });
      done.blogSlug = post.slug;
    }
    if (b.data.notify) {
      // notifyAll re-reads the accounts once when one is erased mid-write (P2003); a busy site can
      // erase another in between. A failed bell must not turn an announcement whose blog post
      // already exists into a 500, so it is retried, then reported instead of thrown.
      done.notified = null;
      for (let attempt = 0; attempt < 3 && done.notified == null; attempt++) {
        try { done.notified = await _broadcast(p, 'release_published', `${headline} is out.`, headlineFr ? `${headlineFr} est disponible.` : null, { href: `${proj.url}?tab=versions` }); }
        catch { /* retried */ }
      }
      if (done.notified == null) done.notifyFailed = true;
    }
    if (b.data.newsletter && emailEnabled()) {
      const url = done.blogSlug ? `${SITE_URL}/blog/${done.blogSlug}` : `${SITE_URL}${proj.url}?tab=versions`;
      done.newsletter = true;
      // The post's own "announce to the newsletter" toggle must not send it a second time.
      if (done.blogSlug) await p.blogPost.update({ where: { slug: done.blogSlug }, data: { newsletterSentAt: new Date() } }).catch(() => {});
      // In the background, like the blog's own announce: a list of thousands is not a request.
      sendNewsletter(p, { subject: `${headline} is out`, title: headline, body: (en.highlights || []).map((h) => `- ${h}`).join('\n') || en.notes || '', url }).catch(() => {});
    }
    const links = { ...(rel.links || {}), ...(done.blogSlug ? { blog: `/blog/${done.blogSlug}` } : {}) };
    const updated = await p.projectRelease.update({ where: { id: rel.id }, data: { announcedAt: new Date(), announcement: done, links } });
    await logAudit(p, req.user.uid, 'project.release.announced', `${proj.ref} ${rel.version} blog=${!!done.blogSlug} notify=${done.notified ?? 0} newsletter=${!!done.newsletter}`, clientIp(req));
    return { ok: true, announcedAt: updated.announcedAt, announcement: { blogSlug: done.blogSlug || null, notified: done.notified ?? null, newsletter: !!done.newsletter }, links };
  });
}
