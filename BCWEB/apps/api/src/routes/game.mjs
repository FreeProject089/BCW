// 404-page mini-game leaderboard. Submitting a score needs a signed-in account (keeps the
// user's BEST per game); the leaderboard itself is public (display names/avatars are already
// public). Scores are bounded so a tampered client can't store absurd values.
//
// The board runs in monthly SEASONS: a score belongs to the month it was set in, the board
// shows the current month, and a finished month awards a podium (see lib/game-season.mjs).
// Nothing is deleted at the turn of the month — the winners are decided after it ends, and a
// wiped board has nothing left to decide from.
import { z } from 'zod';
import { db, requireRole, optionalAuth } from '../lib/lib.mjs';
import { seasonOf, previousSeason, seasonEndsAt, PODIUM, AWARD_MIN_MONTHS, AWARD_MIN_AMOUNT_CENTS, AWARD_VALID_DAYS } from '../lib/game-season.mjs';

/** Names and avatars for a set of ids, in one query. */
async function usersById(p, ids) {
  if (!ids.length) return new Map();
  const users = await p.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, displayName: true, avatar: true },
  });
  return new Map(users.map((u) => [u.id, u]));
}

export default async function gameRoutes(app) {
  app.post('/game/score', { preHandler: requireRole() }, async (req, reply) => {
    const b = z.object({ game: z.string().max(30).default('orbfall'), score: z.number().int().min(0).max(1_000_000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid' });
    const p = await db();
    const season = seasonOf();
    const key = { userId_game_season: { userId: req.user.uid, game: b.data.game, season } };
    const existing = await p.gameScore.findUnique({ where: key });
    if (existing && existing.score >= b.data.score) return { ok: true, best: existing.score, improved: false, season };
    const row = await p.gameScore.upsert({
      where: key,
      create: { userId: req.user.uid, game: b.data.game, season, score: b.data.score },
      update: { score: b.data.score },
    });
    return { ok: true, best: row.score, improved: true, season };
  });

  app.get('/game/leaderboard', async (req) => {
    const game = String(req.query?.game || 'orbfall').slice(0, 30);
    // An explicit season is how last month's board stays reachable after the reset — the
    // page links to it beside the winners, and "the board I was on" not existing any more
    // is the one thing a monthly reset must not do.
    const season = String(req.query?.season || seasonOf()).slice(0, 7);
    const p = await db();
    const top = await p.gameScore.findMany({
      where: { game, season },
      orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
      take: 10,
    });
    const byId = await usersById(p, top.map((s) => s.userId));
    return {
      season,
      // What is at stake this month, sent with the board rather than written into the page:
      // the numbers live in one file and the page must not disagree with the codes it mints.
      // The instant this season stops counting: the first moment of the next month, UTC.
      // Sent rather than derived in the page, because the page and the sweeper must agree
      // about which month a score lands in — and the page does not know the sweeper uses UTC.
      endsAt: seasonEndsAt(season).toISOString(),
      prizes: {
        podium: PODIUM,
        minMonths: AWARD_MIN_MONTHS,
        minAmountCents: AWARD_MIN_AMOUNT_CENTS,
        // How long a won code lasts. Same reason as the rest of this block: the page must
        // not print a number the codes are not minted with.
        validDays: AWARD_VALID_DAYS,
      },
      leaderboard: top.map((s, i) => {
        const u = byId.get(s.userId);
        return { rank: i + 1, score: s.score, user: u ? { displayName: u.displayName, avatar: u.avatar } : null };
      }),
    };
  });

  /**
   * Last month's podium.
   *
   * Public, minus the codes: who won is a scoreboard, a code is a bearer secret. The
   * winner's own code is returned only to the winner, and only when they ask signed in —
   * which is also where they will look for it.
   */
  app.get('/game/awards', { preHandler: optionalAuth() }, async (req) => {
    const game = String(req.query?.game || 'orbfall').slice(0, 30);
    const season = String(req.query?.season || previousSeason(seasonOf())).slice(0, 7);
    const p = await db();
    const rows = await p.gameAward.findMany({ where: { game, season }, orderBy: { rank: 'asc' } });
    const byId = await usersById(p, rows.map((r) => r.userId));
    const me = req.user?.uid || null;
    return {
      season,
      awards: rows.map((r) => {
        const u = byId.get(r.userId);
        return {
          rank: r.rank,
          score: r.score,
          percentOff: r.percentOff,
          user: u ? { displayName: u.displayName, avatar: u.avatar } : null,
          mine: r.userId === me,
          // Only ever to its owner.
          code: r.userId === me ? r.code : null,
        };
      }),
    };
  });
}
