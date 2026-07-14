// Test-environment cleanup. Two modes, both DRY-RUN unless you pass --yes:
//
//   node src/clear-repos-catalogs.mjs            → dry-run of CONTENT clear
//   node src/clear-repos-catalogs.mjs --yes      → clear ALL user CONTENT, KEEP accounts
//   node src/clear-repos-catalogs.mjs --nuke --yes → wipe EVERYTHING incl. accounts
//
// (npm: `npm run clear-content [-- --yes]`, `npm run nuke -- --yes`)
//
// CONTENT clear removes every user-generated row (repos, pools, catalogs, submissions,
// blog/docs, reviews, notifications, subscriptions, payments, analytics, newsletter,
// game scores, contact messages, promo redemptions, audit/metrics…) with a best-effort
// object-storage payload purge — but keeps User accounts + their links + site config
// (projects, plans, admin settings, promo codes, showcase, FAQ, access policies).
// NUKE additionally truncates accounts and every config table — a totally empty DB
// (re-run `npm run seed` afterwards to recreate the admin + projects + plans).
import { db } from './lib/lib.mjs';
import { deleteObject } from './lib/storage.mjs';

const DRY = !process.argv.includes('--yes');
const NUKE = process.argv.includes('--nuke');

// Friendly failures for the two classic host-side mistakes (this script is meant to run
// INSIDE the api container, where the env + a fresh Prisma client are guaranteed):
//   docker compose -f infra/compose/docker-compose.yml exec api node src/clear-repos-catalogs.mjs --nuke --yes
if (!process.env.DATABASE_URL) {
  console.error('[clear] DATABASE_URL is not set. Run this inside the api container:\n' +
    '  docker compose -f infra/compose/docker-compose.yml exec api node src/clear-repos-catalogs.mjs [--nuke] [--yes]\n' +
    'or set DATABASE_URL yourself (see infra/compose/.env) before running on the host.');
  process.exit(1);
}
const p = await db();
if (!p.communityCatalogItem) {
  console.error('[clear] The generated Prisma client here is STALE (missing newer models).\n' +
    'Run inside the api container (see above), or refresh the host client first:\n' +
    '  cd apps/api && npx prisma generate --schema ../../packages/db/schema.prisma');
  process.exit(1);
}
const rm = async (key) => { if (key) { try { await deleteObject(key); } catch {} } };

// Content tables cleared in BOTH modes. TRUNCATE … CASCADE pulls in their dependent
// tables (RepoFile, CommunityCatalogItem, CatalogEvent, comments/revisions, …), so only
// the top-level owners need listing.
const CONTENT = [
  'ServerRepo', 'HostingGroup', 'CommunityCatalog', 'CatalogItem', 'Submission',
  'BlogPost', 'DocPage', 'Notification', 'Review', 'Announcement', 'Subscription',
  'FeatureSubscription', 'Payment', 'PromoRedemption', 'Giveaway', 'PendingCart',
  'KofiDonation', 'ContactMessage', 'AnalyticsEvent', 'WebVital', 'InteractionEvent',
  'ErrorEvent', 'GameScore', 'AnalyticsGoal', 'NewsletterSubscriber', 'ServerMetricSample',
  'ServerAlertLog', 'LoginAttempt', 'AuditLogEntry', 'FreeTierClaim', 'RepoFavorite',
  'BlogPermission', 'OAuthCode', 'OAuthConsent', 'OAuthRefreshToken', 'Report',
];
// NUKE also wipes accounts + config.
const NUKE_EXTRA = [
  'User', 'OAuthAccount', 'DiscordLink', 'DiscordActivity', 'DiscordLinkCode', 'LinkCode',
  'CreatorLink', 'Project', 'HostingPlan', 'GlobalAccessPolicy', 'UserAccessPolicy',
  'AdminSetting', 'ShowcaseProject', 'PromoCode', 'PromoCampaign', 'Event', 'FaqItem',
  'OidcKey', 'OAuthClient', 'EmailVerification', 'PasswordReset', 'PlatformAsset', 'ProjectVersion',
];

// Only truncate tables that actually exist in this database — so the script keeps working
// against a DB that predates newer models (they'd just have nothing to wipe anyway).
const wanted = NUKE ? [...CONTENT, ...NUKE_EXTRA] : CONTENT;
const existing = new Set((await p.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).map((r) => r.tablename));
const tables = wanted.filter((t) => existing.has(t));

// Counts for the summary / dry-run.
const [repos, cats, items, offItems] = await Promise.all([
  p.serverRepo.count(), p.communityCatalog.count(), p.communityCatalogItem.count(), p.catalogItem.count(),
]);
console.log(`[clear] mode=${NUKE ? 'NUKE (everything)' : 'CONTENT (keep accounts)'} · will truncate ${tables.length} table group(s)`);
console.log(`[clear] storage payloads to purge: ${repos} repo(s), ${cats} catalog(s) (${items} items), ${offItems} official item(s)`);
if (DRY) { console.log('[clear] DRY RUN — pass --yes to actually delete. Nothing changed.'); process.exit(0); }

// 1) Best-effort object-storage purge (rows go via TRUNCATE next, but the bytes won't).
for (const r of await p.serverRepo.findMany({ include: { files: { select: { key: true } } } })) {
  for (const f of r.files) await rm(f.key);
}
for (const c of await p.communityCatalog.findMany({ include: { items: { select: { payloadKey: true } } } })) {
  for (const it of c.items) await rm(it.payloadKey);
}
for (const it of await p.catalogItem.findMany({ select: { payloadKey: true } })) await rm(it.payloadKey);

// 2) One TRUNCATE … RESTART IDENTITY CASCADE clears the listed tables + all dependents.
const quoted = tables.map((t) => `"${t}"`).join(', ');
await p.$executeRawUnsafe(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE;`);

console.log(`[clear] done — ${NUKE ? 'database wiped (run `npm run seed` to recreate the admin + projects + plans)' : 'all user content cleared; accounts + config kept'}.`);
process.exit(0);
