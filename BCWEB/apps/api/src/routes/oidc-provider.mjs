import { z } from 'zod';
import crypto from 'node:crypto';
import { db, requireRole } from '../lib.mjs';
import { jwks, issuer } from '../oidc.mjs';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SCOPES = ['openid', 'profile', 'email'];

export default async function oidcProviderRoutes(app) {
  // ── Discovery + JWKS (public; the whole point is that anyone can fetch these) ──
  app.get('/.well-known/openid-configuration', { config: { rateLimit: false } }, async () => {
    const iss = issuer();
    return {
      issuer: iss,
      authorization_endpoint: `${iss}/oauth2/authorize`,
      token_endpoint: `${iss}/oauth2/token`,
      userinfo_endpoint: `${iss}/oauth2/userinfo`,
      jwks_uri: `${iss}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: SCOPES,
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
      code_challenge_methods_supported: ['S256'],
      claims_supported: ['sub', 'name', 'email', 'email_verified', 'picture'],
    };
  });
  app.get('/.well-known/jwks.json', { config: { rateLimit: false } }, async () => jwks());

  // ── Admin: OAuth client registry ──
  app.get('/admin/oauth-clients', { preHandler: requireRole('ADMIN') }, async () => {
    const p = await db();
    const clients = await p.oAuthClient.findMany({ orderBy: { createdAt: 'desc' } });
    // Never return secretHash.
    return { clients: clients.map((c) => ({ id: c.id, name: c.name, confidential: c.confidential, redirectUris: c.redirectUris, scopes: c.scopes, active: c.active, createdAt: c.createdAt })) };
  });

  app.post('/admin/oauth-clients', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      name: z.string().min(1).max(120),
      confidential: z.boolean().optional(),
      redirectUris: z.array(z.string().url()).min(1).max(20),
      scopes: z.array(z.enum(['openid', 'profile', 'email'])).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const d = b.data;
    const confidential = d.confidential !== false; // default confidential
    // A confidential client gets a secret shown ONCE; only its sha256 is stored.
    const secret = confidential ? crypto.randomBytes(32).toString('base64url') : '';
    const p = await db();
    const c = await p.oAuthClient.create({ data: {
      name: d.name, confidential, secretHash: secret ? sha256(secret) : '',
      redirectUris: d.redirectUris, scopes: d.scopes?.length ? d.scopes : SCOPES,
    } });
    return reply.code(201).send({
      client: { id: c.id, name: c.name, confidential: c.confidential, redirectUris: c.redirectUris, scopes: c.scopes, active: c.active },
      clientSecret: secret || null, // shown once, never retrievable again
    });
  });

  app.patch('/admin/oauth-clients/:id', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const b = z.object({
      active: z.boolean().optional(),
      redirectUris: z.array(z.string().url()).min(1).max(20).optional(),
      scopes: z.array(z.enum(['openid', 'profile', 'email'])).optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const data = {};
    for (const k of ['active', 'redirectUris', 'scopes']) if (b.data[k] !== undefined) data[k] = b.data[k];
    if (!Object.keys(data).length) return reply.code(400).send({ error: 'nothing_to_update' });
    const p = await db();
    const c = await p.oAuthClient.update({ where: { id: req.params.id }, data }).catch(() => null);
    if (!c) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // Rotate the secret (returns a new one once). Only for confidential clients.
  app.post('/admin/oauth-clients/:id/rotate', { preHandler: requireRole('ADMIN') }, async (req, reply) => {
    const p = await db();
    const cur = await p.oAuthClient.findUnique({ where: { id: req.params.id } });
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    if (!cur.confidential) return reply.code(400).send({ error: 'public_client' });
    const secret = crypto.randomBytes(32).toString('base64url');
    await p.oAuthClient.update({ where: { id: cur.id }, data: { secretHash: sha256(secret) } });
    return { clientSecret: secret };
  });

  app.delete('/admin/oauth-clients/:id', { preHandler: requireRole('ADMIN') }, async (req) => {
    const p = await db();
    await p.oAuthClient.delete({ where: { id: req.params.id } }).catch(() => {});
    return { ok: true };
  });
}
