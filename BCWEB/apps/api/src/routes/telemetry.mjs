import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { db, requireRole, logAudit } from '../lib.mjs';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
const ADMIN_TIER = ['MOD', 'ADMIN', 'SUPERADMIN'];

// Gate the (separate) BMM telemetry dashboard behind a BCWEB login + an explicit
// `canViewTelemetry` grant, WITHOUT modifying the telemetry app: Caddy's forward_auth
// hits GET /api/telemetry/authorize before proxying telemetry.<domain>. A 2xx lets the
// request through; anything else is returned to the browser (we 302 to /auth so an
// unauthenticated visitor lands on the login page instead of a bare 401).
//
// Cross-subdomain note: the bcw_session cookie must reach the telemetry subdomain, so
// set COOKIE_DOMAIN=.your-domain in production (see issueSession in lib.mjs).
export default async function telemetryRoutes(app) {
  app.get('/telemetry/authorize', async (req, reply) => {
    const site = process.env.SITE_URL || '';
    const deny = () => reply.code(302).header('Location', `${site}/auth?next=telemetry`).header('Cache-Control', 'no-store').send();
    let claims;
    try { claims = jwt.verify(req.cookies?.bcw_session, JWT_SECRET); } catch { return deny(); }
    const p = await db();
    const u = await p.user.findUnique({ where: { id: claims.uid }, select: { role: true, canViewTelemetry: true } }).catch(() => null);
    if (!u) return deny();
    const allowed = u.role === 'SUPERADMIN' || (u.canViewTelemetry && ADMIN_TIER.includes(u.role));
    // 403 (not a redirect) for a signed-in but unauthorized user — they don't need to
    // re-login, they need the grant; a redirect loop to /auth would just bounce them.
    if (!allowed) return reply.code(403).header('Cache-Control', 'no-store').type('text/plain').send('Forbidden — you do not have BMM telemetry access. Ask a SUPERADMIN to grant it.');
    return reply.code(204).header('Cache-Control', 'no-store').send();
  });

  // SUPERADMIN: who can view telemetry.
  app.get('/admin/telemetry-access/users', { preHandler: requireRole('SUPERADMIN') }, async () => {
    const p = await db();
    const users = await p.user.findMany({ where: { canViewTelemetry: true }, select: { id: true, displayName: true, email: true, role: true } });
    return { users };
  });

  app.put('/admin/telemetry-access/:userId', { preHandler: requireRole('SUPERADMIN') }, async (req, reply) => {
    const b = z.object({ granted: z.boolean() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const target = await p.user.update({ where: { id: req.params.userId }, data: { canViewTelemetry: b.data.granted } }).catch(() => null);
    if (!target) return reply.code(404).send({ error: 'not_found' });
    await logAudit(p, req.user.uid, 'telemetry-access.grant', `${b.data.granted ? 'Granted' : 'Revoked'} telemetry access for ${target.displayName}`);
    return { ok: true };
  });
}
