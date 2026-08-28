// The content backup, and the one thing it must never contain.
//
// It downloads as a zip into somebody's Downloads folder, gets copied to a laptop, and is
// attached to an email. An account section carrying password hashes or 2FA secrets would make
// that archive as sensitive as the database itself, while looking like a folder of JSON.
//
// The defence is an explicit `select`, never a `findMany()` with a few fields deleted
// afterwards: a spread hands over whatever column is added next, and the day that column is a
// secret nobody is looking at this file.
//
// So the test is on the SELECT, read out of the source. It runs without a database on purpose
// — this must fail on a laptop with nothing running, because it is the check that matters when
// somebody is in a hurry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS, SECTION_KEYS } from '../src/routes/content-backup.mjs';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/routes/content-backup.mjs'), 'utf8');

/** Anything whose name says "this signs you in as them". */
const SECRETISH = /passwordHash|password|totp|twoFactor|secret|token|salt|sessionId|resetCode|verifyCode/i;

test('the accounts section selects explicitly, and never a secret', () => {
  const at = SRC.indexOf('users: {');
  assert.ok(at > 0, 'the users section moved — this test cannot be trusted');
  const block = SRC.slice(at, SRC.indexOf('catalogs: {', at));
  assert.match(block, /select:\s*\{/, 'the accounts section must use an explicit select');

  const fields = [...block.matchAll(/(\w+):\s*true/g)].map((m) => m[1]);
  assert.ok(fields.length >= 5, `read ${fields.length} field(s) — too few to be right`);
  const bad = fields.filter((f) => SECRETISH.test(f));
  assert.deepEqual(bad, [], `the accounts export would carry: ${bad.join(', ')}`);
});

test('no section reads a whole row without a select', () => {
  // `findMany()` with no `select` is fine for a doc page and is exactly how a secret escapes
  // from a model that gains one. The sections that legitimately take whole rows are content
  // tables; anything touching people or payloads has to name its columns.
  for (const key of ['users', 'catalogs', 'repos']) {
    const at = SRC.indexOf(`${key}: {`);
    const block = SRC.slice(at, at + 900);
    assert.match(block, /select:\s*\{/, `${key} must name the columns it exports`);
  }
});

test('catalogues and repositories are off by default', () => {
  // They are metadata pointing at files the zip does not contain. On by default, the archive
  // would look more complete than it is — which is the failure mode of a backup: you find out
  // when you need it.
  assert.equal(SECTIONS.catalogs.on, false);
  assert.equal(SECTIONS.repos.on, false);
  assert.equal(SECTIONS.docs.on, true);
  assert.equal(SECTIONS.blog.on, true);
});

test('every section can name itself and count itself', () => {
  assert.ok(SECTION_KEYS.length >= 7, `${SECTION_KEYS.length} sections`);
  for (const k of SECTION_KEYS) {
    const s = SECTIONS[k];
    assert.equal(typeof s.label, 'string', k);
    assert.ok(s.label.length > 2, k);
    assert.equal(typeof s.count, 'function', k);
    assert.equal(typeof s.read, 'function', k);
  }
});
