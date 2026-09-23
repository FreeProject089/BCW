import { z } from 'zod';
import { db, requireRole, logAudit, clientIp, clearUserCache, CAPABILITIES, SCOPE_RIGHTS, GRANT_RIGHTS, grantRights, hasCap, canEditProject, canEditShowcase, projectGrants, studioGrants, holdsStudioRight } from '../lib/lib.mjs';
import { KEY_SHAPE } from '../lib/project-keys.mjs';

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
    return { roles: (await withScopeNames(p, roles)).map((r) => ({ ...r, memberCount: counts[r.id] || 0 })), capabilities: CAPABILITIES };
  });

  const roleBody = z.object({
    name: z.string().trim().min(2).max(40),
    // A hex colour from the picker (e.g. "#3b82f6"), or a legacy named Badge tone for
    // roles created before the picker existed. The client renders both (see RoleBadge).
    color: z.string().trim().regex(/^(#[0-9a-fA-F]{6}|primary|amber|green|red|blue)$/).default('#3b82f6'),
    capabilities: z.array(z.enum(CAPABILITIES)).max(CAPABILITIES.length).default([]),
    // Limit the role to elements: official project keys and/or showcase slugs (stored as
    // ids). Null / empty = the role applies site-wide.
    scope: z.object({
      projectKeys: z.array(z.string().regex(KEY_SHAPE)).max(50).default([]),
      showcaseSlugs: z.array(z.string().max(80)).max(200).default([]),
      allShowcase: z.boolean().default(false),
      // WHAT the role may do on those elements: edit the page's content, write in its blog,
      // run its marketplace, or any combination. A scope stored before this field existed
      // means `pages` — what it always did.
      // Read from lib.mjs rather than repeated: this list lives in four places (the
      // filter in scopeRights, the grants function per right, the editor, and here), and
      // the one that silently breaks the other three is this one — a right the API knows
      // and the schema rejects is a 400 on a checkbox that looks like it should work.
      rights: z.array(z.enum(SCOPE_RIGHTS)).max(SCOPE_RIGHTS.length).default(['pages']),
    }).nullable().optional(),
  });
  // Slugs → ids (a slug is what the picker shows; an id is what survives a rename).
  const resolveScope = async (p, scope) => {
    if (!scope) return null;
    const rows = scope.showcaseSlugs.length ? await p.showcaseProject.findMany({ where: { slug: { in: scope.showcaseSlugs } }, select: { id: true } }) : [];
    const rights = [...new Set(scope.rights || [])];
    const out = { projectKeys: [...new Set(scope.projectKeys)], showcaseIds: rows.map((r) => r.id), allShowcase: !!scope.allShowcase, rights: rights.length ? rights : ['pages'] };
    return out.projectKeys.length || out.showcaseIds.length || out.allShowcase ? out : null;
  };
  // For the list: the scope back as slugs + names, so the editor and the badge read it.
  const withScopeNames = async (p, roles) => {
    const ids = [...new Set(roles.flatMap((r) => r.scope?.showcaseIds || []))];
    const sc = ids.length ? await p.showcaseProject.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true, name: true } }) : [];
    const byId = Object.fromEntries(sc.map((s) => [s.id, s]));
    return roles.map((r) => ({ ...r, scope: r.scope ? { ...r.scope, showcases: (r.scope.showcaseIds || []).map((id) => byId[id]).filter(Boolean) } : null }));
  };
  app.post('/admin/custom-roles', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const b = roleBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const caps = [...new Set(b.data.capabilities)];
    const dup = await p.customRole.findUnique({ where: { name: b.data.name } });
    if (dup) return reply.code(409).send({ error: 'name_taken' });
    const scope = await resolveScope(p, b.data.scope);
    const role = await p.customRole.create({ data: { name: b.data.name, color: b.data.color || 'primary', capabilities: caps, scope, createdBy: req.user.uid } });
    await logAudit(p, req.user.uid, 'role.create', `${role.name}: [${caps.join(', ')}]${scope ? ' scoped' : ''}`, clientIp(req));
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
    const scope = await resolveScope(p, b.data.scope);
    const role = await p.customRole.update({ where: { id: req.params.id }, data: { name: b.data.name, color: b.data.color || 'primary', capabilities: caps, scope } });
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
    return { grants: grants.map((g) => ({ id: g.id, user: g.user, projectKey: g.projectKey, allShowcase: g.allShowcase, showcase: g.showcaseProjectId ? byId[g.showcaseProjectId] || null : null, rights: grantRights(g), createdAt: g.createdAt })) };
  });

  // NON-ESCALATION, the rule of lib/tasks.mjs applied to these grants: a grant is only ever of
  // something the granter already holds ON THAT TARGET, and never to themselves.
  //   · `pages`  needs what editing that page needs (canEditProject / canEditShowcase, or for
  //              every other-project page manage_showcase or a blanket grant);
  //   · `studio` needs the studio right there (holdsStudioRight: manage_studio, or a studio
  //              grant on it). The switch being off does not matter: granting is not drawing.
  // Today only ADMIN reaches these routes and ADMIN holds everything (D8), so for ADMIN this
  // never refuses; it is written down so that the day these routes take a capability, handing
  // out the studio still needs the studio.
  async function mayGrant(user, target, rights) {
    for (const r of rights) {
      if (r === 'pages') {
        const ok = target.allShowcase
          ? (hasCap(user, 'manage_showcase') || (await projectGrants(user.uid)).allShowcase)
          : target.showcaseProjectId ? await canEditShowcase(user, target.showcaseProjectId) : await canEditProject(user, target.projectKey);
        if (!ok) return false;
      } else if (r === 'studio') {
        const ok = target.allShowcase
          ? (hasCap(user, 'manage_studio') || (await studioGrants(user.uid)).allShowcase)
          : await holdsStudioRight(user, target.showcaseProjectId ? 'showcase' : 'project', target.showcaseProjectId || target.projectKey);
        if (!ok) return false;
      } else return false;
    }
    return true;
  }
  const rightsOf = (list) => [...new Set(list && list.length ? list : ['pages'])];

  const projGrant = z.object({
    userId: z.string().min(1),
    // This list was missing `developers` outright, so a grant for the developer blog was
    // refused by a copy nobody updated when that project arrived — exactly the failure this
    // change is about.
    projectKey: z.string().regex(KEY_SHAPE).optional().nullable(),
    showcaseSlug: z.string().max(80).optional().nullable(),
    allShowcase: z.boolean().optional().default(false),
    // What the grant allows there: the page's content, its studio, or both. Absent = `pages`,
    // what a grant always meant (PLAN-STUDIO-2026 3.1).
    rights: z.array(z.enum(GRANT_RIGHTS)).min(1).max(GRANT_RIGHTS.length).optional(),
  }).refine((v) => v.allShowcase || v.projectKey || v.showcaseSlug, { message: 'no_scope' });
  app.post('/admin/project-permissions', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = projGrant.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    // Nobody grants themselves anything here: an admin already holds every right, so for them
    // it is not a grant, and for anybody else it would be the escalation this file exists to stop.
    if (b.data.userId === req.user.uid) return reply.code(400).send({ error: 'cannot_grant_self' });
    const user = await p.user.findUnique({ where: { id: b.data.userId }, select: { id: true } });
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    const allShowcase = !!b.data.allShowcase;
    // A blanket "all other-projects" grant ignores any specific scope in the same call.
    let showcaseProjectId = null, projectKey = null;
    if (!allShowcase) {
      if (b.data.showcaseSlug) { const sp = await p.showcaseProject.findUnique({ where: { slug: b.data.showcaseSlug }, select: { id: true } }); if (!sp) return reply.code(400).send({ error: 'unknown_page' }); showcaseProjectId = sp.id; }
      projectKey = b.data.projectKey || null;
    }
    const rights = rightsOf(b.data.rights);
    if (!(await mayGrant(req.user, { allShowcase, showcaseProjectId, projectKey }, rights))) return reply.code(403).send({ error: 'cannot_grant_unheld_right' });
    const what = `${allShowcase ? 'all other-projects' : showcaseProjectId ? `showcase ${b.data.showcaseSlug}` : `project ${projectKey}`} [${rights.join(', ')}]`;
    // One row per person and target: granting again SETS its rights (the screen sends the
    // ticked boxes), rather than answering with the old row as if the new boxes were applied.
    const existing = await p.projectPermission.findFirst({ where: { userId: user.id, showcaseProjectId, projectKey, allShowcase } });
    if (existing) {
      if (JSON.stringify(grantRights(existing).slice().sort()) === JSON.stringify(rights.slice().sort())) return { grant: existing };
      const grant = await p.projectPermission.update({ where: { id: existing.id }, data: { rights } });
      await logAudit(p, req.user.uid, 'project_permission.rights', `${user.id}: ${what}`, clientIp(req));
      return { grant };
    }
    const grant = await p.projectPermission.create({ data: { userId: user.id, showcaseProjectId, projectKey, allShowcase, rights, grantedBy: req.user.uid } });
    await logAudit(p, req.user.uid, 'project_permission.grant', `${user.id}: ${what}`, clientIp(req));
    return reply.code(201).send({ grant });
  });
  app.delete('/admin/project-permissions/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.projectPermission.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });
}
