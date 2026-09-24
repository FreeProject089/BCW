// Pentest round 2, card R9 (Sept 24 2026): a proposed task is made from an error or an alert
// and, once accepted, read by a whole team that may hold none of the capabilities the log is
// behind. lib/task-suggest.mjs promises that scrub() removes "every key=value, every token-
// shaped run, every e-mail and IP". Two spellings got through:
//   · an IPv6 address (a client's, in a rate-limit or proxy error): only dotted IPv4 was matched,
//     and no IPv6 group is long enough to look like a token;
//   · a secret written `name: value` or JSON `"name":"value"` rather than `name=value`: a short
//     password or a key under 16 characters is neither a key=value nor token-shaped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub, candidatesFrom } from '../src/lib/task-suggest.mjs';

const LEAKS = [
  ['a full IPv6 client address', 'rate limit for 2001:0db8:85a3:0000:0000:8a2e:0370:7334 exceeded', ['2001:0db8', '7334']],
  ['a compressed IPv6 address', 'proxy refused 2a02:1210:5c0b::1f', ['2a02:1210', '5c0b']],
  ['an IPv6 with a zone and port', 'connect ECONNREFUSED [fe80::1%eth0]:5432', ['fe80::1']],
  ['IPv6 loopback', 'connect ECONNREFUSED ::1:6379', ['::1']],
  ['a JSON password', 'Invalid invocation {"password":"hunter2"}', ['hunter2']],
  ['a header-style secret', 'upstream said x-bot-secret: s3cr3t!', ['s3cr3t']],
  ['a YAML-style api key', 'config error apiKey: abc123', ['abc123']],
  ['a quoted token with spaces', "failed with token: 'a b c'", ["'a b c'", 'a b c']],
  ['a cookie header', 'Cookie: bcw_session=abc; other=1', ['abc']],
];

for (const [name, raw, bad] of LEAKS) {
  test(`scrub removes ${name}`, () => {
    const out = scrub(raw, 1000);
    for (const b of bad) assert.equal(out.includes(b), false, `"${b}" survived: ${out}`);
  });
}

test('words, times, versions and ratios survive (control)', () => {
  const raw = 'PrismaClientKnownRequestError at 12:30:45 in v2.3.1, 3/4 done, Note: retry later, ratio 16:9';
  const out = scrub(raw, 1000);
  for (const keep of ['PrismaClientKnownRequestError', '12:30:45', 'v2.3.1', '3/4 done', 'Note: retry later', '16:9']) {
    assert.ok(out.includes(keep), `"${keep}" was removed: ${out}`);
  }
});

test('a proposal built from such an error carries none of it', () => {
  const [c] = candidatesFrom({ errors: [{ id: 'e1', title: 'Auth failed for 2001:db8::7 with {"secret":"k9"}', sub: '× 3' }] });
  assert.equal(/2001:db8|k9/.test(`${c.title} ${c.body}`), false, c.title);
});
