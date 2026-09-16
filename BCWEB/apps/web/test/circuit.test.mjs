// The admin's race preview draws the circuit with src/lib/circuit.js; the bot's GIF draws it
// with the API's layoutTrack. Two drawings of one rule drift — so the last test here is a
// PARITY test: point for point, the preview's polyline, pit lane and sector split must equal
// the renderer's for the same circuit in the same box. If they ever disagree, this goes red
// instead of an admin discovering it from a film that is not what they picked.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sampleCircuit, fitToViewBox, splitBySector, layoutCircuit, pathD, circuitInfo, arcResample } from '../src/lib/circuit.js';
import { layoutTrack, importPaddockCircuit, BUILTIN_TRACKS, generateCircuit } from '../../api/src/lib/casino-race.mjs';

const SAMPLE = JSON.parse(readFileSync(fileURLToPath(new URL('../../api/test/fixtures/paddock-circuit-sample.json', import.meta.url)), 'utf8'));
const PADDOCK = importPaddockCircuit(SAMPLE);
const HAND = { name: 'Spa', pts: [[0.1, 0.6], [0.4, 0.6], [0.5, 0.3], [0.8, 0.2], [0.9, 0.5], [0.6, 0.8]], sectors: [0.34, 0.66], pit: [0.015, 0.13] };
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

describe('sampleCircuit', () => {
  test('a closed polyline of N points, evenly spaced, inside the unit box', () => {
    for (const c of [HAND, PADDOCK, generateCircuit(7)]) {
      const p = sampleCircuit(c, 240);
      assert.equal(p.length, 240);
      for (const [x, y] of p) assert.ok(x >= -0.01 && x <= 1.01 && y >= -0.01 && y <= 1.01);
      // Evenly spaced by arc length: every step is within a few percent of the mean.
      const steps = p.map((q, i) => Math.hypot(q[0] - p[(i + 1) % p.length][0], q[1] - p[(i + 1) % p.length][1]));
      const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
      assert.ok(Math.max(...steps) < mean * 1.35, 'evenly spaced');
      // It closes: the step from the last point back to the first is one step, not a jump.
      assert.ok(steps[steps.length - 1] < mean * 1.35, 'the loop closes');
    }
  });
  test('anything that is not a circuit gives null, never a throw', () => {
    for (const bad of [null, undefined, {}, 0, 'x', { pts: [] }, { pts: [[0, 0], [1, 1]] }, { pts: [[0, 0], ['a', 1], [1, 1], [0, 1]] }]) {
      assert.equal(sampleCircuit(bad, 64), null);
    }
  });
});

describe('fitToViewBox', () => {
  test('stretching fills the box; uniform keeps the aspect and centres', () => {
    const square = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const stretched = fitToViewBox(square, { width: 400, height: 100 });
    assert.deepEqual(stretched[0], [0, 0]);
    assert.deepEqual(stretched[2], [400, 100]);
    const uni = fitToViewBox(square, { width: 400, height: 100, uniform: true });
    assert.ok(close(uni[2][0] - uni[0][0], 100) && close(uni[2][1] - uni[0][1], 100), 'a square stays square');
    assert.ok(close(uni[0][0], 150) && close(uni[0][1], 0), 'centred across the long axis');
  });
  test('pad insets on every side, and an empty input is an empty output', () => {
    const p = fitToViewBox([[0, 0], [1, 1]], { width: 100, height: 100, pad: 10 });
    assert.deepEqual(p, [[10, 10], [90, 90]]);
    assert.deepEqual(fitToViewBox([], { width: 10, height: 10 }), []);
    assert.deepEqual(fitToViewBox([[0, 0]], { width: 0, height: 10 }), []);
  });
  test('`from` fixes the source box, so two polylines share one transform', () => {
    const a = fitToViewBox([[0, 0], [0.5, 0.5]], { width: 100, height: 100, from: [[0, 0], [1, 1]] });
    assert.deepEqual(a, [[0, 0], [50, 50]]);
  });
});

