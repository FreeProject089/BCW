// Demo catalog content for a DEV database — `npm run seed:demo`.
//
// seed.mjs sets the platform up (projects, users, plans, badges, settings, posts) but creates
// no catalog items, so a fresh dev stack has an empty catalog: nothing to look at, and nothing
// for the load harness (loadtest/) to actually render. This fills that gap with data whose
// SHAPE matches production, which is the part that matters:
//
//   - Only PLUGIN items carry `meta.validation` — that's the only kind revalidatePlugin ever
//     re-checks (see routes/catalog.mjs). APP/THEME/PRESET have no `validation` key at all,
//     exactly like real submissions. Getting this wrong is what makes a seed lie to you: a
//     seed that stamps validation on everything hides the visibility bugs this shape exposes.
//   - Plugins are mostly valid, with a few `valid:false` (tampered/failed checksum) and a few
//     `{unverified:true}` (dead download link — NOT an integrity failure, must stay visible).
//   - Downloads follow a long tail (a handful of hits, most items near zero) so ORDER BY
//     downloads + take 500 behaves like the real feed instead of a uniform block.
//
// A re-run replaces exactly its own rows and never touches real content — not because of the
// `demo-` slug (a real submission under a project keyed `demo` gets one too) but because every
// id this script creates is recorded in AdminSetting['seed.demoRows']. Refuses to run against a
// production DB.
import { PrismaClient } from '@prisma/client';
// The fixtures themselves live in lib/demo.mjs: the admin demo mode serves the same generator
// as JSON and stores nothing, this script writes its output as rows. One body of fixtures, so
// the two can never drift into showing different shapes.
import { generateCatalogItems, makeRng } from './lib/demo.mjs';
// The ids this run creates are recorded here; `clear-demo` deletes nothing else. See the
// header of that file for why a `demo-` slug is not a safe marker.
import { readSeedRecord, writeSeedRecord, SEED_RECORD_KEY } from './lib/demo-seed-record.mjs';

const p = new PrismaClient();
const N = Number(process.env.DEMO_N) || 400;

if (process.env.NODE_ENV === 'production' && process.env.DEMO_ALLOW_PROD !== 'yes') {
  console.error('[seed-demo] refusing to seed demo content into NODE_ENV=production (set DEMO_ALLOW_PROD=yes to override).');
  process.exit(1);
}

async function main() {
  // Owners: reuse whatever real users exist, else make demo ones (a catalog with a single
  // author doesn't exercise the owner join the feed does).
  const previous = await readSeedRecord(p);
  const existing = await p.user.findMany({ take: 5, where: { id: { notIn: previous.userIds.length ? previous.userIds : ['-'] } }, select: { id: true } });
  let owners = existing.map((u) => u.id);
  // Accounts this seeder owns: the ones it created itself (recorded), never a real user that
  // happens to use a `demo-author-` address.
  const seededUserIds = [];
  if (owners.length < 3) {
    for (let i = owners.length; i < 3; i++) {
      const email = `demo-author-${i}@bettercommunity.local`;
      const prior = await p.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, id: { in: previous.userIds.length ? previous.userIds : ['-'] } }, select: { id: true } });
      const u = prior || await p.user.create({ data: { email, displayName: `Demo Author ${i + 1}` } })
        .catch(async (e) => {
          // The address is taken by an account this seeder did not create: leave it alone and
          // use it only as an owner if it is already among the real users above.
          if (e?.code !== 'P2002') throw e;
          console.warn(`[seed-demo] ${email} belongs to an account this seeder did not create — not touching it.`);
          return null;
        });
      if (!u) continue;
      if (!prior) seededUserIds.push(u.id);
      owners.push(u.id);
    }
  }
  if (!owners.length) throw new Error('no owner available for the demo catalogue');

  const projects = {};
  // The same names seed.mjs gives them: this upsert never updates, so a wrong name here would stick
  // on a database where the demo seed ran first.
  for (const [key, name] of [['bmm', 'Better Mods Manager'], ['bsm', 'Better Sound Maker'], ['community', 'BetterCommunity']]) {
    projects[key] = await p.project.upsert({ where: { key }, create: { key, name }, update: {} });
  }

  // Replace only OUR rows, by id.
  const removed = await p.catalogItem.deleteMany({ where: { id: { in: previous.itemIds.length ? previous.itemIds : ['-'] } } });

  // Deterministic (seed 42) so two runs produce the same catalog — a load test that changes
  // shape between runs isn't a comparison. Owners come from a second stream, so adding an
  // owner does not reshuffle the catalogue itself.
  const { pick } = makeRng(4242);
  const rows = generateCatalogItems({ seed: 42, n: N, at: new Date() }).map(({ projectKey, ...it }) => ({
    ...it,
    description: it.description.replace('lib/demo.mjs', 'seed-demo.mjs'),
    projectId: projects[projectKey].id,
    ownerId: pick(owners),
  }));

  // A real item may already hold one of these slugs (slug is @unique). `skipDuplicates` leaves
  // it alone instead of failing the whole insert, and the rows that already existed under those
  // slugs are excluded from the record below, so clear-demo will never delete them.
  const slugs = rows.map((r) => r.slug);
  const foreign = await p.catalogItem.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
  if (foreign.length) console.warn(`[seed-demo] ${foreign.length} slug(s) already belong to content this seeder did not create (e.g. ${foreign[0].slug}) — skipped, not replaced.`);
  await p.catalogItem.createMany({ data: rows, skipDuplicates: true });

  const foreignIds = new Set(foreign.map((x) => x.id));
  const mine = (await p.catalogItem.findMany({ where: { slug: { in: slugs } }, select: { id: true } }))
    .map((x) => x.id).filter((id) => !foreignIds.has(id));
  await writeSeedRecord(p, { itemIds: mine, userIds: [...previous.userIds.filter((id) => owners.includes(id)), ...seededUserIds] });

  // Report the shape, so it's obvious what the catalog now contains.
  const MINE = { id: { in: mine.length ? mine : ['-'] } };
  const byKind = await p.catalogItem.groupBy({ by: ['kind'], where: { ...MINE, status: 'PUBLISHED' }, _count: { _all: true } });
  const total = mine.length;
  const published = await p.catalogItem.count({ where: { ...MINE, status: 'PUBLISHED' } });

  console.log(`[seed-demo] replaced ${removed.count} → created ${total} demo items (${published} PUBLISHED)`);
  console.log(`[seed-demo] recorded ${total} item id(s) in AdminSetting['${SEED_RECORD_KEY}'] — clear-demo deletes those and nothing else.`);
  console.log(`[seed-demo] published by kind: ${byKind.map((r) => `${r.kind}=${r._count._all}`).join(' ')}`);
  console.log(`[seed-demo] owners: ${owners.length} · projects: bmm/bsm/community`);
  console.log(`[seed-demo] note: only PLUGIN items carry meta.validation — that mirrors production (revalidatePlugin only runs for plugins).`);
}

main()
  .catch((e) => { console.error('[seed-demo] failed:', e); process.exit(1); })
  .finally(() => p.$disconnect());
