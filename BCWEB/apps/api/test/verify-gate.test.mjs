// The boundary: what an account that has never confirmed its address may still do.
//
// This is the half of the feature that is easy to get wrong in the expensive direction. Too
// loose and "your account is created" means nothing — an address nobody can receive mail at
// publishes content and messages members. Too tight and somebody who typed `jon@gmial.com`
// cannot sign in, cannot see which address they typed, cannot ask for the link again and
// cannot reach support: the account is gone with no way back, which is the failure the repo
// already refuses to risk on the login path (see the weak-password comment in auth.mjs).
//
// So the interesting assertions here are in BOTH directions, and the negative ones are the
// ones that would otherwise be discovered by a user.
//
// Pure: no database, no SMTP, no cookie. The rule is a function, and this tests the function.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { unverifiedMayWrite, normalizePath, UNVERIFIED_ALLOW, VERIFY_WINDOW_DAYS, VERIFY_REMIND_DAYS, RESEND_MIN_GAP_MS, RESEND_MAX_PER_DAY } from '../src/lib/verify-gate.mjs';

describe('an unverified account can still recover its own account', () => {
  test('reading is never gated — the gate is about writing', () => {
    for (const url of ['/me', '/catalog', '/me/sessions', '/me/catalogs', '/blog']) {
      assert.equal(unverifiedMayWrite('GET', url), true, `GET ${url} was refused`);
      assert.equal(unverifiedMayWrite('HEAD', url), true);
    }
  });

  test('every credential path stays open', () => {
    // If ANY of these is refused the account is unrecoverable: you cannot ask for the link
    // again, you cannot reset the password, you cannot even sign out.
    for (const url of ['/auth/login', '/auth/login/2fa', '/auth/logout', '/auth/register',
      '/auth/verify-email', '/auth/verify-email/resend', '/auth/reset/request', '/auth/reset/confirm',
      '/auth/oauth/link/confirm']) {
      assert.equal(unverifiedMayWrite('POST', url), true, `POST ${url} was refused`);
    }
  });

  test('the account’s own settings still work', () => {
    assert.equal(unverifiedMayWrite('PATCH', '/me'), true);
    assert.equal(unverifiedMayWrite('POST', '/me/password'), true);
    assert.equal(unverifiedMayWrite('POST', '/me/2fa/enable'), true);
    assert.equal(unverifiedMayWrite('POST', '/me/2fa/disable'), true);
    assert.equal(unverifiedMayWrite('PUT', '/me/notification-prefs'), true);
    assert.equal(unverifiedMayWrite('POST', '/me/legal-accept'), true);
  });

  test('the devices screen works before anything else does', () => {
    // It exists to evict an intruder. An account that cannot reach it while unverified is one
    // where the gate has made a compromise worse rather than better.
    assert.equal(unverifiedMayWrite('DELETE', '/me/sessions'), true);
    assert.equal(unverifiedMayWrite('DELETE', '/me/sessions/ckabc123'), true);
  });

  test('linking a provider is allowed — it is a way to PROVE an address', () => {
    assert.equal(unverifiedMayWrite('POST', '/me/oauth/github'), true);
    assert.equal(unverifiedMayWrite('DELETE', '/me/connections/discord'), true);
  });

  test('leaving is never gated', () => {
    assert.equal(unverifiedMayWrite('POST', '/me/closure'), true);
    assert.equal(unverifiedMayWrite('POST', '/me/closure/cancel'), true);
    assert.equal(unverifiedMayWrite('POST', '/account/closure/cancel'), true);
    assert.equal(unverifiedMayWrite('POST', '/me/telemetry/data-request'), true);
  });
});

