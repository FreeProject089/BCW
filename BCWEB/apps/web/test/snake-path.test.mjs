// N5 (agent-landing-N): the snake path's geometry. The complaint it answers: the old curve ran
// stop to stop as one S and crossed the cards. The new one must pass through every stop's centre,
// be a straight line when the stops share a column (the phone layout), and only ever move
// sideways inside the gap between two rows.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { snakePath } from '../src/ui/snake-path.js';

// Parse "M x y L x y C x y x y x y" into commands with absolute points.
function parse(d) {
  const out = [];
  const re = /([MLC])([^MLC]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const nums = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const pts = [];
    for (let i = 0; i < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
    out.push({ c: m[1], pts });
  }
  return out;
}
// Sample the path densely (cubic segments evaluated), as a polyline.
function sample(d) {
  const cmds = parse(d);
  const pts = [];
  let cur = null;
  for (const { c, pts: p } of cmds) {
    if (c === 'M') { cur = p[0]; pts.push(cur); continue; }
    if (c === 'L') { cur = p[0]; pts.push(cur); continue; }
    const [c1, c2, e] = p;
    for (let k = 1; k <= 24; k += 1) {
      const t = k / 24, u = 1 - t;
      pts.push({
        x: u * u * u * cur.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * e.x,
        y: u * u * u * cur.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * e.y,
      });
    }
    cur = e;
  }
  return pts;
}

describe('snake path', () => {
  test('fewer than two stops draws nothing', () => {
    assert.equal(snakePath([]), '');
    assert.equal(snakePath([{ x: 10, y: 10 }]), '');
  });

  test('stops in one column (phone): a straight vertical line', () => {
    const d = snakePath([{ x: 20, y: 30 }, { x: 20, y: 200 }, { x: 20, y: 380 }], [115, 290]);
    assert.equal(d, 'M20.0 30.0 L20.0 200.0 L20.0 380.0');
  });

  test('alternating stops: through every centre, sideways only inside the gaps', () => {
    // Rows: [0,150] [214,364] [428,578]; stops centred vertically, alternating 24 / 872.
    const rows = [[0, 150], [214, 364], [428, 578]];
    const stops = [{ x: 24, y: 75 }, { x: 872, y: 289 }, { x: 24, y: 503 }];
    const gaps = [182, 396];
    const d = snakePath(stops, gaps);
    const pts = sample(d);
    // Passes through each centre.
    for (const s of stops) assert.ok(pts.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < 0.2), `misses ${s.x},${s.y}`);
    // Inside a row, the line only runs in that row's stop column: it never reaches the card.
    rows.forEach(([top, bottom], i) => {
      for (const p of pts) {
        if (p.y > top + 0.5 && p.y < bottom - 0.5) assert.ok(Math.abs(p.x - stops[i].x) < 0.2, `row ${i}: x ${p.x} at y ${p.y}`);
      }
    });
    // Continuous: no jump between consecutive samples bigger than the longest straight run.
    for (let i = 1; i < pts.length; i += 1) assert.ok(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) < 900);
  });

  test('turns are rounded (a quarter circle of at most 28px)', () => {
    const d = snakePath([{ x: 24, y: 75 }, { x: 872, y: 289 }], [182]);
    assert.match(d, / C24\.0 169\.5 /); // first corner starts 28px above the gap, bends out
    assert.match(d, /L844\.0 182\.0/);  // straight across the gap until 28px before the column
  });

  test('no room to turn (crossing height at a stop): still a curve through both centres, no NaN', () => {
    const d = snakePath([{ x: 24, y: 75 }, { x: 872, y: 225 }], [75]);
    assert.match(d, / C24\.0 75\.0 872\.0 75\.0 872\.0 225\.0$/);
    assert.ok(!/NaN/.test(d));
    assert.ok(d.endsWith('872.0 225.0'));
  });
});
