// The statuses a content takedown writes, checked against the SCHEMA's own vocabulary.
//
// Three kinds of content, three different status vocabularies:
//   ServerRepo.status       ENUM RepoStatus — PROVISIONING | ONLINE | SUSPENDED | OFFLINE
//   CatalogItem.status      ENUM ItemStatus — PENDING | PUBLISHED | REJECTED | HIDDEN | SUSPENDED
//   CommunityCatalog.status STRING          — ACTIVE | SUSPENDED | HIDDEN, stated in a comment
//
// The two enums are checked by Prisma: a wrong value throws. The String is not — Postgres
// accepts anything — and that is the one that was wrong. Lifting a catalog takedown wrote
// PUBLISHED, which belongs to the ITEM vocabulary, and `isServable` is `status === 'ACTIVE'`,
// so the catalog stayed dead after a moderator had restored it. No error, no log, nothing to
// notice. The column with no database-level check is exactly where the bug lived.
//
// Read from schema.prisma rather than hardcoded here, so the day somebody adds a status the
// test learns about it instead of enshrining today's list.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_TARGETS } from '../src/routes/sanctions.mjs';

const SCHEMA = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../packages/db/schema.prisma'),
  'utf8',
);

/** An enum's members. */
function enumValues(name) {
  const block = SCHEMA.split(`enum ${name} {`)[1]?.split('}')[0] ?? '';
  return new Set(block.split('\n').map((l) => l.trim().split(/\s|\/\//)[0]).filter((x) => /^[A-Z_]+$/.test(x)));
}

/**
 * What a model's `status` column may hold.
 *
 * Follows the DECLARED TYPE rather than assuming one: `status RepoStatus` means read that
 * enum, `status String // A | B | C` means read the comment, because a comment is the only
 * place a plain String's allowed values are written down.
 *
 * Assuming String for all three is how the first version of this read nothing at all — and a
 * test that reads nothing passes everything, which is the same failure it exists to catch,
 * one level up. The guard below is what said so.
 */
function statusesOf(model) {
  const block = SCHEMA.split(`model ${model} {`)[1]?.split('\nmodel ')[0] ?? '';
  const line = block.split('\n').find((l) => /^\s*status\s/.test(l)) ?? '';
  const type = (line.trim().split(/\s+/)[1] ?? '').replace(/[?[\]]/g, '');
  if (type && type !== 'String') {
    const vals = enumValues(type);
    if (vals.size) return vals;
  }
  return new Set((line.split('//')[1] ?? '').match(/\b[A-Z][A-Z_]{2,}\b/g) || []);
}

const VOCAB = {
  repo: statusesOf('ServerRepo'),
  catalog: statusesOf('CommunityCatalog'),
  item: statusesOf('CatalogItem'),
};

describe('content sanction target map', () => {
  test('the schema vocabularies were actually read', () => {
    // A parser that silently returns nothing would make every assertion below vacuous —
    // the failure mode this whole file exists to catch, one level up.
    for (const [k, v] of Object.entries(VOCAB)) {
      assert.ok(v.size >= 3, `${k} vocabulary looks empty (${[...v].join(',')})`);
      assert.ok(v.has('SUSPENDED'), `${k} must know SUSPENDED`);
    }
  });

  test('every takedown status exists in ITS OWN model\'s vocabulary', () => {
    for (const [type, def] of Object.entries(CONTENT_TARGETS)) {
      assert.ok(VOCAB[type], `no vocabulary known for ${type}`);
      assert.ok(VOCAB[type].has(def.down.status), `${type} takedown writes ${def.down.status}, not in ${[...VOCAB[type]].join('|')}`);
    }
  });

  test('every RESTORE status exists too — the half that failed silently', () => {
    for (const [type, def] of Object.entries(CONTENT_TARGETS)) {
      assert.ok(VOCAB[type].has(def.up.status), `${type} restore writes ${def.up.status}, not in ${[...VOCAB[type]].join('|')}`);
    }
  });

  test('restoring a catalog makes it servable again', () => {
    // The specific bug, named: isServable is `status === 'ACTIVE'`.
    assert.equal(CONTENT_TARGETS.catalog.up.status, 'ACTIVE');
    assert.equal(CONTENT_TARGETS.catalog.up.listed, true);
  });

  test('a takedown never leaves content servable', () => {
    assert.equal(CONTENT_TARGETS.catalog.down.status, 'SUSPENDED');
    assert.equal(CONTENT_TARGETS.catalog.down.listed, false);
    assert.equal(CONTENT_TARGETS.repo.down.status, 'SUSPENDED');
    assert.equal(CONTENT_TARGETS.item.down.status, 'SUSPENDED');
  });
});
