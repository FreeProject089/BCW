// The daily-metrics comparison, as pure functions.
//
// The admin's Performance tab shows the machine's daily figures (CPU, memory, disk, latency)
// and says how the window compares with the one immediately before it. That arithmetic used
// to live inline in a route handler, where nothing could test it — and "a change measured
// against no data" is exactly the kind of thing that quietly comes out as +0 %. Here it takes
// plain rows (the ServerMetricDaily shape) and returns plain numbers.
//
//   windowBounds(days, now)      → { startCur, startPrev, today, previousTo }
//   summariseDaily(rows)         → { days, samples, cpu, mem, disk, latencyMs, cpuMax, memMax, diskMax } | null
//   percentChange(cur, prev)     → number | null   (relative, in %)
//   compareDaily(cur, prev)      → { [metric]: { current, previous, abs, pct } }

/** Midnight UTC of a date. */
export const midnightUtc = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * The two windows: today back `days` days (inclusive), and the same length immediately before.
 * `days` is clamped to [1, 366] — the daily table is kept for good, but a year is the longest
 * span the screen offers and a request for 10 000 days is a mistake, not a wish.
 */
export function windowBounds(days, now = new Date()) {
  const asked = Math.round(Number(days));
  const n = Math.min(Math.max(Number.isFinite(asked) ? asked : 7, 1), 366);
  const today = midnightUtc(now);
  const startCur = new Date(today.getTime() - (n - 1) * 864e5);
  const startPrev = new Date(startCur.getTime() - n * 864e5);
  const previousTo = new Date(startCur.getTime() - 864e5);
  return { days: n, today, startCur, startPrev, previousTo };
}

// The four measures the status page used to chart, plus their peaks. Averages are weighted by
// the number of samples behind each day, so a day with four readings does not count the same
// as a day with a hundred and forty; a peak is a peak whatever the sample count.
export const DAILY_METRICS = ['cpu', 'mem', 'disk', 'latencyMs'];
const FIELD = { cpu: 'cpuAvg', mem: 'memAvg', disk: 'diskAvg', latencyMs: 'latencyAvg' };
const PEAK = { cpu: 'cpuMax', mem: 'memMax', disk: 'diskMax' };

/** One window of daily rows → its weighted averages and peaks. Empty → null, never zeros. */
export function summariseDaily(rows) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return null;
  const n = list.reduce((a, r) => a + (Number(r.samples) || 0), 0) || list.length;
  const w = (f) => list.reduce((a, r) => a + (Number(r[f]) || 0) * (Number(r.samples) || 1), 0) / n;
  const out = { days: list.length, samples: n };
  for (const m of DAILY_METRICS) out[m] = round1(w(FIELD[m]));
  for (const [m, f] of Object.entries(PEAK)) out[`${m}Max`] = round1(Math.max(...list.map((r) => Number(r[f]) || 0)));
  return out;
}

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Relative change, in percent. Null when either side is missing, and null when the previous
 * value is zero: "up from nothing" is not a percentage, and Infinity in a JSON body is null
 * anyway — better to say so on purpose.
 */
export function percentChange(cur, prev) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev === 0) return null;
  return round1(((cur - prev) / Math.abs(prev)) * 100);
}

/** Per metric: both values, the absolute difference and the relative one. */
export function compareDaily(cur, prev) {
  const out = {};
  for (const m of [...DAILY_METRICS, ...Object.keys(PEAK).map((k) => `${k}Max`)]) {
    const a = cur?.[m] ?? null;
    const b = prev?.[m] ?? null;
    out[m] = {
      current: a,
      previous: b,
      abs: a != null && b != null ? round1(a - b) : null,
      pct: percentChange(a, b),
    };
  }
  return out;
}

/** One daily row → what the charts draw. Averages rounded to a tenth, peaks alongside. */
export function dailyPoint(r) {
  return {
    day: r.day,
    cpu: round1(Number(r.cpuAvg) || 0), mem: round1(Number(r.memAvg) || 0), disk: round1(Number(r.diskAvg) || 0),
    latencyMs: r.latencyAvg == null ? null : Math.round(Number(r.latencyAvg)),
    cpuMax: round1(Number(r.cpuMax) || 0), memMax: round1(Number(r.memMax) || 0), diskMax: round1(Number(r.diskMax) || 0),
    samples: Number(r.samples) || 0,
  };
}
