// The casino's arithmetic, checked without a roll.
//
// Every game's fairness is a statement about an EXPECTED return, and an expected return is
// an integral over the draw — so the new games are tested by integrating their pure
// functions over a fine grid of the uniform draw rather than by rolling ten thousand times
// and hoping. A crash curve that promised 95 % and paid 97 % would pass a Monte-Carlo test
// nine runs out of ten; it fails this one every time.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { betLimits, edgePctFor, payoutFor, crashPoint, potWinner, potMultiplier, raceWinner, RACE_CARS, RACE_MULTIPLIER, edgeApplied, splitPot, settleTable } from '../src/lib/casino-rules.mjs';

describe('betLimits', () => {
  test('0 means no cap, not 100', () => {
    // The all-in bug. `Number(cfg.maxBet) || 100` turned the admin's zero into a hundred and
    // every "tapis" was silently capped at 100 with no sentence saying so.
    const { min, max } = betLimits({ minBet: 1, maxBet: 0 });
    assert.equal(min, 1);
    assert.equal(max, Infinity);
  });
  test('a real cap is kept, and never below the minimum', () => {
    assert.deepEqual(betLimits({ minBet: 5, maxBet: 100 }), { min: 5, max: 100 });
    assert.deepEqual(betLimits({ minBet: 50, maxBet: 10 }), { min: 50, max: 50 });
  });
  test('junk falls to 1 and no cap', () => {
    assert.deepEqual(betLimits({}), { min: 1, max: Infinity });
    assert.deepEqual(betLimits({ minBet: 'x', maxBet: 'y' }), { min: 1, max: Infinity });
  });
});

describe('edgePctFor', () => {
  test('a per-game percentage wins over the global one', () => {
    const c = { houseEdgePct: 5, edgeByGame: { plinko: 12 } };
    assert.equal(edgePctFor(c, 'plinko'), 12);
    assert.equal(edgePctFor(c, 'coinflip'), 5);
  });
  test('a blank override means "the global", and 0 means zero', () => {
    const c = { houseEdgePct: 5, edgeByGame: { dice: '', wheel: 0 } };
    assert.equal(edgePctFor(c, 'dice'), 5);
    assert.equal(edgePctFor(c, 'wheel'), 0);
  });
  test('clamped to 0–100', () => {
    assert.equal(edgePctFor({ houseEdgePct: 250 }, 'x'), 100);
    assert.equal(edgePctFor({ houseEdgePct: -3 }, 'x'), 0);
  });
});

describe('payoutFor', () => {
  test('the edge taxes the profit, never the stake', () => {
    assert.equal(payoutFor(100, 2, 5), 195);   // 100 + 100·0.95
    assert.equal(payoutFor(100, 1, 5), 100);   // a push returns the bet to the point
    assert.equal(payoutFor(100, 0.3, 5), 30);  // a partial loss is not taxed further
    assert.equal(payoutFor(100, 0, 5), 0);
  });
  test('integral, never negative', () => {
    assert.equal(payoutFor(3, 0.3, 5), 1);
    assert.equal(payoutFor(-5, 2, 5), 0);
  });
});

