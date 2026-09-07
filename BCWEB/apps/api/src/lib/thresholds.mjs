// What counts as "needs attention", written once.
//
// The monitor evaluates these and the admin route exposes them for editing. Held in two
// places, the two drift in a way neither reports: a threshold the monitor honours but the
// route does not list is one nobody can change, and one the route lists with no check behind
// it is a field that saves and does nothing. Both look like the feature working.
//
// Every value is a number, and every one is a CEILING that fires when reached — including the
// `…FreeGB` ones, which fire when the remaining space falls TO or BELOW them. Percentage and
// absolute sit side by side on purpose: a percentage is the right unit while a server is small
// and the wrong one once it is large. 10% of 4 TB is 400 GB of headroom, which is not an
// emergency; 10% of 20 GB is two.
export const ALERT_THRESHOLDS = {
  cpuPct: 90,
  memPct: 90,
  diskPct: 90,
  // One hosting pool, filling up. Affects its owner.
  storagePct: 85,
  // The SERVER's own ceiling — every pool and reservation against what the machine can hold.
  // A different question, and the one that affects everybody: overselling shows up here first.
  capacityPct: 85,
  capacityFreeGB: 10,
  // BMM telemetry keeps its own database with its own allocation. Full, it drops reports
  // silently, because a client that cannot send telemetry carries on working.
  telemetryPct: 85,
  telemetryFreeGB: 1,
  vitalsPoorPct: 25,
  vitalsMinSamples: 20,
  errorBurst: 10,
};

/** The keys, for a route that has to build a schema from them. */
export const ALERT_THRESHOLD_KEYS = Object.keys(ALERT_THRESHOLDS);

/**
 * The configured thresholds, defaults filled in.
 *
 * This exact function existed TWICE — privately in monitor.mjs and inline in the
 * server-perf route — reading the same AdminSetting key with the same fallback rules. That is
 * the drift this file's header warns about, one level up: not the thresholds held in two
 * places, but the READING of them. A stored value the monitor accepts and the route rejects
 * (or the reverse) is a server alerting on a number the screen does not show.
 */
export async function readThresholds(p) {
  const row = await p.adminSetting.findUnique({ where: { key: 'alerts.thresholds' } }).catch(() => null);
  const stored = (row?.value && typeof row.value === 'object') ? row.value : {};
  const out = { ...ALERT_THRESHOLDS };
  for (const k of ALERT_THRESHOLD_KEYS) {
    const n = Number(stored[k]);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

/**
 * Is the machine all right? — the whole of Simple mode, in one answer.
 *
 * PURE: the latest sample and the thresholds in, a verdict out. No database, so it can be
 * tested against every boundary rather than against whatever the server happens to be doing.
 *
 * Simple mode used to be the same wall of gauges with the sections collapsed: the numbers
 * were all there and the reader still had to know that 87% disk is fine and 91% is not. The
 * thresholds already encode that, and the monitor already alerts on them — this reports the
 * SAME comparison against the live sample, so what the screen says and what fires an alert
 * cannot disagree.
 *
 * Three states, deliberately. "watch" exists because a server at 86% of a 90% ceiling is not
 * healthy and not an emergency, and collapsing that into a green light is how a disk fills up
 * overnight with the dashboard saying everything is fine.
 *
 * @param {{cpuPct?:number, memPct?:number, diskPct?:number, createdAt?:Date|string}|null} s
 * @param {Record<string, number>} t
 * @param {{staleAfterMin?: number, now?: number}} [opts]
 */
export function serverVerdict(s, t, opts = {}) {
  const staleAfterMin = opts.staleAfterMin ?? 30;
  const now = opts.now ?? Date.now();
  if (!s) return { state: 'unknown', reasons: [{ key: 'nosample', text: 'No sample yet — the monitor has not run.' }] };

  const age = s.createdAt ? (now - new Date(s.createdAt).getTime()) / 60000 : 0;
  // A stale sample is not a healthy one. Reporting the last known numbers as if they were
  // current is worse than saying nothing: the one case where the machine is in trouble is
  // also the case where it stops writing samples.
  if (age > staleAfterMin) {
    return { state: 'unknown', age, reasons: [{ key: 'stale', text: `Last sample is ${Math.round(age)} min old — the monitor may have stopped.` }] };
  }

  const reasons = [];
  // 90% of the ceiling is the "watch" line: near enough to act on, far enough not to page.
  const WATCH = 0.9;
  const check = (key, value, ceiling, label) => {
    if (!Number.isFinite(value) || !Number.isFinite(ceiling) || ceiling <= 0) return;
    const pct = Math.round(value);
    if (value >= ceiling) reasons.push({ key, level: 'problem', value: pct, ceiling, text: `${label} at ${pct}% (limit ${ceiling}%).` });
    else if (value >= ceiling * WATCH) reasons.push({ key, level: 'watch', value: pct, ceiling, text: `${label} at ${pct}%, approaching the ${ceiling}% limit.` });
  };
  check('cpu', s.cpuPct, t?.cpuPct, 'CPU');
  check('mem', s.memPct, t?.memPct, 'Memory');
  check('disk', s.diskPct, t?.diskPct, 'Disk');

  const state = reasons.some((r) => r.level === 'problem') ? 'problem' : reasons.length ? 'watch' : 'ok';
  return { state, age, reasons };
}
