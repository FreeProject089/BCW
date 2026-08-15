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
const say = (m) => console.log(`[tunnel] ${m}`);

/** Set or clear one key in the compose .env, leaving the rest and its line endings alone. */
function setEnv(value) {
  const raw = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const kept = raw.split(/\r?\n/).filter((l) => !l.trim().startsWith(`${KEY}=`));
  if (value) kept.push(`${KEY}=${value}`);
  fs.writeFileSync(ENV_FILE, kept.join(eol));
}

// Caddy alone. Restarting the stack to change one hostname would drop the API for anybody
// already using it.
const reloadCaddy = () => execFileSync('docker', ['compose', 'up', '-d', 'caddy'], { cwd: COMPOSE, stdio: 'inherit' });

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
  try { setEnv(''); reloadCaddy(); } catch { /* leaving it set breaks nothing */ }
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
    setEnv(`http://${url.replace(/^https:\/\//, '')}:${PORT}`);
    say('telling Caddy to answer on that hostname…');
    try { reloadCaddy(); } catch (e) { say(`could not reload Caddy: ${e.message}`); return stop(1); }
    say('');
    say(`  Share this:  ${url}`);
    say('');
    say('  It reaches YOUR machine, through the same Caddy you use locally.');
    say('  Sign-ups, uploads and payments on it are the real ones on this instance.');
    say('  Ctrl-C ends the tunnel and the address stops working.');
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
