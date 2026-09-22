// A giveaway's economy prize (`prizeKind: 'economy'`), as the site shows it before the API has
// seen it. normEconomyReward() / rewardLabel() in apps/api/src/lib/giveaway-reward.mjs, copied:
// the same bounds, the same "500 coins + 200 XP" wording, so the form's preview and placeholder
// read exactly like the name the API gives a prize left unnamed.
export const MAX_REWARD_POINTS = 1_000_000;
export const MAX_REWARD_XP = 10_000_000;

const int = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };

/** `{ points, xp }` with both non-negative integers, or null when it would pay nothing. */
export function normReward(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const points = int(raw.points, MAX_REWARD_POINTS);
  const xp = int(raw.xp, MAX_REWARD_XP);
  return points || xp ? { points, xp } : null;
}

/** "500 coins + 200 XP": the currency is whatever the economy calls one unit. */
export function rewardText(reward, currencyName = 'points') {
  const r = normReward(reward);
  if (!r) return '';
  const parts = [];
  if (r.points) parts.push(`${r.points.toLocaleString('en-US')} ${currencyName || 'points'}`);
  if (r.xp) parts.push(`${r.xp.toLocaleString('en-US')} XP`);
  return parts.join(' + ');
}
