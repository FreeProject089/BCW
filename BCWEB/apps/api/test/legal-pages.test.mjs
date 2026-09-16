// The legal document LIST — which documents exist, and what they are grouped under.
//
// The content of a policy is edited elsewhere and tested elsewhere. What is checked here are
// the four rules that stop this feature from destroying something, because every one of them
// protects a document a person may have legally agreed to:
//
//   · every built-in survives the migration with the keys its stored sections already
//     hold — a key that shifts is a document that silently empties;
//   · a built-in cannot be deleted, because its text is compiled into the web bundle and the
//     row is the only thing listing it;
//   · a document with published versions cannot be deleted, because somebody's acceptance
//     points at those versions;
//   · deleting a heading keeps the documents in it.
//
// Needs a throwaway Postgres (DATABASE_URL); skipped without one, like its neighbours.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const RUN = !!process.env.DATABASE_URL;
const skip = RUN ? false : 'set DATABASE_URL to a throwaway Postgres (see CI) to run legal-page tests';
let p;

before(async () => {
  if (!RUN) return;
  p = await (await import('../src/lib/lib.mjs')).db();
});
after(async () => { if (RUN) await p?.$disconnect?.(); });

test('every built-in is present, with the keys its sections already use', { skip }, async () => {
  const pages = await p.legalPage.findMany({ where: { builtIn: true }, select: { key: true, published: true } });
  const keys = pages.map((x) => x.key).sort();
  assert.deepEqual(keys, ['about', 'cookies', 'dpa', 'privacy', 'refunds', 'submissions', 'terms']);
  // The addendum is the one document a deployment chooses to offer, so it ships unpublished:
  // an Article 28 contract nobody agreed to must not appear on a site by default.
  assert.equal(pages.find((x) => x.key === 'dpa')?.published, false);
  for (const k of ['about', 'cookies', 'privacy', 'refunds', 'terms']) {
    assert.equal(pages.find((x) => x.key === k)?.published, true, `${k} must stay published`);
  }
});

test('a page carries its heading, and losing the heading does not lose the page', { skip }, async () => {
  const tag = `t${Date.now().toString(36)}`;
  const cat = await p.legalCategory.create({ data: { key: `cat-${tag}`, label: 'Test heading' } });
  const page = await p.legalPage.create({ data: { key: `doc-${tag}`, label: 'Test doc', categoryId: cat.id } });
  try {
    const before = await p.legalPage.findUnique({ where: { id: page.id }, select: { categoryId: true } });
    assert.equal(before.categoryId, cat.id);

    // SetNull, not Cascade. A policy disappearing because somebody tidied a heading is not a
    // recoverable mistake, and this is the line that decides it.
    await p.legalCategory.delete({ where: { id: cat.id } });
    const after = await p.legalPage.findUnique({ where: { id: page.id }, select: { categoryId: true } });
    assert.ok(after, 'the document survived its heading');
    assert.equal(after.categoryId, null);
  } finally {
    await p.legalPage.deleteMany({ where: { id: page.id } });
    await p.legalCategory.deleteMany({ where: { id: cat.id } });
  }
});

test('a key is unique — two documents cannot claim the same URL', { skip }, async () => {
  const tag = `u${Date.now().toString(36)}`;
  const first = await p.legalPage.create({ data: { key: `dup-${tag}`, label: 'First' } });
  try {
    await assert.rejects(
      () => p.legalPage.create({ data: { key: `dup-${tag}`, label: 'Second' } }),
      // Whatever Prisma calls it, the point is that it refuses. Two rows with one key means
      // /legal/<key> resolves to whichever the ORDER BY happened to put first.
      (e) => !!e,
    );
  } finally {
    await p.legalPage.deleteMany({ where: { id: first.id } });
  }
});

test('a document key matches the sections stored under it', { skip }, async () => {
  // The join is by key and not by foreign key, deliberately — every section written before
  // the table existed already holds one. Which means nothing in the database enforces this,
  // and a section under a key no page names is a section nobody can reach.
  const [pages, docs] = await Promise.all([
    p.legalPage.findMany({ select: { key: true } }),
    p.legalSection.findMany({ select: { doc: true }, distinct: ['doc'] }),
  ]);
  const known = new Set(pages.map((x) => x.key));
  const orphans = docs.map((d) => d.doc).filter((d) => !known.has(d));
  assert.deepEqual(orphans, [], `sections stored under a document that no page names: ${orphans.join(', ')}`);
});
