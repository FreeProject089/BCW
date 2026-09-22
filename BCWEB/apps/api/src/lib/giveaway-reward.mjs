// Giveaways that pay out in the economy: points (named with the configured currency) and/or XP.
//
// A giveaway's prize was an inventory item (a promo code, a custom reveal) or nothing. This adds
// `prizeKind: 'economy'`, whose amounts live in `giftConfig` as `{ points, xp }` — the column is
// already Json and only the `promo` kind reads it, so no migration.
//
// Paid through the SAME door as a staff grant: movePoints() (atomic, one EconomyLedger row,
// kind `grant`), with `ref: giveaway:<id>` and `meta.source: 'giveaway'`. So the win shows in
// the member's history, the admin ledger and every statistic that sums grants — there is no
// second "giveaway balance" to reconcile.
//
// Paying twice is prevented twice:
//   1. claimDraw() moves the giveaway active → ended with ONE conditional UPDATE. Only the
//      caller whose update matched a row pays anybody. A retried /drawn, a second bot process,
//      the sweeper racing the bot: each gets count 0 and pays nothing.
//   2. awardEconomyReward() refuses a user who already has a ledger row with this giveaway's
//      ref — the belt to the braces, for any future path that awards outside a fresh claim.
// An UNLINKED Discord winner is credited on their shadow row (DiscordEconomy), which is folded
// into their account when they link — the same place their message XP already waits. That
// credit has no ledger (a ledger row needs a user), so only guard 1 covers it.
import { movePoints } from './economy-shop.mjs';
import { economyLevelFor } from './economy-curve.mjs';

export const MAX_REWARD_POINTS = 1_000_000;
export const MAX_REWARD_XP = 10_000_000;

const int = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };

/** `{ points, xp }` with both non-negative integers, or null when it would pay nothing. */
export function normEconomyReward(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const points = int(raw.points, MAX_REWARD_POINTS);
    const xp = int(raw.xp, MAX_REWARD_XP);
    return points || xp ? { points, xp } : null;
}

/** The reward a giveaway row carries, or null for every other prize kind. */
export const rewardOf = (gw) => (gw?.prizeKind === 'economy' ? normEconomyReward(gw.giftConfig) : null);

/** "500 coins + 200 XP" — the currency is whatever the economy calls one unit. */
export function rewardLabel(reward, currencyName = 'points') {
    if (!reward) return '';
    const parts = [];
    if (reward.points) parts.push(`${reward.points.toLocaleString('en-US')} ${currencyName || 'points'}`);
    if (reward.xp) parts.push(`${reward.xp.toLocaleString('en-US')} XP`);
    return parts.join(' + ');
}

/**
 * Take the draw. True for exactly one caller per giveaway: the conditional update is the lock.
 * `winnerIds` is recorded in the same statement, so the row never says "ended" without them.
 */
export async function claimDraw(p, giveawayId, winnerIds) {
    const r = await p.giveaway.updateMany({ where: { id: giveawayId, status: 'active' }, data: { status: 'ended', winnerIds } });
    return (r?.count || 0) === 1;
}

/**
 * Pay one winner. `userId` for a linked account (ledger + history), else `discordId` for the
 * shadow row. Returns { paid, via: 'account'|'shadow', points, xp, level } or { paid: false, why }.
 * `onLevelUp(userId, { from, level, xp })` lets the route fire its webhook / badge rules, which
 * live beside the routes rather than in this module.
 */
export async function awardEconomyReward(p, eco, { giveaway, userId = null, discordId = null, onLevelUp = null }) {
    const reward = rewardOf(giveaway);
    if (!reward) return { paid: false, why: 'no_reward' };
    const ref = `giveaway:${giveaway.id}`;
    const reason = `Giveaway: ${String(giveaway.prize || '').slice(0, 150)}`;

    if (userId) {
        const already = await p.economyLedger.findFirst({ where: { userId, ref } });
        if (already) return { paid: false, why: 'already_paid' };
        await p.userEconomy.upsert({ where: { userId }, create: { userId }, update: {} });
        let level = null;
        if (reward.xp) {
            // Same rule as a staff grant (POST /admin/economy/grant): XP moves the level on the
            // live curve; no level-up points are minted on top of the prize.
            const cur = await p.userEconomy.findUnique({ where: { userId } });
            const from = cur?.level || 0;
            const xp = (cur?.xp || 0) + reward.xp;
            level = economyLevelFor(xp, eco?.curveBase, eco?.curveFactor);
            await p.userEconomy.update({ where: { userId }, data: { xp: { increment: reward.xp }, level } });
            if (level > from && onLevelUp) await Promise.resolve(onLevelUp(userId, { from, level, xp })).catch(() => {});
        }
        // One ledger row per win, even an XP-only one (delta 0, the XP in meta): the history is
        // where a member looks for "did I get it", and an XP prize is a prize too.
        await movePoints(p, userId, reward.points, {
            kind: 'grant', ref,
            meta: { source: 'giveaway', giveawayId: giveaway.id, reason, xp: reward.xp, points: reward.points, by: 'giveaway' },
        });
        return { paid: true, via: 'account', points: reward.points, xp: reward.xp, level };
    }

    if (discordId) {
        const sh = await p.discordEconomy.findUnique({ where: { discordId } }).catch(() => null);
        const xp = (sh?.xp || 0) + reward.xp;
        const level = economyLevelFor(xp, eco?.curveBase, eco?.curveFactor);
        // Same rule as the account path: the level follows the XP, no level-up points on top.
        const points = (sh?.points || 0) + reward.points;
        await p.discordEconomy.upsert({ where: { discordId }, create: { discordId, xp, level, points }, update: { xp, level, points } });
        return { paid: true, via: 'shadow', points: reward.points, xp: reward.xp, level };
    }
    return { paid: false, why: 'no_target' };
}
