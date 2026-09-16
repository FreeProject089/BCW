// An optional legal document is off until it is published: the menu, the text, the
// acceptance prompt and the privacy policy's pointer all follow that one flag.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const misc = readFileSync(new URL('../src/routes/misc.mjs', import.meta.url), 'utf8');
const legal = readFileSync(new URL('../../web/src/pages/legal.jsx', import.meta.url), 'utf8');

describe('the optional-document rule', () => {
  test('the API declares the list and withholds the sections of an unpublished one', () => {
    assert.match(misc, /const OPTIONAL_DOCS = \['dpa'\];/);
    assert.match(misc, /for \(const k of OPTIONAL_DOCS\) if \(!pages\.some\(\(x\) => x\.key === k\)\) delete docs\[k\];/);
    assert.match(misc, /return \{ docs, pages, categories, optional: OPTIONAL_DOCS \};/);
  });
  test('an unpublished optional document stops asking to be accepted', () => {
    assert.match(misc, /offDocs\.add\(k\)/);
    assert.match(misc, /versions\.filter\(\(v\) => !offDocs\.has\(v\.doc\)\)/);
  });
  test('the client hides the bundled copy, and no fallback list offers an optional key', () => {
    assert.match(legal, /const OPTIONAL_KEYS = \['dpa'\];/);
    // Three places build a page list when the API is unreachable; all three must filter.
    assert.equal((legal.match(/BUILTIN_ORDER\.filter\(\(k\) => !OPTIONAL_KEYS\.includes\(k\)\)/g) || []).length, 3);
    assert.match(legal, /if \(optional && !on\) \{/);
  });
  test('the privacy pointer is a marker, not a sentence, so it can be absent', () => {
    assert.ok(legal.includes('{{dpa}}'), 'the marker is in the policy text');
    assert.match(legal, /const fillPointers = /);
    // The pointer sentence exists exactly once each, in its own constant — not in the policy.
    assert.equal((legal.match(/When the roles are reversed/g) || []).length, 1);
    assert.equal((legal.match(/Quand les rôles s’inversent/g) || []).length, 1);
  });
});

describe('the migration that turns it off', () => {
  test('the addendum ships unpublished', () => {
    const sql = readFileSync(new URL('../../../packages/db/migrations/20260916180000_dpa_opt_in/migration.sql', import.meta.url), 'utf8');
    assert.match(sql, /UPDATE "LegalPage" SET "published" = false WHERE "key" = 'dpa';/);
  });
});
