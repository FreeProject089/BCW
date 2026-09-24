// Remove exactly what `seed:demo` created, and nothing else.
//
// `clear-content` already exists and wipes ALL user content — repos, catalogs, uploads,
// everyone's. That is the right tool for starting over and the wrong one for "take the
// sample data out of my site", which is what this is for.
//
// It works because seed-demo RECORDS the ids it created in AdminSetting['seed.demoRows'],
// and this script deletes by id, intersected with that record. It used to match on names
// instead — a `demo-` slug, a `demo-author-` address — and both are shapes a real user can
// produce: a submission under a project keyed `demo` is slugged `demo-…`, and this script
// would have deleted it. Matching a name is matching something somebody else can choose.
//
// The rule below is therefore absolute: an id that is not in the record is never deleted,
// whatever it is called. Counts are printed BEFORE the delete so a surprise is visible while
// it is still a number on a screen rather than a missing catalog.
import { PrismaClient } from '@prisma/client';
import { readSeedRecord, SEED_RECORD_KEY } from './lib/demo-seed-record.mjs';

const p = new PrismaClient();
const dry = process.argv.includes('--dry-run');

// Same refusal as seed:demo. There was none here, and this is the script that DELETES.
if (process.env.NODE_ENV === 'production' && process.env.DEMO_ALLOW_PROD !== 'yes') {
  console.error('[clear-demo] refusing to run against NODE_ENV=production (set DEMO_ALLOW_PROD=yes to override).');
  process.exit(1);
}

// The record is necessary, not sufficient (pentest round 2, R8). It is one AdminSetting row,
// and until Sept 24 the generic settings door accepted that key from any ADMIN — so a record
// can name ids the seeder never minted. A row is deleted only when it is in the record AND
// has the shape seed:demo gives its own rows: a `demo-` slug (lib/demo-fixtures.mjs) and a
// `demo-author-N@bettercommunity.local` address. Neither test is enough alone (a real item
// can be slugged `demo-…`, which is why the record exists); together a real row needs both
// a planted record and a demo-shaped name to be reached.
const SEED_EMAIL = /^demo-author-\d+@bettercommunity\.local$/i;

async function main() {
  const record = await readSeedRecord(p);
  const recordedItems = record.itemIds.length ? await p.catalogItem.findMany({ where: { id: { in: record.itemIds } }, select: { id: true, slug: true } }) : [];
  const recordedUsers = record.userIds.length ? await p.user.findMany({ where: { id: { in: record.userIds } }, select: { id: true, email: true } }) : [];
  const itemIds = recordedItems.filter((r) => r.slug.startsWith('demo-')).map((r) => r.id);
  const userIds = recordedUsers.filter((u) => SEED_EMAIL.test(u.email || '')).map((u) => u.id);
  const odd = recordedItems.length - itemIds.length + recordedUsers.length - userIds.length;
  if (odd) console.log(`[clear-demo] ${odd} recorded row(s) are not shaped like seed:demo output — NOT deleted (a record names rows, it does not prove the seeder made them).`);
  if (record.itemIds.length || record.userIds.length) {
    if (!itemIds.length && !userIds.length) { console.log('[clear-demo] nothing in the record is deletable.'); return; }
  }

  if (!itemIds.length && !userIds.length) {
    console.log(`[clear-demo] no seed record (AdminSetting['${SEED_RECORD_KEY}'] is absent or empty): nothing to delete.`);
    // Say plainly what is NOT being deleted, so "but my catalogue is full of demo- items"
    // has an answer that is not "run it again harder".
    const named = await p.catalogItem.count({ where: { slug: { startsWith: 'demo-' } } });
    if (named) console.log(`[clear-demo] ${named} catalog item(s) have a demo- slug — NOT deleted: a slug is a name anyone can pick, not proof the seeder made the row. Re-run \`npm run seed:demo\` to take ownership of a fresh set.`);
    return;
  }

  // What is actually still there (rows may have been deleted by hand since the seed).
  const items = await p.catalogItem.count({ where: { id: { in: itemIds } } });
  const users = await p.user.findMany({ where: { id: { in: userIds.length ? userIds : ['-'] } }, select: { id: true, email: true } });

  // What ELSE those accounts own. A demo author that somehow acquired real content is the
  // case where deleting the account quietly takes something with it, so it is counted and
  // shown rather than assumed empty.
  const ids = users.map((u) => u.id);
  const owned = ids.length
    ? {
      posts: await p.blogPost.count({ where: { authorId: { in: ids } } }),
      repos: await p.serverRepo.count({ where: { ownerId: { in: ids } } }),
      // ownerId, not authorId. CatalogItem is owned; BlogPost is authored. Guessing the
      // wrong one here does not warn — Prisma refuses the query outright, which is the
      // friendly version of this repo's usual field-name failure.
      otherItems: await p.catalogItem.count({ where: { ownerId: { in: ids }, NOT: { id: { in: itemIds } } } }),
    }
    : { posts: 0, repos: 0, otherItems: 0 };

  console.log(`[clear-demo] recorded by the last seed:demo     : ${itemIds.length} item(s), ${userIds.length} account(s) (at ${record.at || 'unknown date'})`);
  console.log(`[clear-demo] still present, and deletable       : ${items}`);
  console.log(`[clear-demo] demo accounts                      : ${users.length}${users.length ? ' (' + users.map((u) => u.email).join(', ') + ')' : ''}`);
  console.log(`[clear-demo] those accounts also own            : ${owned.posts} post(s), ${owned.repos} repo(s), ${owned.otherItems} non-recorded catalog item(s)`);

  if (owned.posts || owned.repos || owned.otherItems) {
    console.log('[clear-demo] REFUSING: a demo account owns content the demo seed did not create.');
    console.log('[clear-demo] Reassign or delete it first — this script will not decide that for you.');
    return;
  }

  if (dry) { console.log('[clear-demo] --dry-run: nothing deleted.'); return; }

  // Both deletes are keyed on the recorded ids. There is deliberately no slug/email filter
  // anywhere below: a row that is not in the record cannot be reached from here.
  const delItems = await p.catalogItem.deleteMany({ where: { id: { in: itemIds } } });
  const delUsers = userIds.length ? await p.user.deleteMany({ where: { id: { in: userIds } } }) : { count: 0 };
  await p.adminSetting.deleteMany({ where: { key: SEED_RECORD_KEY } });
  console.log(`[clear-demo] deleted ${delItems.count} catalog item(s) and ${delUsers.count} account(s); cleared the seed record.`);

  const left = await p.catalogItem.count();
  console.log(`[clear-demo] catalog items remaining: ${left}`);
}

main()
  .catch((e) => { console.error('[clear-demo] failed:', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
