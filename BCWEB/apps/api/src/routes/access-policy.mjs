import { z } from 'zod';
import { db, requireRole, accountEntrySchema, getGlobalAccessPolicy, getUserAccessPolicy, logAudit } from '../lib.mjs';

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip;
}

const policySchema = z.object({
  whitelistOnly: z.boolean().optional(),
  whitelistIps: z.array(z.string().max(64)).max(5000).optional(),
  whitelistKeys: z.array(z.string().max(128)).max(5000).optional(),
  whitelistAccounts: z.array(accountEntrySchema).max(5000).optional(),
  bannedIps: z.array(z.string().max(64)).max(20000).optional(),
  bannedKeys: z.array(z.string().max(128)).max(20000).optional(),
  bannedAccounts: z.array(accountEntrySchema).max(20000).optional(),
});

// Site-wide whitelist/blacklist applied identically to every hosted repo (see the
// GlobalAccessPolicy model + hosting-content.mjs's sandboxGate for the enforcement
// side). Restricted to SUPERADMIN — it lives under the "Roles & access" tab, which
// is itself SUPERADMIN-only.
export default async function accessPolicyRoutes(app) {
  app.get('/admin/access-policy', { preHandler: requireRole('SUPERADMIN') }, async () => {
    const p = await db();
    return { policy: await getGlobalAccessPolicy(p) };
  });

  app.put('/admin/access-policy', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const b = policySchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cur = await getGlobalAccessPolicy(p);
    const next = { ...cur, ...b.data };
    delete next.id;
    delete next.updatedAt;
    const out = await p.globalAccessPolicy.upsert({ where: { id: 'global' }, create: { id: 'global', ...next }, update: next });
    await logAudit(p, req.user.uid, 'access-policy.global_update', '', clientIp(req));
    return { policy: out };
  });

  // Owner-scoped equivalent: applies only to THIS user's own hosted repos, on top
  // of both each repo's own settings and the site-wide policy above.
  app.get('/me/access-policy', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    return { policy: await getUserAccessPolicy(p, req.user.uid) };
  });

  app.put('/me/access-policy', { preHandler: requireRole() }, async (req, reply) => {
    const b = policySchema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const cur = await getUserAccessPolicy(p, req.user.uid);
    const next = { ...cur, ...b.data };
    delete next.userId;
    delete next.updatedAt;
    const out = await p.userAccessPolicy.upsert({ where: { userId: req.user.uid }, create: { userId: req.user.uid, ...next }, update: next });
    return { policy: out };
  });
}
