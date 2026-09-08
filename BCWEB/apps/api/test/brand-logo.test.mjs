// The logo every transactional e-mail carries must be the logo this repository ships.
//
// It is embedded as a base64 data URI, generated from apps/web/public/logo.png, and the
// generated file asked to be regenerated "if the logo changes" — which is an instruction, not
// a check. The logo changed. Every confirmation, password reset, receipt, expiry warning and
// waitlist mail went out with a 29 KB image that matched NO file in the repository, and
// nothing anywhere could have said so: the file is valid JavaScript, the mail renders, the
// image loads. It is only wrong if you know what the logo is supposed to be.
//
// Needs no database, no SMTP and no network — it is a file comparison, so it runs everywhere
// the suite does.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LOGO_SRC, LOGO_OUT, renderModule } from '../scripts/gen-brand-logo.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

describe('the e-mail logo', () => {
  test('its source and its generated copy both exist', () => {
    assert.ok(existsSync(LOGO_SRC), `${LOGO_SRC} is missing — the generator has no source`);
    assert.ok(existsSync(LOGO_OUT), `${LOGO_OUT} is missing — mails would have no logo`);
  });

  test('the embedded bytes ARE public/logo.png, byte for byte', () => {
    const src = readFileSync(LOGO_SRC);
    const gen = readFileSync(LOGO_OUT, 'utf8');
    const m = /'data:image\/png;base64,([^']+)'/.exec(gen);
    assert.ok(m, 'no data URI in brand-logo-data.mjs');
    const embedded = Buffer.from(m[1], 'base64');
    assert.equal(sha(embedded), sha(src),
      `the mail logo is ${embedded.length} bytes and public/logo.png is ${src.length}. `
      + 'Run: node apps/api/scripts/gen-brand-logo.mjs');
  });

  test('the whole file matches what the generator would write — comments included', () => {
    // Stronger than comparing the bytes: it also catches a hand-edited data URI that happens
    // to decode to the right image, which is how a "quick fix" becomes the next drift.
    assert.equal(readFileSync(LOGO_OUT, 'utf8').replace(/\r\n/g, '\n'),
      renderModule(readFileSync(LOGO_SRC)).replace(/\r\n/g, '\n'),
      'brand-logo-data.mjs is not what gen-brand-logo.mjs produces — regenerate it rather than editing it');
  });

  test('it is a real PNG, and small enough to attach to every message', () => {
    const src = readFileSync(LOGO_SRC);
    assert.deepEqual([...src.subarray(0, 4)], [0x89, 0x50, 0x4E, 0x47], 'public/logo.png is not a PNG');
    // Base64 adds a third. A logo in every mail is a cost paid on every send, and past a
    // couple of hundred KB some clients clip the message body outright.
    const b64 = Math.ceil(src.length / 3) * 4;
    assert.ok(b64 < 200_000, `the encoded logo is ${Math.round(b64 / 1024)} KB — too heavy to sit in every message`);
  });
});
