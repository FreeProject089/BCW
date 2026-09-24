// The API refuses the 2FA step with 429 `2fa_locked` after too many wrong codes on one account
// (apps/api routes/auth.mjs, full audit Sept 24 2026). The sign-in page said "Sign-in failed"
// to that, which reads as a typo in the code and invites another try into the same wall.
// The page has no pure part to run, so the handling is asserted where it is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const signin = readFileSync(new URL('../src/pages/signin.jsx', import.meta.url), 'utf8');
const fr = readFileSync(new URL('../src/i18n-fr.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../api/src/routes/auth.mjs', import.meta.url), 'utf8');

test('the 2FA step names the lock, in both languages, with the wait it was given', () => {
  assert.match(api, /error: '2fa_locked'/, 'the API no longer answers 2fa_locked: this test reads nothing');
  assert.match(signin, /=== '2fa_locked'/);
  const en = /t\('auth\.2faLocked', '([^']+)'\)/.exec(signin);
  assert.ok(en, "no t('auth.2faLocked', …) in signin.jsx");
  assert.match(en[1], /\{m\}/);
  assert.match(signin, /retryAfterSec/);
  const frEntry = /'auth\.2faLocked':\s*'([^']+)'/.exec(fr);
  assert.ok(frEntry, 'no French entry');
  assert.match(frEntry[1], /\{m\}/);
});

test('it does not offer a backup code: the lock refuses those too', () => {
  // The ceiling is checked before the recovery-code loop in auth.mjs.
  const lock = api.indexOf("error: '2fa_locked'");
  const recovery = api.indexOf('totpRecoveryCodes', lock);
  assert.ok(lock > 0 && recovery > lock, 'the lock no longer comes before the recovery codes; revisit the wording');
  const en = /t\('auth\.2faLocked', '([^']+)'\)/.exec(signin)[1];
  const frText = /'auth\.2faLocked':\s*'([^']+)'/.exec(fr)[1];
  assert.doesNotMatch(en, /backup|recovery/i);
  assert.doesNotMatch(frText, /secours|récupération/i);
});
