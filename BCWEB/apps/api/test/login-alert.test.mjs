// When a sign-in is worth an e-mail, and when telling somebody is how you teach them to stop
// reading.
//
// The failure mode this guards is not a crash. It is an alert that fires on a new IP: a phone
// changes address several times a day without going anywhere, the alerts become noise, and the
// one that mattered is filtered into the same folder as the rest. So the negative assertions
// here — the sign-ins that must stay SILENT — are the important half.
//
// Pure: classifyLogin takes facts and returns a verdict. No database, no clock, no mail.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLogin, fingerprintOf, FAIL_THRESHOLD, FAIL_WINDOW_MS, DEDUP_MS } from '../src/lib/login-alert.mjs';
import { notifCategory, NOTIF_CATEGORIES } from '../src/lib/lib.mjs';

const known = (...fps) => new Set(fps);
const base = {
  priorSessionCount: 3,
  knownFingerprints: known('firefox|windows|desktop'),
  knownCountries: new Set(['CH']),
  fingerprint: 'firefox|windows|desktop',
  country: 'CH',
  recentFails: 0,
};

describe('what counts as new', () => {
  test('the same browser in the same country says nothing', () => {
    assert.equal(classifyLogin(base), null);
  });

  test('a browser this account has never used', () => {
    assert.equal(classifyLogin({ ...base, fingerprint: 'safari|ios|mobile' })?.reason, 'new_device');
  });

  test('a country this account has never used', () => {
    assert.equal(classifyLogin({ ...base, country: 'BR', fingerprint: 'safari|ios|mobile' })?.reason, 'new_country',
      'a new country outranks a new device — a stolen password travels, a new laptop does not');
  });

  test('a success after a run of failures, even on the usual laptop', () => {
    // The one reason that fires on a KNOWN device: somebody guessing who then succeeds from
    // the owner's own machine is somebody who has the owner's machine.
    const v = classifyLogin({ ...base, recentFails: FAIL_THRESHOLD });
    assert.equal(v?.reason, 'after_failures');
    assert.equal(v.fails, FAIL_THRESHOLD);
  });

  test('a couple of typos are not an attack', () => {
    assert.equal(classifyLogin({ ...base, recentFails: FAIL_THRESHOLD - 1 }), null);
  });
});

describe('what stays silent', () => {
  test('a new IP is not a reason — it is not even an input', () => {
    // The verdict function is never given an IP. If somebody adds one as a trigger later,
    // this line is what they have to delete, and deleting it is a decision.
    const src = classifyLogin.toString();
    const signature = src.slice(0, src.indexOf(')') + 1);
    assert.ok(signature.includes('fingerprint'), 'read the right thing — this is meant to be the parameter list');
    assert.ok(!/\bip\b/i.test(signature), 'classifyLogin must not take an IP as a signal');
  });

  test('the very first session of an account', () => {
    // Nothing to be new against, and the person is looking at the screen. "Welcome — by the
    // way, a new device signed in" is the mail that teaches somebody this alert means nothing.
    assert.equal(classifyLogin({ ...base, priorSessionCount: 0, knownFingerprints: known(), knownCountries: new Set() }), null);
  });

  test('...unless that first session came after a run of failures', () => {
    assert.equal(classifyLogin({ ...base, priorSessionCount: 0, knownFingerprints: known(), knownCountries: new Set(), recentFails: 5 })?.reason,
      'after_failures');
  });

  test('a session with no geo does not read as a new country', () => {
    // geoOf returns nothing on a loopback address and behind some proxies. An empty country
    // must not mean "somewhere new", or every local sign-in is an alert.
    assert.equal(classifyLogin({ ...base, country: null }), null);
    assert.equal(classifyLogin({ ...base, country: '' }), null);
  });

  test('a country is compared case- and space-insensitively', () => {
    assert.equal(classifyLogin({ ...base, country: ' ch ' }), null);
  });
});

describe('the fingerprint', () => {
  test('is the device, never the address', () => {
    const fp = fingerprintOf({ browser: 'Firefox', os: 'Windows', device: 'desktop', ip: '203.0.113.7', country: 'CH' });
    assert.equal(fp, 'firefox|windows|desktop');
    assert.ok(!fp.includes('203.0.113.7'));
    assert.ok(!fp.includes('ch'), 'the country is compared separately, so it must not be baked in here');
  });

  test('two sessions from the same browser share one', () => {
    assert.equal(
      fingerprintOf({ browser: 'Firefox', os: 'Windows', device: 'desktop' }),
      fingerprintOf({ browser: 'firefox', os: 'windows ', device: 'Desktop' }),
    );
  });

  test('an unparsed user-agent is a stable value, not a crash', () => {
    assert.equal(fingerprintOf({}), '?|?|?');
    assert.equal(fingerprintOf(null), '?|?|?');
    // And it is one bucket: a client the UA parser cannot read does not generate an alert per
    // sign-in just because every field is empty.
    assert.equal(classifyLogin({ ...base, knownFingerprints: known('?|?|?'), fingerprint: fingerprintOf(null) }), null);
  });
});

describe('the preference it lives under', () => {
  test('a sign-in alert lands in `logins`, not in the locked catch-all', () => {
    for (const reason of ['new_device', 'new_country', 'after_failures']) {
      assert.equal(notifCategory(`login_${reason}`), 'logins', `login_${reason} fell through to ${notifCategory(`login_${reason}`)}`);
    }
  });

  test('`logins` can actually be switched off', () => {
    // The whole point. Everything in `security` has already happened TO the account and is
    // lost if muted; a sign-in alert is an event the person caused, and /me/sessions still
    // shows every device whether or not the mail arrives.
    assert.equal(NOTIF_CATEGORIES.logins.locked, undefined);
    assert.ok(NOTIF_CATEGORIES.logins.label);
  });

  test('and the locked category is still locked', () => {
    // Adding a category before `security` is exactly how somebody could accidentally steal
    // kinds from it, so the thing it protects is asserted here too.
    assert.equal(NOTIF_CATEGORIES.security.locked, true);
    assert.equal(notifCategory('account_banned'), 'security');
    assert.equal(notifCategory('key_revoked'), 'security');
    assert.equal(notifCategory('something_nobody_declared'), 'security');
  });
});

describe('the constants', () => {
  test('"being guessed at" is defined once', () => {
    // /auth/login escalates to a proof of work on the same threshold and window. Two numbers
    // for one idea is two numbers that will drift.
    assert.equal(FAIL_THRESHOLD, 3);
    assert.equal(FAIL_WINDOW_MS, 15 * 60_000);
  });

  test('a repeat is suppressed for a day, not for ever', () => {
    assert.equal(DEDUP_MS, 24 * 3600 * 1000);
  });
});
