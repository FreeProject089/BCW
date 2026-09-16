// Circuit geometry for the admin's race preview — the same shapes the GIF renderer draws.
//
// The API's apps/api/src/lib/casino-race.mjs owns the circuits themselves (the built-ins,
// the generated one, and the Paddock-Manager import). This file owns only the GEOMETRY the
// preview needs to draw one: sample a circuit to a polyline, fit that polyline to a viewBox,
// split it by sector. Pure functions, no React, no fetch — so they can be unit-tested, and
// apps/web/test/circuit.test.mjs checks them point for point against `layoutTrack` in the
// API. If the preview ever drifts from the film, that test goes red rather than the admin
// finding out from a GIF that does not match what they chose.
//
// A circuit is either
//   · hand-written / built-in / generated — { name, pts: [[x, y], …] } in 0..1, smoothed
//     through a Catmull-Rom loop, and STRETCHED to the box (they are authored for it);
//   · imported (`kind: 'paddock'`)        — { pts, speeds, pitPts, sectors, pit, corners,
//     length }, already aspect-correct in the unit box, so it is placed with one scale and
//     centred. Stretching it would undo what the import was for.

/** Catmull-Rom through a closed set of control points. Mirrors smoothLoop in casino-race.mjs. */
function smoothLoop(pts) {
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
  return out;
}

