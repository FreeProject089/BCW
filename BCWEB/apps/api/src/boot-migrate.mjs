// Boot-time schema management — the SAFE replacement for `prisma db push --accept-data-loss`.
// `db push` mutates the live schema to match the models and can silently drop a column/table
// on a rename or narrowing. `migrate deploy` only applies reviewed, checked-in migration SQL,
// and NEVER drops data it isn't told to. This wrapper makes `migrate deploy` work on all three
// database states without manual steps:
//
//   • fresh DB (no tables)                        → deploy applies the baseline, creates everything
//   • DB previously synced with `db push`         → baseline it (resolve --applied) so deploy is a
//     (tables exist, no _prisma_migrations)          no-op instead of trying to recreate tables
//   • already-migrated DB (_prisma_migrations)    → deploy applies any pending migrations
//
// Run before the server:  node src/boot-migrate.mjs && node src/server.mjs
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const SCHEMA = process.env.PRISMA_SCHEMA || 'prisma/schema.prisma'; // container path; override locally
const BASELINE = process.env.PRISMA_BASELINE || '0_init';
const schemaArg = `--schema "${SCHEMA}"`;
const sh = (cmd) => execSync(cmd, { stdio: 'inherit' });

const p = new PrismaClient();
const tableExists = async (name) => (await p.$queryRawUnsafe(
  "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS e", name))[0].e;
let hasMigrations = false, hasApp = false;
try {
  hasMigrations = await tableExists('_prisma_migrations');
  hasApp = await tableExists('User'); // information_schema stores the real (case-sensitive) name
} finally { await p.$disconnect(); }

if (!hasMigrations && hasApp) {
  console.log(`[migrate] adopting an existing (db push) database — baselining ${BASELINE} as applied`);
  try { sh(`npx prisma migrate resolve --applied ${BASELINE} ${schemaArg}`); }
  catch (e) { console.log('[migrate] baseline resolve skipped:', String(e.message).split('\n')[0]); }
}
console.log('[migrate] applying migrations…');
sh(`npx prisma migrate deploy ${schemaArg}`);
