// The snake path's geometry (ui/snake.jsx draws it). N5 (agent-landing-N).
//
// From stop to stop: down the first stop's column to the gap between the two rows, across the
// gap, down the next stop's column into it. Every turn is a quarter circle (cubic Bézier), so
// the line is continuous and smooth, passes through every stop's centre, and only ever crosses
// sideways inside a gap, never over a row (which is where the cards and their text are).
// Two stops in one column give a straight vertical segment.

const R_MAX = 28;
const K = 0.5523; // cubic approximation of a quarter circle
const f = (n) => n.toFixed(1);

/**
 * The path through `pts` (stop centres), crossing between stop i and i+1 at height `gaps[i]`
 * (the middle of the space between their rows).
 */
export function snakePath(pts, gaps = []) {
  if (pts.length < 2) return '';
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x;
    const gy = Number.isFinite(gaps[i - 1]) ? gaps[i - 1] : (a.y + b.y) / 2;
    const r = Math.min(R_MAX, gy - a.y, b.y - gy, Math.abs(dx) / 2);
    if (Math.abs(dx) < 1) { d += ` L${f(b.x)} ${f(b.y)}`; continue; }
    if (!(r > 1)) {
      // No room to turn (rows touching): a plain S, still through both centres.
      d += ` C${f(a.x)} ${f(gy)} ${f(b.x)} ${f(gy)} ${f(b.x)} ${f(b.y)}`;
      continue;
    }
    const s = Math.sign(dx), k = K * r;
    d += ` L${f(a.x)} ${f(gy - r)}`
      + ` C${f(a.x)} ${f(gy - r + k)} ${f(a.x + s * (r - k))} ${f(gy)} ${f(a.x + s * r)} ${f(gy)}`
      + ` L${f(b.x - s * r)} ${f(gy)}`
      + ` C${f(b.x - s * (r - k))} ${f(gy)} ${f(b.x)} ${f(gy + r - k)} ${f(b.x)} ${f(gy + r)}`
      + ` L${f(b.x)} ${f(b.y)}`;
  }
  return d;
}