describe('crashPoint', () => {
  test('never below 1.00 and floored to the cent', () => {
    for (const u of [0, 0.005, 0.2, 0.5, 0.9, 0.999999]) {
      const m = crashPoint(u, 5);
      assert.ok(m >= 1, `u=${u} gave ${m}`);
      assert.equal(Math.round(m * 100) / 100, m);
    }
  });
  test('the bottom of the draw crashes at exactly 1.00', () => {
    // Two things put a round at 1.00: the explicit instant share, and the curve itself, which
    // sits below 1 for u < e and is floored up — so P(crash at 1.00) is max(instant, e), which
    // is what makes the expected return come out at 1 − e below.
    assert.equal(crashPoint(0.001, 5), 1);
    assert.equal(crashPoint(0.0099, 5), 1);
    assert.equal(crashPoint(0.04, 5), 1);
    assert.ok(crashPoint(0.2, 5) > 1);
  });
  test('the edge is in the curve: any fixed cash-out target returns 1 − e', () => {
    // A player who always cashes out at M wins whenever the round reaches M and is paid M.
    // Integrate over the draw: P(reach M) · M should be 1 − e, whatever M — that is what makes
    // the game fair at every target and why settlement must not tax it again.
    const e = 5;
    for (const M of [1.2, 2, 5, 20]) {
      let ev = 0; const N = 200000;
      for (let i = 0; i < N; i++) { const u = (i + 0.5) / N; if (crashPoint(u, e) >= M) ev += M; }
      ev /= N;
      // The 1 % instant-crash share and the cent flooring both shave a little; the return sits
      // just under 1 − e and never above it. Within a point and a half, and never generous.
      assert.ok(ev <= 0.95 + 1e-9, `target ${M}: return ${ev.toFixed(4)} exceeds 0.95`);
      assert.ok(ev >= 0.935, `target ${M}: return ${ev.toFixed(4)} too low`);
    }
  });
  test('a bigger edge, a shorter curve', () => {
    assert.ok(crashPoint(0.5, 20) < crashPoint(0.5, 5));
  });
  test('crash is the one game settlement must not tax twice', () => {
    assert.equal(edgeApplied('crash'), true);
    assert.equal(edgeApplied('coinflip'), false);
    assert.equal(edgeApplied('pot'), false);
  });
});

describe('pot', () => {
  const table = [{ bet: 10 }, { bet: 30 }, { bet: 60 }];
  test('the winner is drawn in proportion to stake', () => {
    // Integrate the draw: each player should win exactly their share of the total.
    const N = 100000; const wins = [0, 0, 0];
    for (let i = 0; i < N; i++) wins[potWinner(table, (i + 0.5) / N)]++;
    assert.ok(Math.abs(wins[0] / N - 0.1) < 0.001);
    assert.ok(Math.abs(wins[1] / N - 0.3) < 0.001);
    assert.ok(Math.abs(wins[2] / N - 0.6) < 0.001);
  });
  test('the winner takes the pot, as a multiplier on their own stake', () => {
    assert.equal(potMultiplier(table, 0), 10);   // 100 / 10
    assert.equal(potMultiplier(table, 2), 100 / 60);
    // …and the live pot pays that with NO edge (zero-loss rule): 10 + 90
    assert.equal(payoutFor(10, potMultiplier(table, 0), 0), 100);
  });
  test('an empty or zero-stake table has no winner', () => {
    assert.equal(potWinner([], 0.5), -1);
    assert.equal(potWinner([{ bet: 0 }], 0.5), -1);
    assert.equal(potMultiplier([{ bet: 0 }], 0), 0);
  });
  test('the last draw lands on the last player, never off the end', () => {
    assert.equal(potWinner(table, 0.999999), 2);
    assert.equal(potWinner(table, 1), 2);
  });
});

describe('race', () => {
  test('six cars, each equally likely, none off the grid', () => {
    const N = 60000; const wins = Array(RACE_CARS).fill(0);
    for (let i = 0; i < N; i++) wins[raceWinner((i + 0.5) / N)]++;
    for (const w of wins) assert.equal(w, N / RACE_CARS);
    assert.equal(raceWinner(1), RACE_CARS - 1);
    assert.equal(raceWinner(-1), 0);
  });
});

