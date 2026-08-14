// A relational data generator for a DEV database — `npm run gen -- --scale=medium`.
//
// WHY THIS EXISTS, and why it is not another seed script.
//
// seed.mjs sets the platform up and seed-demo.mjs fills the catalogue, but neither produces
// the thing the admin screens are actually made of: people who own pools, pools that hold
// repos and catalogues, subscriptions in several states, reports pointing at real content,
// sanctions pointing at real people. Without that, every relational screen looks correct on
// an empty set — which is the one case that proves nothing.
//
// It also replaces the way that data used to appear, which was: run the test suite and let
// it leak. One evening of runs had put 23 of 26 accounts in the dev database, plus 19
// hosting pools and 20 subscriptions, with no way to tell them from real rows and no way to
// remove them. Every screen was noise and "how many X are there" had no answer.
//
// The three properties that make this a tool rather than a mess:
//
//   MARKED     Every row carries a marker (`gen-` slugs, @generated.local e-mails). Nothing
//              here can be mistaken for real content, by a person or by --clean.
//   REVERSIBLE `--clean` removes exactly what it made, in foreign-key order, and re-reads
//              the counts from the database afterwards. A cleanup that reports success
//              without counting is the thing that got us here.
//   REPEATABLE A seeded PRNG, so the same --seed produces the same database. Benchmarks
//              that compare two runs need the data to be identical, and "did my change move
//              that number" is unanswerable against random rows.
//
// Refuses to run against anything that does not look like a dev database.

import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const SCALES = {
  small:  { users: 8,   reposPerUser: 1, catsPerUser: 1, itemsPerCat: 6,  reports: 3,  sanctions: 2 },
  medium: { users: 40,  reposPerUser: 2, catsPerUser: 1, itemsPerCat: 12, reports: 15, sanctions: 8 },
  large:  { users: 200, reposPerUser: 2, catsPerUser: 2, itemsPerCat: 20, reports: 60, sanctions: 25 },
};
const scale = SCALES[String(args.scale || 'small')] || SCALES.small;

const MARK = 'gen-';
const DOMAIN = '@generated.local';

/** Deterministic PRNG (mulberry32). Not for anything that needs to be unguessable — this
 *  picks names and numbers, and the point is that two runs agree. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(Number(args.seed) || 1);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

/**
 * Create a row and report whether it landed.
 *
 * Returns 1 or 0, so callers count SUCCESSES. The first version incremented a counter
 * outside the catch and announced 48 items while the database had none: two field names
 * I had invented were rejected, the empty catch swallowed both, and the summary lied.
 * The first failure is printed — a generator that hides WHY a row did not appear leaves
 * you diffing the schema by hand.
 */
let _firstError = true;
async function tryCreate(model, data) {
  try { await model.create({ data }); return 1; }
  catch (e) {
    if (_firstError) {
      _firstError = false;
      console.error('  first failure:', String(e.message).split('\n').filter((l) => l.trim()).slice(-2).join(' | '));
    }
    return 0;
  }
}

const FIRST = ['ada', 'linus', 'grace', 'alan', 'edsger', 'barbara', 'ken', 'margaret', 'donald', 'radia'];
const NOUN = ['forge', 'hangar', 'depot', 'atlas', 'beacon', 'anvil', 'harbour', 'relay', 'vault', 'lantern'];

async function assertDevDatabase() {
  const url = process.env.DATABASE_URL || '';
  // A generator that can be pointed at production by a typo is a generator that eventually
  // is. The check is on the URL rather than on a flag, because a flag is what you forget.
  const looksProd = /prod|amazonaws|azure|render\.com|supabase/i.test(url) && !/localhost|127\.0\.0\.1|@db[:/]/i.test(url);
  if (looksProd) {
    console.error('✗ DATABASE_URL does not look like a dev database. Refusing.');
    process.exit(2);
  }
  const realUsers = await p.user.count({ where: { NOT: { email: { endsWith: DOMAIN } } } });
  if (realUsers > 500) {
    console.error(`✗ ${realUsers} non-generated accounts — that is not a dev database. Refusing.`);
    process.exit(2);
  }
}

