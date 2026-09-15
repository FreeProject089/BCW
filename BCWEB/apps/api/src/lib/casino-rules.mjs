// The casino's arithmetic, in one place, with no database in it.
//
// Three things the route used to decide inline, and one of them wrongly:
//
//   · the bet limits — `Number(cfg.maxBet) || 100` turned an admin's 0 into 100. Zero means
//     "no cap" everywhere else in this config (gifts.maxPerDay, historyDays), and an admin who
//     typed it got a silent 100 instead. It means no cap here too now, and the bot says so.
//   · the house edge — one number for every game. A coin flip at 2× and a plinko bucket at 50×
//     do not want the same tax, so each game may carry its own percentage and falls back to
//     the global one when it does not.
//   · the payout — the edge taxes the PROFIT of a winning play, never the stake (a 1× bucket
//     returns the bet to the point; a 0.3× bucket returns 30 % of it). Unchanged, but now it
//     is a function the multiplayer settlement and the admin's RTP table call as well, instead
//     of three copies that could drift.
//
// The two new games' randomness lives here too — as PURE functions of a uniform draw — so the
// distributions can be tested for their return without a single roll: `crashPoint(u)` maps a
// uniform u to a crash multiplier with the edge built into the curve, and `potWinner` picks a
// player with probability proportional to their stake.

export const CASINO_GAMES = ['coinflip', 'dice', 'slots', 'roulette', 'wheel', 'plinko', 'crash', 'race', 'pot'];

/** min/max for a bet. `max` is Infinity when the admin set 0 — "no cap". */
export function betLimits(casino = {}) {
  const min = Math.max(1, Math.floor(Number(casino.minBet) || 1));
  const rawMax = Number(casino.maxBet);
  const max = Number.isFinite(rawMax) && rawMax > 0 ? Math.max(min, Math.floor(rawMax)) : Infinity;
  return { min, max };
}

/** The house edge for a game, in percent (0–100). Per-game override, else the global. */
export function edgePctFor(casino = {}, game = '') {
  const per = casino.edgeByGame && casino.edgeByGame[game];
  const v = per !== '' && per != null && Number.isFinite(Number(per)) ? Number(per) : Number(casino.houseEdgePct);
  return Math.min(100, Math.max(0, Number.isFinite(v) ? v : 0));
}

/**
 * What a play pays back, in points, for a bet and the multiplier it landed on.
 * The edge taxes the profit of a win and nothing else. Never negative, always integral.
 */
export function payoutFor(bet, multiplier, edgePct) {
  const b = Math.max(0, Math.round(Number(bet) || 0));
  const m = Math.max(0, Number(multiplier) || 0);
  const keep = 1 - Math.min(100, Math.max(0, Number(edgePct) || 0)) / 100;
  return Math.max(0, Math.round(m >= 1 ? b + (b * m - b) * keep : b * m));
}

/**
 * CRASH. A multiplier climbs from 1.00× and stops somewhere; whoever cashed out before it
 * stopped keeps their multiplier, everyone else loses the stake.
 *
 * The stopping point is drawn from the classic curve `(1 − e) / (1 − u)`, floored to a cent:
 * with u uniform on [0, 1) the probability that the round reaches at least M is (1 − e) / M,
 * so a player who always cashes at M wins (1 − e)/M of the time and is paid M — an expected
 * return of exactly 1 − e, whatever M they choose. The edge is IN the curve, which is why the
 * settlement passes crash multipliers through with no second tax (see `edgeApplied`). A
 * fraction `instant` of rounds crash at 1.00× outright — the one everyone remembers.
 */
export function crashPoint(u, edgePct, { instant = 0.01 } = {}) {
  const e = Math.min(0.99, Math.max(0, (Number(edgePct) || 0) / 100));
  const x = Math.min(0.999999, Math.max(0, Number(u) || 0));
  if (x < instant) return 1;
  const m = (1 - e) / (1 - x);
  return Math.max(1, Math.floor(m * 100) / 100);
}

/** Games whose multiplier already carries the edge, so settlement must not tax them again. */
export const edgeApplied = (game) => game === 'crash';

/**
 * POT. Everyone stakes what they like; one player takes it all, drawn with probability
 * proportional to stake — the whole pitch is "the more you put in, the likelier you win",
 * and this is that sentence as arithmetic. Returns the winner's index, or -1 for no entries.
 */
export function potWinner(entries, u) {
  const stakes = (entries || []).map((e) => Math.max(0, Math.round(Number(e?.bet) || 0)));
  const total = stakes.reduce((a, b) => a + b, 0);
  if (!total) return -1;
  let r = Math.min(0.999999, Math.max(0, Number(u) || 0)) * total;
  for (let i = 0; i < stakes.length; i++) { if (r < stakes[i]) return i; r -= stakes[i]; }
  return stakes.length - 1;
}

/**
 * The multiplier the pot winner receives on THEIR stake: pot ÷ stake. Informational (the
 * admin's RTP table): the live pot is settled by `splitPot`, which pays the whole table's
 * stakes to the winner with NO edge — see the zero-loss rule below.
 */
