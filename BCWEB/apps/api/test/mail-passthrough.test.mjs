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

  test('every accepted field is forwarded to the transport', () => {
    // The bug this exists for, generalised: accepting a field and not passing it on is
    // indistinguishable from working.
    const accepted = signature.split(',').map((x) => x.trim()).filter(Boolean);
    const passed = new Set(forwarded.split(',').map((x) => x.trim().split(':')[0]));
    for (const f of accepted) {
      assert.ok(passed.has(f), `sendMail accepts ${f} and never forwards it`);
    }
  });

  test('attachments specifically, because that is the one that was missing', () => {
    assert.ok(signature.includes('attachments'), 'sendMail must accept attachments');
    assert.ok(forwarded.includes('attachments'), 'and forward them');
  });
});
