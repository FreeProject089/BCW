import { z } from 'zod';
import { db, requireRole, logAudit, clientIp, clearUserCache, CAPABILITIES } from '../lib/lib.mjs';

// Custom roles + per-project edit grants.
//
//  • CustomRole CRUD and assignment are SUPERADMIN-only — a role is a bundle of
//    capabilities, so handing one out is an escalation on par with changing a user's role.
//  • ProjectPermission grants are ADMIN — like blog grants, they hand out edit rights to a
//    single project's content, never dashboard-wide power, so they don't need SUPERADMIN.
//
// The reserved-control enforcement (a grantee can't pin/publish/change visibility) lives in
// showcase.mjs / projects.mjs, not here — this file only manages who holds which grant.
export default async function roleRoutes(app) {
  // ── Custom roles (SUPERADMIN) ───────────────────────────────────────────────
  app.get('/admin/custom-roles', { preHandler: requireRole('SUPERADMIN') }, async () => {
    const p = await db();
    const roles = await p.customRole.findMany({ orderBy: { createdAt: 'asc' } });
    // Member counts: how many users carry each role id. One scan of the (small) staff-ish
    // set of users that actually have roles assigned.
    const withRole = await p.user.findMany({ where: { NOT: { customRoleIds: { isEmpty: true } } }, select: { customRoleIds: true } });
    const counts = {};
    for (const u of withRole) for (const id of u.customRoleIds) counts[id] = (counts[id] || 0) + 1;
    return { roles: roles.map((r) => ({ ...r, memberCount: counts[r.id] || 0 })), capabilities: CAPABILITIES };
  });

  const roleBody = z.object({
    name: z.string().trim().min(2).max(40),
    color: z.enum(['primary', 'amber', 'green', 'red', 'blue', '']).default('primary'),
    capabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length).default([]),
  });
  app.post('/admin/custom-roles', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const b = roleBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const caps = [...new Set(b.data.capabilities)];
    const dup = await p.customRole.findUnique({ where: { name: b.data.name } });
    if (dup) return reply.code(409).send({ error: 'name_taken' });
    const role = await p.customRole.create({ data: { name: b.data.name, color: b.data.color || 'primary', capabilities: caps, createdBy: req.user.uid } });
    await logAudit(p, req.user.uid, 'role.create', `${role.name}: [${caps.join(', ')}]`, clientIp(req));
    return reply.code(201).send({ role });
  });
  app.put('/admin/custom-roles/:id', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const b = roleBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const existing = await p.customRole.findUnique({ where: { id: req.params.id } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const caps = [...new Set(b.data.capabilities)];
    // Name is unique — reject a rename that collides with a different role.
    const clash = await p.customRole.findFirst({ where: { name: b.data.name, NOT: { id: req.params.id } } });
    if (clash) return reply.code(409).send({ error: 'name_taken' });
    const role = await p.customRole.update({ where: { id: req.params.id }, data: { name: b.data.name, color: b.data.color || 'primary', capabilities: caps } });
    // A role's caps changed → every member's effective perms changed. Clear the whole cache.
    clearUserCache();
    await logAudit(p, req.user.uid, 'role.update', `${role.name}: [${caps.join(', ')}]`, clientIp(req));
    return { role };
  });
  app.delete('/admin/custom-roles/:id', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const p = await db();
    const role = await p.customRole.findUnique({ where: { id: req.params.id } });
    if (!role) return reply.code(404).send({ error: 'not_found' });
    // Pull the id out of every user that carried it, then delete the role. Postgres arrays
    // have no bulk remove, so update the affected rows individually (there are few).
    const members = await p.user.findMany({ where: { customRoleIds: { has: req.params.id } }, select: { id: true, customRoleIds: true } });
    for (const m of members) await p.user.update({ where: { id: m.id }, data: { customRoleIds: m.customRoleIds.filter((x) => x !== req.params.id) } });
    await p.customRole.delete({ where: { id: req.params.id } }).catch(() => {});
    clearUserCache();
    await logAudit(p, req.user.uid, 'role.delete', `${role.name} (was on ${members.length} user(s))`, clientIp(req));
    return { ok: true };
  });

  // Assign the set of custom roles a user holds (SUPERADMIN — assigning a role can grant
  // capabilities, i.e. escalate). Replaces the full set; can't touch your own.
  app.put('/admin/users/:id/custom-roles', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const b = z.object({ customRoleIds: z.array(z.string().min(1)).max(20) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    if (req.params.id === req.user.uid) return reply.code(400).send({ error: 'cannot_change_own_roles' });
    const p = await db();
    const target = await p.user.findUnique({ where: { id: req.params.id }, select: { id: true, displayName: true, email: true } });
    if (!target) return reply.code(404).send({ error: 'not_found' });
    // Keep only ids that resolve to a real role, deduped — so a deleted/typo id never sticks.
    const ids = [...new Set(b.data.customRoleIds)];
    const valid = ids.length ? await p.customRole.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const validIds = valid.map((r) => r.id);
    await p.user.update({ where: { id: target.id }, data: { customRoleIds: validIds } });
    clearUserCache(target.id);
    await logAudit(p, req.user.uid, 'user.custom_roles', `${target.displayName} (${target.email}): [${valid.map((r) => r.name).join(', ')}]`, clientIp(req));
    return { ok: true, customRoleIds: validIds };
  });

  // ── Per-project edit grants (ADMIN) ─────────────────────────────────────────
  app.get('/admin/project-permissions', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const grants = await p.projectPermission.findMany({ orderBy: { createdAt: 'desc' }, include: { user: { select: { id: true, displayName: true, email: true, avatar: true } } } });
    const scIds = [...new Set(grants.filter((g) => g.showcaseProjectId).map((g) => g.showcaseProjectId))];
    const showcases = scIds.length ? await p.showcaseProject.findMany({ where: { id: { in: scIds } }, select: { id: true, slug: true, name: true } }) : [];
    const byId = Object.fromEntries(showcases.map((s) => [s.id, s]));
    return { grants: grants.map((g) => ({ id: g.id, user: g.user, projectKey: g.projectKey, allShowcase: g.allShowcase, showcase: g.showcaseProjectId ? byId[g.showcaseProjectId] || null : null, createdAt: g.createdAt })) };
  });

  const projGrant = z.object({
    userId: z.string().min(1),
    projectKey: z.enum(['community', 'bmm', 'bsm', 'installer']).optional().nullable(),
    showcaseSlug: z.string().max(80).optional().nullable(),
    allShowcase: z.boolean().optional().default(false),
  }).refine((v) => v.allShowcase || v.projectKey || v.showcaseSlug, { message: 'no_scope' });
  app.post('/admin/project-permissions', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = projGrant.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const user = await p.user.findUnique({ where: { id: b.data.userId }, select: { id: true } });
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    const allShowcase = !!b.data.allShowcase;
    // A blanket "all other-projects" grant ignores any specific scope in the same call.
    let showcaseProjectId = null, projectKey = null;
    if (!allShowcase) {
      if (b.data.showcaseSlug) { const sp = await p.showcaseProject.findUnique({ where: { slug: b.data.showcaseSlug }, select: { id: true } }); if (!sp) return reply.code(400).send({ error: 'unknown_page' }); showcaseProjectId = sp.id; }
      projectKey = b.data.projectKey || null;
    }
    const existing = await p.projectPermission.findFirst({ where: { userId: user.id, showcaseProjectId, projectKey, allShowcase } });
    if (existing) return { grant: existing };
    const grant = await p.projectPermission.create({ data: { userId: user.id, showcaseProjectId, projectKey, allShowcase, grantedBy: req.user.uid } });
    await logAudit(p, req.user.uid, 'project_permission.grant', `${user.id}: ${allShowcase ? 'all other-projects' : showcaseProjectId ? `showcase ${b.data.showcaseSlug}` : `project ${projectKey}`}`, clientIp(req));
    return reply.code(201).send({ grant });
  });
  app.delete('/admin/project-permissions/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.projectPermission.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });
}
