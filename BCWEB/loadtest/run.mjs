// BCWEB stress ladder — hammers several representative endpoint MIXES ("scenarios") at an
// escalating, NAMED concurrency ladder (chill → extreme), captures the full latency tail
// (p50 → p99.9) plus a live event-loop responsiveness probe, and writes a human+AI-readable
// Markdown report (+ machine-readable JSON) with a saturation knee, a bottleneck diagnosis,
// and an extrapolated minimum server spec. See report.mjs for the analysis/rendering.
//
// Usage:
//   BASE=http://localhost:3000 node run.mjs        # straight at the API container
//   BASE=http://localhost      node run.mjs        # through Caddy (adds /api)
//   QUICK=1 node run.mjs                            # 2 low levels, 5s each (smoke)
//   DURATION=15 LEVELS=chill,normal,busy node run.mjs
//   CONNS=10,100,1000 node run.mjs                  # custom numeric ladder
//   SCENARIOS=cached,feed node run.mjs              # subset of mixes
//   RPM_PER_USER=6 node run.mjs                     # tune the min-spec user model
import autocannon from 'autocannon';
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { toMarkdown, findKnee } from './report.mjs';
import { toHtml } from './report-html.mjs';

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/+$/, '');
const u = new URL(BASE);
const ORIGIN = `${u.protocol}//${u.host}`;
// Through Caddy the API lives under /api; hitting the api process directly it doesn't. Any
// explicit non-web port (e.g. :3000, :3010) means we're talking straight to the API; a bare
// host or :80/:443 means we're going through the edge (add /api). Override with API_PREFIX.
const direct = /:\d+$/.test(u.host) && !/:(80|443)$/.test(u.host);
const PREFIX = process.env.API_PREFIX != null ? process.env.API_PREFIX : (direct ? '' : '/api');
const p = (ep) => `${PREFIX}${ep}`;

const QUICK = process.env.QUICK === '1';
const DURATION = Number(process.env.DURATION) || (QUICK ? 5 : 10);
const RPM_PER_USER = Number(process.env.RPM_PER_USER) || 6;

// Named concurrency ladder — "chill" is a calm day, "extreme" pushes the box to its knees.
let LEVELS = [
  { name: 'chill', conns: 10 },
  { name: 'normal', conns: 50 },
  { name: 'busy', conns: 200 },
  { name: 'heavy', conns: 1000 },
  { name: 'extreme', conns: 5000 },
];
if (QUICK) LEVELS = LEVELS.slice(0, 2);
if (process.env.CONNS) LEVELS = process.env.CONNS.split(',').map((c, i) => ({ name: ['chill', 'normal', 'busy', 'heavy', 'extreme', 'insane'][i] || `L${i}`, conns: Number(c) }));
if (process.env.LEVELS) { const want = process.env.LEVELS.split(',').map((s) => s.trim()); LEVELS = LEVELS.filter((l) => want.includes(l.name)); }

// Scenarios = endpoint MIXES exercising different data shapes/costs. autocannon cycles the
// requests round-robin per connection, so repeating an entry weights it.
const ALL_SCENARIOS = [
  { name: 'cached', desc: 'Cheap cached / liveness reads (L1+L2 cache + event loop): /health, /kofi/stats.', endpoints: ['/health', '/kofi/stats'] },
  { name: 'db-read', desc: 'DB-backed list queries (Postgres + visibility filtering): /projects, /showcase, /catalog.', endpoints: ['/projects', '/showcase', '/catalog'] },
  { name: 'feed', desc: 'Heaviest public render — the top-500 catalog feed (DB query + payload build): /catalog.json.', endpoints: ['/catalog.json?project=bmm&kind=app'] },
  { name: 'mixed', desc: 'Realistic blend, weighted to reads: 3× /health, 1× /projects, 1× /showcase, 1× /catalog.json.', endpoints: ['/health', '/health', '/health', '/projects', '/showcase', '/catalog.json?project=bmm&kind=app'] },
];
let SCENARIOS = ALL_SCENARIOS;
if (process.env.SCENARIOS) { const want = process.env.SCENARIOS.split(',').map((s) => s.trim()); SCENARIOS = ALL_SCENARIOS.filter((s) => want.includes(s.name)); }

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const pad = (s, n) => String(s).padEnd(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// While a level runs, poke a bare /health every ~400ms and record how long it takes. A
// healthy server answers in a few ms even mid-flood; if these spike or time out, the event
// loop is starving (CPU-bound handler) — the single most useful bottleneck signal for Node.
async function withPingProbe(fn) {
  const samples = [];
  let stop = false;
  const url = ORIGIN + p('/health');
  const loop = (async () => {
    while (!stop) {
      const t = performance.now();
      try { await fetch(url, { signal: AbortSignal.timeout(2000) }); samples.push(performance.now() - t); }
      catch { samples.push(2000); } // treat a timeout/abort as the 2s ceiling
      await sleep(400);
    }
  })();
  const result = await fn();
  stop = true;
  await loop;
  samples.sort((a, b) => a - b);
  const at = (q) => (samples.length ? samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] : null);
  return { result, ping: samples.length ? { p50: at(0.5), p99: at(0.99), max: samples[samples.length - 1], n: samples.length } : null };
}

