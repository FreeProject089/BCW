// The car race — a track map, a seeded simulation, and the frames that show it.
//
// The bot draws the winner UNIFORMLY (one of six cars, see raceWinner) before anything is
// simulated, and settles on that car. This module's job is to make a race that ends on that
// car without looking staged: every car gets its own pace, its tyres wear, one or two cars
// pit, somebody may crash and bring out the safety car, overtakes happen where the pace says
// they do — and then the finish is bent towards the drawn winner over the last third of the
// race, smoothly, so a winner who was running third has a late charge rather than a jump.
// The odds do not live here (they are the draw); this is the film of a result already known.
//
// Simulation ideas borrowed from the manager-game genre (a Paddock-Manager style model):
//   · pace       — a per-car base lap time, ± a few percent, seeded;
//   · tyre wear  — lap time grows with laps since the last stop (super-linear);
//   · pit stops  — one per car at most, scheduled by the seed, costs ~a quarter lap and a
//                  detour along the pit lane;
//   · incidents  — a per-race chance that one (non-winning) car crashes at a seeded point
//                  and stops for good;
//   · safety car — a crash bunches the field for a spell: every car slows to SC pace and the
//                  gaps compress towards the leader;
//   · overtakes  — read off the order between frames and captioned as they happen.
//
// Everything is a pure function of (winner, seed, frames): the same inputs draw the same race.

