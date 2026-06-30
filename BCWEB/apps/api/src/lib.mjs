// Shared helpers: Prisma singleton, JWT sessions, role guards, slugify.
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';

let _prisma = null;
export async function db() {
  if (!_prisma) {
    const { PrismaClient } = await import('@prisma/client');
    _prisma = new PrismaClient();
  }
  return _prisma;
}

export function issueSession(reply, user) {
  const token = jwt.sign({ uid: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  reply.setCookie('bcw_session', token, {
    httpOnly: true, sameSite: 'lax', path: '/',
    secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 3600,
  });
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

export function clearSession(reply) {
  reply.clearCookie('bcw_session', { path: '/' });
}

/** Auth guard. requireRole() = any logged-in user; requireRole('ADMIN','MOD') = those roles. */
export function requireRole(...roles) {
  return async (req, reply) => {
    try {
      const claims = jwt.verify(req.cookies?.bcw_session, JWT_SECRET);
      if (roles.length && !roles.includes(claims.role)) return reply.code(403).send({ error: 'forbidden' });
      req.user = claims; // { uid, role }
    } catch { return reply.code(401).send({ error: 'unauthenticated' }); }
  };
}

export function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

/** Persist a notification (used by moderation to tell the owner). */
export async function notify(p, userId, kind, body) {
  try { await p.notification.create({ data: { userId, kind, body } }); } catch { /* non-fatal */ }
}
