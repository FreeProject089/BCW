import { z } from 'zod';
import { db, requireRole, logAudit, requireCap } from '../lib/lib.mjs';
import { getBanPolicy, setBanPolicy, liveBlocks, liftBlock, banNow } from '../lib/siteban.mjs';

const entry = z.object({ v: z.string().min(1).max(200), note: z.string().max(200).optional().default(''), until: z.string().max(40).nullable().optional() });
const schema = z.object({
  ips: z.array(entry).max(20000).optional(),
  uas: z.array(entry).max(500).optional(),
  creators: z.array(entry).max(20000).optional(),
  shield: z.object({ enabled: z.boolean().optional(), after429: z.number().int().min(0).max(100000).optional(), minutes: z.number().int().min(1).max(10080).optional(), blockNoUA: z.boolean().optional() }).optional(),
});

// Site-wide bans + the automatic shield (lib/siteban.mjs). Admin-only, audited: a ban list
// is the kind of thing whose history matters the day a legitimate customer is in it.
export default async function siteBanRoutes(app) {
  app.get('/admin/security/bans', { preHandler: requireCap('manage_sanctions') }, async () => {
    const p = await db();
    return { policy: await getBanPolicy(p, { fresh: true }), live: liveBlocks() };
  });
  app.put('/admin/security/bans', { preHandler: requireCap('manage_sanctions') }, async (req, reply) => {
    const b = schema.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const policy = await setBanPolicy(p, b.data);
    await logAudit(p, req.user.uid, 'security.bans_update', `${policy.ips.length} ip · ${policy.uas.length} ua · ${policy.creators.length} creator`, req.ip);
    return { policy, live: liveBlocks() };
  });
  app.post('/admin/security/bans/live', { preHandler: requireCap('manage_sanctions') }, async (req, reply) => {
    const ip = String(req.body?.ip || '').trim(); const minutes = Number(req.body?.minutes) || 30;
    if (!ip || ip.length > 64) return reply.code(400).send({ error: 'invalid_input' });
    banNow(ip, minutes, 'manual');
    await logAudit(await db(), req.user.uid, 'security.block_now', ip, req.ip);
    return { ok: true, live: liveBlocks() };
  });
  app.delete('/admin/security/bans/live/:ip', { preHandler: requireCap('manage_sanctions') }, async (req) => {
    liftBlock(req.params.ip);
    await logAudit(await db(), req.user.uid, 'security.block_lift', String(req.params.ip), req.ip);
    return { ok: true, live: liveBlocks() };
  });
}
