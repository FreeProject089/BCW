// Contacting a PROJECT: the picker, and each project's own contact inbox.
//
//   GET /contact/projects                   the projects a visitor may pick in a form (public ones)
//   GET /projects-contact/:ref              what the contact button needs: open?, topics, and
//                                           what THIS viewer may do (read the inbox, configure)
//   GET /projects-contact/:ref/settings     the full settings (managers and editors)
//   PUT /projects-contact/:ref/settings     change them; who READS the inbox is managers-only
//
// The conversations are ContactThreads of kind 'project' (routes/threads.mjs): opened with
// POST /threads { kind: 'project', targetId: ref, topic }, answered from the ordinary inbox.
// This file never writes a thread. `ref` is a project ref, see lib/project-ref.mjs.
import { z } from 'zod';
import { db, optionalAuth, requireRole, logAudit, canManageProjects, canManageShowcase } from '../lib/lib.mjs';
import { listPublicProjects, resolveProjectRef } from '../lib/project-ref.mjs';
import { settingsFor, topicsOf, inboxAccess, canConfigure, cleanCustomTopics, BASIC_TOPICS, MAX_CUSTOM_TOPICS } from '../lib/project-contact.mjs';
import { findUserIdByBcId, looksLikeBcId } from '../lib/repofingerprint.mjs';

const managerOf = (user, proj) => (proj.official ? canManageProjects(user) : canManageShowcase(user));

/** An account named by id, BC id, e-mail or exact display name: the teams page's rule. */
async function resolveUser(p, who) {
  const s = String(who || '').trim();
  if (!s) return null;
  if (looksLikeBcId(s)) { const id = await findUserIdByBcId(p, s).catch(() => null); if (id) return p.user.findUnique({ where: { id }, select: { id: true, displayName: true } }); }
  if (s.includes('@')) return p.user.findFirst({ where: { email: { equals: s, mode: 'insensitive' } }, select: { id: true, displayName: true } });
  return (await p.user.findUnique({ where: { id: s }, select: { id: true, displayName: true } }).catch(() => null))
    || p.user.findFirst({ where: { displayName: { equals: s, mode: 'insensitive' } }, select: { id: true, displayName: true } });
}

export default async function projectContactRoutes(app) {
  app.get('/contact/projects', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=30');
    return { projects: await listPublicProjects(await db()) };
  });

  app.get('/projects-contact/:ref', { preHandler: optionalAuth() }, async (req, reply) => {
    const p = await db();
    const proj = await resolveProjectRef(p, req.params.ref);
    if (!proj || proj.visibility === 'private') return reply.code(404).send({ error: 'not_found' });
    const s = await settingsFor(p, proj.ref);
    const access = req.user ? await inboxAccess(req.user, proj, s) : '';
    const configure = req.user ? await canConfigure(req.user, proj) : false;
    // How many conversations are waiting for this project's side, for the badge on the
    // button. Only for somebody who may read them.
    const unread = access ? await p.contactThread.count({ where: { kind: 'project', targetId: proj.ref, ownerUnread: true, status: 'open' } }) : 0;
    return { ref: proj.ref, name: proj.name, official: proj.official, enabled: s.enabled, topics: topicsOf(s), canReadInbox: !!access, canConfigure: configure, unread };
  });

  app.get('/projects-contact/:ref/settings', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    const proj = await resolveProjectRef(p, req.params.ref);
    if (!proj) return reply.code(404).send({ error: 'not_found' });
    if (!(await canConfigure(req.user, proj))) return reply.code(403).send({ error: 'forbidden' });
    const s = await settingsFor(p, proj.ref);
    const manager = managerOf(req.user, proj);
    const users = manager && s.inboxUserIds.length ? await p.user.findMany({ where: { id: { in: s.inboxUserIds } }, select: { id: true, displayName: true } }) : [];
    return {
      ref: proj.ref, name: proj.name, official: proj.official,
      enabled: s.enabled, basicTopics: s.basicTopics, customTopics: s.customTopics, allBasicTopics: BASIC_TOPICS, maxCustomTopics: MAX_CUSTOM_TOPICS,
      // Who reads the inbox is a permission, so only the people who hand out permissions on
      // this kind of project see or change it.
      canManageAccess: manager,
      ...(manager ? { editorsSeeInbox: s.editorsSeeInbox, inboxUsers: users } : {}),
    };
  });

  app.put('/projects-contact/:ref/settings', { preHandler: requireRole(), config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = z.object({
      enabled: z.boolean().optional(),
      basicTopics: z.array(z.enum(BASIC_TOPICS)).max(BASIC_TOPICS.length).optional(),
      customTopics: z.array(z.object({ id: z.string().max(40).optional(), label: z.string().max(60), labelFr: z.string().max(60).optional() })).max(MAX_CUSTOM_TOPICS).optional(),
      editorsSeeInbox: z.boolean().optional(),
      inboxUsers: z.array(z.string().trim().min(1).max(254)).max(50).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const proj = await resolveProjectRef(p, req.params.ref);
    if (!proj) return reply.code(404).send({ error: 'not_found' });
    if (!(await canConfigure(req.user, proj))) return reply.code(403).send({ error: 'forbidden' });
    const manager = managerOf(req.user, proj);
    if (!manager && (b.data.editorsSeeInbox !== undefined || b.data.inboxUsers !== undefined)) return reply.code(403).send({ error: 'access_is_managers_only' });
    const cur = await settingsFor(p, proj.ref);
    const data = {
      enabled: b.data.enabled ?? cur.enabled,
      basicTopics: b.data.basicTopics ?? cur.basicTopics,
      customTopics: b.data.customTopics ? cleanCustomTopics(b.data.customTopics) : cur.customTopics,
      editorsSeeInbox: b.data.editorsSeeInbox ?? cur.editorsSeeInbox,
      inboxUserIds: cur.inboxUserIds,
      updatedBy: req.user.uid,
    };
    if (b.data.inboxUsers) {
      const ids = [];
      for (const who of b.data.inboxUsers) {
        const u = await resolveUser(p, who);
        if (!u) return reply.code(404).send({ error: 'user_not_found', who });
        if (!ids.includes(u.id)) ids.push(u.id);
      }
      data.inboxUserIds = ids;
    }
    // A project must offer at least one thing to write about, or its open inbox is a form
    // nobody can send.
    if (data.enabled && !data.basicTopics.length && !data.customTopics.length) return reply.code(400).send({ error: 'no_topics' });
    await p.projectContactSettings.upsert({ where: { ref: proj.ref }, create: { ref: proj.ref, ...data }, update: data });
    await logAudit(p, req.user.uid, 'project.contact.settings', `ref=${proj.ref}${b.data.inboxUsers ? ` inboxUsers=${data.inboxUserIds.length}` : ''}`).catch(() => {});
    return { ok: true };
  });
}
