// Rendering + analysis for the stress ladder: turns the raw per-(scenario × level)
// autocannon rows into a saturation "knee", a bottleneck diagnosis, a minimum-spec
// extrapolation, and a Markdown report that's meant to be read by BOTH a human and an
// AI (flat tables, explicit units, a plain-language verdict per scenario). Pure
// functions only — run.mjs does the I/O.

const fmt = (n) => (n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const ms = (n) => (n == null ? '—' : `${Math.round(n)}ms`);
const pct = (n) => (n == null ? '—' : `${n.toFixed(1)}%`);

// A level's row is "clean" when the server answered without failing the client: no
// transport errors and no timeouts. non-2xx (rate-limiter 429s) is NOT a failure — it's
// the server deliberately shedding load, so a clean-but-throttled row is still healthy.
export function isClean(r) {
  return r.errors === 0 && r.timeouts === 0;
}

// The saturation knee = the highest level where the server still served real traffic
// cleanly at its best throughput. We pick the clean row with the most 2xx/s; anything
// past it either plateaus (throughput stops rising) or starts erroring/timing out.
export function findKnee(results) {
  const clean = results.filter(isClean);
  if (!clean.length) return null;
  return clean.reduce((best, r) => (r.ok2xx_s > (best?.ok2xx_s ?? -1) ? r : best), null);
}

// Plain-language bottleneck verdict for one scenario, from the shape of the ladder.
// Heuristics, not proof — but they point at the right layer to go profile.
export function diagnose(scn) {
  const rows = scn.results;
  const last = rows[rows.length - 1];
  const knee = findKnee(rows);
  const notes = [];

  const anyTimeouts = rows.some((r) => r.timeouts > 0);
  const anyErrors = rows.some((r) => r.errors > 0);
  // Ping = a trivial /health request issued DURING the flood. If its tail explodes, the
  // event loop itself is starving → CPU-bound / synchronous work on the main thread.
  const pingBlew = rows.some((r) => r.ping && r.ping.p99 >= 1000);
  const throttled = last && last.total > 0 && last.non2xx / last.total > 0.5;
  // A p99.9 far above p99 means a small fraction of requests hit something occasional and
  // slow: a GC pause, a cold query, lock contention.
  const longTail = rows.some((r) => r.p99_9 && r.p99 && r.p99_9 > r.p99 * 4 && r.p99_9 > 200);

  if (pingBlew) notes.push('**Event-loop saturation** — a bare `/health` ping timed out or spiked past 1s during the flood, so the Node main thread is CPU-starved (a handler is doing too much synchronous work). This is the ceiling to raise first: profile the hottest handler, move CPU work off-thread (the native worker), add a replica.');
  if (anyTimeouts) notes.push('**Requests timed out** at the top of the ladder — the server accepted connections it could not finish in time. Past the knee it is over capacity; that concurrency needs another replica (or the work behind it is too slow).');
  else if (!anyErrors) notes.push('**No errors, no timeouts** at any level — the server stayed healthy under the whole ladder and shed excess load cleanly rather than falling over.');
  if (throttled) notes.push('At the top level, **most responses were non-2xx** — the anti-abuse rate limiter shedding the flood *by design*. That is protection, not a failure; "2xx/s" is the real served throughput. To measure a single route raw, relax the limiter for it or lower the levels.');
  if (longTail) notes.push('**Long tail** (p99.9 ≫ p99) — a small fraction of requests hit something occasional and slow (GC pause, cold query, lock). Worth chasing for the p99.9 target specifically.');
  if (knee) notes.push(`Cleanest sustained throughput ≈ **${fmt(knee.ok2xx_s)} served req/s** at the **${knee.level}** level (${fmt(knee.conns)} conns), p99 ${ms(knee.p99)}, p99.9 ${ms(knee.p99_9)}.`);

  return notes;
}

// Minimum-server-spec extrapolation, anchored to the measured capacity on THIS box.
// Deliberately conservative + clearly heuristic: it scales the measured served-req/s per
// core linearly and converts to concurrent users at an assumed per-user request rate.
export function minSpec(meta, capacityRps) {
  const cores = meta.cores || 1;
  const perCoreRps = capacityRps / cores;
  const reqPerSecPerUser = Math.max(0.001, (meta.rpmPerUser || 6) / 60); // default: 6 req/min/active user
  const usersPerCore = perCoreRps / reqPerSecPerUser;
  const targets = [100, 1000, 10000, 100000];
  return targets.map((users) => {
    const coresNeeded = Math.max(1, Math.ceil(users / usersPerCore));
    // Very rough RAM rule: a small base + headroom per core (Node heap + PG pool + Redis
    // client). Real memory is dominated by Postgres/Redis sizing, called out in the report.
    const gb = Math.max(1, Math.ceil(0.5 + coresNeeded * 0.75));
    return { users, coresNeeded, gb, usersPerCore: Math.round(usersPerCore) };
  });
}

export function toMarkdown(meta, scenarios) {
  const L = [];
  const knees = scenarios.map((s) => ({ name: s.name, knee: findKnee(s.results) })).filter((x) => x.knee);
  // Headline peak = the best any scenario did (usually the trivial cached path).
  const overallKnee = knees.map((x) => x.knee).reduce((best, k) => (k.ok2xx_s > (best?.ok2xx_s ?? -1) ? k : best), null);
  // Capacity ANCHOR for sizing must be REPRESENTATIVE, not the /health peak: prefer the
  // realistic `mixed` blend, else the most conservative (lowest) scenario knee. Sizing a
  // fleet on a bare liveness endpoint's throughput would wildly under-provision.
  const mixed = knees.find((x) => x.name === 'mixed')?.knee;
  const lowest = knees.map((x) => x.knee).reduce((min, k) => (k.ok2xx_s < (min?.ok2xx_s ?? Infinity) ? k : min), null);
  const anchor = mixed || lowest || overallKnee;
  const capacity = anchor?.ok2xx_s || 0;

  L.push('# BCWEB stress test report');
  L.push('');
  L.push('_Escalating-concurrency load ladder across several endpoint mixes. Generated by `loadtest/run.mjs` — re-run to refresh. Machine-readable copy: `report.json`._');
  L.push('');
  L.push('## Run');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push(`| When | ${meta.at} |`);
  L.push(`| Target | \`${meta.origin}${meta.prefix}\` |`);
  L.push(`| Client box | ${meta.cores} cores · ${meta.memGB} GB RAM · Node ${meta.node} |`);
  L.push(`| Per level | ${meta.durationSec}s |`);
  L.push(`| Levels | ${meta.levels.map((l) => `${l.name} (${fmt(l.conns)})`).join(' · ')} |`);
  L.push('');
  L.push('> **Read this first.** On loopback with a single client box the upper levels do not');
  L.push('> represent real internet clients — one machine easily out-runs the server, and the');
  L.push('> anti-abuse rate limiter then sheds most of the flood **by design** (that shows up as');
  L.push('> non-2xx, *not* as errors). The honest signals here are: the **served req/s** (2xx/s),');
  L.push('> the **latency tail** (p99 / p99.9), and **where errors or timeouts first appear**.');
  L.push('');

  // Headline
  L.push('## Headline');
  L.push('');
  if (overallKnee) {
    L.push(`- **Peak clean throughput:** ~**${fmt(capacity)} served req/s** (\`${overallKnee.scenario}\` @ ${overallKnee.level}, ${fmt(overallKnee.conns)} conns) — p99 ${ms(overallKnee.p99)}, p99.9 ${ms(overallKnee.p99_9)}.`);
  } else {
    L.push('- No fully clean level was recorded (every level saw an error or timeout) — the server is under-provisioned for even the lowest level tested, or the target was unreachable.');
  }
  L.push(`- **CWV note:** Core Web Vitals (LCP/INP/CLS) are browser-side and are collected live by the in-app Web Vitals telemetry. The server-side lever on them is **TTFB**, which tracks the p50/p99 below — a faster served response is a faster TTFB is a faster LCP. See the TTFB column and the CWV section.`);
  L.push('');

  // Per-scenario tables
  for (const scn of scenarios) {
    L.push(`## Scenario: ${scn.name}`);
    L.push('');
    L.push(`_${scn.desc}_`);
    L.push('');
    L.push('| level | conns | req/s | 2xx/s | p50 | p90 | p99 | p99.9 | non-2xx | err | t/o | ping p99 |');
    L.push('|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|');
    for (const r of scn.results) {
      L.push(`| ${r.level} | ${fmt(r.conns)} | ${fmt(r.rps)} | ${fmt(r.ok2xx_s)} | ${ms(r.p50)} | ${ms(r.p90)} | ${ms(r.p99)} | ${ms(r.p99_9)} | ${fmt(r.non2xx)} | ${r.errors} | ${r.timeouts} | ${r.ping ? ms(r.ping.p99) : '—'} |`);
    }
    L.push('');
    for (const n of diagnose(scn)) L.push(`- ${n}`);
    L.push('');
  }

  // TTFB / CWV
  L.push('## Core Web Vitals (server-side contribution)');
  L.push('');
  L.push('The load ladder measures the API. The web app\'s **TTFB** — the server part of LCP/FCP —');
  L.push('is the light-load p50 of the static HTML + the hot feeds; keep it low and the browser has');
  L.push('a head start on every vital. The interactive vitals (INP, CLS) are front-end and are');
  L.push('already captured by the in-app Web Vitals collector (see `guides/` analytics). To capture');
  L.push('real lab CWV, run Lighthouse against the built site: `npx lighthouse <url> --only-categories=performance`.');
  L.push('');

  // Min spec
  L.push('## Minimum server spec (extrapolated)');
  L.push('');
  if (capacity > 0) {
    const specs = minSpec(meta, capacity);
    L.push(`Anchored to the **\`${anchor?.scenario || 'representative'}\`** scenario (the realistic blend / most conservative path, *not* the trivial /health peak): **${fmt(capacity)} served req/s on ${meta.cores} core(s)** (≈ ${fmt(capacity / meta.cores)} req/s/core), assuming **${meta.rpmPerUser} requests/min per active user** (${specs[0].usersPerCore.toLocaleString()} active users/core). Linear, conservative, and only as good as the anchor — treat as a starting point, then measure.`);
    L.push('');
    L.push('| Concurrent active users | vCPU (API) | RAM (API) | Notes |');
    L.push('|---|--:|--:|---|');
    const noteFor = (u) => (u <= 100 ? 'single small instance' : u <= 1000 ? '1–2 replicas behind the edge' : u <= 10000 ? 'horizontal replicas + managed Postgres + Redis' : 'multi-node + read replicas + CDN for static/feeds');
    for (const s of minSpec(meta, capacity)) {
      L.push(`| ${s.users.toLocaleString()} | ${s.coresNeeded} | ${s.gb} GB | ${noteFor(s.users)} |`);
    }
    L.push('');
    L.push('> These are **API-tier** numbers. In practice the first ceiling is usually **Postgres**');
    L.push('> (connection pool + slow queries) and **Redis** memory, not API CPU — size those from the');
    L.push('> DB-read scenario\'s knee, and put the static site + `catalog.json` feed behind a CDN so they');
    L.push('> never hit the origin. The API scales horizontally (stateless); the database does not for free.');
  } else {
    L.push('_No clean capacity anchor was measured, so no extrapolation is given. Lower the levels or fix reachability, then re-run._');
  }
  L.push('');

  L.push('## How to act on this');
  L.push('');
  L.push('1. **Raise the knee** for whichever scenario saturates first (usually the `feed` / DB-read path): profile that handler, add DB indexes for the query, cache harder, or move CPU work to the native worker.');
  L.push('2. **Chase p99.9** where the long-tail note fired: it is almost always a cold query or a GC pause, not average throughput.');
  L.push('3. **Protect the origin**: the static site and `catalog.json` are the same bytes for everyone — a CDN in front makes the API numbers above almost irrelevant for public reads.');
  L.push('4. **Re-run after each change** and diff `report.json` — the knee moving up is the win condition.');
  L.push('');

  return L.join('\n');
}
