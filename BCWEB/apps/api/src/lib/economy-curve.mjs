// The levelling curve, in one place. Read by the bot routes (accrual, grants), the site's
// /me/economy and the public /v1/economy — three readers of one formula, which is why it is
// not three copies of it.
//
// The cost to go from level k to k+1 is base·factor^k, so reaching level L costs
// base·(factor^L−1)/(factor−1) — the exact curve the admin preview draws. Higher factor = each
// level is harder.

/** The level a cumulative XP total maps to. */
export const economyLevelFor = (xp, base, factor) => {
  base = Number(base) || 100; factor = Number(factor) || 1.18; xp = Math.max(0, Number(xp) || 0);
  let lvl = 0, cum = 0;
  while (lvl < 100000) { const step = base * factor ** lvl; if (cum + step > xp) break; cum += step; lvl++; }
  return lvl;
};

/** The cumulative XP needed to reach `lvl`. */
export const economyXpForLevel = (lvl, base, factor) => {
  base = Number(base) || 100; factor = Number(factor) || 1.18;
  return Math.round(base * ((factor ** lvl - 1) / (factor - 1)));
};

/** Total points a member has EARNED by reaching a level (floored to the grant interval). The
 *  spendable balance adds the delta of this on level-up, so points are never double-granted. */
export const economyPointsEarned = (level, everyN, perGrant) => Math.floor(Math.max(0, level) / Math.max(1, Number(everyN) || 5)) * (Number(perGrant) || 0);

/** The level/XP/points view of one economy row, with the configured currency and rates. */
export function economyView(e, eco) {
  const level = e?.level || 0;
  const xp = e?.xp || 0;
  return {
    enabled: !!eco?.enabled,
    currency: { name: eco?.currencyName || 'points', emoji: eco?.currencyEmoji || '', image: eco?.currencyImage || '' },
    level, xp, points: e?.points || 0,
    xpThisLevel: xp - economyXpForLevel(level, eco?.curveBase, eco?.curveFactor),
    xpForNext: economyXpForLevel(level + 1, eco?.curveBase, eco?.curveFactor) - economyXpForLevel(level, eco?.curveBase, eco?.curveFactor),
    stats: { voiceSeconds: e?.voiceSeconds || 0, messages: e?.messages || 0, reactions: e?.reactions || 0, public: e?.statsPublic ?? (eco?.statsPublic !== false) },
    rates: { message: Number(eco?.xpPerMessage ?? 5), reaction: Number(eco?.xpPerReaction ?? 1), voiceMinute: Number(eco?.xpPerVoiceMinute ?? 3) },
  };
}
