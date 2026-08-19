// Show your local BCWEB to somebody who is not on this machine.
//
//   node infra/tunnel.mjs
//
// Starts a Cloudflare quick tunnel in front of the local stack, tells Caddy to answer on the
// hostname it hands out, and prints the address to share. Ctrl-C ends it and puts the config
// back.
//
// It points at 5176 — the port SITE_DOMAIN names and the one Caddy serves the site on — so a
// shared link gets the whole thing through the same edge you use locally: the web app, /api,
// the security headers, the CSP. Tunnelling the web container directly would skip Caddy and
// leave the API unreachable from the link.
//
// The hostname part is NOT optional, and the way it fails is quiet. Caddy matches sites by
// Host: a request arriving as `something.trycloudflare.com` does not match the `localhost`
// site block, and Caddy answers 200 WITH AN EMPTY BODY — not a 404, an empty success.
// Measured on this stack: `Host: localhost` returns 1044 bytes on `/`, any other Host returns
// 0. Without TUNNEL_DOMAIN the tunnel connects, the browser shows a blank page, and nothing
// anywhere says why.
//
// (That same empty 200 is why `curl http://127.0.0.1:5176/…` can look broken while the site
// is fine — curl sends `Host: 127.0.0.1:5176`. Test the edge with `-H "Host: localhost"`.)
//
// TUNNEL_DOMAIN alone makes the site REACHABLE, not usable. SITE_URL is what the API builds
// every absolute link from — e-mail verification, password reset, OAuth callbacks — and it
// still said http://localhost:5176. So a visitor loaded the site fine, asked to verify their
// address, and got a link to THEIR OWN machine. The site worked; everything that leaves it
// and comes back did not.
//
// So SITE_URL follows the tunnel too, and goes back to what it was on exit. It is the https
// address WITHOUT a port — the public one the visitor's browser uses — where TUNNEL_DOMAIN is
// the http origin Caddy matches on :5176. Two different things that happen to share a
// hostname, which is exactly why one of them was easy to forget.
//
// OAUTH STILL WILL NOT WORK, and no change here can fix it: Discord and GitHub only accept a
// redirect_uri registered in their app settings, and this hostname is different every run.
// Tell your tester to sign up with an e-mail address.
//
// A quick tunnel needs no Cloudflare account. The URL is random and dies with this process,
// which is the right trade for "let a friend look for an hour"; a stable address is a named
// tunnel and wants an account.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const PORT = 5176;
// fileURLToPath, not `new URL(...).pathname`: the latter percent-encodes, so a checkout under
// a directory with a space in its name ("Better Project") yields a path containing %20 and
// every file read fails with ENOENT on a path that looks almost right.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPOSE = path.join(HERE, 'compose');
const ENV_FILE = path.join(COMPOSE, '.env');
const KEY = 'TUNNEL_DOMAIN';
const SITE = 'SITE_URL';
const say = (m) => console.log(`[tunnel] ${m}`);

const readEnvRaw = () => (fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '');

/** The current value of one key, or null. Captured before anything is changed so the
 *  original can go back verbatim — SITE_URL had a real value, unlike TUNNEL_DOMAIN, and
 *  deleting it would silently fall back to a compose default that may not match. */
function readEnv(key) {
  const line = readEnvRaw().split(/\r?\n/).find((l) => l.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf('=') + 1) : null;
}

/** Set or clear keys in the compose .env, leaving the rest and its line endings alone.
 *  A null value removes the key. */
function setEnv(entries) {
  const raw = readEnvRaw();
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const keys = Object.keys(entries);
  const kept = raw.split(/\r?\n/).filter((l) => !keys.some((k) => l.trim().startsWith(`${k}=`)));
  for (const [k, v] of Object.entries(entries)) if (v) kept.push(`${k}=${v}`);
  fs.writeFileSync(ENV_FILE, kept.join(eol));
}

// What SITE_URL was before this run, so it can be put back exactly.
const SITE_WAS = readEnv(SITE);

