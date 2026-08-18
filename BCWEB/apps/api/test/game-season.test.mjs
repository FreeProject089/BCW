// Monthly seasons on the 404 leaderboard, and the podium they award.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { seasonOf, previousSeason, awardCode, awardSeason, PODIUM, AWARD_MIN_MONTHS, AWARD_MIN_AMOUNT_CENTS } from '../src/lib/game-season.mjs';
import { promoMeetsMinimum } from '../src/lib/promo-rules.mjs';

describe('seasons', () => {
    test('a season is the UTC month', () => {
        assert.equal(seasonOf(new Date('2026-08-18T12:00:00Z')), '2026-08');
        assert.equal(seasonOf(new Date('2026-01-01T00:00:00Z')), '2026-01');
    });

    test('the last minute of a month is still that month, in UTC', () => {
        // A player in Auckland is already in September when this fires; the sweeper in
        // Zurich is not. Only one of them can be right about which board the score is on.
        assert.equal(seasonOf(new Date('2026-08-31T23:59:59Z')), '2026-08');
        assert.equal(seasonOf(new Date('2026-09-01T00:00:00Z')), '2026-09');
    });

    test('the previous season crosses the year', () => {
        assert.equal(previousSeason('2026-08'), '2026-07');
        assert.equal(previousSeason('2026-01'), '2025-12');
        assert.equal(previousSeason('2026-10'), '2026-09');
    });
});

describe('the code', () => {
    test('carries no character anybody would mistype', () => {
        // Only the RANDOM tail: the season and rank in the middle are digits by nature.
        const code = awardCode('2026-07', 1, () => 0.999);
        assert.ok(!/[O0I1]/.test(code.slice(-5)), code);
        assert.match(code, /^ORB202607R1[A-Z2-9]{5}$/);
    });

    test('says which season and which place it came from', () => {
        assert.ok(awardCode('2026-07', 2).startsWith('ORB202607R2'));
    });
});

describe('promoMeetsMinimum', () => {
    const winner = { minMonths: AWARD_MIN_MONTHS, minAmountCents: AWARD_MIN_AMOUNT_CENTS };

    test('no minimum, nothing to satisfy', () => {
        assert.equal(promoMeetsMinimum({}, { months: 1, subtotalCents: 100 }).ok, true);
    });

    test('THE ONE: with both set, EITHER satisfies it', () => {
        // Read as an AND, a winner's code would be unusable on exactly the purchase it was
        // meant to sweeten — a one-month plan bought outright.
        assert.equal(promoMeetsMinimum(winner, { months: 3, subtotalCents: 300 }).ok, true, 'a long term alone');
        assert.equal(promoMeetsMinimum(winner, { months: 1, subtotalCents: 1000 }).ok, true, 'a big enough basket alone');
        assert.equal(promoMeetsMinimum(winner, { months: 6, subtotalCents: 5000 }).ok, true, 'both');
        assert.equal(promoMeetsMinimum(winner, { months: 2, subtotalCents: 999 }).ok, false, 'neither');
    });

    test('one condition alone still gates on its own', () => {
        assert.equal(promoMeetsMinimum({ minMonths: 12 }, { months: 6, subtotalCents: 99999 }).ok, false);
        assert.equal(promoMeetsMinimum({ minAmountCents: 5000 }, { months: 99, subtotalCents: 100 }).ok, false);
    });

    test('a refusal says what would have been enough', () => {
        const r = promoMeetsMinimum(winner, { months: 1, subtotalCents: 100 });
        assert.equal(r.minMonths, 3);
        assert.equal(r.minAmountCents, 1000);
    });
});

/** A stand-in for the two tables awardSeason touches, so the decision is tested without a
 *  database. Every constraint it relies on is asserted below, including the unique one. */
