// The schema map and the index-drift check. Text in, structure out — no database.
//
// The drift case is real: an index was once created by raw SQL and never declared in the
// schema, so the next generated migration proposed DROPPING it. That was found by accident.
// These make it findable on purpose.
//
// The two false-positive tests exist because this tool reported both of them before it was
// right, and a drift report that cries wolf is one nobody reads the third time.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitModels, parseModel, mapSchema, indexesInMigrations, findIndexDrift } from '../src/lib/schema-map.mjs';

const SCHEMA = `
model User {
  id    String @id @default(cuid())
  email String @unique
  name  String
  posts Post[]
  @@index([name])
}

model Post {
  id       String @id @default(cuid())
  author   User   @relation(fields: [authorId], references: [id])
  authorId String
  title    String
  meta     Json   @default("{}")
}
`;

describe('parsing', () => {
  test('a Json default containing a brace does not end the model early', () => {
    // `@default("{}")` is why this counts braces instead of matching lazily: a regex stops
    // at that brace and silently returns half a model, with fields quietly missing.
    const models = splitModels(SCHEMA);
    assert.deepEqual(models.map((m) => m.name), ['User', 'Post']);
    assert.match(models[1].body, /title/);
  });

  test('fields, relations and indexes are separated', () => {
    const [user, post] = splitModels(SCHEMA).map(parseModel);
    assert.deepEqual(user.fields.map((f) => f.name), ['id', 'email', 'name']);
    assert.equal(user.fields[0].id, true);
    // email @unique is an index, and @@index([name]) is another.
    assert.equal(user.indexes.length, 2);
    assert.deepEqual(post.relations.filter((r) => r.holdsKey).map((r) => r.to), ['User']);
  });

  test('edges run from the side that HOLDS the key', () => {
    // That is the side a cascade travels and a delete is blocked by. Recording both
    // directions would double every edge and describe less.
    const { edges } = mapSchema(SCHEMA);
    assert.deepEqual(edges, [{ from: 'Post', to: 'User', via: 'author' }]);
  });
});

describe('index drift', () => {
  const mig = (sql) => [{ name: 'm1', sql }];

  test('an index the schema declares is not drift', () => {
    const d = findIndexDrift(SCHEMA, mig('CREATE INDEX "User_name_idx" ON "User"("name");'));
    assert.equal(d.orphaned.length, 0);
  });

  test('an index created in SQL and never declared IS drift', () => {
    // The exact shape of the real one: raw SQL adds it, the schema never mentions it, and
    // the next `migrate diff` proposes dropping it.
    const d = findIndexDrift(SCHEMA, mig('CREATE INDEX "User_email_secret_idx" ON "User"("email");'));
    assert.equal(d.orphaned.length, 1);
    assert.equal(d.orphaned[0].index, 'User_email_secret_idx');
  });

  test('created then dropped later is not drift', () => {
    const d = findIndexDrift(SCHEMA, [
      { name: 'm1', sql: 'CREATE INDEX "User_gone_idx" ON "User"("name");' },
      { name: 'm2', sql: 'DROP INDEX "User_gone_idx";' },
    ]);
    assert.equal(d.orphaned.length, 0);
  });

  test('a foreign-key index is reported NOWHERE — Prisma creates those implicitly', () => {
    // Both lists, not just orphaned. Asserting only `orphaned.length === 0` let a mutation
    // through: deleting the _fkey skip moves the index into `unknown` instead, which keeps
    // orphaned at zero while putting a perfectly ordinary implicit index in front of
    // somebody as something to look at.
    const d = findIndexDrift(SCHEMA, mig('CREATE INDEX "Post_authorId_fkey" ON "Post"("authorId");'));
    assert.equal(d.orphaned.length, 0, 'not drift');
    assert.equal(d.unknown.length, 0, 'and not something to look at either');
  });

  test('a unique on an ENUM field counts as declared', () => {
    // False positive #1. Enum-typed fields are neither scalars nor relations, so
    // `key ProjectKey @unique` fell through both branches and its index looked orphaned.
    const s = 'model Project {\n  id  String     @id\n  key ProjectKey @unique\n}';
    const d = findIndexDrift(s, mig('CREATE UNIQUE INDEX "Project_key_key" ON "Project"("key");'));
    assert.equal(d.orphaned.length, 0);
  });

  test('a name longer than 63 characters is compared the way Postgres stores it', () => {
    // False positive #2. The identifier is capped at 63 and the SUFFIX is kept — the middle
    // is clipped, so a naive slice(0, 63) still does not match and still reports an
    // ordinary @@unique as drift.
    const s = [
      'model ProjectPermission {',
      '  id String @id',
      '  @@unique([userId, showcaseProjectId, projectKey, allShowcase])',
      '}',
    ].join('\n');
    const stored = 'ProjectPermission_userId_showcaseProjectId_projectKey_allSh_key';
    assert.equal(stored.length, 63, 'the fixture is the real clipped length');
    const d = findIndexDrift(s, mig(`CREATE UNIQUE INDEX "${stored}" ON "ProjectPermission"("userId");`));
    assert.equal(d.orphaned.length, 0);
  });

  test('a hand-named index is reported separately, not as a fault', () => {
    // Naming one by hand is a deliberate act; calling it drift trains people to ignore this.
    const d = findIndexDrift(SCHEMA, mig('CREATE INDEX "somethingcustom" ON "User"("name");'));
    assert.equal(d.orphaned.length, 0);
    assert.equal(d.unknown.length, 1);
  });
});

describe('indexesInMigrations', () => {
  test('reports the migration that first created each index', () => {
    const { created } = indexesInMigrations([
      { name: 'first', sql: 'CREATE INDEX "A_b_idx" ON "A"("b");' },
      { name: 'second', sql: 'CREATE INDEX "A_b_idx" ON "A"("b");' },
    ]);
    assert.equal(created.get('A_b_idx'), 'first');
  });
});
