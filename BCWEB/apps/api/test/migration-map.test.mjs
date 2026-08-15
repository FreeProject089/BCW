// The migration history, and the disagreements between the folder and the database.
//
// The two drift cases are the reason this exists and neither can be produced by looking at a
// healthy stack — an applied migration whose folder was deleted, and one that started and
// never finished. Both break the NEXT deploy, on a machine that is not the one where it
// happened, so a test is the only place they can be exercised before they cost an evening.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseMigration, buildMigrationMap } from '../src/lib/migration-map.mjs';

describe('parseMigration', () => {
  test('the timestamp prefix is the ordering, and the rest is the label', () => {
    const m = parseMigration('20260715013715_repos_list_index', '');
    assert.equal(m.stamp, '20260715013715');
    assert.equal(m.label, 'repos_list_index');
  });

  test('0_init has no timestamp and is not mangled into one', () => {
    const m = parseMigration('0_init', '');
    assert.equal(m.stamp, null);
    assert.equal(m.label, '0_init');
  });

  test('operations are counted, not just detected', () => {
    const sql = 'CREATE TABLE "A" ();\nCREATE TABLE "B" ();\nCREATE UNIQUE INDEX "i" ON "A"("x");';
    assert.deepEqual(parseMigration('0_x', sql).ops, { createTable: 2, createIndex: 1 });
  });

  test('a DATA migration is an operation, not an empty result', () => {
    // Two of these exist in this repo and both reported "no operations" before they were
    // counted — an empty result that reads exactly like a clean one. A migration that writes
    // ROWS cannot simply be re-run, and a restore has to think about it.
    assert.deepEqual(parseMigration('0_seed', 'INSERT INTO "Project" ("id") VALUES (1);').ops, { insertData: 1 });
    assert.deepEqual(parseMigration('0_fix', 'UPDATE "User" SET "x" = 1;').ops, { updateData: 1 });
  });

  test('ALTER COLUMN is not ADD COLUMN', () => {
    const m = parseMigration('0_d', 'ALTER TABLE "ServerRepo" ALTER COLUMN "listed" SET DEFAULT true;');
    assert.deepEqual(m.ops, { alterColumn: 1 });
  });

  test('the statements that LOSE data are the destructive ones', () => {
    // Everything else changes shape and another migration can reverse it. These cannot be
    // reversed, and knowing which release contained one is the difference between a restore
    // and a guess.
    assert.deepEqual(parseMigration('0_a', 'ALTER TABLE "User" DROP COLUMN "x";').destructive, ['dropColumn']);
    assert.deepEqual(parseMigration('0_b', 'DROP TABLE "Old";').destructive, ['dropTable']);
    assert.deepEqual(parseMigration('0_c', 'DELETE FROM "User" WHERE 1=1;').destructive, ['deleteData']);
    assert.deepEqual(parseMigration('0_d', 'CREATE INDEX "i" ON "A"("x");').destructive, []);
  });

  test('a migration that both adds and drops is still destructive', () => {
    const m = parseMigration('0_e', 'ALTER TABLE "User" ADD COLUMN "a" TEXT;\nALTER TABLE "User" DROP COLUMN "b";');
    assert.deepEqual(m.destructive, ['dropColumn']);
    assert.equal(m.ops.addColumn, 1);
  });

  test('a commented-out statement is not a statement', () => {
    assert.deepEqual(parseMigration('0_f', '-- DROP TABLE "User";\nCREATE TABLE "A" ();').ops, { createTable: 1 });
  });

  test('the tables it touched, for "which migration created this"', () => {
    const m = parseMigration('0_g', 'CREATE TABLE "A" ();\nALTER TABLE "B" ADD COLUMN "x" TEXT;\nALTER TABLE "B" ADD COLUMN "y" TEXT;');
    assert.deepEqual(m.tables, ['A', 'B']);
  });
});

describe('buildMigrationMap', () => {
  const DISK = [
    { name: '0_init', sql: 'CREATE TABLE "User" ();' },
    { name: '20260715013715_two', sql: 'CREATE INDEX "i" ON "User"("x");' },
    { name: '20260812090000_three', sql: 'ALTER TABLE "User" DROP COLUMN "old";' },
  ];
  const row = (name, extra = {}) => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null, ...extra });

  test('0_init sorts first even though it has no timestamp', () => {
    // Newest-first in the output, so the untimestamped one is last.
    const m = buildMigrationMap(DISK, [], false);
    assert.equal(m.timeline[m.timeline.length - 1].name, '0_init');
    assert.equal(m.timeline[0].name, '20260812090000_three');
  });

  test('applied and pending', () => {
    const m = buildMigrationMap(DISK, [row('0_init'), row('20260715013715_two')]);
    assert.deepEqual(m.pending, ['20260812090000_three']);
    assert.equal(m.counts.applied, 2);
  });

  test('APPLIED AND NO LONGER ON DISK — the one that breaks every other machine', () => {
    // Prisma re-validates a checksum per migration, so a deleted or renamed folder makes
    // `migrate deploy` fail everywhere except where it was deleted.
    const m = buildMigrationMap(DISK, [row('0_init'), row('20260101000000_deleted_folder')]);
    assert.deepEqual(m.appliedNotOnDisk, ['20260101000000_deleted_folder']);
  });

  test('started and never finished, and rolled back', () => {
    // The database is then in a state no migration describes, and the next deploy refuses
    // to run at all.
    const m = buildMigrationMap(DISK, [
      row('0_init'),
      row('20260715013715_two', { finished_at: null }),
      row('20260812090000_three', { rolled_back_at: new Date() }),
    ]);
    assert.deepEqual(m.unfinished, [
      { name: '20260715013715_two', rolledBack: false },
      { name: '20260812090000_three', rolledBack: true },
    ]);
  });

  test('without a database, nothing is reported as pending', () => {
    // "48 migrations pending" from an unreachable database is a lie that reads as an
    // emergency. The on-disk half is still an answer and is returned as one.
    const m = buildMigrationMap(DISK, [], false);
    assert.deepEqual(m.pending, []);
    assert.equal(m.hasDatabase, false);
    assert.equal(m.timeline[0].applied, null, 'and no migration claims to be applied or not');
  });

  test('the destructive ones are named, with the tables they touched', () => {
    const m = buildMigrationMap(DISK, [], false);
    assert.deepEqual(m.destructiveMigrations, [
      { name: '20260812090000_three', destructive: ['dropColumn'], tables: ['User'] },
    ]);
  });

  test('totals sum the whole history', () => {
    const m = buildMigrationMap(DISK, [], false);
    assert.deepEqual(m.totals, { createTable: 1, createIndex: 1, dropColumn: 1 });
  });
});