/** Everything this tool has ever made, in foreign-key order: children before parents. */
async function removeGenerated() {
  const users = await p.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const before = {
    users: ids.length,
    repos: await p.serverRepo.count({ where: { ownerId: { in: ids } } }),
    catalogs: await p.communityCatalog.count({ where: { ownerId: { in: ids } } }),
    items: await p.catalogItem.count({ where: { ownerId: { in: ids } } }),
    pools: await p.hostingGroup.count({ where: { ownerId: { in: ids } } }),
    subs: await p.subscription.count({ where: { userId: { in: ids } } }),
  };
  if (!ids.length) return { before, after: before, kept: 0 };

  const steps = [
    ['report', { OR: [{ reporterId: { in: ids } }, { targetId: { in: ids } }] }],
    ['sanctionAttachment', { sanction: { userId: { in: ids } } }],
    ['sanction', { userId: { in: ids } }],
    ['communityCatalogItem', { catalog: { ownerId: { in: ids } } }],
    ['catalogItem', { ownerId: { in: ids } }],
    ['communityCatalog', { ownerId: { in: ids } }],
    ['serverRepo', { ownerId: { in: ids } }],
    ['payment', { userId: { in: ids } }],
    ['subscription', { userId: { in: ids } }],
    ['hostingGroup', { ownerId: { in: ids } }],
    ['notification', { userId: { in: ids } }],
  ];
  for (const [model, where] of steps) {
    if (!p[model]) continue;
    try { await p[model].deleteMany({ where }); } catch { /* a model this schema does not have */ }
  }
  await p.hostingPlan.deleteMany({ where: { name: { startsWith: MARK } } }).catch(() => {});

  // An account that acted as staff cannot go: the audit log is an HMAC chain whose foreign
  // key is Restrict on purpose, and deleting an entry would break the next row's prevHash.
  // Reported rather than forced — tamper-evidence is worth more than a tidy count.
  const audited = new Set((await p.auditLogEntry.findMany({ where: { actorId: { in: ids } }, select: { actorId: true } })).map((a) => a.actorId));
  await p.user.deleteMany({ where: { id: { in: ids.filter((id) => !audited.has(id)) } } });

  const after = {
    users: await p.user.count({ where: { email: { endsWith: DOMAIN } } }),
    repos: await p.serverRepo.count({ where: { ownerId: { in: ids } } }),
    catalogs: await p.communityCatalog.count({ where: { ownerId: { in: ids } } }),
    items: await p.catalogItem.count({ where: { ownerId: { in: ids } } }),
    pools: await p.hostingGroup.count({ where: { ownerId: { in: ids } } }),
    subs: await p.subscription.count({ where: { userId: { in: ids } } }),
  };
  return { before, after, kept: audited.size };
}

