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
// UPLOADS need a SECOND tunnel, and that is not an accident of this script. A file never
// passes through the API: the browser asks for a pre-signed URL and PUTs the bytes straight
// at MinIO on :9000. Pre-signed means the signature covers the host, so the address in that
// URL is the address the browser must use — and it was S3_PUBLIC_ENDPOINT, http://localhost
// :9000, i.e. the VISITOR'S own machine. Attaching a file did nothing, with no error worth
// reading, because the request never left their laptop.
//
// So a second quick tunnel fronts :9000 and S3_PUBLIC_ENDPOINT points at it. Nothing else has
// to change: the CSP already allows `https:` in connect-src, and MinIO's CORS is `*`.
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
// MinIO. Pre-signed upload URLs are signed against whatever S3_PUBLIC_ENDPOINT says, so this
// port needs its own public address for a file to reach us at all.
const S3_PORT = 9000;
// fileURLToPath, not `new URL(...).pathname`: the latter percent-encodes, so a checkout under
// a directory with a space in its name ("Better Project") yields a path containing %20 and
// every file read fails with ENOENT on a path that looks almost right.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPOSE = path.join(HERE, 'compose');
const ENV_FILE = path.join(COMPOSE, '.env');
const KEY = 'TUNNEL_DOMAIN';
const SITE = 'SITE_URL';
// The session cookie is issued with Domain=COOKIE_DOMAIN, which is `localhost` here. A page
// served from <something>.trycloudflare.com CANNOT accept a cookie scoped to localhost — the
// browser drops it without a word. Sign-in returned 200, the app said welcome, and the very
// next request arrived anonymous. Pointed at the tunnel host instead, it is the page's own
// domain and the cookie sticks.
const COOKIE = 'COOKIE_DOMAIN';
const S3 = 'S3_PUBLIC_ENDPOINT';
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
 *  A null value removes the key.
 *
 *  Keys are rewritten WHERE THEY ALREADY ARE. An earlier version filtered them out and pushed
 *  the new values onto the end, which moved SITE_URL and COOKIE_DOMAIN away from the section
 *  documenting them and, because the split leaves a trailing empty element, grew a blank line
 *  on every run. A config file that reshuffles itself each time it is touched is one nobody
 *  can read a diff of. */
function setEnv(entries) {
  const raw = readEnvRaw();
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const pending = new Map(Object.entries(entries));
  const out = [];
  for (const line of lines) {
    const hit = [...pending.keys()].find((k) => line.trim().startsWith(`${k}=`));
    if (!hit) { out.push(line); continue; }
    const v = pending.get(hit);
    pending.delete(hit);
    if (v) out.push(`${hit}=${v}`);        // in place — same position, same neighbours
  }
  // Only keys the file did not already carry get appended, and only when they have a value.
  for (const [k, v] of pending) if (v) out.push(`${k}=${v}`);
  fs.writeFileSync(ENV_FILE, out.join(eol));
}

// ── Surviving a dirty exit ───────────────────────────────────────────────────
// Restoring on Ctrl-C is not enough. Close the terminal, kill the process, lose power, and
// .env is left describing a tunnel that no longer resolves — silently: the site still loads,
// but the session cookie is scoped to a dead hostname so signing in says "welcome" and the
// next request arrives anonymous.
//
// Worse, it COMPOUNDS. The originals used to be captured at startup from .env itself, so the
// next run read the dead tunnel's values as "what these were before" and faithfully restored
// them on exit. One dirty exit and the broken hostname is permanent, re-applied by the very
// code meant to clean it up. That is how COOKIE_DOMAIN stayed pinned to a dead
// trycloudflare.com host here for days.
//
// So the originals are written to a file BEFORE anything is touched, and read back on the
// next start. Recovery stops depending on how the last run ended.
const STATE_FILE = path.join(COMPOSE, '.tunnel-restore.json');

const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
};

/** Put .env back to what a previous run recorded, if it never got the chance itself.
 *  Returns true when there was something to undo. */
function recoverPreviousRun() {
  const prev = readState();
  if (!prev) return false;
  say('a previous tunnel did not shut down cleanly — putting .env back first.');
  setEnv(prev);
  fs.rmSync(STATE_FILE, { force: true });
  return true;
}

// Before reading what to restore later, undo anything a dead run left behind — otherwise the
// values captured next are that run's tunnel, not the real config.
const recovered = recoverPreviousRun();

// `node infra/tunnel.mjs --restore` — repair and stop, without starting a tunnel. For the case
// where you already closed the window and just want the config sane again.
if (process.argv.includes('--restore')) {
  if (!recovered) say('nothing to restore — .env carries no leftover tunnel values.');
  else {
    say('reloading Caddy and the API so they pick it up…');
    execFileSync('docker', ['compose', 'up', '-d', 'caddy'], { cwd: COMPOSE, stdio: 'inherit' });
    execFileSync('docker', ['compose', 'up', '-d', '--force-recreate', 'api'], { cwd: COMPOSE, stdio: 'inherit' });
    say('done.');
  }
  process.exit(0);
}

