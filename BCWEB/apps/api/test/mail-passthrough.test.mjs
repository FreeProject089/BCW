// sendMail forwards what it is given.
//
// It destructures its argument, so anything it does not NAME is silently dropped — the
// caller sees a resolved promise and a sent mail, and the missing part is only noticed by
// whoever was supposed to receive it. That is how a data-export mail would have gone out
// with no data attached.
//
// Source-level, because the failure is a name missing from a destructuring pattern and a
// transport mock would test the mock.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/lib/mail.mjs'), 'utf8');

const signature = SRC.match(/export async function sendMail\(\{([^}]*)\}\)/)?.[1] ?? '';
const forwarded = SRC.match(/tx\(\)\.sendMail\(\{([^}]*)\}\)/)?.[1] ?? '';

describe('sendMail', () => {
  test('the signature and the forward were both found', () => {
    // A regex that matched nothing would make every assertion below vacuous.
    assert.ok(signature.includes('to'), `signature not parsed: ${signature}`);
    assert.ok(forwarded.includes('to'), `forward not parsed: ${forwarded}`);
  });

  /**
   * Fields sendMail accepts and deliberately does NOT hand to nodemailer, each with the
   * reason it is consumed here instead.
   *
   * An allowlist rather than a softer rule: the check exists because a field that is accepted
   * and dropped looks exactly like a field that works, and loosening it to "forwarded OR
   * mentioned somewhere" would give that back. A new exception has to be written down, which
   * is a sentence somebody has to be willing to write.
   */
  const CONSUMED_HERE = {
    // The mail's identity in the gallery. It selects the admin's wording for the subject and
    // is finished with — nodemailer has no idea what a BetterCommunity mail id is.
    mailId: 'resolves the admin-editable subject, then has no meaning to the transport',
  };

  test('every accepted field is forwarded to the transport, or is a declared exception', () => {
    // The bug this exists for, generalised: accepting a field and not passing it on is
    // indistinguishable from working.
    const accepted = signature.split(',').map((x) => x.trim()).filter(Boolean);
    const passed = new Set(forwarded.split(',').map((x) => x.trim().split(':')[0]));
    for (const f of accepted) {
      if (CONSUMED_HERE[f]) continue;
      assert.ok(passed.has(f), `sendMail accepts ${f} and never forwards it`);
    }
  });

  test('every declared exception is really consumed, and not just excused', () => {
    // An entry in the list above must correspond to code that uses the field. Otherwise the
    // allowlist becomes the place where dropped fields go to be forgotten.
    for (const [f, why] of Object.entries(CONSUMED_HERE)) {
      assert.ok(signature.includes(f), `${f} is excused but sendMail no longer accepts it — drop the exception`);
      const body = SRC.slice(SRC.indexOf('export async function sendMail'));
      assert.ok(new RegExp(`\\b${f}\\b`).test(body.slice(body.indexOf('{'))),
        `${f} is excused as "${why}" but nothing in sendMail reads it`);
    }
  });

  test('attachments specifically, because that is the one that was missing', () => {
    assert.ok(signature.includes('attachments'), 'sendMail must accept attachments');
    assert.ok(forwarded.includes('attachments'), 'and forward them');
  });
});
