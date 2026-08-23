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
