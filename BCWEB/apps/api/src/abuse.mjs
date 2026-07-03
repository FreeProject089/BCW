// Lightweight anti-DDoS / anti-bot guards that run BEFORE routing, so junk
// traffic (vuln scanners, bad bots, exploit probes) is rejected as cheaply as
// possible — no DB, no route handler. This complements, and sits in front of:
//   - the per-IP rate limiter (@fastify/rate-limit, with `ban` below),
//   - the proof-of-work gate on signup/contact (real anti-bot for those),
//   - Caddy's own connection handling.
//
// Deliberately a DENYLIST, not an allowlist: legitimate custom clients (the BMM
// Tauri app, the Ko-fi webhook, the Discord bot) must keep working, so we only
// reject traffic that is unambiguously hostile.

// Known attack-tool / aggressive-scraper User-Agents. Substring match, lowercased.
const BAD_UA = [
  'sqlmap', 'nikto', 'nmap', 'masscan', 'zgrab', 'nuclei', 'wpscan', 'dirbuster',
  'gobuster', 'feroxbuster', 'httrack', 'acunetix', 'nessus', 'openvas', 'metasploit',
  'havij', 'evilscan', 'python-requests/0', 'go-http-client/0', 'semrushbot',
  'ahrefsbot', 'mj12bot', 'dotbot', 'petalbot', 'bytespider',
];

// Paths that only ever come from vuln scanners hunting for other stacks —
// there's nothing here to serve, so 403 immediately instead of running the SPA
// fallback / DB lookups. Anchored to the start of the path.
const SCAN_PATHS = [
  '/wp-login', '/wp-admin', '/wp-content', '/xmlrpc.php', '/.env', '/.git',
  '/.aws', '/phpmyadmin', '/administrator', '/vendor/phpunit', '/cgi-bin',
  '/actuator', '/.well-known/security', '/config.json', '/.ssh', '/backup.sql',
  '/shell', '/eval-stdin.php', '/hudson', '/solr/',
];

// Per-IP strike counter for scan/bad-UA hits — repeat offenders get a short,
// in-memory hard block so a scanner sweeping hundreds of paths stops costing us
// anything. Bounded map (evicts oldest) so it can't grow unbounded under a
// spoofed-IP flood.
const strikes = new Map(); // ip -> { n, until }
const MAX_TRACKED = 20000;
const BLOCK_MS = 10 * 60 * 1000;
const STRIKE_LIMIT = 6;

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  return req.ip || '0.0.0.0';
}

function strike(ip) {
  if (strikes.size > MAX_TRACKED) { const k = strikes.keys().next().value; strikes.delete(k); }
  const rec = strikes.get(ip) || { n: 0, until: 0 };
  rec.n += 1;
  if (rec.n >= STRIKE_LIMIT) rec.until = Date.now() + BLOCK_MS;
  strikes.set(ip, rec);
}

export function installAbuseGuards(app) {
  app.addHook('onRequest', (req, reply, done) => {
    const ip = clientIp(req);
    const rec = strikes.get(ip);
    if (rec?.until && rec.until > Date.now()) { reply.code(429).send({ error: 'temporarily_blocked' }); return; }

    const ua = String(req.headers['user-agent'] || '').toLowerCase();
    // A totally missing UA on a browser navigation (GET html) is almost always a
    // bot; but many legit programmatic clients omit it, so only flag it as ONE
    // signal — combined with a scan path below it earns a strike, alone it passes.
    if (ua && BAD_UA.some((b) => ua.includes(b))) { strike(ip); reply.code(403).send({ error: 'forbidden' }); return; }

    const path = (req.raw.url || '').split('?')[0].toLowerCase();
    if (SCAN_PATHS.some((p) => path.startsWith(p))) { strike(ip); reply.code(404).send({ error: 'not_found' }); return; }

    done();
  });
}