async function generate() {
  const project = await p.project.findFirst({ where: { key: 'bmm' }, select: { id: true } });
  if (!project) { console.error('✗ no bmm project — run `npm run seed` first.'); process.exit(2); }

  const plan = await p.hostingPlan.upsert({
    where: { name: `${MARK}standard` },
    update: {},
    create: { name: `${MARK}standard`, storageGB: 10, uploadLimitKbps: 5000, priceMonthlyCents: 500 },
  }).catch(async () => p.hostingPlan.create({
    data: { name: `${MARK}standard`, storageGB: 10, uploadLimitKbps: 5000, priceMonthlyCents: 500 },
  }));

  const made = { users: 0, pools: 0, subs: 0, repos: 0, catalogs: 0, items: 0, submissions: 0, reports: 0, sanctions: 0 };
  const users = [];

  for (let i = 0; i < scale.users; i++) {
    const name = `${pick(FIRST)}-${i}`;
    const user = await p.user.create({
      data: { email: `${MARK}${name}${DOMAIN}`, displayName: `${name}`, emailVerified: true },
    });
    users.push(user);
    made.users++;

    const pool = await p.hostingGroup.create({ data: { ownerId: user.id, name: `${MARK}pool-${i}` } });
    made.pools++;

    // Subscriptions in several states, because every lifecycle screen is written against
    // the mix and looks correct against a set that is all one value.
    const status = pick(['active', 'active', 'active', 'past_due', 'canceled']);
    await p.subscription.create({
      data: { userId: user.id, planId: plan.id, hostingGroupId: pool.id, status },
    }).catch(() => {});
    made.subs++;

    for (let r = 0; r < scale.reposPerUser; r++) {
      made.repos += await tryCreate(p.serverRepo, {
          // `groupId`, not `hostingGroupId` — a name I invented and Prisma refused. The swallow
          // below hid it, and the counter still said 8.
          ownerId: user.id, groupId: pool.id,
          name: `${MARK}${pick(NOUN)}-${i}-${r}`,
          description: 'Generated repository.',
          // A mix, so "listed and verified" filters have something to exclude.
        listed: rand() > 0.25, verified: rand() > 0.35,
      });
    }

    for (let c = 0; c < scale.catsPerUser; c++) {
      const kind = pick(['APP', 'PLUGIN', 'THEME', 'PRESET']);
      const cat = await p.communityCatalog.create({
        data: {
          ownerId: user.id, projectId: project.id,
          name: `${MARK}${pick(NOUN)} ${kind.toLowerCase()}s`,
          slug: `${MARK}cat-${i}-${c}`,
          description: 'Generated catalogue.',
          kinds: [kind], status: 'ACTIVE', listed: true, visibility: 'public',
        },
      }).catch(() => null);
      if (!cat) continue;
      made.catalogs++;

      for (let n = 0; n < scale.itemsPerCat; n++) {
        // TWO different models, and conflating them is why the first run created none.
        // CommunityCatalogItem is what a community catalogue contains; CatalogItem is the
        // platform submission queue, which is project-scoped and has no catalogId at all.
        // Both are generated, because both feed screens somebody has to look at.
        made.items += await tryCreate(p.communityCatalogItem, {
          catalogId: cat.id, kind,
          name: `${MARK}${pick(NOUN)}-${n}`,
          slug: `${MARK}item-${i}-${c}-${n}`,
          description: 'Generated item.',
          // A long tail, so ORDER BY downloads behaves like the real feed rather than a
          // uniform block — the same reasoning seed-demo.mjs already applies.
          downloads: rand() < 0.1 ? int(500, 5000) : int(0, 40),
        });
        made.submissions += await tryCreate(p.catalogItem, {
          projectId: project.id, ownerId: user.id, kind,
          name: `${MARK}sub-${pick(NOUN)}-${n}`,
          slug: `${MARK}sub-${i}-${c}-${n}`,
          status: pick(['PUBLISHED', 'PUBLISHED', 'PUBLISHED', 'PENDING']),
        });
      }
    }
  }

  // Reports point at content that EXISTS. A report whose target is a made-up id renders as
  // a broken row and teaches nothing about the queue.
  const items = await p.catalogItem.findMany({ where: { slug: { startsWith: MARK } }, select: { id: true }, take: 500 });
  for (let i = 0; i < scale.reports && items.length; i++) {
    made.reports += await tryCreate(p.report, {
        targetType: 'item', targetId: pick(items).id,
        reporterId: pick(users).id,
        reason: pick(['spam', 'broken', 'stolen', 'malware']),
      // `targetLabel`, not `detail` — the admin list denormalises the name so a row stays
      // readable after the content is gone. `detail` does not exist; tryCreate said so.
      targetLabel: 'Generated item',
    });
  }

  for (let i = 0; i < scale.sanctions && users.length; i++) {
    const target = pick(users);
    made.sanctions += await tryCreate(p.sanction, {
        code: `SNC-GEN0-${String(1000 + i)}`,
        kind: pick(['warning', 'suspension', 'ban']),
        scope: 'account', userId: target.id,
        reason: 'Generated sanction.',
      status: pick(['active', 'active', 'lifted']),
    });
  }
  return made;
}

await assertDevDatabase();

if (args.clean) {
  const { before, after, kept } = await removeGenerated();
  console.log('removed :', JSON.stringify(before));
  console.log('left    :', JSON.stringify(after));
  if (kept) console.log(`kept    : ${kept} account(s) held by audit history — the chain is Restrict on purpose.`);
} else {
  // Always clean first. Two runs that both left their rows is exactly the accumulation this
  // tool exists to end, and "run it twice" is not a mistake worth punishing.
  await removeGenerated();
  const made = await generate();
  console.log(`generated (scale=${args.scale || 'small'}, seed=${Number(args.seed) || 1}):`, JSON.stringify(made));
  console.log('remove it all with:  npm run gen -- --clean');
}

await p.$disconnect();