function fakeDb(scores) {
    const awards = [];
    const promos = [];
    return {
        awards, promos,
        gameAward: {
            count: async ({ where }) => awards.filter((a) => a.game === where.game && a.season === where.season).length,
            create: async ({ data }) => {
                if (awards.some((a) => a.game === data.game && a.season === data.season && a.rank === data.rank)) {
                    const e = new Error('unique'); e.code = 'P2002'; throw e;
                }
                awards.push(data); return data;
            },
        },
        gameScore: {
            findMany: async ({ where, take }) => scores
                .filter((s) => s.game === where.game && s.season === where.season)
                .sort((a, b) => b.score - a.score || a.updatedAt - b.updatedAt)
                .slice(0, take),
        },
        promoCode: { create: async ({ data }) => { promos.push(data); return data; } },
    };
}

describe('awarding a season', () => {
    const now = new Date('2026-08-05T10:00:00Z');
    const scores = [
        { game: 'orbfall', season: '2026-07', userId: 'u1', score: 90, updatedAt: 3 },
        { game: 'orbfall', season: '2026-07', userId: 'u2', score: 90, updatedAt: 1 },
        { game: 'orbfall', season: '2026-07', userId: 'u3', score: 40, updatedAt: 2 },
        { game: 'orbfall', season: '2026-07', userId: 'u4', score: 10, updatedAt: 4 },
        { game: 'orbfall', season: '2026-08', userId: 'u5', score: 999, updatedAt: 5 },
    ];

    test('the podium is the top three of the FINISHED month', async () => {
        const p = fakeDb(scores);
        const r = await awardSeason(p, { now });
        assert.equal(r.season, '2026-07');
        assert.deepEqual(r.awarded.map((a) => a.userId), ['u2', 'u1', 'u3']);
        // u2 and u1 tie on 90; the one who got there first takes the higher place, which is
        // the order the board itself is drawn in.
        assert.deepEqual(r.awarded.map((a) => a.percentOff), PODIUM.map((x) => x.percentOff));
        // u5's 999 is this month's business and must not win last month.
        assert.ok(!r.awarded.some((a) => a.userId === 'u5'));
    });

    test("the codes belong to their winner and cannot be stacked", async () => {
        const p = fakeDb(scores);
        await awardSeason(p, { now });
        for (const promo of p.promos) {
            assert.equal(promo.assignedUserIds.length, 1);
            assert.equal(promo.stackable, false);
            assert.equal(promo.perUserLimit, 1);
            assert.equal(promo.maxRedemptions, 1);
            assert.equal(promo.minMonths, AWARD_MIN_MONTHS);
            assert.equal(promo.minAmountCents, AWARD_MIN_AMOUNT_CENTS);
            assert.ok(promo.expiresAt > now);
        }
    });

    test('THE ONE: running it again mints nothing', async () => {
        // The sweeper runs at boot and every ten minutes. A second code per winner per month
        // is money, and "have we done this yet" is not a question to trust a timestamp with.
        const p = fakeDb(scores);
        await awardSeason(p, { now });
        const after = p.promos.length;
        const again = await awardSeason(p, { now });
        assert.equal(again.awarded.length, 0);
        assert.equal(again.reason, 'already_awarded');
        assert.equal(p.promos.length, after);
    });

    test('the current season is never awarded', async () => {
        const p = fakeDb(scores);
        const r = await awardSeason(p, { season: '2026-08', now });
        assert.equal(r.reason, 'season_not_over');
        assert.equal(p.promos.length, 0);
    });

    test('a month nobody played awards nothing', async () => {
        const p = fakeDb([]);
        const r = await awardSeason(p, { now });
        assert.equal(r.reason, 'no_scores');
        assert.equal(p.promos.length, 0);
    });

    test('fewer than three players award only the places that exist', async () => {
        const p = fakeDb([{ game: 'orbfall', season: '2026-07', userId: 'u1', score: 5, updatedAt: 1 }]);
        const r = await awardSeason(p, { now });
        assert.equal(r.awarded.length, 1);
        assert.equal(r.awarded[0].percentOff, 10);
    });
});
