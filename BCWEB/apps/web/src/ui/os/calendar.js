// The tray calendar's date math (agent-bcw-os). Pure, so test/os-desk.test.mjs checks it from
// node: the popup used to be a <table>, and the site-wide `table { display: block }` (index.css,
// the phone-overflow guard) collapsed it into one line of digits, "1415161718…". The grid is a
// CSS grid of seven columns now, and every cell comes from here.
//
// Weeks start on Monday: both languages the site speaks (en-GB, fr-FR) count that way.

/** A day as a plain value (months 0-11, like Date). */
export const dayOf = (d) => ({ y: d.getFullYear(), m: d.getMonth(), d: d.getDate() });
export const sameDay = (a, b) => !!a && !!b && a.y === b.y && a.m === b.m && a.d === b.d;
const toDate = (v) => new Date(v.y, v.m, v.d);

/**
 * The 42 cells (six weeks) of a month view, Monday first. Days of the previous and next month
 * fill the edges and are marked `out`, like every OS calendar, so the grid never changes height
 * when the month does.
 */
export function calendarCells(y, m) {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  const out = [];
  for (let i = 0; i < 42; i++) {
    const v = dayOf(new Date(y, m, 1 - lead + i));
    out.push({ ...v, out: v.m !== m || v.y !== y });
  }
  return out;
}

/** The month shown after moving `n` months from { y, m }. */
export function shiftMonth(v, n) {
  const d = new Date(v.y, v.m + n, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
}

/**
 * Keyboard in the grid (the ARIA date-grid pattern): arrows move a day or a week, Home/End go to
 * the start/end of the week, PageUp/PageDown a month (Shift: a year), keeping the day of the
 * month when it exists. Returns the new focused day, or null for a key it does not handle.
 */
export function stepDay(v, key, shift = false) {
  const d = toDate(v);
  const month = (n) => {
    const target = new Date(v.y, v.m + n, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return { y: target.getFullYear(), m: target.getMonth(), d: Math.min(v.d, last) };
  };
  switch (key) {
    case 'ArrowLeft': d.setDate(d.getDate() - 1); return dayOf(d);
    case 'ArrowRight': d.setDate(d.getDate() + 1); return dayOf(d);
    case 'ArrowUp': d.setDate(d.getDate() - 7); return dayOf(d);
    case 'ArrowDown': d.setDate(d.getDate() + 7); return dayOf(d);
    case 'Home': d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayOf(d);
    case 'End': d.setDate(d.getDate() + (6 - ((d.getDay() + 6) % 7))); return dayOf(d);
    case 'PageUp': return month(shift ? -12 : -1);
    case 'PageDown': return month(shift ? 12 : 1);
    default: return null;
  }
}
