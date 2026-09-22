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
// Everything it creates is slugged `demo-*` so a re-run replaces exactly its own rows and
// never touches real content. Refuses to run against a production DB.
import { PrismaClient } from '@prisma/client';
// The fixtures themselves live in lib/demo.mjs: the admin demo mode serves the same generator
// as JSON and stores nothing, this script writes its output as rows. One body of fixtures, so
// the two can never drift into showing different shapes.
import { generateCatalogItems, makeRng } from './lib/demo.mjs';

const p = new PrismaClient();
const N = Number(process.env.DEMO_N) || 400;

if (process.env.NODE_ENV === 'production' && process.env.DEMO_ALLOW_PROD !== 'yes') {
  console.error('[seed-demo] refusing to seed demo content into NODE_ENV=production (set DEMO_ALLOW_PROD=yes to override).');
  process.exit(1);
}

async function main() {
  // Owners: reuse whatever real users exist, else make demo ones (a catalog with a single
  // author doesn't exercise the owner join the feed does).
  const existing = await p.user.findMany({ take: 5, select: { id: true } });
  let owners = existing.map((u) => u.id);
  if (owners.length < 3) {
    for (let i = owners.length; i < 3; i++) {
      const u = await p.user.upsert({
        where: { email: `demo-author-${i}@bettercommunity.local` },
        update: {},
        create: { email: `demo-author-${i}@bettercommunity.local`, displayName: `Demo Author ${i + 1}` },
      });
      owners.push(u.id);
    }
  }

  const projects = {};
  for (const [key, name] of [['bmm', 'BetterModsManager'], ['bsm', 'BetterSaveManager'], ['community', 'Community']]) {
    projects[key] = await p.project.upsert({ where: { key }, create: { key, name }, update: {} });
  }

  const removed = await p.catalogItem.deleteMany({ where: { slug: { startsWith: 'demo-' } } });

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

  await p.catalogItem.createMany({ data: rows });

  // Report the shape, so it's obvious what the catalog now contains.
  const byKind = await p.catalogItem.groupBy({ by: ['kind'], where: { slug: { startsWith: 'demo-' }, status: 'PUBLISHED' }, _count: { _all: true } });
  const noValidation = await p.catalogItem.count({ where: { slug: { startsWith: 'demo-' }, status: 'PUBLISHED', NOT: { meta: { path: ['validation', 'valid'], equals: false } } } });
  const total = await p.catalogItem.count({ where: { slug: { startsWith: 'demo-' } } });
  const published = await p.catalogItem.count({ where: { slug: { startsWith: 'demo-' }, status: 'PUBLISHED' } });

  console.log(`[seed-demo] replaced ${removed.count} → created ${total} demo items (${published} PUBLISHED)`);
  console.log(`[seed-demo] published by kind: ${byKind.map((r) => `${r.kind}=${r._count._all}`).join(' ')}`);
  console.log(`[seed-demo] owners: ${owners.length} · projects: bmm/bsm/community`);
  console.log(`[seed-demo] note: only PLUGIN items carry meta.validation — that mirrors production (revalidatePlugin only runs for plugins).`);
}

main()
  .catch((e) => { console.error('[seed-demo] failed:', e); process.exit(1); })
  .finally(() => p.$disconnect());
