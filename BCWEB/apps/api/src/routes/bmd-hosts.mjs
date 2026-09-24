// The host list of live B.MD blocks (lib/bmd-hosts.mjs says what it is and why it is empty by
// default). Public read, small and cached, like the other /site/* settings: the renderer asks
// once per page load. Written by ADMIN only, audited.
//
// ADMIN, not a capability (apps/web/scripts/capabilities-baseline.json went 104 -> 106 for these
// two routes): the list widens what EVERY author's live blocks may reach, in docs (manage_docs),
// blog posts (per-post BlogPermission) and project pages (manage_projects) alike. Handing it to
// any one of those capabilities would let that author lift the limit on their own content, which
// is the thing the list exists to stop. It is a site security boundary, like the CSP it pairs with.
import { db, requireRole, logAudit } from '../lib/lib.mjs';
import { KEY, readHosts, parseHosts } from '../lib/bmd-hosts.mjs';

export default async function bmdHostRoutes(app) {
  const read = async () => {
    const p = await db();
    const row = await p.adminSetting.findUnique({ where: { key: KEY } }).catch(() => null);
    return { hosts: readHosts(row?.value) };
  };

  app.get('/site/bmd-hosts', async (req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return read();
  });

  app.get('/admin/bmd-hosts', { preHandler: requireRole('ADMIN') }, async () => read());

  // Replaced whole.
  app.put('/admin/bmd-hosts', { preHandler: requireRole('ADMIN'), config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const r = parseHosts(req.body);
    if (!r.ok) return reply.code(400).send({ error: r.error, ...(r.index != null ? { index: r.index } : {}) });
    const value = { hosts: r.hosts, updatedAt: new Date().toISOString() };
    const p = await db();
    await p.adminSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
    await logAudit(p, req.user.uid, 'site.bmd-hosts', `hosts=${r.hosts.length}`);
    return { hosts: r.hosts };
  });
}
