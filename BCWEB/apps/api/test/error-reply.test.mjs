// O3 (SECURITY_SUMMARY §9): exception text in response bodies.
//
// Routes sent `String(e.message)` to whoever called them — on the public project and
// showcase pages that is GitHub's or the network's error text, handed to anybody. Now a
// failure answers a fixed token; the detail goes to the server log, and into the body only
// for a SUPERADMIN (lib/error-reply.mjs).
//
// Two checks: the helper does what it says, and no route file builds a reply from an
// exception's text any more. The scan is the part that keeps it true — the next route written
// the old way turns this red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorReply } from '../src/lib/error-reply.mjs';

const fakeReply = () => { const r = { status: 0, body: null }; r.code = (s) => { r.status = s; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const logged = [];
const req = (user) => ({ user, log: { warn: (o) => logged.push(o) }, routeOptions: { url: '/projects/:key/releases' } });

describe('errorReply', () => {
  const err = new Error('GET https://api.github.com/repos/x/y: 403 rate limit for token owner bcweb-bot');
  test('a public caller gets the token and nothing else; the text goes to the log', () => {
    logged.length = 0;
    const r = errorReply(req(undefined), fakeReply(), 502, 'github_unreachable', err);
    assert.equal(r.status, 502);
    assert.deepEqual(r.body, { error: 'github_unreachable' });
    assert.match(logged[0].detail, /rate limit/);
  });
  test('an ADMIN is not a SUPERADMIN', () => {
    assert.deepEqual(errorReply(req({ role: 'ADMIN' }), fakeReply(), 502, 'x', err).body, { error: 'x' });
  });
  test('a SUPERADMIN gets the detail', () => {
    assert.match(errorReply(req({ role: 'SUPERADMIN' }), fakeReply(), 502, 'x', err).body.detail, /rate limit/);
  });
});

describe('no route answers with an exception’s text', () => {
  const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/routes');
  // Where it is deliberate, by file and by the exact line:
  //   · server-control.mjs is the server console — the canControlServer + TOTP-elevated
  //     tools, a SUPERADMIN's own instrument, where the path in the error IS the answer;
  //   · the internal telemetry notifier answers the telemetry service, never a browser.
  //   · the rest are NOT an upstream's text handed to a stranger, each read here and kept:
  //     the parse error of the TOML an admin just pasted (it names their line), the SMTP
  //     refusal of the first failed address in an admin's broadcast, a moderator's
  //     "unverified because the download failed" note, the reasons a member's OWN backup
  //     skipped a file, an error's NAME (AbortError), and the SSRF guard's own short codes.
  const ALLOWED_FILES = new Set(['server-control.mjs']);
  const ALLOWED_LINES = [
    /return \{ ok: false, reason: String\(e\?\.message \|\| e\) \};/,          // telemetry.mjs, internal notifier
    /error: 'bad_toml', message: String\(e\?\.message \|\| e\)/,                    // devtools.mjs, admin's own TOML
    /firstError = \{ email: r\.email, reason: String\(e\?\.message \|\| e\)/,      // misc.mjs, admin broadcast
    /const validation = \{ unverified: true, reason: String\(e\?\.message \|\| e\)/, // catalog.mjs, moderator note
    /manifest\.skipped\.push\(\{ name, reason: String\(e\?\.message \|\| e\)/,      // my-backup.mjs, own export
    /reason: String\(e\?\.name \|\| e\)/,                                           // repos.mjs, an error NAME
    /error: String\(e\?\.message \|\| 'ssrf_refused'\)\.slice\(0, 40\)/,           // status.mjs, guard codes
  ];
  const SHAPE = /\b(?:detail|reason|message|error)\s*:\s*String\(\s*(?:e|err|x|error)\s*(?:\?\.|\.|\))/;
  test('scan src/routes', () => {
    const hits = [];
    for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.mjs'))) {
      if (ALLOWED_FILES.has(f)) continue;
      fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').forEach((line, i) => {
        if (SHAPE.test(line) && !ALLOWED_LINES.some((re) => re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
    }
    assert.deepEqual(hits, [], `routes that send exception text:\n${hits.join('\n')}`);
  });
});