// Caddy alone. Restarting the stack to change one hostname would drop the API for anybody
// already using it.
const reloadCaddy = () => execFileSync('docker', ['compose', 'up', '-d', 'caddy'], { cwd: COMPOSE, stdio: 'inherit' });

// The API reads SITE_URL once, at module load. `docker compose restart` does NOT re-read the
// .env — only a recreate does, which is the difference between the change taking effect and
// appearing to.
//
// Only the api. The bot also receives SITE_URL, and bouncing it drops its Discord gateway
// connection for a demo it is not part of; links it posts during the tunnel keep pointing at
// localhost, which is a smaller problem than a bot that reconnects mid-session.
const recreateApi = () => execFileSync('docker', ['compose', 'up', '-d', '--force-recreate', 'api'], { cwd: COMPOSE, stdio: 'inherit' });

const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let url = null;
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // The hostname comes back OUT: left behind, the config claims to serve an address that no
  // longer resolves — harmless, and a lie the next person has to disprove.
  //
  // SITE_URL goes back to what it WAS, not to nothing: leaving it on a dead tunnel would send
  // every verification e-mail from this machine to an address that no longer exists, long
  // after the tunnel is forgotten.
  try {
    setEnv({ [KEY]: null, [SITE]: SITE_WAS });
    reloadCaddy();
    recreateApi();
  } catch { /* leaving it set breaks nothing that a re-run will not fix */ }
  try { child.kill(); } catch { /* already gone */ }
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

// cloudflared prints the assigned URL inside a box, on stderr in current builds. Matched by
// SHAPE rather than by line position, which moves between releases.
for (const stream of [child.stdout, child.stderr]) {
  readline.createInterface({ input: stream }).on('line', (line) => {
    const m = !url && line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (!m) return;
    url = m[0];
    // `http://host:5176`, with BOTH the scheme and the port.
    //
    // A bare hostname makes Caddy treat it as a public site: it listens on 443 and tries to
    // provision a certificate for a name it does not control. The tunnel already terminates
    // TLS and forwards plain HTTP to :5176, so requests keep arriving on a port that address
    // is not listening on — and Caddy answers its empty 200 again. Two silent failures that
    // look identical from outside; only the port tells them apart.
    setEnv({
      [KEY]: `http://${url.replace(/^https:\/\//, '')}:${PORT}`,
      // No port: this is the address the visitor's browser uses, and the tunnel terminates
      // TLS on 443. A port here would appear in every e-mail link and reach nothing.
      [SITE]: url,
    });
    say('telling Caddy to answer on that hostname…');
    try { reloadCaddy(); } catch (e) { say(`could not reload Caddy: ${e.message}`); return stop(1); }
    say('rebuilding the API so its links point at the tunnel…');
    try { recreateApi(); } catch (e) { say(`could not recreate the api: ${e.message}`); return stop(1); }
    say('');
    say(`  Share this:  ${url}`);
    say('');
    say('  It reaches YOUR machine, through the same Caddy you use locally.');
    say('  Sign-ups, uploads and payments on it are the real ones on this instance.');
    say('  Ctrl-C ends the tunnel, puts SITE_URL back, and the address stops working.');
    say('');
    say('  Sign-in by e-mail works. OAUTH DOES NOT: Discord and GitHub only accept a');
    say('  redirect_uri registered in their app settings, and this hostname is new every run.');
    say('');
    say(`  While this runs, SITE_URL is https — so cookies are Secure and signing in at`);
    say(`  http://localhost:${PORT} will not work until you Ctrl-C.`);
    say('');
  });
}

child.on('exit', (code) => {
  if (!url) {
    say('cloudflared exited before printing a URL.');
    say('Check it is installed (`cloudflared --version`) and that the stack is up:');
    say(`  curl -s -o /dev/null -w "%{http_code}" -H "Host: localhost" http://127.0.0.1:${PORT}/   → expect 200`);
  }
  stop(code ?? 0);
});
