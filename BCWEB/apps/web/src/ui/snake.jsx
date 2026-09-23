// A snake path: numbered stops joined by one thick coloured line that swings left and right
// down the page (the landing's "Get going" steps, and the snake landing template).
//
// The line is computed from where the stops actually ARE, not drawn for one layout. Every
// element marked `data-snake-dot` inside the container is a stop; the path runs through their
// centres, stop to stop, as a cubic curve whose tangents are vertical at each stop. Two stops on
// opposite sides make the S of the snake; two stops in one column (the phone layout, where every
// stop sits on the start edge) make a straight vertical line, with no special case for it.
//
// Measured on mount, on a window resize, on a web font arriving, after a short settle, and by a
// ResizeObserver. The observer alone is not enough: a tab that is not painting never calls it,
// and a path measured once against a layout that then moves is a line through the wrong places.
//
// Decoration only: `aria-hidden`, no text, and the stops are real list items that read in
// order without it. The draw-in follows the section's reveal; reduced motion shows it drawn.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import './snake.css';

function pathThrough(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1], b = pts[i];
    const my = (a.y + b.y) / 2;
    d += ` C${a.x.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}

/**
 * Put it as the FIRST child of a `position: relative` container that holds the stops.
 *
 *   done     how many stops, from the first, are done: the line up to the last done stop is
 *            drawn in the success colour, the rest in the accent.
 *   width    the stroke, in px (default 8).
 */
export function SnakePath({ done = 0, width = 8, className = '' }) {
  const ref = useRef(null);
  const [geo, setGeo] = useState({ d: '', dDone: '', w: 0, h: 0 });

  const measure = useCallback(() => {
    const svg = ref.current;
    const box = svg?.parentElement;
    if (!box) return;
    const r = box.getBoundingClientRect();
    if (!r.width) return;
    const pts = [...box.querySelectorAll('[data-snake-dot]')].map((el) => {
      const q = el.getBoundingClientRect();
      return { x: q.left + q.width / 2 - r.left, y: q.top + q.height / 2 - r.top };
    });
    const d = pathThrough(pts);
    const dDone = done > 1 ? pathThrough(pts.slice(0, Math.min(done, pts.length))) : '';
    setGeo((g) => (g.d === d && g.dDone === dDone && g.w === r.width && g.h === r.height ? g : { d, dDone, w: r.width, h: r.height }));
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
      width={geo.w || undefined} height={geo.h || undefined} viewBox={geo.w ? `0 0 ${geo.w} ${geo.h}` : undefined}
      style={{ '--snake-w': `${width}px` }}>
      {geo.d && <path className="snake-under" d={geo.d} />}
      {geo.d && <path className="snake-line" d={geo.d} pathLength="1" />}
      {geo.dDone && <path className="snake-done" d={geo.dDone} />}
    </svg>
  );
}