describe('splitPot — a table settled between its players, zero-loss', () => {
  test('the losers’ stakes go to the winner, who keeps their own — nothing to the house', () => {
    const r = splitPot([{ discordId: 'a', bet: 100, multiplier: 2 }, { discordId: 'b', bet: 50, multiplier: 0 }, { discordId: 'c', bet: 30, multiplier: 0 }], 25);
    const a = r.find((p) => p.discordId === 'a');
    assert.equal(a.pot, 80);
    assert.equal(a.share, 80);              // the edge argument is ignored: a pot is untaxed
    assert.equal(a.multiplier, 1.8);        // (100 + 80) / 100
    assert.equal(a.refund, false);
    assert.equal(r.find((p) => p.discordId === 'b').multiplier, 0);
  });
  test('two winners split the pot by STAKE (not by multiplier), to the point', () => {
    // a: 100, c: 50 both won (a 6× race pick, say); pot = 100 from b. 100 · 100/150 = 66.67,
    // 100 · 50/150 = 33.33 → floors 66 + 33 = 99, the leftover point to the bigger fraction (a).
    const r = splitPot([{ discordId: 'a', bet: 100, multiplier: 6 }, { discordId: 'b', bet: 100, multiplier: 0 }, { discordId: 'c', bet: 50, multiplier: 6 }], 10);
    const a = r.find((p) => p.discordId === 'a'), c = r.find((p) => p.discordId === 'c');
    assert.equal(a.share, 67);
    assert.equal(c.share, 33);
    assert.equal(a.share + c.share, 100);
    assert.equal(payoutFor(100, a.multiplier, 0) + payoutFor(50, c.multiplier, 0), 250);
  });
  test('nobody wins → every stake comes back (refund), the house keeps nothing', () => {
    const r = splitPot([{ bet: 10, multiplier: 0 }, { bet: 20, multiplier: 0 }], 5);
    assert.ok(r.every((p) => p.multiplier === 1 && p.pot === 30 && p.refund === true));
    assert.equal(r.reduce((a, p) => a + payoutFor(p.bet, p.multiplier, 0), 0), 30);
  });
  test('a lone winner with no losers gets exactly their stake back', () => {
    const r = splitPot([{ bet: 40, multiplier: 2 }], 5);
    assert.equal(r[0].multiplier, 1);
    assert.equal(r[0].refund, false);
    assert.equal(payoutFor(40, 1, 0), 40);
  });
  test('sum paid out == sum staked for any table with a winner (fuzz)', () => {
    let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    for (let k = 0; k < 2000; k++) {
      const n = 2 + Math.floor(rnd() * 8);
      const plays = Array.from({ length: n }, () => ({ bet: 1 + Math.floor(rnd() * 997), multiplier: rnd() < 0.4 ? 2 : 0 }));
      if (!plays.some((p) => p.multiplier > 0)) plays[0].multiplier = 6;
      const r = splitPot(plays);
      const staked = plays.reduce((a, p) => a + p.bet, 0);
      const paid = r.reduce((a, p) => a + payoutFor(p.bet, p.multiplier, 0), 0);
      assert.equal(paid, staked, `table ${JSON.stringify(plays)}`);
      // …and only winners are paid: every loser at 0.
      assert.ok(r.every((p, i) => plays[i].multiplier > 0 || p.multiplier === 0));
    }
  });
});

