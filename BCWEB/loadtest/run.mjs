// BCWEB stress ladder: hammers representative endpoints at escalating concurrency
// and prints a compact table. Loopback + one client box means REAL upper levels
// (100k/1M sockets) aren't physically reachable here — we find the local
// saturation point and report honestly.
import autocannon from 'autocannon';

const TARGETS = [
  ['SPA shell (nginx via caddy)', 'http://localhost/'],
  ['GET /api/projects (DB+visibility)', 'http://localhost/api/projects'],
  ['GET /api/showcase (DB list)', 'http://localhost/api/showcase'],
  ['GET /api/kofi/stats (DB aggregate)', 'http://localhost/api/kofi/stats'],
];
const LEVELS = [100, 1000, 5000, 10000];

function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)); }

const results = [];
for (const [label, url] of TARGETS) {
  for (const conns of LEVELS) {
    const r = await autocannon({
      url, connections: conns, duration: 10, pipelining: 1, timeout: 20,
      // rate limiter off — we want max throughput per level
    });
    results.push({
      label, conns,
      rps: r.requests.average, p50: r.latency.p50, p97: r.latency.p97_5 ?? r.latency.p99, p99: r.latency.p99,
      errors: r.errors, timeouts: r.timeouts, non2xx: r.non2xx,
    });
    console.log(`${label} @ ${fmt(conns)} conns → ${fmt(r.requests.average)} req/s | p50 ${r.latency.p50}ms p99 ${r.latency.p99}ms | err ${r.errors} timeout ${r.timeouts} non2xx ${r.non2xx}`);
  }
}
console.log('\nJSON_RESULTS ' + JSON.stringify(results));
