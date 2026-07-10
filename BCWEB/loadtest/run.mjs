// BCWEB stress ladder: hammers representative read endpoints at escalating
// concurrency and prints a compact table + a saved JSON report. Loopback + one
// client box means the REAL upper levels (100k/1M sockets) aren't physically
// reachable here — we find the local saturation point and report honestly.
//
// Usage:
//   BASE=http://localhost:3000 node run.mjs            # API container directly
//   BASE=http://localhost      node run.mjs            # through Caddy (adds /api)
//   LEVELS=100,1000,5000 DURATION=8 node run.mjs
import autocannon from 'autocannon';
import { writeFileSync } from 'node:fs';

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/+$/, '');
// Through Caddy the API is under /api; hitting the api container directly it isn't.
const API = /localhost:3000$/.test(BASE) ? BASE : `${BASE}/api`;
const DURATION = Number(process.env.DURATION) || 10;
const LEVELS = (process.env.LEVELS || '100,1000,5000,10000').split(',').map(Number);

const TARGETS = [
  ['health (liveness)', `${API}/health`],
  ['GET /projects (DB + visibility)', `${API}/projects`],
  ['GET /showcase (DB list)', `${API}/showcase`],
  ['GET /kofi/stats (DB aggregate)', `${API}/kofi/stats`],
];

const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const pad = (s, n) => String(s).padEnd(n);

console.log(`\nBCWEB load test → ${API}  (levels: ${LEVELS.join(', ')}, ${DURATION}s each)\n`);
const results = [];
for (const [label, url] of TARGETS) {
  console.log(`■ ${label}`);
  console.log(`  ${pad('conns', 8)}${pad('req/s', 10)}${pad('2xx/s', 10)}${pad('p50', 8)}${pad('p99', 8)}${pad('non2xx', 8)}${pad('err', 6)}timeout`);
  for (const conns of LEVELS) {
    const r = await autocannon({ url, connections: conns, duration: DURATION, pipelining: 1, timeout: 20 });
    const total = r.requests.total || 1;
    const okRps = Math.round(r.requests.average * Math.max(0, (total - r.non2xx) / total));
    const row = { label, url, conns, rps: r.requests.average, okRps, p50: r.latency.p50, p99: r.latency.p99, p97_5: r.latency.p97_5, errors: r.errors, timeouts: r.timeouts, non2xx: r.non2xx, total };
    results.push(row);
    console.log(`  ${pad(fmt(conns), 8)}${pad(fmt(r.requests.average), 10)}${pad(fmt(okRps), 10)}${pad(`${r.latency.p50}ms`, 8)}${pad(`${r.latency.p99}ms`, 8)}${pad(fmt(r.non2xx), 8)}${pad(r.errors, 6)}${r.timeouts}`);
  }
  console.log('');
}
console.log('Note: on loopback, a single client easily out-runs the server; most requests\n' +
  'then come back non-2xx (the anti-abuse rate limiter + backpressure shedding load\n' +
  'BY DESIGN). 0 errors + 0 timeouts + low p99 means the server stays healthy under\n' +
  'the flood instead of falling over. "2xx/s" is the real served throughput; to\n' +
  'measure a single route raw, lower the levels or relax the limiter for that path.\n');

const out = { base: API, at: new Date().toISOString(), durationSec: DURATION, levels: LEVELS, results };
const file = new URL('./last-run.json', import.meta.url);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`Report written to ${file.pathname}`);
// Headline: best sustained req/s per endpoint (highest rps with 0 errors/timeouts).
console.log('\nHeadline (best clean req/s per endpoint):');
for (const [label] of TARGETS) {
  const clean = results.filter((r) => r.label === label && r.errors === 0 && r.timeouts === 0);
  const best = clean.sort((a, b) => b.rps - a.rps)[0];
  if (best) console.log(`  ${pad(label, 36)} ${fmt(best.rps)} req/s @ ${fmt(best.conns)} conns (p99 ${best.p99}ms)`);
}
