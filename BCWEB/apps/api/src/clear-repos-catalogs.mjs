// One-off cleanup: wipe ALL server repos + catalogs for a clean test environment.
// Run inside the api container: `node src/clear-repos-catalogs.mjs --yes`
//   (without --yes it just prints what it WOULD delete, and changes nothing).
//
// Deletes, with best-effort object-storage payload purge:
//   - Community catalogs (+ their items + hosted payloads)
//   - Server repos (+ their files/payloads + subscriptions), then hosting pools
//   - Official catalog items (+ events + submissions + payloads)
import { db } from './lib/lib.mjs';
import { deleteObject } from './lib/storage.mjs';

const DRY = !process.argv.includes('--yes');
const p = await db();
const rm = async (key) => { if (key) { try { await deleteObject(key); } catch {} } };

const [repos, groups, comCats, comItems, offItems] = await Promise.all([
  p.serverRepo.count(), p.hostingGroup.count(), p.communityCatalog.count(),
  p.communityCatalogItem.count(), p.catalogItem.count(),
]);
console.log(`[clear] found: ${repos} repo(s), ${groups} pool(s), ${comCats} community catalog(s) (${comItems} items), ${offItems} official item(s)`);
if (DRY) { console.log('[clear] DRY RUN — pass --yes to actually delete. Nothing changed.'); process.exit(0); }

// ── Community catalogs + items ──
for (const c of await p.communityCatalog.findMany({ include: { items: { select: { payloadKey: true } } } })) {
  for (const it of c.items) await rm(it.payloadKey);
}
await p.communityCatalogItem.deleteMany({});
await p.communityCatalog.deleteMany({});

// ── Server repos: purge file payloads, drop subs, then the repos + pools ──
for (const r of await p.serverRepo.findMany({ include: { files: { select: { key: true } } } })) {
  for (const f of r.files) await rm(f.key);
}
await p.subscription.deleteMany({ where: { serverRepoId: { not: null } } });
await p.serverRepo.deleteMany({}); // RepoFile rows cascade
await p.hostingGroup.deleteMany({});

// ── Official catalog items + their events/submissions/payloads ──
for (const it of await p.catalogItem.findMany({ select: { payloadKey: true } })) await rm(it.payloadKey);
await p.catalogEvent.deleteMany({});
await p.submission.deleteMany({});
await p.catalogItem.deleteMany({});

console.log('[clear] done — repos, pools and catalogs wiped.');
process.exit(0);
