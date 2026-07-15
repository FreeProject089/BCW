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

const p = new PrismaClient();
const N = Number(process.env.DEMO_N) || 400;

if (process.env.NODE_ENV === 'production' && process.env.DEMO_ALLOW_PROD !== 'yes') {
  console.error('[seed-demo] refusing to seed demo content into NODE_ENV=production (set DEMO_ALLOW_PROD=yes to override).');
  process.exit(1);
}

// Deterministic PRNG so two runs produce the same catalog — a load test that changes shape
// between runs isn't a comparison.
let _s = 42;
const rnd = () => (_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
// Long tail: most items near zero, a few big hits.
const longTail = (max) => Math.floor(max * Math.pow(rnd(), 3.2));

const ADJ = ['Better', 'Ultra', 'Quick', 'Smart', 'Neon', 'Turbo', 'Simple', 'Advanced', 'Compact', 'Lite', 'Pro', 'Nova'];
const NOUN = ['Manager', 'Loader', 'Toolkit', 'Inspector', 'Bridge', 'Overlay', 'Sync', 'Tweaks', 'Panel', 'Helper', 'Suite', 'Studio'];
const TAGS = ['utility', 'ui', 'performance', 'qol', 'graphics', 'audio', 'modding', 'tools', 'automation', 'experimental'];
const CATS = ['utility', 'graphics', 'audio', 'gameplay', 'other'];

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

  const rows = [];
  for (let i = 0; i < N; i++) {
    const kind = pick(['APP', 'APP', 'APP', 'PLUGIN', 'PLUGIN', 'THEME', 'PRESET']); // apps dominate, like the real catalog
    const projectKey = kind === 'PRESET' ? 'bsm' : pick(['bmm', 'bmm', 'bmm', 'community']);
    const name = `${pick(ADJ)} ${pick(NOUN)} ${i}`;
    // Most content is live; a realistic slice is still awaiting or failed moderation.
    const status = rnd() < 0.82 ? 'PUBLISHED' : pick(['PENDING', 'PENDING', 'REJECTED', 'HIDDEN']);
    const size = int(80_000, 40_000_000);

    const meta = {
      category: pick(CATS),
      price: rnd() < 0.9 ? 'free' : 'paid',
      file_type: kind === 'PLUGIN' ? 'bmmplug' : kind === 'THEME' ? 'bmmtheme' : kind === 'PRESET' ? 'json' : 'exe',
      size,
      download_url: `https://cdn.example.invalid/demo/${i}/${kind.toLowerCase()}.bin`,
      images: { thumb: `https://cdn.example.invalid/demo/${i}/thumb.png` },
      requirements: rnd() < 0.3 ? 'Windows 10+' : null,
    };

    // THE shape that matters: only plugins are ever re-checked, so only plugins carry
    // `validation`. Everything else legitimately has none.
    if (kind === 'PLUGIN') {
      const r = rnd();
      if (r < 0.08) meta.validation = { valid: false, reason: 'checksum mismatch', checkedAt: new Date().toISOString() };
      else if (r < 0.16) meta.validation = { unverified: true, reason: 'download url unreachable', checkedAt: new Date().toISOString() };
      else meta.validation = { valid: true, sha256: 'f'.repeat(64), files: int(3, 40), checkedAt: new Date().toISOString() };
    }

    rows.push({
      projectId: projects[projectKey].id,
      ownerId: pick(owners),
      kind, status, name,
      slug: `demo-${kind.toLowerCase()}-${i}`,
      description: `${name} — demo catalog content generated by seed-demo.mjs for local development and load testing.`,
      tags: Array.from(new Set([pick(TAGS), pick(TAGS)])),
      version: `${int(0, 3)}.${int(0, 9)}.${int(0, 9)}`,
      payloadSize: size,
      meta,
      downloads: longTail(250_000),
      views: longTail(900_000),
    });
  }

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
