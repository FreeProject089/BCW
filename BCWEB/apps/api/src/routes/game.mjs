// 404-page mini-game leaderboard. Submitting a score needs a signed-in account (keeps the
// user's BEST per game); the leaderboard itself is public (display names/avatars are already
// public). Scores are bounded so a tampered client can't store absurd values.
import { z } from 'zod';
import { db, requireRole } from '../lib/lib.mjs';

export default async function gameRoutes(app) {
  app.post('/game/score', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ game: z.string().max(30).default('orbfall'), score: z.number().int().min(0).max(1_000_000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const p = await db();
    const key = { userId_game: { userId: req.user.uid, game: b.data.game } };
    const existing = await p.gameScore.findUnique({ where: key });
    if (existing && existing.score >= b.data.score) return { ok: true, best: existing.score, improved: false };
    const row = await p.gameScore.upsert({ where: key, create: { userId: req.user.uid, game: b.data.game, score: b.data.score }, update: { score: b.data.score } });
    return { ok: true, best: row.score, improved: true };
  });

  app.get('/game/leaderboard', async (req) => {
    const game = String(req.query?.game || 'orbfall').slice(0, 30);
    const p = await db();
    const top = await p.gameScore.findMany({ where: { game }, orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }], take: 10 });
    const users = top.length ? await p.user.findMany({ where: { id: { in: top.map((s) => s.userId) } }, select: { id: true, displayName: true, avatar: true } }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return { leaderboard: top.map((s, i) => { const u = byId.get(s.userId); return { rank: i + 1, score: s.score, user: u ? { displayName: u.displayName, avatar: u.avatar } : null }; }) };
  });
}
