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

/**
 * A member just linked: fold what they earned while unlinked (DiscordEconomy) into their
 * account's economy, then drop the shadow row. XP and activity add up; the level is recomputed
 * from the summed XP on the CURRENT curve; points add up (they were granted on the same level
 * rule while unlinked). Idempotent: a second call finds no shadow and does nothing.
 */
export async function mergeShadowEconomy(p, discordId, userId, eco = {}) {
  const shadow = await p.discordEconomy.findUnique({ where: { discordId } }).catch(() => null);
  if (!shadow || !userId) return null;
  const cur = await p.userEconomy.findUnique({ where: { userId } });
  const xp = (cur?.xp || 0) + shadow.xp;
  const level = economyLevelFor(xp, eco.curveBase, eco.curveFactor);
  const data = {
    xp, level,
    points: (cur?.points || 0) + shadow.points,
    messages: (cur?.messages || 0) + shadow.messages,
    reactions: (cur?.reactions || 0) + shadow.reactions,
    voiceSeconds: (cur?.voiceSeconds || 0) + shadow.voiceSeconds,
  };
  await p.userEconomy.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  await p.discordEconomy.delete({ where: { discordId } }).catch(() => {});
  return { merged: true, xp: shadow.xp, points: shadow.points, level };
}