/** Resample a polyline to N points evenly spaced by arc length, carrying a per-point value. */
export function arcResample(pts, N, closed = true, vals = null) {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  if (n < 2 || N < 2 || segs < 1) return null;
  const cum = [0];
  for (let i = 0; i < segs; i++) { const a = pts[i], b = pts[(i + 1) % n]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = cum[segs];
  if (!(total > 0)) return null;
  const span = closed ? N : N - 1;
  const out = [], ov = [];
  let i = 0;
  for (let j = 0; j < N; j++) {
    const d = (j / span) * total;
    while (i < segs - 1 && cum[i + 1] < d) i++;
    const a = pts[i], b = pts[(i + 1) % n];
    const u = (d - cum[i]) / Math.max(1e-12, cum[i + 1] - cum[i]);
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    if (vals) ov.push(vals[Math.min(vals.length - 1, i)]);
  }
  return { points: out, values: vals ? ov : null };
}

const isPaddock = (c) => !!c && c.kind === 'paddock' && Array.isArray(c.pts);

/**
 * A circuit → a dense closed polyline in the unit box (0..1), N points, evenly spaced by
 * arc length. Returns null for anything that is not a circuit.
 */
export function sampleCircuit(circuit, N = 480) {
  const src = circuit && (Array.isArray(circuit.pts) ? circuit.pts : Array.isArray(circuit.points) ? circuit.points : null);
  if (!src || src.length < 3) return null;
  const clean = [];
  for (const p of src) {
    const x = Number(p?.[0]), y = Number(p?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    clean.push([x, y]);
  }
  if (isPaddock(circuit)) return arcResample(clean, N, true, circuit.speeds || null)?.points || null;
  return arcResample(smoothLoop(clean), N, true, null)?.points || null;
}

/**
 * Fit a polyline into a width × height box. `uniform` keeps the aspect ratio (one scale,
 * centred); otherwise each axis is stretched to fill, which is how the built-ins are drawn.
 * `pad` is a margin in the box's own units.
 */
export function fitToViewBox(points, { width, height, pad = 0, uniform = false, from = null } = {}) {
  if (!Array.isArray(points) || !points.length || !(width > 0) || !(height > 0)) return [];
  const src = from || points;
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const [x, y] of src) { if (x < mnx) mnx = x; if (y < mny) mny = y; if (x > mxx) mxx = x; if (y > mxy) mxy = y; }
  const bw = Math.max(1e-9, mxx - mnx), bh = Math.max(1e-9, mxy - mny);
  const iw = Math.max(1e-9, width - pad * 2), ih = Math.max(1e-9, height - pad * 2);
  const sx = uniform ? Math.min(iw / bw, ih / bh) : iw / bw;
  const sy = uniform ? sx : ih / bh;
  const ox = pad + (iw - bw * sx) / 2 - mnx * sx, oy = pad + (ih - bh * sy) / 2 - mny * sy;
  return points.map(([x, y]) => [x * sx + ox, y * sy + oy]);
}

/**
 * The closed polyline cut into its three sectors, at the two lap fractions. Each piece keeps
 * the boundary point of the next, so the three strokes join instead of leaving a gap.
 */
export function splitBySector(points, sectors) {
  const N = points.length;
  if (!N) return [[], [], []];
  const s = Array.isArray(sectors) && sectors.length === 2 && sectors.every((v) => Number.isFinite(v)) ? sectors : [0.34, 0.66];
  const bounds = [0, Math.min(1, Math.max(0, s[0])), Math.min(1, Math.max(0, s[1])), 1];
  const out = [];
  for (let k = 0; k < 3; k++) {
    const a = Math.floor(bounds[k] * N), b = Math.floor(bounds[k + 1] * N);
    const piece = [];
    for (let i = a; i <= b; i++) piece.push(points[i % N]);
    out.push(piece);
  }
  return out;
}

/**
 * The pit lane in the same box: an imported circuit's own, or the built-ins' approximation
 * (the track between pit-in and pit-out, pushed towards the inside of the loop).
 * `offset` is in box units — 16 px on the GIF's 420 × 180 play area.
 */
export function pitLane(circuit, points, { offset = 16 } = {}) {
  const N = points.length;
  if (!N) return [];
  if (isPaddock(circuit)) return null; // the caller fits circuit.pitPts with the same transform
  const pit = Array.isArray(circuit?.pit) && circuit.pit.length === 2 ? circuit.pit : [0.015, 0.13];
  const at = (s) => { const u = ((s % 1) + 1) % 1; const f = u * N; const i = Math.floor(f) % N; const j = (i + 1) % N; const k = f - Math.floor(f); return [points[i][0] + (points[j][0] - points[i][0]) * k, points[i][1] + (points[j][1] - points[i][1]) * k]; };
  const span = pit[1] - pit[0];
  let cx = 0, cy = 0; for (const [x, y] of points) { cx += x; cy += y; } cx /= N; cy /= N;
  const steps = 18, out = [];
  for (let i = 0; i <= steps; i++) {
    const u = pit[0] + span * (i / steps);
    const a = at(u - 0.004), b = at(u + 0.004), p = at(u);
    const dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1;
    const nrm = [-dy / l, dx / l];
    const ease = Math.sin(Math.min(1, Math.min(i, steps - i) / 3) * Math.PI / 2);
    const side = (nrm[0] * (cx - p[0]) + nrm[1] * (cy - p[1])) >= 0 ? 1 : -1;
    const off = offset * ease * side;
    out.push([p[0] + nrm[0] * off, p[1] + nrm[1] * off]);
  }
  return out;
}

/**
 * Everything the preview draws, in one call: the track and the pit lane laid out in a
 * width × height box exactly as the GIF lays them out, plus the sector pieces.
 */
export function layoutCircuit(circuit, { width = 420, height = 180, pad = 0, points = 480 } = {}) {
  const unit = sampleCircuit(circuit, points);
  if (!unit) return null;
  const uniform = isPaddock(circuit);
  // Fitted from the UNIT BOX, not from the polyline's own bounding box — that is what
  // layoutTrack does, and the preview's whole point is to show what the film will show. So
  // an imported circuit that is tall and thin is drawn tall and thin, with the space beside
  // it that the GIF will have. The pit lane gets the same transform or it would not line up.
  const fit = (pts) => fitToViewBox(pts, { width, height, pad, uniform, from: [[0, 0], [1, 1]] });
  const track = fit(unit);
  let pit;
  if (uniform) pit = Array.isArray(circuit.pitPts) && circuit.pitPts.length >= 2 ? fit(circuit.pitPts) : [];
  else pit = pitLane(circuit, track, { offset: (16 / 420) * Math.max(1e-9, width - pad * 2) });
  return {
    name: circuit.name || '',
    track,
    pit: pit || [],
    sectors: splitBySector(track, circuit.sectors),
    start: track[0],
    // The direction of travel at the line, for the start/finish bar.
    startNormal: (() => { const a = track[track.length - 1], b = track[1] || track[0]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; })(),
  };
}

/** An SVG path string for a polyline. */
export function pathD(points, close = false) {
  if (!points || !points.length) return '';
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') + (close ? ' Z' : '');
}

/** What the import carried, for the caption above the drawing. */
export function circuitInfo(circuit) {
  if (!circuit) return null;
  return {
    name: circuit.name || '',
    imported: isPaddock(circuit),
    corners: Number.isFinite(Number(circuit.corners)) ? Number(circuit.corners) : null,
    length: Number.isFinite(Number(circuit.length)) ? Number(circuit.length) : null,
    sectors: Array.isArray(circuit.sectors) && circuit.sectors.length === 2 ? circuit.sectors : [0.34, 0.66],
    hasPit: isPaddock(circuit) ? Array.isArray(circuit.pitPts) && circuit.pitPts.length >= 2 : true,
    points: Array.isArray(circuit.pts) ? circuit.pts.length : Array.isArray(circuit.points) ? circuit.points.length : 0,
  };
}
