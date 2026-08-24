// Remove exactly what `seed:demo` created, and nothing else.
//
// `clear-content` already exists and wipes ALL user content — repos, catalogs, uploads,
// everyone's. That is the right tool for starting over and the wrong one for "take the
// sample data out of my site", which is what this is for.
//
// It works because seed-demo marks its own rows: catalog items get a `demo-` slug prefix and
// its authors are `demo-author-N@bettercommunity.local`. Nothing else is touched — and the
// counts are printed BEFORE the delete so a surprise is visible while it is still a number
// on a screen rather than a missing catalog.
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const dry = process.argv.includes('--dry-run');

const DEMO_SLUG = { slug: { startsWith: 'demo-' } };
const DEMO_USER = { email: { startsWith: 'demo-author-' } };

async function main() {
  const items = await p.catalogItem.count({ where: DEMO_SLUG });
  const users = await p.user.findMany({ where: DEMO_USER, select: { id: true, email: true } });

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
      // friendly version of this repo’s usual field-name failure.
      otherItems: await p.catalogItem.count({ where: { ownerId: { in: ids }, NOT: DEMO_SLUG } }),
    }
    : { posts: 0, repos: 0, otherItems: 0 };

  console.log(`[clear-demo] catalog items with a demo- slug : ${items}`);
  console.log(`[clear-demo] demo accounts                   : ${users.length}${users.length ? ' (' + users.map((u) => u.email).join(', ') + ')' : ''}`);
  console.log(`[clear-demo] those accounts also own          : ${owned.posts} post(s), ${owned.repos} repo(s), ${owned.otherItems} non-demo catalog item(s)`);

  if (owned.posts || owned.repos || owned.otherItems) {
    console.log('[clear-demo] REFUSING: a demo account owns content the demo seed did not create.');
    console.log('[clear-demo] Reassign or delete it first — this script will not decide that for you.');
    return;
  }

  if (dry) { console.log('[clear-demo] --dry-run: nothing deleted.'); return; }

  const delItems = await p.catalogItem.deleteMany({ where: DEMO_SLUG });
  const delUsers = await p.user.deleteMany({ where: DEMO_USER });
  console.log(`[clear-demo] deleted ${delItems.count} catalog item(s) and ${delUsers.count} account(s).`);

  const left = await p.catalogItem.count();
  console.log(`[clear-demo] catalog items remaining: ${left}`);
}

main()
  .catch((e) => { console.error('[clear-demo] failed:', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
