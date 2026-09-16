// A REAL Paddock-Manager export, converted. The fixture beside this file is a genuine one
// taken out of the circuit editor (14 segments, three sectors, an authored pit lane, and
// coordinates in a pixel space that runs NEGATIVE), so these assertions are about the file
// people will actually drop on the admin page rather than a hand-made stand-in.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importPaddockCircuit, normalizeCircuit, pickCircuit, layoutTrack, simulateRace, carPoint } from '../src/lib/casino-race.mjs';

const SAMPLE = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/paddock-circuit-sample.json', import.meta.url)), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(SAMPLE));

describe('importPaddockCircuit — the real export', () => {
  test('the polyline is one closed loop, with no doubled joints', () => {
    const c = importPaddockCircuit(SAMPLE);
    assert.ok(c, 'the sample converts');
    assert.ok(c.pts.length >= 24 && c.pts.length <= 240, `bounded (${c.pts.length})`);
    // No point repeats its neighbour, and the last point does not repeat the first: the loop
    // closes implicitly, which is what the renderer assumes.
    for (let i = 1; i < c.pts.length; i++) assert.ok(Math.hypot(c.pts[i][0] - c.pts[i - 1][0], c.pts[i][1] - c.pts[i - 1][1]) > 1e-9, `doubled point at ${i}`);
    const first = c.pts[0], last = c.pts[c.pts.length - 1];
    assert.ok(Math.hypot(last[0] - first[0], last[1] - first[1]) > 1e-9, 'the closing point is not duplicated');
    // It really closes: the gap from the last point back to the first is one step, not a jump
    // across the map.
    const step = Math.hypot(c.pts[1][0] - c.pts[0][0], c.pts[1][1] - c.pts[0][1]);
    assert.ok(Math.hypot(last[0] - first[0], last[1] - first[1]) < step * 3, 'the loop closes');
  });

  test('normalised into 0..1 with the aspect ratio kept (the source runs negative)', () => {
    const c = importPaddockCircuit(SAMPLE);
    const box = (pts) => pts.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [9, 9, -9, -9]);
    const [mnx, mny, mxx, mxy] = box([...c.pts, ...c.pitPts]);
    assert.ok(mnx >= 0 && mny >= 0 && mxx <= 1 && mxy <= 1, `inside the unit box (${mnx}, ${mny}, ${mxx}, ${mxy})`);
    // The source bounding box, straight off the file — negative y included.
    const raw = SAMPLE.segments.flatMap((s) => s.controlPoints).concat(SAMPLE.pitlane.segments.flatMap((s) => s.controlPoints));
    assert.ok(Math.min(...raw.map((p) => p.y)) < 0, 'the fixture really has negative coordinates');
    const srcAspect = (Math.max(...raw.map((p) => p.x)) - Math.min(...raw.map((p) => p.x))) / (Math.max(...raw.map((p) => p.y)) - Math.min(...raw.map((p) => p.y)));
    const outAspect = (mxx - mnx) / (mxy - mny);
    assert.ok(Math.abs(outAspect - srcAspect) < 0.02, `aspect kept (${outAspect.toFixed(3)} vs ${srcAspect.toFixed(3)})`);
    // Centred, not shoved into a corner: the longer axis fills the box, the shorter one is
    // inset by the same amount on both sides.
    assert.ok(Math.abs(mnx - (1 - mxx)) < 0.01 && Math.abs(mny - (1 - mxy)) < 0.01, 'centred');
    assert.ok(mxy - mny > 0.9, 'the long axis fills the box');
  });

  test('the sectors land in order, as fractions of the lap', () => {
    const c = importPaddockCircuit(SAMPLE);
    assert.equal(c.sectors.length, 2);
    assert.ok(c.sectors[0] > 0 && c.sectors[0] < c.sectors[1] && c.sectors[1] < 1, `in order (${c.sectors})`);
    // They are the CUMULATIVE LENGTHS of the segments the export names, not their indices.
    const total = SAMPLE.segments.reduce((a, s) => a + s.length, 0);
    const cum = (i) => SAMPLE.segments.slice(0, i).reduce((a, s) => a + s.length, 0) / total;
    assert.ok(Math.abs(c.sectors[0] - cum(SAMPLE.sectors[1].startSegmentIndex)) < 0.002);
    assert.ok(Math.abs(c.sectors[1] - cum(SAMPLE.sectors[2].startSegmentIndex)) < 0.002);
    assert.notDeepEqual(c.sectors, [0.34, 0.66]); // not the fallback
  });

  test('the pit lane comes from the file, beside the track, not from the offset approximation', () => {
    const c = importPaddockCircuit(SAMPLE);
    assert.ok(Array.isArray(c.pitPts) && c.pitPts.length >= 4, 'a pit lane was found');
    // It lies beside the track: every pit point is close to the loop, but not on it.
    const near = (p) => Math.min(...c.pts.map(([x, y]) => Math.hypot(x - p[0], y - p[1])));
    assert.ok(c.pitPts.every((p) => near(p) < 0.08), 'the pit lane hugs the track');
    assert.ok(c.pitPts.some((p) => near(p) > 0.004), 'it is not the track itself');
    // Its ends set the lap fractions the simulation uses to send a car down it.
    assert.ok(c.pit[0] >= 0 && c.pit[1] > c.pit[0] && c.pit[1] - c.pit[0] < 0.3, `pit window ${c.pit}`);
  });

  test('speedFactor is carried, and renormalised so a lap still takes the same time', () => {
    const c = importPaddockCircuit(SAMPLE);
    assert.equal(c.speeds.length, c.pts.length);
    assert.ok(Math.min(...c.speeds) < 0.8 && Math.max(...c.speeds) > 1.2, 'slow parts and fast parts');
    // mean(1 / factor) = 1 is exactly "the lap takes as long as it did at factor 1", because
    // time is the sum of (distance / pace) over arc-length-uniform points.
    const meanInv = c.speeds.reduce((a, f) => a + 1 / f, 0) / c.speeds.length;
    assert.ok(Math.abs(meanInv - 1) < 0.01, `lap time preserved (${meanInv})`);
    // And it reaches the simulation: two cars on the same circuit are slower where it is slow.
    const T = layoutTrack(c, { x: 40, y: 30, w: 420, h: 180 });
    assert.equal(typeof T.paceAt, 'function');
    const seen = new Set(); for (let s = 0; s < 1; s += 0.01) seen.add(T.paceAt(s).toFixed(2));
    assert.ok(seen.size > 5, 'the pace really varies around the lap');
  });

  test('it lays out inside its box, keeps its shape, and a race still ends on the drawn winner', () => {
    const c = importPaddockCircuit(SAMPLE);
    const T = layoutTrack(c, { x: 40, y: 30, w: 420, h: 180 });
    assert.equal(T.loop.length, 480);
    for (const [x, y] of T.loop) assert.ok(x >= 40 && x <= 460 && y >= 30 && y <= 210, 'the circuit leaves its box');
    for (const [x, y] of T.pit) assert.ok(x >= 40 && x <= 460 && y >= 30 && y <= 210, 'the pit lane leaves its box');
    // Placed with ONE scale: the pixel aspect matches the unit-box aspect (no stretching).
    const bb = T.loop.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [9e9, 9e9, -9e9, -9e9]);
    const src = c.pts.reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [9, 9, -9, -9]);
    assert.ok(Math.abs((bb[2] - bb[0]) / (bb[3] - bb[1]) - (src[2] - src[0]) / (src[3] - src[1])) < 0.02, 'not stretched to the box');
    for (let winner = 0; winner < 6; winner++) {
      const sim = simulateRace({ winner, seed: 1234 + winner, frames: 96, pitIn: T.pitIn, pitSpan: T.pitSpan, paceAt: T.paceAt });
      assert.equal(sim.finalOrder[0], winner);
      for (let f = 0; f < 96; f++) { const { pt } = carPoint(T, sim, 0, f); assert.ok(Number.isFinite(pt[0]) && Number.isFinite(pt[1])); }
    }
  });

  test('a truncated or garbage file returns null, and never throws', () => {
    for (const bad of [
      null, undefined, 0, '', 'nope', [], {}, { segments: [] },
      { segments: [{ controlPoints: [{ x: 1, y: 2 }] }] },                                     // one point per segment
      { segments: [{ controlPoints: [{ x: 'a', y: 2 }, { x: 1, y: 1 }] }, { controlPoints: [{ x: 2, y: 2 }, { x: 3, y: 3 }] }] }, // not a number
      { segments: Array.from({ length: 401 }, () => ({ controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })) },                     // absurdly many
      { segments: [{ controlPoints: Array.from({ length: 8 }, () => ({ x: 5, y: 5 })) }, { controlPoints: Array.from({ length: 8 }, () => ({ x: 5, y: 5 })) }] }, // zero-size
    ]) assert.equal(importPaddockCircuit(bad), null, `refused: ${JSON.stringify(bad)?.slice(0, 60)}`);
    // Truncated: the file cut off half way through still parses as JSON only if it happens to
    // — the realistic truncation is a segment list that lost its control points.
    const cut = clone(); cut.segments = cut.segments.slice(0, 1);
    assert.equal(importPaddockCircuit(cut), null, 'a single segment is not a circuit');
    const gutted = clone(); gutted.segments = gutted.segments.map((s) => ({ ...s, controlPoints: undefined }));
    assert.equal(importPaddockCircuit(gutted), null);
  });

  test('a raw export is accepted wherever a circuit is, and survives a JSON round trip', () => {
    // normalizeCircuit takes the raw file…
    const fromRaw = normalizeCircuit(SAMPLE);
    assert.ok(fromRaw && fromRaw.kind === 'paddock');
    // …and the stored (already converted) shape it wrote, read back out of the bot config.
    const stored = JSON.parse(JSON.stringify(fromRaw));
    const again = normalizeCircuit(stored);
    assert.deepEqual(again.pts, fromRaw.pts);
    assert.deepEqual(again.sectors, fromRaw.sectors);
    assert.deepEqual(again.pitPts, fromRaw.pitPts);
    assert.ok(JSON.stringify(stored).length < 64 * 1024, 'the stored shape stays small');
    // And the `circuits` list in the bot config: raw file or converted, picking it by id works.
    for (const entry of [SAMPLE, stored]) {
      const picked = pickCircuit({ circuit: fromRaw.id, circuits: [entry] }, 1);
      assert.equal(picked.name, fromRaw.name);
      assert.equal(picked.kind, 'paddock');
    }
    // A hand-written circuit still normalises the old way, untouched.
    const hand = normalizeCircuit({ name: 'Spa', points: [[0.1, 0.6], [0.4, 0.6], [0.5, 0.3], [0.8, 0.2], [0.9, 0.5], [0.6, 0.8]] });
    assert.equal(hand.kind, undefined);
    assert.equal(hand.pts.length, 6);
  });

  test('the name survives its accents, and the id is a slug', () => {
    const c = importPaddockCircuit(SAMPLE);
    assert.equal(c.name, 'Circuit généré');
    assert.match(c.id, /^[a-z0-9-]{1,32}$/);
    assert.equal(importPaddockCircuit({ ...clone(), name: '<script>x</script>' }).name, 'scriptxscript');
  });
});