function rowFrom(scn, level, r, ping) {
  const total = r.requests.total || 1;
  const ok = r['2xx'] != null ? r['2xx'] : Math.max(0, total - r.non2xx);
  const ok2xx_s = Math.round(r.requests.average * (ok / total));
  return {
    scenario: scn.name, level: level.name, conns: level.conns,
    rps: Math.round(r.requests.average), ok2xx_s,
    p50: r.latency.p50, p90: r.latency.p90, p99: r.latency.p99, p99_9: r.latency.p99_9, p99_99: r.latency.p99_99,
    non2xx: r.non2xx, errors: r.errors, timeouts: r.timeouts,
    bytesPerSec: Math.round(r.throughput.average || 0),
    ping,
  };
}

console.log(`\nBCWEB stress test → ${ORIGIN}${PREFIX}`);
console.log(`  levels: ${LEVELS.map((l) => `${l.name}(${fmt(l.conns)})`).join(' ')}  ·  ${DURATION}s each  ·  scenarios: ${SCENARIOS.map((s) => s.name).join(', ')}\n`);

const meta = {
  at: new Date().toISOString(), origin: ORIGIN, prefix: PREFIX,
  node: process.version, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 1e9),
  durationSec: DURATION, levels: LEVELS, rpmPerUser: RPM_PER_USER,
};

const scenarioOut = [];
for (const scn of SCENARIOS) {
  console.log(`■ ${scn.name} — ${scn.desc}`);
  console.log(`  ${pad('level', 9)}${pad('conns', 8)}${pad('req/s', 9)}${pad('2xx/s', 9)}${pad('p50', 8)}${pad('p99', 8)}${pad('p99.9', 9)}${pad('non2xx', 8)}${pad('err', 5)}${pad('t/o', 5)}pingp99`);
  const requests = scn.endpoints.map((ep) => ({ method: 'GET', path: p(ep) }));
  const results = [];
  for (const level of LEVELS) {
    const { result: r, ping } = await withPingProbe(() =>
      autocannon({ url: ORIGIN, requests, connections: level.conns, duration: DURATION, pipelining: 1, timeout: 20 }));
    const row = rowFrom(scn, level, r, ping);
    results.push(row);
    console.log(`  ${pad(level.name, 9)}${pad(fmt(level.conns), 8)}${pad(fmt(row.rps), 9)}${pad(fmt(row.ok2xx_s), 9)}${pad(`${row.p50}ms`, 8)}${pad(`${row.p99}ms`, 8)}${pad(`${row.p99_9}ms`, 9)}${pad(fmt(row.non2xx), 8)}${pad(row.errors, 5)}${pad(row.timeouts, 5)}${ping ? `${Math.round(ping.p99)}ms` : '—'}`);
    await sleep(500); // let the rate-limiter window + sockets settle between levels
  }
  const knee = findKnee(results);
  console.log(`  → knee: ${knee ? `${fmt(knee.ok2xx_s)} req/s @ ${knee.level} (p99 ${knee.p99}ms, p99.9 ${knee.p99_9}ms)` : 'none clean'}\n`);
  scenarioOut.push({ ...scn, results, knee });
}

// Write the reports — every run emits both languages (the repo convention), so the FR copy
// can't silently rot behind the EN one.
const json = { meta, scenarios: scenarioOut };
writeFileSync(new URL('./report.json', import.meta.url), JSON.stringify(json, null, 2));
// Keep the legacy filename working for anything that read it.
writeFileSync(new URL('./last-run.json', import.meta.url), JSON.stringify(json, null, 2));

// report.html is the one to actually LOOK at: self-contained (no CDN/build), open it straight
// from the filesystem. The <head> is added here so the file stands alone in a browser; each
// language links to the other.
const page = (lang, altHref) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${lang === 'fr' ? 'Rapport de stress BCWEB' : 'BCWEB stress report'} — ${meta.at}</title>
<style>html,body{margin:0;padding:0}</style></head><body>
${toHtml(meta, scenarioOut, lang, altHref)}
</body></html>`;
writeFileSync(new URL('./report.html', import.meta.url), page('en', './report.fr.html'));
writeFileSync(new URL('./report.fr.html', import.meta.url), page('fr', './report.html'));
writeFileSync(new URL('./report.md', import.meta.url), toMarkdown(meta, scenarioOut, 'en'));
writeFileSync(new URL('./report.fr.md', import.meta.url), toMarkdown(meta, scenarioOut, 'fr'));

const overall = scenarioOut.map((s) => s.knee).filter(Boolean).sort((a, b) => b.ok2xx_s - a.ok2xx_s)[0];
console.log('────────────────────────────────────────────────────────');
console.log(`Peak clean throughput: ${overall ? `${fmt(overall.ok2xx_s)} served req/s (${overall.scenario} @ ${overall.level})` : 'none clean — lower the levels or check reachability'}`);
const here = decodeURIComponent(new URL('.', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
console.log(`\nReports written to ${here}`);
console.log('  report.html / report.fr.html  ← open one of these (charts + tables + diagnosis, self-contained)');
console.log('  report.md   / report.fr.md    same thing as text');
console.log('  report.json                   machine-readable — diff it between runs; the knee moving up is the win\n');
