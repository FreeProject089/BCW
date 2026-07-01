import { z } from 'zod';
import argon2 from 'argon2';
import { db, issueSession, clearSession, requireRole } from '../lib.mjs';

const creds = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  displayName: z.string().min(2).max(40).optional(),
});

export default async function authRoutes(app) {
  app.post('/auth/register', async (req, reply) => {
    const parsed = creds.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const { email, password, displayName } = parsed.data;
    const p = await db();
    if (await p.user.findUnique({ where: { email } })) return reply.code(409).send({ error: 'email_taken' });
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await p.user.create({ data: { email, passwordHash, displayName: displayName || email.split('@')[0] } });
    return issueSession(reply, user);
  });

  app.post('/auth/login', async (req, reply) => {
    const parsed = creds.pick({ email: true, password: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const user = await p.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || !(await argon2.verify(user.passwordHash, parsed.data.password))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    return issueSession(reply, user);
  });

  app.post('/auth/logout', async (_req, reply) => { clearSession(reply); return { ok: true }; });

  const profileSelect = { id: true, email: true, displayName: true, role: true, emailVerified: true, bio: true, avatar: true, createdAt: true };

  app.get('/me', { preHandler: requireRole() }, async (req) => {
    const p = await db();
    const user = await p.user.findUnique({ where: { id: req.user.uid }, select: profileSelect });
    return { user };
  });

  // Update profile (display name, bio, avatar).
  app.patch('/me', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({
      displayName: z.string().min(2).max(40).optional(),
      bio: z.string().max(280).optional(),
      avatar: z.object({ variant: z.string().max(20), seed: z.string().max(60) }).nullable().optional(),
    }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const user = await p.user.update({ where: { id: req.user.uid }, data: b.data, select: profileSelect });
    return { user };
  });

  // Change password.
  app.post('/me/password', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ current: z.string(), next: z.string().min(8).max(200) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_input' });
    const p = await db();
    const user = await p.user.findUnique({ where: { id: req.user.uid } });
    if (!user || !(await argon2.verify(user.passwordHash, b.data.current))) return reply.code(401).send({ error: 'wrong_password' });
    await p.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(b.data.next, { type: argon2.argon2id }) } });
    return { ok: true };
  });
}
