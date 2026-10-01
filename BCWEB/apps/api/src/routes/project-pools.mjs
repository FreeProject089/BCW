// agent-bcw-pools: pools dedicated to a project (rules in lib/project-pool.mjs).
//
//   GET  /admin/hosting/project-pools          every project with its pool (if any), and the
//                                              pools that could take one        manage_hosting
//   PUT  /admin/hosting/pools/:id/project      dedicate a pool to a project, or free it
//                                              ({ ref: null })                    manage_hosting
//   GET  /projects-pool/:ref                   a project's pool, for the people who run it
//                                              (page editors, early-access holders)
import { z } from 'zod';
import { db, requireCap, requireEditor, logAudit, clientIp } from '../lib/lib.mjs';
import { projectByRef, projectsByTargets, canEditTarget, canRunEarlyAccess } from '../lib/project-target.mjs';
import { poolOfTarget, poolSummary, projectFileBytes } from '../lib/project-pool.mjs';
import { poolRoom } from '../lib/entity-hosting.mjs';
import { projectKeys } from '../lib/project-keys.mjs';

export default async function projectPoolRoutes(app) {
  app.get('/admin/hosting/project-pools', { preHandler: requireCap('manage_hosting') }, async () => {
    const p = await db();
    const [keys, shows, pools] = await Promise.all([
      projectKeys(),
      p.showcaseProject.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }], take: 500, select: { id: true } }),
      p.hostingGroup.findMany({ orderBy: { createdAt: 'desc' }, take: 300, select: { id: true, name: true, poolBytes: true, projectTarget: true, owner: { select: { displayName: true } } } }),
    ]);
    const recs = await projectsByTargets(p, [...keys, ...shows.map((s) => `sc:${s.id}`)]);
    const byTarget = new Map(pools.filter((g) => g.projectTarget).map((g) => [g.projectTarget, g]));
    const projects = [];
    for (const proj of recs.values()) {
      const g = byTarget.get(proj.target);
      projects.push({ ref: proj.ref, name: proj.name, official: proj.official, pool: g ? await poolSummary(p, g, { room: poolRoom }) : null });
    }
    return {
      projects,
      pools: await Promise.all(pools.map(async (g) => {
        const free = (await poolRoom(p, g.id)) ?? 0n;
        return { id: g.id, name: g.name, owner: g.owner?.displayName || '', poolBytes: Number(g.poolBytes || 0n), projectTarget: g.projectTarget || null, freeBytes: Number(free > 0n ? free : 0n) };
      })),
    };
  });

  app.put('/admin/hosting/pools/:id/project', { preHandler: requireCap('manage_hosting') }, async (req, reply) => {
    const b = z.object({ ref: z.string().max(90).nullable() }).safeParse(req.body || {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const g = await p.hostingGroup.findUnique({ where: { id: String(req.params.id || '').slice(0, 40) } });
    if (!g) return reply.code(404).send({ error: 'not_found' });
    if (b.data.ref === null) {
      if (g.projectTarget) {
        await p.hostingGroup.update({ where: { id: g.id }, data: { projectTarget: null } });
        await logAudit(p, req.user.uid, 'pool.project', `${g.id} freed from ${g.projectTarget}`, clientIp(req));
      }
      return { ok: true, pool: await poolSummary(p, { ...g, projectTarget: null }, { room: poolRoom }) };
    }
    const proj = await projectByRef(p, b.data.ref);
    if (!proj) return reply.code(404).send({ error: 'unknown_project' });
    const taken = await poolOfTarget(p, proj.target);
    if (taken && taken.id !== g.id) return reply.code(409).send({ error: 'project_has_pool', pool: { id: taken.id, name: taken.name } });
    // The project's files move onto the pool the moment it is attached: refuse a pool too small
    // to hold them, rather than start the project over its quota.
    const files = await projectFileBytes(p, proj.target);
    const room = (await poolRoom(p, g.id)) ?? 0n;
    const alreadyCounted = g.projectTarget === proj.target ? files.total : 0n;
    if (room + alreadyCounted < files.total) return reply.code(409).send({ error: 'pool_too_small', needBytes: Number(files.total), freeBytes: Number(room > 0n ? room : 0n) });
    const row = await p.hostingGroup.update({ where: { id: g.id }, data: { projectTarget: proj.target } });
    await logAudit(p, req.user.uid, 'pool.project', `${g.id} dedicated to ${proj.target}`, clientIp(req));
    return { ok: true, pool: await poolSummary(p, row, { room: poolRoom }) };
  });

  app.get('/projects-pool/:ref', { preHandler: requireEditor() }, async (req, reply) => {
    const p = await db();
    const proj = await projectByRef(p, String(req.params.ref || ''));
    if (!proj) return reply.code(404).send({ error: 'unknown_project' });
    if (!(await canEditTarget(req.user, proj)) && !(await canRunEarlyAccess(req.user, proj))) return reply.code(403).send({ error: 'forbidden' });
    const g = await poolOfTarget(p, proj.target);
    return { pool: g ? await poolSummary(p, g, { room: poolRoom }) : null };
  });
}
