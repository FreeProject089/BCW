// Admin: hosting settings per blog and per contact inbox (lib/entity-hosting.mjs).
//
//   GET /admin/hosting/entities?kind=blog|project-contact|team-contact   every candidate, its settings and usage
//   PUT /admin/hosting/entities/:kind/:ref                              { mode, maxItems, maxKB, poolId, quotaMB, attachments, maxAttachmentMB }
//   GET /admin/hosting/entities/defaults · PUT …                        the site-wide contact attachment rule
//
// Guarded by manage_hosting: these are hosting decisions (who gets how much storage, and
// from which pool), the same capability as the pools screen they sit beside. An admin may
// point a thing at ANY pool; a team points its own inbox at its own pools from the team
// page (routes/teams.mjs), with the ownership rule there.
import { z } from 'zod';
import { db, requireCap, logAudit } from '../lib/lib.mjs';
import { listPublicProjects } from '../lib/project-ref.mjs';
import { hostingFor, saveHosting, serHosting, siteAttachmentDefault, poolRoom, KINDS, MODES, ATTACH } from '../lib/entity-hosting.mjs';

const MB = 1024 * 1024;

/** Posts and their bytes per blog, in one query, keyed by project ref. */
async function blogUsageByRef(p) {
  const rows = await p.$queryRaw`
    SELECT COALESCE(pr.key, 'sc:' || sp.slug) AS ref, count(*)::int AS n,
           COALESCE(SUM(octet_length(b.body) + octet_length(COALESCE(b."bodyFr", ''))), 0)::bigint AS bytes
      FROM "BlogPost" b
      LEFT JOIN "Project" pr ON pr.id = b."projectId"
      LEFT JOIN "ShowcaseProject" sp ON sp.id = b."showcaseProjectId"
     GROUP BY 1`;
  return Object.fromEntries(rows.filter((r) => r.ref).map((r) => [r.ref, { count: r.n, bytes: Number(r.bytes) }]));
}

/** Conversations and the bytes of their files, per target. */
async function contactUsageByRef(p, kind) {
  const threadKind = kind === 'team-contact' ? 'team' : 'project';
  const rows = await p.$queryRaw`
    SELECT t."targetId" AS ref, t."ownerTeamId" AS team, count(DISTINCT t.id)::int AS n,
           COALESCE(SUM(a.size), 0)::bigint AS bytes
      FROM "ContactThread" t
      LEFT JOIN "ContactThreadAttachment" a ON a."threadId" = t.id
     WHERE t.kind = ${threadKind}
     GROUP BY 1, 2`.catch(() => []);
  // A team is keyed by its id in the settings, by its slug in targetId.
  return Object.fromEntries(rows.map((r) => [kind === 'team-contact' ? r.team : r.ref, { count: r.n, bytes: Number(r.bytes) }]));
}

export default async function entityHostingRoutes(app) {
  app.get('/admin/hosting/entities', { preHandler: requireCap('manage_hosting') }, async (req, reply) => {
    const kind = String(req.query?.kind || 'blog');
    if (!KINDS.includes(kind)) return reply.code(400).send({ error: 'invalid_kind' });
    const p = await db();
    let things;
    if (kind === 'team-contact') {
      const teams = await p.team.findMany({ orderBy: { name: 'asc' }, take: 300, select: { id: true, name: true, slug: true } });
      things = teams.map((t) => ({ ref: t.id, name: t.name, sub: `/t/${t.slug}` }));
    } else {
      things = (await listPublicProjects(p)).map((x) => ({ ref: x.ref, name: x.name, sub: x.official ? 'official' : 'other' }));
    }
    const [rows, usage, pools, site] = await Promise.all([
      p.entityHostingSettings.findMany({ where: { kind } }),
      kind === 'blog' ? blogUsageByRef(p) : contactUsageByRef(p, kind),
      p.hostingGroup.findMany({ orderBy: { createdAt: 'desc' }, take: 300, select: { id: true, name: true, poolBytes: true, owner: { select: { displayName: true } } } }),
      siteAttachmentDefault(p),
    ]);
    const byRef = Object.fromEntries(rows.map((r) => [r.ref, r]));
    const poolList = await Promise.all(pools.map(async (g) => ({ id: g.id, name: g.name, owner: g.owner?.displayName || '', sizeMB: Number(g.poolBytes) / MB, freeMB: Number((await poolRoom(p, g.id)) ?? 0n) / MB })));
    return {
      kind, modes: MODES, attachmentRules: ATTACH, site,
      items: things.map((x) => ({ ...x, settings: serHosting(byRef[x.ref] || { mode: 'inherit', maxItems: 0, maxKB: 0, quotaBytes: 0n, attachments: 'inherit', maxAttachmentMB: 0 }), usage: usage[x.ref] || { count: 0, bytes: 0 } })),
      pools: poolList,
    };
  });

  app.put('/admin/hosting/entities/:kind/:ref', { preHandler: requireCap('manage_hosting') }, async (req, reply) => {
    const b = z.object({
      mode: z.enum(MODES).optional(),
      maxItems: z.number().int().min(0).max(1_000_000).optional(),
      maxKB: z.number().int().min(0).max(100 * 1024 * 1024).optional(),
      poolId: z.string().max(64).nullable().optional(),
      quotaMB: z.number().min(0).max(10 * 1024 * 1024).optional(),
      attachments: z.enum(ATTACH).optional(),
      maxAttachmentMB: z.number().int().min(0).max(100).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const { kind, ref } = req.params;
    if (!KINDS.includes(kind)) return reply.code(400).send({ error: 'invalid_kind' });
    if (String(ref).length > 90) return reply.code(400).send({ error: 'invalid_ref' });
    const p = await db();
    const r = await saveHosting(p, kind, ref, b.data, { actorId: req.user.uid });
    if (r.error) return reply.code(r.error === 'pool_not_found' ? 404 : 409).send(r);
    await logAudit(p, req.user.uid, 'hosting.entity', `kind=${kind} ref=${ref} mode=${r.row.mode}${r.row.poolId ? ` pool=${r.row.poolId}` : ''}`).catch(() => {});
    return { settings: serHosting(await hostingFor(p, kind, ref)) };
  });

  app.get('/admin/hosting/entities/defaults', { preHandler: requireCap('manage_hosting') }, async () => ({ site: await siteAttachmentDefault(await db()) }));
  app.put('/admin/hosting/entities/defaults', { preHandler: requireCap('manage_hosting') }, async (req, reply) => {
    const b = z.object({ attachments: z.enum(['off', 'always', 'pool_only']), maxAttachmentMB: z.number().int().min(1).max(100) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    for (const [key, value] of [['contact.attachments', b.data.attachments], ['contact.maxAttachmentMB', b.data.maxAttachmentMB]]) {
      await p.adminSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    return { site: await siteAttachmentDefault(p) };
  });
}
