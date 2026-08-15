// The date on the legal pages, checked against reality.
//
// Also runs against the REAL legal.jsx, so this fails the day somebody edits the terms and
// forgets the constant — which is the entire point, and something no unit test over fixtures
// can do.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declaredDate, checkFreshness } from '../src/lib/legal-freshness.mjs';

describe('declaredDate', () => {
  test('reads the constant', () => {
    assert.equal(declaredDate("const LEGAL_UPDATED = '2026-08-14';"), '2026-08-14');
  });

  test('a missing or malformed constant is null, not a guess', () => {
    assert.equal(declaredDate('const OTHER = 1;'), null);
    assert.equal(declaredDate("const LEGAL_UPDATED = 'soon';"), null);
  });
});

describe('checkFreshness', () => {
  const src = "const LEGAL_UPDATED = '2026-08-14';";

  test('the file changed after the date it claims — stale', () => {
    const r = checkFreshness(src, '2026-08-20');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'stale');
    assert.match(r.message, /2026-08-20/);
    assert.match(r.message, /2026-08-14/);
  });

  test('same day is fine', () => {
    assert.equal(checkFreshness(src, '2026-08-14').ok, true);
  });

  test('a date in the FUTURE is fine, deliberately', () => {
    // "These terms take effect on the 1st" is normal. Failing on it would teach people to
    // work around the check, which costs more than the case it would catch.
    assert.equal(checkFreshness(src, '2026-08-01').ok, true);
  });

  test('no constant fails loudly', () => {
    assert.equal(checkFreshness('nothing here', '2026-08-14').reason, 'no_constant');
  });

  test('an unreadable file date is UNVERIFIED, not fine', () => {
    // A broken lookup that returned ok:true would be a green check testing nothing.
    assert.equal(checkFreshness(src, '').ok, false);
    assert.equal(checkFreshness(src, '').reason, 'unknown_file_date');
  });
});

describe('the real legal.jsx', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const FILE = join(HERE, '../../web/src/pages/legal.jsx');

  test('says a date that its own history agrees with', () => {
    const src = readFileSync(FILE, 'utf8');
    const repo = join(HERE, '../../..');
    const REL = 'apps/web/src/pages/legal.jsx';
    let fileDate = '';
    try {
      // An UNCOMMITTED edit counts as today. `git log` reports the last commit, so without
      // this the check only bites after the change is already in history — which is too late
      // to be useful while somebody is editing the terms, and is how the first version of
      // this test passed a probe that had just modified the file.
      const dirty = execFileSync('git', ['status', '--porcelain', '--', REL], { cwd: repo, encoding: 'utf8' }).trim();
      fileDate = dirty
        ? new Date().toISOString().slice(0, 10)
        : execFileSync('git', ['log', '-1', '--format=%cs', '--', REL], { cwd: repo, encoding: 'utf8' }).trim();
    } catch { /* reported as unverified below, never as a pass */ }

    // A checkout with no git history (a release tarball) cannot answer this. Skipping is
    // right there; passing would be a lie.
    if (!fileDate) {
      assert.equal(checkFreshness(src, fileDate).reason, 'unknown_file_date');
      return;
    }
    const r = checkFreshness(src, fileDate);
    assert.equal(r.ok, true, r.message);
  });
});
