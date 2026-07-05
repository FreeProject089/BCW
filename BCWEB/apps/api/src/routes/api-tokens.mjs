// Personal API tokens: a signed-in user manages their own token from the profile
// (view / reset / revoke), then uses it against the token-authed `/v1/*` account
// API. Token endpoints are rate-limited per IP (stricter than the global limit) to
// blunt brute-force enumeration.
import crypto from 'node:crypto';
import { db, requireRole, tokenAuth } from '../lib.mjs';

const genToken = () => 'bmm_' + crypto.randomBytes(30).toString('base64url'); // ~40 chars
const RL = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

export default async function apiTokenRoutes(app) {
  // ── Owner-managed token (session auth) ──────────────────────────────────────
  app.get('/me/api-token', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid }, select: { apiToken: true, apiTokenCreatedAt: true } });
    return { token: u?.apiToken || null, createdAt: u?.apiTokenCreatedAt || null };
  });

  app.post('/me/api-token/reset', { preHandler: requireRole(), ...RL }, async (req) => {
    const p = await db();
    let token; // guard against the (astronomically unlikely) unique collision
    for (let i = 0; i < 5; i++) { token = genToken(); if (!(await p.user.findUnique({ where: { apiToken: token } }))) break; }
    await p.user.update({ where: { id: req.user.uid }, data: { apiToken: token, apiTokenCreatedAt: new Date() } });
    return { token, createdAt: new Date() };
  });

  app.delete('/me/api-token', { preHandler: requireRole() }, async (req, reply) => {
    const p = await db();
    await p.user.update({ where: { id: req.user.uid }, data: { apiToken: null, apiTokenCreatedAt: null } });
    return reply.code(204).send();
  });

  // ── Token-authed account API (`/v1/*`) ──────────────────────────────────────
  app.get('/v1/me', { preHandler: tokenAuth(), ...RL }, async (req) => {
    const p = await db();
    const u = await p.user.findUnique({ where: { id: req.user.uid }, select: { id: true, email: true, displayName: true, role: true, bio: true, createdAt: true } });
    return { user: u };
  });

  app.get('/v1/me/repos', { preHandler: tokenAuth(), ...RL }, async (req) => {
    const p = await db();
    const repos = await p.serverRepo.findMany({ where: { ownerId: req.user.uid }, select: { id: true, name: true, status: true, createdAt: true } }).catch(() => []);
    return { repos };
  });

  // Small self-service account edit over the token API.
  app.patch('/v1/me', { preHandler: tokenAuth(), ...RL }, async (req, reply) => {
    const b = req.body || {};
    const data = {};
    if (typeof b.displayName === 'string' && b.displayName.trim().length >= 2 && b.displayName.length <= 60) data.displayName = b.displayName.trim();
    if (typeof b.bio === 'string' && b.bio.length <= 500) data.bio = b.bio;
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'nothing_to_update' });
    const p = await db();
    const u = await p.user.update({ where: { id: req.user.uid }, data, select: { id: true, displayName: true, bio: true } });
    return { user: u };
  });
}
