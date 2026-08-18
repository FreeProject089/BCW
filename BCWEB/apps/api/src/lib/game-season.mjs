// The 404 game's monthly seasons, and the podium they award.
//
// The leaderboard resets every month. It resets by ASKING for the current month, never by
// deleting: the winners of a season are decided once that season is already over, and a
// board that was wiped at midnight has nothing left to decide from. Old rows also cost
// nothing — one per player per month.
//
// The prize is a promo code, one per podium place, and everything about it is a constraint
// the promo system already enforces:
//
//   · assignedUserIds = [the winner]  — only they can redeem it;
//   · stackable = false               — it cannot be combined with another code;
//   · perUserLimit = 1                — once;
//   · minMonths / minAmountCents      — a 3-month term OR a basket of $10 or more.
//
// The last one is an OR, and it is written in exactly one place (`promoMeetsMinimum`)
// because this repository has already shipped a rule that existed twice and diverged.

/** The season a moment belongs to: "YYYY-MM", UTC. UTC and not local time, so a player in
 *  Auckland and a sweeper in Zurich never disagree about which month a score is in. */
export function seasonOf(date = new Date()) {
    const d = new Date(date);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The season before this one. Handles the January case, which is the one that breaks a
 *  hand-rolled `month - 1`. */
export function previousSeason(season) {
    const [y, m] = String(season).split('-').map(Number);
    if (!y || !m) return season;
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** The first moment AFTER a season, in UTC — i.e. when the board resets.
 *
 *  Derived from the season string rather than from "now", so it is the same answer whether
 *  it is asked on the 1st or the 30th, and it handles December → January without a
 *  hand-rolled `month + 1` rolling over to month 13. */
export function seasonEndsAt(season) {
    const [y, m] = String(season).split('-').map(Number);
    if (!y || !m) return new Date(0);
    return m === 12 ? new Date(Date.UTC(y + 1, 0, 1)) : new Date(Date.UTC(y, m, 1));
}

/** Rank → percent off. First place gets the biggest cut; the shape of the podium is the
 *  whole reason anyone plays for it. */
export const PODIUM = [
    { rank: 1, percentOff: 10 },
    { rank: 2, percentOff: 7 },
    { rank: 3, percentOff: 5 },
];

/** A code has to be worth having and impossible to hoard: it expires.
 *
 *  One month, matching the season that awarded it. Ninety days meant a player could be
 *  holding three seasons' codes at once, which is the opposite of what a monthly board is
 *  for — the prize stops belonging to the month you won it in, and the next month's podium
 *  competes with a stack of unspent codes.
 *
 *  30 days rather than "the end of next month": a winner announced on the 2nd and one
 *  announced on the 27th should get the same amount of time, and a calendar-month expiry
 *  gives one of them four times the other. */
export const AWARD_VALID_DAYS = 30;

/** What a winner's code requires: a 3-month term, OR a basket of $10 or more. */
export const AWARD_MIN_MONTHS = 3;
export const AWARD_MIN_AMOUNT_CENTS = 1000;

/** A code nobody has to transcribe carefully: no O/0, no I/1. */
export function awardCode(season, rank, rand = Math.random) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let tail = '';
    for (let i = 0; i < 5; i++) tail += alphabet[Math.floor(rand() * alphabet.length)];
    return `ORB${season.replace('-', '')}R${rank}${tail}`;
}

/**
 * Award a finished season's podium, once.
 *
 * Idempotent by the database rather than by a flag: `GameAward` is unique on
 * (game, season, rank), so a second run inserts nothing. The sweeper runs on every boot,
 * and "did we already do this month" is not a question worth trusting a timestamp with.
 *
 * The CURRENT season is never awarded — it is not over.
 */
export async function awardSeason(p, { game = 'orbfall', season, now = new Date() } = {}) {
    const target = season || previousSeason(seasonOf(now));
    if (target === seasonOf(now)) return { awarded: [], reason: 'season_not_over' };

    const existing = await p.gameAward.count({ where: { game, season: target } });
    if (existing) return { awarded: [], reason: 'already_awarded' };

    const top = await p.gameScore.findMany({
        where: { game, season: target },
        // Ties break by who got there FIRST, which is the same order the board is drawn in.
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
        take: PODIUM.length,
    });
    if (!top.length) return { awarded: [], reason: 'no_scores' };

    const expiresAt = new Date(now.getTime() + AWARD_VALID_DAYS * 86400_000);
    const awarded = [];
    for (const [i, row] of top.entries()) {
        const { rank, percentOff } = PODIUM[i];
        const code = awardCode(target, rank);
        try {
            await p.promoCode.create({
                data: {
                    code,
                    kind: 'discount',
                    percentOff,
                    minMonths: AWARD_MIN_MONTHS,
                    minAmountCents: AWARD_MIN_AMOUNT_CENTS,
                    perUserLimit: 1,
                    maxRedemptions: 1,
                    stackable: false,
                    // The whole point: this code belongs to one person.
                    assignedUserIds: [row.userId],
                    expiresAt,
                    note: `Orb Fall ${target} — rank ${rank}`,
                },
            });
            await p.gameAward.create({
                data: { game, season: target, rank, userId: row.userId, score: row.score, code, percentOff },
            });
            awarded.push({ rank, userId: row.userId, score: row.score, code, percentOff });
        } catch (e) {
            // A unique violation here means another process awarded this place between the
            // count above and now. That is the race working: stop, do not mint a second code.
            if (String(e?.code) === 'P2002') return { awarded, reason: 'raced' };
            throw e;
        }
    }
    return { awarded, season: target };
}