describe('splitBySector', () => {
  test('three pieces, in order, covering the loop and joining at the boundaries', () => {
    const pts = Array.from({ length: 100 }, (_, i) => [i, 0]);
    const [s1, s2, s3] = splitBySector(pts, [0.3, 0.7]);
    assert.deepEqual(s1[0], [0, 0]);
    assert.deepEqual(s1[s1.length - 1], s2[0], 'S1 ends where S2 begins');
    assert.deepEqual(s2[s2.length - 1], s3[0], 'S2 ends where S3 begins');
    assert.deepEqual(s3[s3.length - 1], [0, 0], 'S3 comes back to the line');
    assert.equal(s1.length + s2.length + s3.length, 103);
  });
  test('nonsense sectors fall back to the default split', () => {
    const pts = Array.from({ length: 30 }, (_, i) => [i, 0]);
    assert.deepEqual(splitBySector(pts, null).map((p) => p.length), splitBySector(pts, [0.34, 0.66]).map((p) => p.length));
    assert.deepEqual(splitBySector(pts, ['a', 2]).map((p) => p.length), splitBySector(pts, [0.34, 0.66]).map((p) => p.length));
    assert.deepEqual(splitBySector([], [0.3, 0.6]), [[], [], []]);
  });
});

describe('layoutCircuit and its captions', () => {
  test('an imported circuit brings its own pit lane; a hand-written one gets the approximation', () => {
    const imported = layoutCircuit(PADDOCK, { width: 420, height: 180 });
    assert.ok(imported.pit.length >= 4);
    assert.equal(imported.name, PADDOCK.name);
    assert.equal(imported.sectors.length, 3);
    const hand = layoutCircuit(HAND, { width: 420, height: 180 });
    assert.equal(hand.pit.length, 19); // the 18-step offset lane
    assert.equal(layoutCircuit(null), null);
  });
  test('circuitInfo reports what the import carried', () => {
    const i = circuitInfo(PADDOCK);
    assert.equal(i.imported, true);
    assert.equal(i.corners, SAMPLE.cornerCount);
    assert.equal(i.length, Math.round(SAMPLE.totalLength));
    assert.equal(i.hasPit, true);
    assert.equal(circuitInfo(HAND).imported, false);
    assert.equal(circuitInfo(null), null);
  });
  test('pathD writes a polyline, and closes it on request', () => {
    assert.equal(pathD([[0, 0], [1, 2]]), 'M0.00 0.00 L1.00 2.00');
    assert.equal(pathD([[0, 0], [1, 2]], true), 'M0.00 0.00 L1.00 2.00 Z');
    assert.equal(pathD([]), '');
    assert.equal(pathD(null), '');
  });
  test('arcResample refuses a degenerate polyline instead of dividing by zero', () => {
    assert.equal(arcResample([[1, 1], [1, 1], [1, 1]], 10, true), null);
    assert.equal(arcResample([[0, 0]], 10, true), null);
  });
});

// ── the parity test ─────────────────────────────────────────────────────────────────────
describe('the preview draws what the GIF draws', () => {
  const BOX = { x: 0, y: 0, w: 420, h: 180 };
  for (const [label, circuit] of [
    ['an imported Paddock circuit', PADDOCK],
    ['a hand-written circuit', HAND],
    ['a generated circuit', generateCircuit(31)],
    ...BUILTIN_TRACKS().slice(0, 3).map((t) => [`the built-in ${t.name}`, t]),
  ]) {
    test(`${label}: the same polyline, pit lane and sectors as layoutTrack`, () => {
      const T = layoutTrack(circuit, BOX);
      const L = layoutCircuit(circuit, { width: BOX.w, height: BOX.h, points: 480 });
      assert.equal(L.track.length, T.loop.length);
      for (let i = 0; i < T.loop.length; i++) {
        assert.ok(close(L.track[i][0], T.loop[i][0], 1e-6) && close(L.track[i][1], T.loop[i][1], 1e-6), `point ${i}: ${L.track[i]} vs ${T.loop[i]}`);
      }
      assert.equal(L.pit.length, T.pit.length);
      for (let i = 0; i < T.pit.length; i++) {
        assert.ok(close(L.pit[i][0], T.pit[i][0], 1e-6) && close(L.pit[i][1], T.pit[i][1], 1e-6), `pit ${i}: ${L.pit[i]} vs ${T.pit[i]}`);
      }
      // The sector split uses the same boundaries the renderer strokes with.
      const N = T.loop.length, b = T.sectors;
      assert.deepEqual(L.sectors.map((p) => p.length), [
        Math.floor(b[0] * N) + 1,
        Math.floor(b[1] * N) - Math.floor(b[0] * N) + 1,
        N - Math.floor(b[1] * N) + 1,
      ]);
      // And it stays inside the box the film gives it.
      for (const [x, y] of [...L.track, ...L.pit]) assert.ok(x >= -0.001 && x <= 420.001 && y >= -0.001 && y <= 180.001);
    });
  }
});