describe('settleTable — every game in multi mode, and single-seat unchanged', () => {
  const staked = (seats) => seats.filter((p) => !p.skipped).reduce((a, p) => a + p.bet, 0);
  const paid = (seats) => seats.filter((p) => !p.skipped).reduce((a, p) => a + p.payout, 0);
  test('race: one right pick takes the whole table', () => {
    const t = settleTable([{ discordId: 'a', bet: 100, multiplier: RACE_MULTIPLIER }, { discordId: 'b', bet: 40, multiplier: 0 }, { discordId: 'c', bet: 60, multiplier: 0 }], { pot: true, edgePct: 5 });
    assert.equal(t.winners, 1); assert.equal(t.refund, false); assert.equal(t.pot, 100);
    assert.equal(t.seats.find((p) => p.discordId === 'a').payout, 200);
    assert.equal(paid(t.seats), staked(t.seats));
  });
  test('race: two right picks share by stake', () => {
    const t = settleTable([{ discordId: 'a', bet: 100, multiplier: 6 }, { discordId: 'b', bet: 300, multiplier: 6 }, { discordId: 'c', bet: 100, multiplier: 0 }], { pot: true });
    assert.equal(t.winners, 2);
    assert.equal(t.seats.find((p) => p.discordId === 'a').payout, 125);
    assert.equal(t.seats.find((p) => p.discordId === 'b').payout, 375);
    assert.equal(paid(t.seats), 500);
  });
  test('race: nobody picked the winner → stakes returned', () => {
    const t = settleTable([{ discordId: 'a', bet: 100, multiplier: 0 }, { discordId: 'b', bet: 300, multiplier: 0 }], { pot: true });
    assert.equal(t.refund, true); assert.equal(t.winners, 0);
    assert.ok(t.seats.every((p) => p.delta === 0 && p.payout === p.bet));
  });
  test('pot: the drawn player takes everything', () => {
    const t = settleTable([{ discordId: 'a', bet: 10, multiplier: 0 }, { discordId: 'b', bet: 30, multiplier: 1 }, { discordId: 'c', bet: 60, multiplier: 0 }], { pot: true });
    assert.equal(t.seats.find((p) => p.discordId === 'b').payout, 100);
    assert.equal(t.seats.find((p) => p.discordId === 'b').delta, 70);
    assert.equal(paid(t.seats), 100);
  });
  test('coin / dice / roulette / wheel on a shared roll: winners split the losers’ stakes', () => {
    for (const m of [2, 2, 14, 50]) {
      const t = settleTable([{ discordId: 'a', bet: 50, multiplier: m }, { discordId: 'b', bet: 50, multiplier: m }, { discordId: 'c', bet: 200, multiplier: 0 }], { pot: true, edgePct: 5 });
      assert.equal(t.winners, 2);
      assert.equal(t.seats.find((p) => p.discordId === 'a').payout, 150);
      assert.equal(t.seats.find((p) => p.discordId === 'b').payout, 150);
      assert.equal(paid(t.seats), 300);
    }
  });
  test('everyone wins the shared roll → everyone keeps their stake, nobody gains', () => {
    const t = settleTable([{ discordId: 'a', bet: 50, multiplier: 2 }, { discordId: 'b', bet: 80, multiplier: 2 }], { pot: true });
    assert.equal(t.refund, false); assert.equal(t.winners, 2); assert.equal(t.pot, 0);
    assert.ok(t.seats.every((p) => p.delta === 0));
  });
  test('a seat that cannot cover its stake is skipped and never part of the pot', () => {
    const t = settleTable([{ discordId: 'a', bet: 100, multiplier: 2 }, { discordId: 'b', bet: 100, multiplier: 0 }, { discordId: 'ghost', bet: 500, multiplier: 0 }], { pot: true, covered: (p) => p.discordId !== 'ghost' });
    assert.equal(t.pot, 100);
    assert.equal(t.seats.find((p) => p.discordId === 'a').payout, 200);
    assert.ok(t.seats.find((p) => p.discordId === 'ghost').skipped);
    assert.equal(paid(t.seats), staked(t.seats));
  });
  test('single seat against the house keeps the edge (unchanged)', () => {
    const t = settleTable([{ discordId: 'a', bet: 100, multiplier: 2 }], { pot: false, edgePct: 5 });
    assert.equal(t.seats[0].payout, 195);
    assert.equal(t.pot, null);
    const lose = settleTable([{ discordId: 'a', bet: 100, multiplier: 0 }], { pot: false, edgePct: 5 });
    assert.equal(lose.seats[0].payout, 0); assert.equal(lose.refund, false);
  });
  test('crash is never a pot: each seat on its own cash-out, no second edge', () => {
    const t = settleTable([{ discordId: 'a', bet: 100, multiplier: 2.5 }, { discordId: 'b', bet: 100, multiplier: 0 }], { pot: false, edgePct: 0 });
    assert.equal(t.seats[0].payout, 250); assert.equal(t.seats[1].payout, 0);
  });
});
