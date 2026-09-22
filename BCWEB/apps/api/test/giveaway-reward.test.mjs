// A giveaway that pays points / XP pays each winner exactly once, through the same ledger a
// staff grant writes — however many times the draw is reported.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normEconomyReward, rewardOf, rewardLabel, claimDraw, awardEconomyReward } from '../src/lib/giveaway-reward.mjs';

// Just enough Prisma for claimDraw + movePoints + the shadow row, in memory.
function fakePrisma(giveaways = []) {
    const gw = new Map(giveaways.map((g) => [g.id, { status: 'active', winnerIds: [], ...g }]));
    const eco = new Map();      // userId → row
    const shadow = new Map();   // discordId → row
    const ledger = [];
    const match = (row, where) => Object.entries(where).every(([k, v]) => {
        if (v && typeof v === 'object' && 'gte' in v) return row[k] >= v.gte;
        return row[k] === v;
    });
    return {
        _: { gw, eco, shadow, ledger },
        giveaway: {
            updateMany: async ({ where, data }) => {
                let count = 0;
                for (const g of gw.values()) if (match(g, where)) { Object.assign(g, data); count++; }
                return { count };
            },
        },
        economyLedger: {
            findFirst: async ({ where }) => ledger.find((r) => match(r, where)) || null,
            create: async ({ data }) => { const r = { id: `l${ledger.length + 1}`, createdAt: new Date(), ...data }; ledger.push(r); return r; },
        },
        userEconomy: {
            upsert: async ({ where, create }) => { if (!eco.has(where.userId)) eco.set(where.userId, { xp: 0, level: 0, points: 0, ...create }); return eco.get(where.userId); },
            findUnique: async ({ where }) => eco.get(where.userId) || null,
            update: async ({ where, data }) => {
                const r = eco.get(where.userId);
                for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === 'object' && 'increment' in v ? r[k] + v.increment : v;
                return r;
            },
            updateMany: async ({ where, data }) => {
                const r = eco.get(where.userId);
                if (!r || (where.points?.gte != null && r.points < where.points.gte)) return { count: 0 };
                for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === 'object' && 'decrement' in v ? r[k] - v.decrement : v;
                return { count: 1 };
            },
        },
        discordEconomy: {
            findUnique: async ({ where }) => shadow.get(where.discordId) || null,
            upsert: async ({ where, create, update }) => { shadow.set(where.discordId, { ...(shadow.get(where.discordId) || create), ...update }); return shadow.get(where.discordId); },
        },
    };
}
const ECO = { curveBase: 100, curveFactor: 1.18, currencyName: 'coins' };
const GW = { id: 'g1', prize: 'Launch party', prizeKind: 'economy', giftConfig: { points: 500, xp: 250 } };

describe('the reward itself', () => {
    test('amounts are positive integers, capped; nothing to pay is null', () => {
        assert.deepEqual(normEconomyReward({ points: '500', xp: 12.7 }), { points: 500, xp: 12 });
        assert.deepEqual(normEconomyReward({ points: -5, xp: 10 }), { points: 0, xp: 10 });
        assert.equal(normEconomyReward({ points: 0, xp: 0 }), null);
        assert.equal(normEconomyReward(null), null);
        assert.equal(normEconomyReward({ points: 1e12 }).points, 1_000_000);
    });
    test('only an economy giveaway carries one — a promo gift config is not points', () => {
        assert.deepEqual(rewardOf(GW), { points: 500, xp: 250 });
        assert.equal(rewardOf({ prizeKind: 'promo', giftConfig: { points: 500 } }), null);
    });
    test('the label names the configured currency', () => {
        assert.equal(rewardLabel({ points: 1500, xp: 250 }, 'coins'), '1,500 coins + 250 XP');
        assert.equal(rewardLabel({ points: 0, xp: 40 }, 'coins'), '40 XP');
    });
});

describe('paid once', () => {
    test('the draw can be taken exactly once: a second report pays nobody', async () => {
        const p = fakePrisma([GW]);
        const first = await claimDraw(p, 'g1', ['111']);
        const second = await claimDraw(p, 'g1', ['222']);
        assert.equal(first, true);
        assert.equal(second, false);
        assert.deepEqual(p._.gw.get('g1').winnerIds, ['111'], 'the retry did not overwrite the winners');
    });

    test('a linked winner is paid through the grant ledger, visible in history', async () => {
        const p = fakePrisma([GW]);
        const r = await awardEconomyReward(p, ECO, { giveaway: GW, userId: 'u1' });
        assert.equal(r.paid, true);
        assert.equal(p._.eco.get('u1').points, 500);
        assert.equal(p._.eco.get('u1').xp, 250);
        assert.equal(p._.eco.get('u1').level, 2, 'XP moves the level on the live curve (100 + 118 ≤ 250)');
        assert.equal(p._.ledger.length, 1);
        const row = p._.ledger[0];
        assert.equal(row.kind, 'grant');
        assert.equal(row.ref, 'giveaway:g1');
        assert.equal(row.delta, 500);
        assert.equal(row.balance, 500);
        assert.equal(row.meta.source, 'giveaway');
        assert.equal(row.meta.xp, 250);
    });

    test('awarding the same winner twice pays once (red against a naive award)', async () => {
        const p = fakePrisma([GW]);
        await awardEconomyReward(p, ECO, { giveaway: GW, userId: 'u1' });
        const again = await awardEconomyReward(p, ECO, { giveaway: GW, userId: 'u1' });
        assert.equal(again.paid, false);
        assert.equal(again.why, 'already_paid');
        assert.equal(p._.eco.get('u1').points, 500);
        assert.equal(p._.eco.get('u1').xp, 250);
        assert.equal(p._.ledger.length, 1);
    });

    test('an XP-only prize still leaves a ledger row (delta 0, XP in meta)', async () => {
        const g = { ...GW, id: 'g2', giftConfig: { xp: 40 } };
        const p = fakePrisma([g]);
        await awardEconomyReward(p, ECO, { giveaway: g, userId: 'u1' });
        assert.equal(p._.ledger[0].delta, 0);
        assert.equal(p._.ledger[0].meta.xp, 40);
        assert.equal(p._.eco.get('u1').points, 0);
    });

    test('an unlinked Discord winner waits on the shadow row the link folds in', async () => {
        const p = fakePrisma([GW]);
        const r = await awardEconomyReward(p, ECO, { giveaway: GW, discordId: '999' });
        assert.equal(r.via, 'shadow');
        assert.deepEqual({ ...p._.shadow.get('999') }, { discordId: '999', xp: 250, level: 2, points: 500 });
        assert.equal(p._.ledger.length, 0);
    });

    test('a level crossed by the prize is reported for the webhook / badge rules', async () => {
        const p = fakePrisma([GW]);
        const seen = [];
        await awardEconomyReward(p, ECO, { giveaway: GW, userId: 'u1', onLevelUp: (uid, e) => seen.push([uid, e.from, e.level]) });
        assert.deepEqual(seen, [['u1', 0, 2]]);
    });

    test('a non-economy giveaway pays nothing', async () => {
        const p = fakePrisma([]);
        const r = await awardEconomyReward(p, ECO, { giveaway: { id: 'g3', prizeKind: 'custom' }, userId: 'u1' });
        assert.equal(r.paid, false);
        assert.equal(p._.ledger.length, 0);
    });
});
