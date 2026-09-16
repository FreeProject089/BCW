// A security report is the one contact message that must not wait in a queue, and the one
// whose text must not be repeated anywhere it can be read without a second factor.
//
// Both rules are asserted on the source, because the behaviour lives inside the route's
// closure: exercising it needs a database and a Discord webhook, and this suite runs with
// neither. What can be checked without them is that the two rules are written down and that
// nothing in the file contradicts them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const misc = readFileSync(new URL('../src/routes/misc.mjs', import.meta.url), 'utf8');
const forward = misc.slice(misc.indexOf('async function forwardContactToDiscord'), misc.indexOf('async function alertStaffOfSecurityReport'));
const alert = misc.slice(misc.indexOf('async function alertStaffOfSecurityReport'), misc.indexOf('async function alertStaffOfSecurityReport') + 1200);

describe('a security report wakes staff', () => {
  test('the route raises the alert, and only for that kind', () => {
    assert.match(misc, /if \(kind === 'security'\) alertStaffOfSecurityReport\(p, msg\)\.catch\(/);
  });
  test('it reaches every admin, as a kind nobody can have muted', () => {
    assert.match(alert, /role: \{ in: \['ADMIN', 'SUPERADMIN'\] \}/);
    assert.match(alert, /'security_alert'/);
    // `security` is the locked notification category in lib.mjs: a kind that matches nothing
    // else falls into it, so an account cannot switch this off.
    const lib = readFileSync(new URL('../src/lib/lib.mjs', import.meta.url), 'utf8');
    assert.match(lib, /security: \{ match: \(\) => true, label: 'Account & security', locked: true \}/);
  });
  test('the notice carries who and where, never the report', () => {
    assert.match(alert, /Read it in the dashboard/);
    assert.ok(!/msg\.body/.test(alert), 'the alert must not read the body');
    assert.match(alert, /href: '\/admin\?s=messages'/);
  });
});

describe('the Discord webhook never quotes a security report', () => {
  test('the body is sent for an ordinary message and withheld for a security one', () => {
    assert.match(forward, /const secret = msg\.kind === 'security';/);
    // One branch carries the body, the other carries a pointer. Both exist, and the body is
    // only ever in the branch guarded by `secret` being false.
    const [secretBranch, plainBranch] = forward.split('        : [');
    assert.ok(!/msg\.body/.test(secretBranch), 'the security branch must not include the body');
    assert.match(plainBranch, /msg\.body\.slice\(0, 1000\)/);
  });
});
