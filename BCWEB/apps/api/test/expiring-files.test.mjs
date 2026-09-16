// The dated-link arithmetic: whichever comes first, revoked beats everything, the key
// parser, and the mail body capture that lets an admin edit a built-in wording in place.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveExpiry, statusOf, keyFromMediaUrl, describe as describeLink } from '../src/lib/expiring-files.mjs';
import { builtinBody } from '../src/lib/mail-samples.mjs';

const DAY = 86400e3;
const t0 = new Date('2026-09-16T12:00:00Z');
const at = (d) => new Date(t0.getTime() + d * DAY);

describe('effective expiry', () => {
  test('a month after delivery when nobody downloads', () => {
    const row = { expiresAt: at(30), downloadAfterDays: 7, firstDownloadAt: null, downloads: 0 };
    assert.equal(effectiveExpiry(row).getTime(), at(30).getTime());
    assert.equal(statusOf(row, at(29)), 'ok');
    assert.equal(statusOf(row, at(30)), 'expired');
  });
  test('seven days after the first download when that comes first', () => {
    const row = { expiresAt: at(30), downloadAfterDays: 7, firstDownloadAt: at(3), downloads: 1 };
    assert.equal(effectiveExpiry(row).getTime(), at(10).getTime());
    assert.equal(statusOf(row, at(9)), 'ok');
    assert.equal(statusOf(row, at(10)), 'expired');
  });
  test('the month still wins when the first download is late', () => {
    const row = { expiresAt: at(30), downloadAfterDays: 7, firstDownloadAt: at(28), downloads: 1 };
    assert.equal(effectiveExpiry(row).getTime(), at(30).getTime());
  });
  test('revoked, purged and exhausted, in that order of precedence; no dates = never', () => {
    assert.equal(statusOf({ revokedAt: t0, purgedAt: t0 }), 'purged');
    assert.equal(statusOf({ revokedAt: t0 }), 'revoked');
    assert.equal(statusOf({ maxDownloads: 1, downloads: 1 }), 'exhausted');
    assert.equal(statusOf({ downloads: 0 }), 'ok');
    assert.equal(effectiveExpiry({}), null);
    assert.equal(describeLink({ expiresAt: at(1), downloads: 2, fileName: 'a.zip', bytes: 5 }, t0).status, 'ok');
  });
});

describe('media keys', () => {
  test('our media URLs give a key; anything else does not', () => {
    assert.equal(keyFromMediaUrl('/api/media/blog/abc-file.zip'), 'blog/abc-file.zip');
    assert.equal(keyFromMediaUrl('https://site.test/media/blog/x.png?w=64'), 'blog/x.png');
    assert.equal(keyFromMediaUrl('/api/media/../etc'), null);
    assert.equal(keyFromMediaUrl('https://evil.test/file.zip'), null);
  });
});

describe('the built-in wording, captured', () => {
  test('an editable sample yields its body html; a preview-only one yields null', () => {
    const b = builtinBody('reset');
    assert.ok(typeof b === 'string' && /password/i.test(b), b);
    assert.equal(builtinBody('does-not-exist'), null);
  });
});