describe('an unverified account cannot reach anybody else', () => {
  test('nothing that publishes', () => {
    for (const [m, url] of [
      ['POST', '/catalog'], ['POST', '/catalog/bulk'], ['POST', '/repos'],
      ['POST', '/me/catalogs'], ['PATCH', '/me/catalogs/abc'], ['POST', '/me/catalogs/abc/items'],
      ['POST', '/showcase-requests'], ['POST', '/myo/requests'], ['POST', '/blog'],
    ]) {
      assert.equal(unverifiedMayWrite(m, url), false, `${m} ${url} was allowed`);
    }
  });

  test('nothing that lands in somebody else’s inbox', () => {
    for (const [m, url] of [
      ['POST', '/me/threads/abc/messages'], ['POST', '/me/teams'], ['POST', '/me/teams/abc/invites'],
      ['POST', '/me/transfers'], ['POST', '/reports'], ['POST', '/contact'],
      ['POST', '/me/economy/gift'],
    ]) {
      assert.equal(unverifiedMayWrite(m, url), false, `${m} ${url} was allowed`);
    }
  });

  test('no API key — the one credential that would walk around this gate', () => {
    // The hook reads the session cookie. An API key carries none, so a key minted by an
    // unverified account would be a way through. An account that can never mint one has no
    // way through.
    assert.equal(unverifiedMayWrite('POST', '/me/api-keys'), false);
    assert.equal(unverifiedMayWrite('POST', '/me/notifications-key'), false);
    assert.equal(unverifiedMayWrite('POST', '/me/webhooks'), false);
    assert.equal(unverifiedMayWrite('POST', '/me/oauth-clients'), false);
  });

  test('`/me/` is not a prefix rule, and that is the point', () => {
    // Half the routes under /me publish. A rule written as "allow /me/*" would read like it
    // was about settings and would in fact allow all of them.
    const allowedMePaths = UNVERIFIED_ALLOW.filter(([, p]) => p.startsWith('/me'));
    assert.ok(allowedMePaths.length > 0);
    assert.ok(!allowedMePaths.some(([, p]) => p === '/me/**' || p === '/me/*'),
      'a wildcard under /me would let every publishing route through');
  });
});

describe('the rule cannot be side-stepped by spelling', () => {
  test('a trailing slash is the same path', () => {
    assert.equal(normalizePath('/me/catalogs/'), '/me/catalogs');
    assert.equal(unverifiedMayWrite('POST', '/me/catalogs/'), false);
    assert.equal(unverifiedMayWrite('POST', '/me/password/'), true);
  });

  test('a query string is not part of the path', () => {
    assert.equal(normalizePath('/me/catalogs?x=1&y=2'), '/me/catalogs');
    assert.equal(unverifiedMayWrite('POST', '/me/catalogs?x=1'), false);
    assert.equal(unverifiedMayWrite('POST', '/auth/verify-email?token=abc'), true);
  });

  test('the /api prefix the edge adds is the same route', () => {
    // Caddy mounts this API under /api; the tests call it bare. A list written for one
    // spelling and applied to the other would be a gate that is open in production.
    assert.equal(normalizePath('/api/me/catalogs'), '/me/catalogs');
    assert.equal(unverifiedMayWrite('POST', '/api/me/catalogs'), false);
    assert.equal(unverifiedMayWrite('POST', '/api/auth/logout'), true);
  });

  test('a deeper path does not inherit a shorter allowance', () => {
    // '/me/sessions/*' is one segment, not "everything under sessions".
    assert.equal(unverifiedMayWrite('DELETE', '/me/sessions/abc/anything'), false);
    assert.equal(unverifiedMayWrite('POST', '/me/password/reset-everyone'), false);
  });

  test('the method matters', () => {
    // PATCH /me is the profile; POST /me is not a route the list means to open.
    assert.equal(unverifiedMayWrite('PATCH', '/me'), true);
    assert.equal(unverifiedMayWrite('DELETE', '/me'), false);
  });
});

describe('the lifetime of an unconfirmed account', () => {
  test('the reminder lands inside the window, not after it', () => {
    // A reminder sent on or after the deadline is a reminder about something that has already
    // happened.
    assert.ok(VERIFY_REMIND_DAYS > 0);
    assert.ok(VERIFY_REMIND_DAYS < VERIFY_WINDOW_DAYS,
      'the day-7 reminder must leave real time to act on it');
    assert.ok(VERIFY_WINDOW_DAYS - VERIFY_REMIND_DAYS >= 7,
      'a reminder with less than a week left is a reminder somebody misses on holiday');
  });

  test('the resend limit is a gap AND a ceiling', () => {
    // A minimum gap alone lets a patient sender post a mail every five minutes for ever; a
    // daily ceiling alone lets a double-click burn the whole day's quota in one second.
    assert.ok(RESEND_MIN_GAP_MS >= 60_000);
    assert.ok(RESEND_MAX_PER_DAY >= 3, 'too few and a person whose mail is slow gives up');
    assert.ok(RESEND_MAX_PER_DAY <= 10, 'too many and this is a mail bomb aimed at a typo’d address');
  });
});
