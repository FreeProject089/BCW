// A snake path: numbered stops joined by one line that winds down the page (the landing's
// "Get going" steps, and the snake landing template).
//
// N5 (agent-landing-N): redrawn. The line used to run stop to stop as one S-curve with vertical
// tangents, which on the alternating layout cut diagonally THROUGH the cards (it was drawn
// behind them, under a wide halo, so it read as a thick smudge crossing the text). Now it is
// routed so that it can never meet a card:
//
//   · down from a stop along its own column (the stop sits beside its card, never on it),
//   · across in the GAP between two rows, where nothing is drawn,
//   · down into the next stop along that stop's column,
//
// with every turn a quarter-circle (cubic Béziers, radius up to 28px). Two stops in one column
// (the phone layout, every stop on the start edge) give a straight vertical line with no special
// case. The stops are measured, not assumed, so it follows the layout in every language, in RTL
// and at every width.
//
// Measured with offsetLeft/offsetTop, NOT getBoundingClientRect: the rows scale and slide in on
// reveal (.reveal-stagger), and a rect read mid-animation put the line beside the stops instead
// of through them. Offsets are layout positions and ignore transforms. Re-measured on mount, on a
// resize, on web fonts arriving, after a settle, and by a ResizeObserver (which a tab that is not
// painting never calls, hence the others).
//
// Two strokes: the part already walked (up to the last done stop) solid, with a subtle gradient
// along the page; the part still ahead a thin dashed line. No halo, no wide track. Decoration
// only: `aria-hidden`, and the stops are real list items that read in order without it. The
// walked part draws in when the section is revealed; reduced motion shows it drawn.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import './snake.css';

// The geometry is a pure module so the test can check it without a DOM (test/snake-path.test.mjs).
import { snakePath } from './snake-path.js';

// Where `el` sits inside `box`, in layout pixels (transforms ignored).
function offsetIn(el, box) {
  let x = 0, y = 0, n = el;
  while (n && n !== box) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
  if (n !== box) return null;
  return { x, y };
}

/**
 * Put it as the FIRST child of a `position: relative` container that holds the stops.
 *
 *   done   how many stops, from the first, are done: the line up to the last done stop is the
 *          walked (solid) part, the rest the dashed part still ahead.
 *
 * Stops are `[data-snake-dot]`; the rows that hold them are `[data-snake-row]` (their bottom
 * and the next one's top give the height where the line crosses over).
 */
export function SnakePath({ done = 0, className = '' }) {
  const ref = useRef(null);
  const gid = `snk${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [geo, setGeo] = useState({ d: '', dDone: '', w: 0, h: 0 });

  const measure = useCallback(() => {
    const svg = ref.current;
    const box = svg?.parentElement;
    if (!box || !box.offsetWidth) return;
    const pts = [];
    for (const el of box.querySelectorAll('[data-snake-dot]')) {
      const o = offsetIn(el, box);
      if (!o) return;
      pts.push({ x: o.x + el.offsetWidth / 2, y: o.y + el.offsetHeight / 2 });
    }
    const rows = [...box.querySelectorAll('[data-snake-row]')].map((el) => {
      const o = offsetIn(el, box);
      return o ? { top: o.y, bottom: o.y + el.offsetHeight } : null;
    });
    const gaps = rows.slice(0, -1).map((r, i) => (r && rows[i + 1] ? (r.bottom + rows[i + 1].top) / 2 : NaN));
    const d = snakePath(pts, gaps);
    const dDone = done > 1 ? snakePath(pts.slice(0, Math.min(done, pts.length)), gaps) : '';
    const w = box.offsetWidth, h = box.offsetHeight;
    setGeo((g) => (g.d === d && g.dDone === dDone && g.w === w && g.h === h ? g : { d, dDone, w, h }));
  }, [done]);

  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    const box = ref.current?.parentElement;
    const settle = setTimeout(measure, 300);
    const late = setTimeout(measure, 1200);
    window.addEventListener('resize', measure);
    document.fonts?.ready?.then(measure).catch(() => {});
    let ro;
    if (box && typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(box); }
    return () => { clearTimeout(settle); clearTimeout(late); window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [measure]);

  return (
    <svg ref={ref} className={`snake-svg ${className}`} aria-hidden="true" focusable="false"
      width={geo.w || undefined} height={geo.h || undefined} viewBox={geo.w ? `0 0 ${geo.w} ${geo.h}` : undefined}>
      {/* userSpaceOnUse, down the whole list: a bounding-box gradient on the phone layout's
          straight vertical line has a zero-width box and draws nothing. */}
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={geo.h || 1}>
          <stop offset="0" className="snake-stop-a" />
          <stop offset="1" className="snake-stop-b" />
        </linearGradient>
      </defs>
      {geo.d && <path className="snake-ahead" d={geo.d} />}
      {geo.dDone && <path className="snake-walked" d={geo.dDone} pathLength="1" style={{ stroke: `url(#${gid})` }} />}
    </svg>
  );
}
