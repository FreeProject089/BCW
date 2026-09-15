// The race film: whatever the seed, the car the bot drew is the car that crosses first —
// the settlement and the GIF can never disagree — and the film is a film (monotone progress,
// a crashed car stays put, the safety car follows a crash).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { simulateRace, layoutTrack, carPoint, LAPS, TRACK_COUNT } from '../src/lib/casino-race.mjs';

describe('simulateRace', () => {
  test('ends on the drawn winner for every car and many seeds', () => {
    for (let seed = 1; seed <= 240; seed++) {
      const winner = seed % 6;
      const sim = simulateRace({ winner, seed: seed * 7919, frames: 96 });
      assert.equal(sim.finalOrder[0], winner, `seed ${seed}`);
      assert.equal(sim.winner, winner);
      // The winner is on the line at its finish frame; nobody else has crossed yet.
      assert.ok(sim.P[winner][sim.finish] >= LAPS);
      for (let c = 0; c < 6; c++) if (c !== winner) assert.ok(sim.P[c][sim.finish] < LAPS, `seed ${seed} car ${c} crossed first`);
    }
  });
  test('progress never goes backwards, and a crashed car never moves again', () => {
    let crashes = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const sim = simulateRace({ winner: 2, seed, frames: 96 });
      for (let c = 0; c < 6; c++) for (let f = 1; f < 96; f++) assert.ok(sim.P[c][f] >= sim.P[c][f - 1] - 1e-9, `seed ${seed} car ${c} frame ${f}`);
      if (sim.crashCar >= 0) {
        crashes++;
        assert.notEqual(sim.crashCar, 2, 'the winner never crashes');
        for (let f = sim.crashFrame + 1; f < 96; f++) assert.equal(sim.P[sim.crashCar][f], sim.P[sim.crashCar][sim.crashFrame]);
        assert.ok(sim.events.some((e) => e.kind === 'crash'));
        assert.ok(sim.state.slice(sim.crashFrame + 1, sim.crashFrame + 4).every((s) => s.sc), 'a crash brings out the safety car');
      }
    }
    assert.ok(crashes > 20 && crashes < 100, `about half the races have an incident (${crashes}/120)`);
  });
  test('deterministic: the same inputs make the same film', () => {
    const a = simulateRace({ winner: 4, seed: 12345, frames: 96 }), b = simulateRace({ winner: 4, seed: 12345, frames: 96 });
    assert.deepEqual(Array.from(a.P[0]), Array.from(b.P[0]));
    assert.deepEqual(a.events, b.events);
  });
  test('every track lays out and places a car on it, pit lane included', () => {
    assert.ok(TRACK_COUNT >= 2);
    for (let i = 0; i < TRACK_COUNT; i++) {
      const T = layoutTrack(i, { x: 40, y: 30, w: 420, h: 180 });
      assert.ok(T.loop.length > 100);
      assert.ok(T.pit.length > 5);
      for (const [x, y] of T.loop) { assert.ok(x >= 40 && x <= 460 && y >= 30 && y <= 210, `track ${i} leaves its box`); }
      const sim = simulateRace({ winner: 0, seed: 99, frames: 96, pitIn: T.pitIn, pitSpan: T.pitSpan });
      let onPit = 0;
      for (let c = 0; c < 6; c++) for (let f = 0; f < 96; f++) { const { pt, pit } = carPoint(T, sim, c, f); assert.ok(Number.isFinite(pt[0]) && Number.isFinite(pt[1])); if (pit) onPit++; }
      if (sim.pitLap.some((l) => l >= 0)) assert.ok(onPit > 0, 'a car that pits is drawn on the pit lane');
    }
  });
});