export const CAR_TAGS = ['RED', 'BLU', 'GRN', 'YEL', 'PUR', 'ORA'];
export const CAR_COLOURS = ['#ef4444', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316'];
const SECTOR_COLOURS = ['#ef4444', '#3b82f6', '#facc15']; // S1 red · S2 blue · S3 yellow, like a timing screen
export const LAPS = 3; // the default; the admin's `economy.casino.race.laps` overrides it per race

// ── tracks: control points in a unit box, smoothed to a dense polyline ─────────────────
// Each track: a closed loop of control points (x, y in 0..1), the fraction of the lap where
// each sector ends, and where the pit lane leaves and rejoins the track (fractions of the lap,
// along the start/finish straight, which is always the segment from point 0 to point 1 —
// so the pit lane never wraps the line and never crosses a corner).
const TRACKS = [
  { name: 'Riviera', pts: [[0.04, 0.62], [0.42, 0.62], [0.36, 0.44], [0.30, 0.30], [0.14, 0.24], [0.16, 0.10], [0.42, 0.08], [0.60, 0.16], [0.70, 0.30], [0.90, 0.32], [0.96, 0.52], [0.86, 0.66], [0.70, 0.70], [0.54, 0.80], [0.26, 0.86], [0.08, 0.80]], sectors: [0.34, 0.66], pit: [0.015, 0.13] },
  { name: 'Speedring', pts: [[0.06, 0.72], [0.64, 0.72], [0.72, 0.60], [0.86, 0.62], [0.94, 0.42], [0.86, 0.18], [0.66, 0.10], [0.50, 0.24], [0.38, 0.10], [0.14, 0.12], [0.06, 0.30], [0.16, 0.48], [0.06, 0.58]], sectors: [0.36, 0.70], pit: [0.015, 0.15] },
  { name: 'Hairpin Park', pts: [[0.06, 0.80], [0.46, 0.80], [0.46, 0.64], [0.36, 0.50], [0.48, 0.36], [0.72, 0.40], [0.80, 0.24], [0.92, 0.20], [0.94, 0.42], [0.84, 0.56], [0.90, 0.70], [0.76, 0.86], [0.56, 0.90], [0.30, 0.92], [0.10, 0.90]], sectors: [0.30, 0.64], pit: [0.015, 0.14] },
  { name: 'Lakeside', pts: [[0.05, 0.55], [0.40, 0.55], [0.52, 0.42], [0.44, 0.26], [0.22, 0.20], [0.14, 0.08], [0.36, 0.06], [0.58, 0.14], [0.78, 0.10], [0.94, 0.24], [0.92, 0.46], [0.80, 0.58], [0.88, 0.76], [0.70, 0.90], [0.44, 0.86], [0.24, 0.92], [0.06, 0.78]], sectors: [0.33, 0.68], pit: [0.015, 0.13] },
  { name: 'Monza Nord', pts: [[0.06, 0.66], [0.70, 0.66], [0.86, 0.58], [0.94, 0.40], [0.86, 0.20], [0.66, 0.12], [0.50, 0.18], [0.44, 0.34], [0.30, 0.36], [0.20, 0.22], [0.08, 0.28], [0.06, 0.48]], sectors: [0.40, 0.72], pit: [0.015, 0.16] },
  { name: 'Serpentine', pts: [[0.06, 0.86], [0.36, 0.86], [0.40, 0.70], [0.26, 0.62], [0.30, 0.46], [0.50, 0.44], [0.56, 0.30], [0.42, 0.16], [0.60, 0.06], [0.82, 0.12], [0.92, 0.30], [0.80, 0.44], [0.92, 0.62], [0.80, 0.80], [0.60, 0.92], [0.30, 0.94], [0.10, 0.94]], sectors: [0.30, 0.66], pit: [0.015, 0.13] },
];

/**
 * A circuit an admin imported (the Paddock-Manager export, or a hand-written one):
 *   { name, points: [[x, y], …] in 0..1 (≥ 6, a closed loop), sectors?: [a, b], pit?: [in, span] }
 * Anything malformed is refused (null) rather than drawn wrong: the renderer never trusts a
 * setting it did not write. `pts`/`points` are both accepted.
 */
export function normalizeCircuit(c) {
  if (!c || typeof c !== 'object') return null;
  const src = Array.isArray(c.points) ? c.points : Array.isArray(c.pts) ? c.pts : null;
  if (!src || src.length < 6 || src.length > 64) return null;
  const pts = [];
  for (const p of src) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Number(p[0]), y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push([Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]);
  }
  const sec = Array.isArray(c.sectors) && c.sectors.length === 2 ? c.sectors.map(Number) : [0.34, 0.66];
  const sectors = sec.every((v) => Number.isFinite(v)) && sec[0] > 0.05 && sec[1] > sec[0] + 0.05 && sec[1] < 0.95 ? sec : [0.34, 0.66];
  const pt = Array.isArray(c.pit) && c.pit.length === 2 ? c.pit.map(Number) : [0.015, 0.13];
  const pit = pt.every((v) => Number.isFinite(v)) && pt[0] >= 0 && pt[1] > pt[0] && pt[1] < 0.3 ? pt : [0.015, 0.13];
  const name = String(c.name || 'Custom').replace(/[^\w \-'.]/g, '').slice(0, 24) || 'Custom';
  return { name, pts, sectors, pit, id: String(c.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 32) };
}

/**
 * A circuit nobody drew: 10–14 control points around a loop with a jittered radius and a
 * slow wobble, so it reads as a track (straights and a few real corners) rather than a
 * blob. Deterministic in the seed — the same race renders the same circuit on every mirror.
 */
export function generateCircuit(seed) {
  const r = rng(seed);
  const n = 10 + Math.floor(r() * 5);
  const wob = 1 + Math.floor(r() * 3);
  const ph = r() * 6.28;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = 0.34 + 0.10 * Math.sin(a * wob + ph) + (r() - 0.5) * 0.10;
    pts.push([0.5 + Math.cos(a) * rad * 1.15, 0.52 + Math.sin(a) * rad * 0.92]);
  }
  // The start/finish straight is the segment from point 0 to point 1: pull point 1 level
  // with point 0 so the pit lane sits on a straight, as the built-ins have it.
  pts[1][1] = pts[0][1];
  const names = ['Nova', 'Delta', 'Orbit', 'Vector', 'Prism', 'Zephyr', 'Cascade', 'Meridian'];
  return { name: `${names[Math.floor(r() * names.length)]} ${1 + Math.floor(r() * 9)}`, pts: pts.map(([x, y]) => [Math.min(0.97, Math.max(0.03, x)), Math.min(0.96, Math.max(0.04, y))]), sectors: [0.34, 0.67], pit: [0.015, 0.13], id: 'random' };
}

/**
 * Which circuit a race runs on, from the admin's settings:
 *   circuit: 'random'   → a fresh generated one per race (the seed's)
 *            'builtin'  → one of the built-in tracks, by the seed
 *            '<id>'     → that built-in (by name) or imported circuit (by id), fixed
 *   circuits: the imported list (normalizeCircuit each)
 */
export function pickCircuit(settings = {}, seed = 1) {
  const custom = (Array.isArray(settings.circuits) ? settings.circuits : []).map(normalizeCircuit).filter(Boolean);
  const choice = String(settings.circuit || 'builtin');
  if (choice === 'random') return generateCircuit(seed);
  const all = [...TRACKS.map((t) => ({ ...t, id: t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') })), ...custom];
  if (choice === 'builtin' || choice === 'any') { const r = rng(seed); return all[Math.floor(r() * all.length)]; }
  return all.find((t) => t.id === choice || t.name === choice) || all[Math.abs(seed) % all.length];
}
export const BUILTIN_CIRCUITS = () => TRACKS.map((t) => ({ id: t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: t.name }));

/** Catmull-Rom through a closed set of points, sampled into N evenly spaced points. */
function smoothLoop(pts, N = 480) {
  const n = pts.length; const out = [];
  const seg = 24;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < seg; k++) {
      const t = k / seg, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  // Re-sample by arc length so equal progress means equal distance.
  const cum = [0];
  for (let i = 1; i <= out.length; i++) { const a = out[i - 1], b = out[i % out.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = cum[out.length];
  const res = [];
  for (let j = 0; j < N; j++) {
    const d = (j / N) * total;
    let i = 0; while (i < out.length - 1 && cum[i + 1] < d) i++;
    const a = out[i], b = out[(i + 1) % out.length]; const u = (d - cum[i]) / Math.max(1e-9, cum[i + 1] - cum[i]);
    res.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return res;
}

/** A track laid out in a pixel box: the dense loop, the pit lane, sectors, start line. */
export function layoutTrack(index, box) {
  // A number picks a built-in; an object (from pickCircuit / normalizeCircuit) is used as is.
  const T = typeof index === 'object' && index ? index : TRACKS[((index % TRACKS.length) + TRACKS.length) % TRACKS.length];
  const { x, y, w, h } = box;
  const loop = smoothLoop(T.pts).map(([px, py]) => [x + px * w, y + py * h]);
  const N = loop.length;
  const at = (s) => { const u = ((s % 1) + 1) % 1; const f = u * N; const i = Math.floor(f) % N; const j = (i + 1) % N; const k = f - Math.floor(f); return [loop[i][0] + (loop[j][0] - loop[i][0]) * k, loop[i][1] + (loop[j][1] - loop[i][1]) * k]; };
  // The pit lane: the track between pit-in and pit-out, pushed inwards by a fixed offset.
  const inward = (s) => { const a = at(s - 0.004), b = at(s + 0.004); const dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
  const [pIn, pOut] = T.pit;
  const span = pOut - pIn;
  const cx = loop.reduce((a, q) => a + q[0], 0) / N, cy = loop.reduce((a, q) => a + q[1], 0) / N;
  const pit = [];
  const steps = 18;
  for (let k = 0; k <= steps; k++) {
    const s = pIn + span * (k / steps); const p = at(s); const nrm = inward(s);
    const ease = Math.sin(Math.min(1, Math.min(k, steps - k) / 3) * Math.PI / 2); // slip in and out
    // Offset towards the inside of the loop (the centroid side), whichever way it runs.
    const side = (nrm[0] * (cx - p[0]) + nrm[1] * (cy - p[1])) >= 0 ? 1 : -1;
    const off = 16 * ease * side;
    pit.push([p[0] + nrm[0] * off, p[1] + nrm[1] * off]);
  }
  const pitAt = (u) => { const f = Math.min(1, Math.max(0, u)) * steps; const i = Math.min(steps - 1, Math.floor(f)); const k = f - i; return [pit[i][0] + (pit[i + 1][0] - pit[i][0]) * k, pit[i][1] + (pit[i + 1][1] - pit[i][1]) * k]; };
  return { name: T.name, loop, at, sectors: T.sectors, pit, pitAt, pitIn: pIn, pitSpan: span, inward };
}
// ── the simulation ─────────────────────────────────────────────────────────────────────
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
const clamp01 = (t) => Math.min(1, Math.max(0, t));

/**
 * Run the race. Returns per-frame progress (in laps, 0..LAPS) for each car, plus the events
 * and per-frame state the drawer needs. `winner` is the car that must cross the line first.
 */
export function simulateRace({ winner, seed, frames, cars = 6, pitIn = 0.015, pitSpan = 0.13, laps = LAPS, equalStats = true, incidents = true, pitStops = true, colours = CAR_COLOURS }) {
  const r = rng(seed);
  const LAPS_ = Math.min(12, Math.max(1, Math.floor(laps) || LAPS));
  const w = Math.min(cars - 1, Math.max(0, winner | 0));
  const FIN = Math.round(frames * 0.86);          // the winner crosses the line here
  const BLEND = Math.round(frames * 0.5);         // the finish starts bending here
  const basePace = LAPS_ / FIN;                   // laps per frame for a clean car
  // Equal cars: every seat has the same machine and the race is the driver's (the draw's).
  // Otherwise each car gets a fixed ±4 % — the "realistic" Paddock-Manager grid.
  const pace = Array.from({ length: cars }, () => basePace * (equalStats ? 1 : 1 + (r() - 0.5) * 0.08));
  pace[w] *= 1.015; // a nudge, not a fix: the bend below does the rest
  // Pit plans: about half the field stops once, at the start of lap 2 or 3 (crossing the
  // line into the pit lane, never on the last lap's end). The stop is the pit stretch of
  // that lap: from pitIn to pitIn + pitSpan, along the start/finish straight.
  const pitLap = Array.from({ length: cars }, () => (pitStops && LAPS_ > 1 && r() < 0.55 ? 1 + Math.floor(r() * (LAPS_ - 1)) : -1));
  const pitWindow = (c) => (pitLap[c] < 0 ? null : [pitLap[c] + pitIn, pitLap[c] + pitIn + pitSpan]);
  // One incident in roughly half the races, never the winner.
  const crashCar = incidents && r() < 0.5 ? [...Array(cars).keys()].filter((c) => c !== w)[Math.floor(r() * (cars - 1))] : -1;
  const crashAt = crashCar >= 0 ? Math.min(LAPS_ - 0.3, 0.6 + r() * Math.max(0.1, LAPS_ - 1.4)) : Infinity;   // in laps

  const P = Array.from({ length: cars }, () => new Float64Array(frames));
  const state = new Array(frames).fill(null).map(() => ({ sc: false, leader: 0 }));
  const events = [];
  const stopped = Array.from({ length: cars }, () => false);
  const lastStop = Array.from({ length: cars }, () => 0);
  const jitter = Array.from({ length: cars }, () => r() * 6.28);
  let crashed = false, crashFrame = -1, scUntil = -1;
  for (let f = 1; f < frames; f++) {
    const sc = f < scUntil;
    const prevOrder = [...Array(cars).keys()].sort((a, b) => P[b][f - 1] - P[a][f - 1]);
    const leader = prevOrder[0];
    const speed = (c) => {
      const prev = P[c][f - 1];
      const wear = 1 + 0.02 * Math.pow(Math.max(0, prev - lastStop[c]), 1.5);   // tyres go off
      let v = (pace[c] / wear) * (1 + Math.sin(f * 0.35 + jitter[c]) * 0.03);   // a little breathing
      const pw = pitWindow(c);
      if (pw && prev >= pw[0] && prev < pw[1]) v *= 0.45;                        // crawling down the pit lane
      return v;
    };
    // The leader first: under the safety car everybody queues behind it.
    for (let idx = 0; idx < cars; idx++) {
      const c = prevOrder[idx];
      const prev = P[c][f - 1];
      if (crashCar === c && crashed) { P[c][f] = prev; continue; }
      let v = speed(c);
      if (sc) v = idx === 0 ? Math.min(v, basePace * 0.5) : Math.min(v, basePace * 0.62);
      let next = prev + v;
      if (sc && idx > 0) { const ahead = prevOrder[idx - 1]; next = Math.min(next, P[ahead][f] - 0.012); }
      const pw = pitWindow(c);
      if (pw && prev < pw[1] && next >= pw[1] && !stopped[c]) { stopped[c] = true; lastStop[c] = next; events.push({ f, kind: 'pit', car: c }); }
      if (pw && prev < pw[0] && next >= pw[0]) events.push({ f, kind: 'pitin', car: c });
      if (crashCar === c && !crashed && next >= crashAt) {
        crashed = true; crashFrame = f; next = crashAt; scUntil = f + Math.round(frames * 0.16);
        events.push({ f, kind: 'crash', car: c });
      }
      P[c][f] = Math.max(prev, next);
    }
    state[f] = { sc, leader };
  }
  // ── the bend: the drawn winner crosses first at FIN; the rest end short, in their own order ─
  const wScale = LAPS_ / Math.max(1e-6, P[w][FIN]);
  const others = [...Array(cars).keys()].filter((c) => c !== w && c !== crashCar).sort((a, b) => P[b][FIN] - P[a][FIN]);
  const cap = new Map(others.map((c, i) => [c, LAPS_ - 0.04 - i * 0.03]));
  for (let c = 0; c < cars; c++) {
    if (c === crashCar) continue;
    const scale = c === w ? wScale : Math.min(1.08, Math.max(0.9, cap.get(c) / Math.max(1e-6, P[c][FIN])));
    for (let f = BLEND; f < frames; f++) {
      const k = clamp01((f - BLEND) / (FIN - BLEND));
      P[c][f] *= 1 + (scale - 1) * (k * k * (3 - 2 * k));
    }
    for (let f = 1; f < frames; f++) P[c][f] = Math.max(P[c][f - 1], P[c][f]);
    if (c === w) { for (let f = FIN; f < frames; f++) P[c][f] = Math.max(LAPS_, P[c][f]); }
    else {
      // Short of the line until the winner has crossed, then they roll on and finish too.
      for (let f = 0; f <= FIN; f++) P[c][f] = Math.min(P[c][f], cap.get(c));
      for (let f = FIN + 1; f < frames; f++) P[c][f] = Math.max(P[c][f - 1], Math.min(P[c][f], P[c][FIN] + (f - FIN) * basePace * 0.9));
    }
  }
  // Overtakes for the lead, read off the frames after the bend so the captions match the film.
  const order = (f) => [...Array(cars).keys()].sort((a, b) => P[b][f] - P[a][f]);
  let prevLead = order(0)[0];
  for (let f = 1; f < frames; f++) {
    const o = order(f);
    if (o[0] !== prevLead && !state[f].sc && P[o[0]][f] > 0.2 && P[o[0]][f] < LAPS_) events.push({ f, kind: 'overtake', car: o[0], on: prevLead });
    prevLead = o[0];
  }
  const finalOrder = order(frames - 1);
  const cols = Array.isArray(colours) && colours.length >= cars ? colours.map((c, i) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c) : CAR_COLOURS[i])) : CAR_COLOURS;
  return { P, events: events.sort((a, b) => a.f - b.f), state, winner: w, crashCar, crashFrame, pitLap, pitWindow, finish: FIN, finalOrder, laps: LAPS_, colours: cols };
}

// ── drawing ────────────────────────────────────────────────────────────────────────────
/** Draw the track: asphalt, sector-coloured kerb, dotted pit lane, the start line. */
export function drawTrack(x, T) {
  const { loop, sectors } = T;
  x.lineCap = 'round'; x.lineJoin = 'round';
  // Asphalt, with a soft shadow.
  x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 18; path(x, loop, true); x.stroke();
  x.strokeStyle = '#2b3240'; x.lineWidth = 14; path(x, loop, true); x.stroke();
  // Sector kerbs: the outline in three colours.
  const N = loop.length; const bounds = [0, sectors[0], sectors[1], 1];
  for (let s = 0; s < 3; s++) {
    const a = Math.floor(bounds[s] * N), b = Math.floor(bounds[s + 1] * N);
    x.strokeStyle = SECTOR_COLOURS[s]; x.lineWidth = 3; x.globalAlpha = 0.9;
    x.beginPath(); for (let i = a; i <= b; i++) { const p = loop[i % N]; if (i === a) x.moveTo(p[0], p[1]); else x.lineTo(p[0], p[1]); } x.stroke();
    x.globalAlpha = 1;
  }
  // Centre line
  x.strokeStyle = 'rgba(255,255,255,0.10)'; x.lineWidth = 1; x.setLineDash([5, 7]); path(x, loop, true); x.stroke(); x.setLineDash([]);
  // Pit lane: dotted, with its entry and exit marked.
  x.strokeStyle = 'rgba(255,255,255,0.7)'; x.lineWidth = 2; x.setLineDash([2, 5]); path(x, T.pit, false); x.stroke(); x.setLineDash([]);
  x.font = 'bold 8px sans-serif'; x.textAlign = 'center'; x.fillStyle = 'rgba(255,255,255,0.55)';
  const pm = T.pit[Math.floor(T.pit.length / 2)]; x.fillText('PIT', pm[0], pm[1] - 6);
  // Start / finish: a short chequered bar across the track.
  const s0 = T.at(0), n0 = T.inward(0);
  for (let k = -3; k < 3; k++) { for (let j = 0; j < 2; j++) { x.fillStyle = (k + j) % 2 ? '#fff' : '#111'; x.fillRect(s0[0] + n0[0] * k * 3 - 2 + j * 2, s0[1] + n0[1] * k * 3 - 2, 2.2, 3.2); } }
  x.save(); x.translate(s0[0], s0[1]); x.rotate(Math.atan2(n0[1], n0[0])); x.fillStyle = 'rgba(0,0,0,0)';
  x.restore();
}
function path(x, pts, close) { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); if (close) x.closePath(); }

/** Where car `c` is at frame `f` on track T: on the loop, or on the pit path when stopping. */
export function carPoint(T, sim, c, f) {
  const p = sim.P[c][f];
  const pw = sim.pitWindow(c);
  if (pw && p >= pw[0] && p < pw[1]) return { pt: T.pitAt((p - pw[0]) / (pw[1] - pw[0])), pit: true };
  return { pt: T.at(p - Math.floor(p)), pit: false };
}

/** One frame of the race over an already-drawn track. `t` is 0..1 through the clip. */
export function drawRaceFrame(x, T, sim, f, { pick = -1, frames, W }) {
  const cars = sim.P.length;
  const LAPS = sim.laps || 3;
  const CAR_COLOURS = sim.colours || ['#ef4444', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316'];
  const order = [...Array(cars).keys()].sort((a, b) => sim.P[b][f] - sim.P[a][f]);
  // Cars, back-markers first so the leader draws on top.
  for (const c of [...order].reverse()) {
    const { pt, pit } = carPoint(T, sim, c, f);
    const dead = sim.crashCar === c && sim.crashFrame >= 0 && f >= sim.crashFrame;
    if (dead) {
      // Smoke, then the wreck: a grey dot with a cross.
      const k = Math.min(1, (f - sim.crashFrame) / 12);
      x.fillStyle = `rgba(200,200,200,${0.35 * (1 - k)})`; for (let i = 0; i < 3; i++) { x.beginPath(); x.arc(pt[0] + (i - 1) * 5, pt[1] - 6 - k * 14 - i * 3, 5 + k * 6, 0, Math.PI * 2); x.fill(); }
      x.fillStyle = '#6b7280'; x.beginPath(); x.arc(pt[0], pt[1], 6, 0, Math.PI * 2); x.fill();
      x.strokeStyle = '#ef4444'; x.lineWidth = 2; x.beginPath(); x.moveTo(pt[0] - 4, pt[1] - 4); x.lineTo(pt[0] + 4, pt[1] + 4); x.moveTo(pt[0] + 4, pt[1] - 4); x.lineTo(pt[0] - 4, pt[1] + 4); x.stroke();
      tag(x, CAR_TAGS[c], pt, '#9ca3af');
      continue;
    }
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.beginPath(); x.arc(pt[0] + 1.5, pt[1] + 2, 6.5, 0, Math.PI * 2); x.fill();
    x.fillStyle = CAR_COLOURS[c]; x.beginPath(); x.arc(pt[0], pt[1], 6, 0, Math.PI * 2); x.fill();
    x.lineWidth = c === pick ? 2.5 : 1.5; x.strokeStyle = c === pick ? '#fff' : 'rgba(0,0,0,0.7)'; x.stroke();
    if (pit) { x.fillStyle = '#fff'; x.font = 'bold 7px sans-serif'; x.textAlign = 'center'; x.fillText('P', pt[0], pt[1] + 2.5); }
    tag(x, CAR_TAGS[c], pt, CAR_COLOURS[c]);
  }
  // Running order, top-left, with the lap counter.
  const leaderLap = Math.min(LAPS, Math.floor(sim.P[order[0]][f]) + 1);
  x.font = 'bold 12px sans-serif'; x.textAlign = 'left'; x.fillStyle = '#fff';
  x.fillText(f >= sim.finish ? 'FINISH' : `LAP ${leaderLap} / ${LAPS}`, 14, 42);
  x.font = 'bold 9px sans-serif';
  order.forEach((c, i) => {
    const dead = sim.crashCar === c && f >= sim.crashFrame && sim.crashFrame >= 0;
    x.fillStyle = dead ? '#6b7280' : CAR_COLOURS[c]; x.fillRect(14, 50 + i * 12, 8, 8);
    x.fillStyle = dead ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.85)'; x.fillText(`${i + 1}  ${CAR_TAGS[c]}${dead ? '  OUT' : c === pick ? '  ◀' : ''}`, 26, 58 + i * 12);
  });
  // Events: the latest one, as a caption under the lap counter; the safety car as a banner.
  const live = sim.events.filter((e) => e.f <= f && e.f > f - 22 && e.kind !== 'sc');
  const e = live[live.length - 1];
  if (e) {
    const txt = e.kind === 'crash' ? `${CAR_TAGS[e.car]} CRASHES OUT` : e.kind === 'pitin' ? `${CAR_TAGS[e.car]} INTO THE PITS` : e.kind === 'pit' ? `${CAR_TAGS[e.car]} REJOINS` : `${CAR_TAGS[e.car]} TAKES THE LEAD FROM ${CAR_TAGS[e.on]}`;
    x.font = 'bold 10px sans-serif'; x.textAlign = 'right';
    const tw = x.measureText(txt).width;
    x.fillStyle = e.kind === 'crash' ? 'rgba(239,68,68,0.9)' : 'rgba(0,0,0,0.6)'; x.beginPath(); x.roundRect(W - 14 - tw - 12, 30, tw + 12, 16, 4); x.fill();
    x.fillStyle = '#fff'; x.fillText(txt, W - 20, 42);
  }
  if (sim.state[f]?.sc) {
    x.fillStyle = 'rgba(250,204,21,0.92)'; x.beginPath(); x.roundRect(W / 2 - 52, 12, 104, 18, 4); x.fill();
    x.font = 'bold 11px sans-serif'; x.textAlign = 'center'; x.fillStyle = '#111'; x.fillText('SAFETY CAR', W / 2, 25);
  }
}
function tag(x, text, pt, colour) {
  x.font = 'bold 9px sans-serif'; x.textAlign = 'left'; x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,0.8)';
  x.strokeText(text, pt[0] + 9, pt[1] + 3.5); x.fillStyle = colour; x.fillText(text, pt[0] + 9, pt[1] + 3.5);
}
export const TRACK_COUNT = TRACKS.length;