export function potMultiplier(entries, winnerIdx) {
  const stakes = (entries || []).map((e) => Math.max(0, Math.round(Number(e?.bet) || 0)));
  const total = stakes.reduce((a, b) => a + b, 0);
  const mine = stakes[winnerIdx] || 0;
  return mine > 0 ? total / mine : 0;
}

/**
 * RACE. Six cars, one winner, drawn uniformly — the odds are the same for every car and the
 * payout for picking the right one is 6× before the edge. A multiplayer race is the same
 * draw with every player's own pick settled against the house.
 */
export const RACE_CARS = 6;
export const RACE_MULTIPLIER = 6;
export function raceWinner(u) {
  return Math.min(RACE_CARS - 1, Math.floor(Math.min(0.999999, Math.max(0, Number(u) || 0)) * RACE_CARS));
}

/**
 * A table settled between its players — the ZERO-LOSS rule.
 *
 * `plays` carry each seat's stake and a WIN WEIGHT: 0 for a loser, anything > 0 for a winner
 * (the game's multiplier is passed for the ledger line, but it does not change a share). The
 * losers' stakes form the pot. Each winner keeps their own stake and takes a share of the pot
 * in proportion to their stake; the house takes NOTHING from a multiplayer table — the sum
 * paid out equals the sum staked, to the point (the rounding remainder goes one point at a
 * time to the winners with the largest fractional share, so nothing is lost to flooring).
 * With no winner every seat gets its stake back (`refund: true`, multiplier 1): the house
 * never keeps a pot.
 *
 * Returns the plays with `multiplier` rewritten as payout ÷ stake, so the ordinary settlement
 * can pay them with payoutFor(bet, multiplier, 0) — no edge, because none applies here.
 * `edgePct` is accepted for call-compatibility and ignored: a multiplayer pot is untaxed.
 */
export function splitPot(plays, _edgePct = 0) {
  const list = (plays || []).map((p) => ({ ...p, bet: Math.max(0, Math.round(Number(p.bet) || 0)), multiplier: Math.max(0, Number(p.multiplier) || 0) }));
  const winners = list.filter((p) => p.multiplier > 0 && p.bet > 0);
  const pot = list.filter((p) => !(p.multiplier > 0)).reduce((a, p) => a + p.bet, 0);
  if (!winners.length) return list.map((p) => ({ ...p, multiplier: p.bet > 0 ? 1 : 0, share: 0, pot, refund: true }));
  const weight = winners.reduce((a, p) => a + p.bet, 0);
  // Largest-remainder split: floors first, then the leftover points to the biggest fractions.
  const exact = winners.map((p) => (pot * p.bet) / weight);
  const floors = exact.map((v) => Math.floor(v));
  let left = pot - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; floors[i] += 1; left -= 1; }
  const shareOf = new Map(winners.map((p, i) => [p, floors[i]]));
  return list.map((p) => {
    if (!shareOf.has(p)) return { ...p, multiplier: 0, share: 0, pot, refund: false };
    const share = shareOf.get(p);
    return { ...p, multiplier: (p.bet + share) / p.bet, share, pot, refund: false };
  });
}

/**
 * The whole settlement of a live table as one pure step, so the route and the tests agree.
 *
 * `covered(play)` says whether a seat can still pay its stake (linked, balance ≥ bet). A
 * seat that cannot is reported and left OUT of the pot: its stake never existed, so it is
 * neither won by anybody nor refunded. With `pot` false every seat is settled against the
 * house on its own multiplier with the game's edge (single-seat play, and crash, whose edge
 * is in the curve and arrives with edgePct 0).
 *
 * Returns `{ seats: [{ ...play, payout, delta, skipped? }], pot, refund, winners }` — and the
 * invariant the tests pin: with `pot` true, Σ payout over settled seats == Σ bet over them.
 */
export function settleTable(plays, { pot = false, edgePct = 0, covered = () => true } = {}) {
  const seats = (plays || []).map((p) => ({ ...p, bet: Math.max(0, Math.round(Number(p.bet) || 0)), multiplier: Math.max(0, Number(p.multiplier) || 0) }));
  const live = seats.filter((p) => covered(p));
  const skipped = seats.filter((p) => !covered(p)).map((p) => ({ ...p, skipped: true, payout: 0, delta: 0 }));
  if (!pot) {
    const out = live.map((p) => { const payout = payoutFor(p.bet, p.multiplier, edgePct); return { ...p, payout, delta: payout - p.bet }; });
    return { seats: [...out, ...skipped], pot: null, refund: false, winners: out.filter((p) => p.delta > 0).length };
  }
  const split = splitPot(live);
  const out = split.map((p) => { const payout = payoutFor(p.bet, p.multiplier, 0); return { ...p, payout, delta: payout - p.bet }; });
  const refund = split.length > 0 && split.every((p) => p.refund);
  return { seats: [...out, ...skipped], pot: split[0]?.pot || 0, refund, winners: refund ? 0 : live.filter((p) => p.multiplier > 0 && p.bet > 0).length };
}
