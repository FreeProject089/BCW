// The profile's "Reset key pin" button (Creator IDs section, pages/profile.jsx).
//
// BMM tells a user whose proof is refused with key_fork, key_retired or upgraded_key_required
// to reset the pin from here, so the button has to exist, call the owner route and nothing
// else, sit behind the undo window (removing a pin is destructive), and only appear on an id
// that actually has a pin. The page has no pure part to run, so this is asserted where it is
// written, and the API side is read too: a button calling a path the server does not serve,
// or reading a flag the list never sends, would pass a web-only check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const profile = readFileSync(new URL('../src/pages/profile.jsx', import.meta.url), 'utf8');
const fr = readFileSync(new URL('../src/i18n-fr.js', import.meta.url), 'utf8');
const links = readFileSync(new URL('../../api/src/routes/links.mjs', import.meta.url), 'utf8');

// The CreatorLinks component, up to the next top-level function.
const start = profile.indexOf('function CreatorLinks()');
const body = profile.slice(start, profile.indexOf('\nfunction ', start + 1));

test('the section exists where this test looks', () => {
  assert.ok(start > 0, 'no CreatorLinks() in profile.jsx: this test reads nothing');
  assert.match(body, /api\.get\('\/me\/creator-links'\)/);
});

test('the button calls exactly the owner key-pin route, once', () => {
  const calls = body.match(/api\.[a-z]+\(`\/me\/creator-links\/\$\{l\.id\}\/key-pin`\)/g) || [];
  assert.deepEqual(calls, ['api.del(`/me/creator-links/${l.id}/key-pin`)'], 'one DELETE to /me/creator-links/:id/key-pin');
  assert.match(links, /app\.delete\('\/me\/creator-links\/:id\/key-pin'/, 'the API no longer serves that route');
});

test('the DELETE waits for the undo window, and the list is refreshed after it', () => {
  const at = body.indexOf('/key-pin`');
  const action = body.lastIndexOf('toast.action({', at);
  const commit = body.lastIndexOf('onCommit:', at);
  assert.ok(action > 0 && commit > action, 'the key-pin DELETE is not inside toast.action({ onCommit })');
  assert.ok(!body.slice(action, at).includes('\n  };'), 'the toast.action found belongs to another handler');
  const after = body.slice(at, body.indexOf('onCancel', at));
  assert.match(after, /load\(\)/, 'the list is not reloaded after the reset');
  assert.match(body.slice(at, at + 400), /onCancel:\s*\(\)\s*=>\s*unpin\(l\.id\)/, 'Cancel does not bring the button back');
});

test('shown only for a linked id that has a pin, and the list says which', () => {
  assert.match(body, /\{l\.keyPinned && !pinReset\.has\(l\.id\) && \(\s*<Button[^>]*onClick=\{\(\) => resetPin\(l\)\}/, 'the button is not gated on l.keyPinned');
  assert.match(links, /keyPinned: pinned\.has\(l\.creatorId\.toLowerCase\(\)\)/, 'GET /me/creator-links does not send keyPinned');
});

test('explained in one sentence, in both languages', () => {
  const en = /t\('kp\.why', '([^']+)'\)/.exec(body);
  assert.ok(en, "no t('kp.why', …)");
  assert.equal(en[1].split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length, 1, 'more than one sentence');
  for (const code of ['key_fork', 'key_retired', 'upgraded_key_required']) assert.ok(en[1].includes(code), `the explanation does not name ${code}`);
  const block = fr.slice(fr.indexOf('// keypin (agent-small-fixes)'), fr.indexOf('// fin keypin (agent-small-fixes)'));
  assert.ok(block.length > 40, 'no keypin block in i18n-fr.js');
  for (const k of ['kp.reset', 'kp.why', 'kp.pending', 'kp.failed']) {
    assert.ok(body.includes(`t('${k}'`), `${k} is not used`);
    assert.ok(block.includes(`'${k}':`), `${k} has no French entry in the keypin block`);
  }
});
