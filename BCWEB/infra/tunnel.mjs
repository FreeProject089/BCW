// Show your local BCWEB to somebody who is not on this machine.
//
//   node infra/tunnel.mjs
//
// Starts a Cloudflare quick tunnel in front of the local stack and prints the address to
// share. Ctrl-C ends it.
//
// It points at 5176 — the port SITE_DOMAIN names and the one Caddy serves the site on — so
// the tunnel gets the whole thing through the same edge you use locally: the web app, /api,
// the security headers, the CSP. Tunnelling the web container directly would skip Caddy and
// the API would be unreachable from the shared link.
//
// No Caddyfile change is needed, which is worth writing down because the opposite is the
// obvious guess. Caddy matches sites by Host, so a request arriving as
// `something.trycloudflare.com` looks like it should miss the `localhost` site block and
// serve nothing. Measured instead of assumed: every Host tried — localhost, example.invalid,
// a trycloudflare name — answers 200 on both 80 and 5176 with this configuration. So the
// tunnel works as-is, and a TUNNEL_DOMAIN address on the site block would have been an extra
// moving part for a problem that is not there.
//
// A quick tunnel needs no Cloudflare account. The URL is random and dies with this process,
// which is the right trade for "let a friend look for an hour"; a stable address is a named
// tunnel and wants an account.
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const PORT = 5176;
const say = (m) => console.log(`[tunnel] ${m}`);

const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let url = null;

// cloudflared prints the assigned URL inside a box, on stderr in current builds. Matched by
// SHAPE rather than by line position, which moves between releases.
for (const stream of [child.stdout, child.stderr]) {
  readline.createInterface({ input: stream }).on('line', (line) => {
    const m = !url && line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (!m) return;
    url = m[0];
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
    say(`  curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${PORT}/   → expect 200`);
  }
  process.exit(code ?? 0);
});

const stop = () => { try { child.kill(); } catch { /* already gone */ } };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