// What these were before this run, so they can be put back exactly. Read AFTER recovery, so
// they are the real config rather than a dead tunnel's leftovers.
const SITE_WAS = readEnv(SITE);
const COOKIE_WAS = readEnv(COOKIE);
const S3_WAS = readEnv(S3);

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

const spawnTunnel = (port) => spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

const child = spawnTunnel(PORT);
const s3child = spawnTunnel(S3_PORT);

let url = null;
let s3url = null;
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
    setEnv({ [KEY]: null, [SITE]: SITE_WAS, [COOKIE]: COOKIE_WAS, [S3]: S3_WAS });
    // Dropped only once .env is actually back: if the write above threw, the file must stay
    // so the next run (or --restore) still knows what to undo.
    fs.rmSync(STATE_FILE, { force: true });
    reloadCaddy();
    recreateApi();
  } catch { /* the state file survives, so the next start repairs it */ }
  try { child.kill(); } catch { /* already gone */ }
  try { s3child.kill(); } catch { /* already gone */ }
  process.exit(code);
}
// SIGBREAK is Ctrl-Break on Windows, and SIGHUP is what a closing terminal sends. Neither is
// exotic — they are simply the two ways this gets ended that are not Ctrl-C, and without them
// the graceful path is skipped. (Closing the console window outright, or Task Manager, still
// kills the process outright; that is what the state file is for.)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  try { process.on(sig, () => stop(0)); } catch { /* not every signal exists on every OS */ }
}

// cloudflared prints the assigned URL inside a box, on stderr in current builds. Matched by
// SHAPE rather than by line position, which moves between releases.
//
// Two processes hand out two addresses and neither is useful alone: the site is unusable
// without somewhere to upload to, and an upload endpoint with no site in front of it is
// nothing. So each reader records its own and calls ready(), which does the work once both
// have arrived — rather than racing to configure a half-known stack.
for (const stream of [s3child.stdout, s3child.stderr]) {
  readline.createInterface({ input: stream }).on('line', (line) => {
    const m = !s3url && line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (!m) return;
    s3url = m[0];
    ready();
  });
}

for (const stream of [child.stdout, child.stderr]) {
  readline.createInterface({ input: stream }).on('line', (line) => {
    const m = !url && line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (!m) return;
    url = m[0];
    ready();
  });
}

let announced = false;
function ready() {
  if (announced || !url || !s3url) return;
  announced = true;
  // `http://host:5176`, with BOTH the scheme and the port.
  //
  // A bare hostname makes Caddy treat it as a public site: it listens on 443 and tries to
  // provision a certificate for a name it does not control. The tunnel already terminates
  // TLS and forwards plain HTTP to :5176, so requests keep arriving on a port that address
  // is not listening on — and Caddy answers its empty 200 again. Two silent failures that
  // look identical from outside; only the port tells them apart.
  // Record how to undo this BEFORE doing it. Written first so that a crash one line later
  // still leaves a way back; the file is the only thing that makes recovery independent of
  // this process surviving to run its own cleanup.
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    [KEY]: null, [SITE]: SITE_WAS, [COOKIE]: COOKIE_WAS, [S3]: S3_WAS,
  }, null, 2));
  setEnv({
    [KEY]: `http://${url.replace(/^https:\/\//, '')}:${PORT}`,
    // No port: this is the address the visitor's browser uses, and the tunnel terminates
    // TLS on 443. A port here would appear in every e-mail link and reach nothing.
    [SITE]: url,
    // Bare hostname, no scheme and no port — a cookie Domain is a host, not a URL.
    [COOKIE]: url.replace(/^https:\/\//, ''),
    // The address a pre-signed upload URL is signed against, and therefore the one the
    // browser must PUT to. No trailing slash: the S3 client joins paths itself.
    [S3]: s3url,
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
  say('  Sign-in by e-mail works — the session cookie is scoped to this hostname for the');
  say('  duration. OAUTH DOES NOT: Discord and GitHub only accept a');
  say('  redirect_uri registered in their app settings, and this hostname is new every run.');
  say('');
  say(`  Uploads go to ${s3url} (a second tunnel in front of MinIO).`);
  say('');
  say(`  While this runs, SITE_URL is https — so cookies are Secure and signing in at`);
  say(`  http://localhost:${PORT} will not work until you Ctrl-C.`);
  say('');
  }

child.on('exit', (code) => {
  if (!url) {
    say('cloudflared exited before printing a URL.');
    say('Check it is installed (`cloudflared --version`) and that the stack is up:');
    say(`  curl -s -o /dev/null -w "%{http_code}" -H "Host: localhost" http://127.0.0.1:${PORT}/   → expect 200`);
  }
  stop(code ?? 0);
});
