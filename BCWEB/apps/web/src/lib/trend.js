/**
 * Baseline / anomaly maths for the analytics Trends view.
 *
 * Deliberately a plain module with no React and no imports: everything here is a pure
 * function over an array of numbers, which is the only reason it can be unit-tested at all.
 * The same numbers drive the KPI strip, the chart and the table view, so they are computed
 * ONCE, here — a second opinion about "how far from normal is today" living in the render
 * is how the headline figure and the chart start disagreeing.
 *
 * The whole view answers one question: **is today unusual for this site?** Absolute traffic
 * cannot answer it — a site that gets 40 views a day is not in crisis, and a site that
 * normally gets 4000 and got 400 today is. So everything is measured against the site's own
 * recent past.
 */

/**
 * A trailing MEDIAN over `w` points, `null` until there are `w` of them.
 *
 * The baseline is a median and not a mean, and this is the single decision the whole view
 * rests on. It was written as a mean first, and the test for it failed: a flat site with one
 * 20× spike — a post that got shared once — had its "normal" dragged up by 63% for the next
 * thirty days, so every ordinary day after the spike was reported as a 39% collapse and
 * flagged as a crisis. The alert fires because traffic went UP.
 *
 * Smoothing first does not save a mean; the spike is still in the window. A median over
 * thirty days does not move unless more than half of them moved, which is the definition of
 * "normal changed" rather than "something happened once".
 */
export function rollingMedian(values, w) {
  const out = new Array(values.length).fill(null);
  if (!(w >= 1)) return out;
  for (let i = w - 1; i < values.length; i++) {
    const win = values.slice(i - w + 1, i + 1).sort((a, b) => a - b);
    const m = win.length >> 1;
    out[i] = win.length % 2 ? win[m] : (win[m - 1] + win[m]) / 2;
  }
  return out;
}

/**
 * The smoothed line the chart draws.
 *
 * Trailing, not centred, and that is the point: a centred window would let a value be shaped
 * by days that had not happened yet, so the last few points of the chart would keep changing
 * for a week after they were drawn. Somebody watching a drop needs the line to mean the same
 * thing tomorrow as it meant when they looked at it.
 *
 * Short windows at the start are averaged over what exists rather than dropped, so the chart
 * starts at day one instead of a week in.
 */
export function smooth(values, w) {
  return values.map((_, i) => {
    const from = Math.max(0, i - w + 1);
    const slice = values.slice(from, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** How far each point sits from its baseline, as a PERCENTAGE of that baseline. */
export function distancePct(line, base) {
  return line.map((v, i) => {
    const b = base[i];
    // A baseline of zero has no percentage — the site had no traffic to be up or down from.
    if (b == null || b <= 0) return null;
    return ((v - b) / b) * 100;
  });
}

/**
 * A y-axis ceiling that one exceptional value cannot set.
 *
 * Drawn against a plain max, a site that got shared once has a chart where the viral week is
 * a pillar and the other fifty-one weeks are a flat smear along the bottom — the axis is
 * spent on the one day nobody needs a chart to know about. Seen in the first render of this
 * view: a 20× day put the whole year into the bottom fifth of the plot.
 *
 * So the ceiling is a high percentile, floored so it can never crop the ordinary range, and
 * the caller draws anything above it clamped AND says so. Clamping silently would be the
 * worse bug of the two.
 */
export function robustCeiling(values, { percentile = 0.98, floor = 0 } = {}) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (!v.length) return Math.max(floor, 1);
  const sorted = [...v].sort((a, b) => a - b);
  const p = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))];
  // Never above the real maximum (an all-quiet series must not get a ceiling it never reaches)
  // and never below the floor the caller needs visible.
  return Math.max(1, Math.min(sorted[sorted.length - 1], Math.max(p, floor)));
}

/** low / medium / high → how far below normal counts as an event, in % of baseline. */
export const SENSITIVITY = { low: 40, medium: 25, high: 15 };

/**
 * Auto-flagged drops.
 *
 * One marker per EPISODE, not per day. A four-day slump is one thing that happened, and
 * flagging each of its days turns the chart into a picket fence that says nothing about how
 * many times the site actually fell over. So a contiguous run below the threshold is
 * collapsed to its deepest day, which is also the day worth looking at in the logs.
 *
 * `minRun` exists because a single bad day is usually a bad day — a bank holiday, a bot that
 * stopped, a CDN blip. Two consecutive days below normal is a pattern.
 */
export function flagDrops(days, dist, { sensitivity = 'medium', minRun = 2 } = {}) {
  const threshold = SENSITIVITY[sensitivity] ?? SENSITIVITY.medium;
  const events = [];
  let run = [];
  const close = () => {
    if (run.length >= minRun) {
      const worst = run.reduce((a, b) => (dist[b] < dist[a] ? b : a));
      events.push({ i: worst, day: days[worst], drop: dist[worst], length: run.length });
    }
    run = [];
  };
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] != null && dist[i] <= -threshold) run.push(i); else close();
  }
  close();
  return events;
}

/**
 * Trajectory over the last `w` days: the mean of that window against the mean of the window
 * before it, as a % change.
 *
 * Not "last value minus the value w days ago", which is what a trajectory usually means and
 * is the wrong answer here — it reads two single days, so a quiet Sunday at either end
 * invents a trend that is really just the weekend. Comparing two whole windows cannot.
 *
 * Returns null when there is not enough history for BOTH windows, rather than comparing a
 * full window against a partial one and reporting the difference as a trend.
 */
export function trajectory(values, w) {
  if (values.length < w * 2) return null;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const now = mean(values.slice(-w));
  const before = mean(values.slice(-w * 2, -w));
  if (before <= 0) return now > 0 ? 100 : 0;
  return ((now - before) / before) * 100;
}

/**
 * Everything the view needs, from the raw daily rows.
 *
 * `rows` are the zero-filled `{ day, views, visitors }` the API returns; `metric` picks the
 * column. The result carries the raw values too, because the table view has to show what was
 * measured and not only what was smoothed.
 */
export function analyseTrend(rows, { metric = 'views', baselineWindow = 30, smoothWindow = 7, sensitivity = 'medium' } = {}) {
  const days = rows.map((r) => r.day);
  const raw = rows.map((r) => Number(r[metric]) || 0);
  const line = smooth(raw, smoothWindow);
  // Built from the smoothed line so the baseline does not jitter with the weekend — and a
  // median, not a mean, so one exceptional day cannot redefine normal (see rollingMedian).
  const base = rollingMedian(line, baselineWindow);
  const dist = distancePct(line, base);
  const events = flagDrops(days, dist, { sensitivity });
  const last = line.length - 1;
  return {
    days, raw, line, base, dist, events,
    now: line[last] ?? 0,
    baseNow: base[last] ?? null,
    vsBaseline: dist[last] ?? null,
    d14: trajectory(raw, 14),
    d30: trajectory(raw, 30),
    d90: trajectory(raw, 90),
  };
}
