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
// Same command, but the output comes back instead of only going to the console — the
// self-heal below has to READ why deploy failed, and `stdio: 'inherit'` throws that away.
const shCapture = (cmd) => {
  try {
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    process.stdout.write(out);
    return { ok: true, out };
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    process.stdout.write(out);
    return { ok: false, out };
  }
};

// Does the live database already match the models, exactly?
//
// This is the whole safety argument for the self-heal. `migrate diff` exits 0 for "no
// difference" and 2 for "there are differences"; if there is NO difference then every
// migration still marked pending or failed has nothing left to do, and marking it applied
// cannot skip work that was never done. If there IS a difference we touch nothing.
const schemaAlreadyMatches = () => {
  try {
    execSync(`npx prisma migrate diff --from-schema-datasource "${SCHEMA}" --to-schema-datamodel "${SCHEMA}" --exit-code`,
      { stdio: ['ignore', 'pipe', 'pipe'] });
    return true;   // exit 0 = no difference
  } catch { return false; }
};

// Which migration did deploy die on. Prisma phrases it two ways: the long form on the
// first failure, the short P3009 form on every retry afterwards.
const failedMigrationName = (out) =>
  out.match(/^The `(.+?)` migration started at .* failed$/m)?.[1]
  || out.match(/^Migration name: (.+)$/m)?.[1]
  || null;

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
let res = shCapture(`npx prisma migrate deploy ${schemaArg}`);

// ── The restart loop this exists to prevent ─────────────────────────────────────
// A database that was ever synced with `db push` has the OBJECTS a later migration
// creates but not the row saying so, and Prisma refuses that migration with
// "relation … already exists" (42P07). It then refuses every migration after it (P3009),
// this script exits non-zero, the container restarts, and does the same thing forever —
// so a fully-recoverable state reads as a hard crash with no way out but psql.
//
// Baselining `0_init` (above) only ever covered the FIRST migration; the same thing
// happens with every index migration added after the last db push.
//
// Recover only when the database provably already matches the models. Otherwise the
// failure is real and belongs on the console, unaltered.
if (!res.ok) {
  if (!schemaAlreadyMatches()) {
    console.error('[migrate] deploy failed and the schema does NOT match the models — not touching anything.');
    console.error('[migrate] fix the migration, or resolve it by hand: npx prisma migrate resolve --applied <name>');
    process.exit(1);
  }
  console.log('[migrate] deploy failed, but the database already matches the models.');
  console.log('[migrate] adopting the redundant migrations instead of restarting forever:');
  // Bounded: one pass per checked-in migration at most, so a failure this cannot fix
  // exits rather than spinning.
  let previous = null;
  for (let i = 0; i < 100 && !res.ok; i++) {
    const name = failedMigrationName(res.out);
    if (!name) break;
    // The SAME migration coming back means resolving it changed nothing — which happens
    // when its row is left `rolled_back` (Prisma then retries it forever) and is exactly
    // the loop this function exists to break. Stop and say so, rather than burning
    // through 100 identical attempts and reporting a generic failure.
    if (name === previous) {
      console.error(`[migrate] resolving ${name} did not clear it — its _prisma_migrations row is probably marked rolled_back.`);
      console.error('[migrate] delete that row (or re-resolve it) by hand; nothing further will be attempted.');
      break;
    }
    previous = name;
    console.log(`[migrate]   • ${name}`);
    try { execSync(`npx prisma migrate resolve --applied "${name}" ${schemaArg}`, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { break; }
    res = shCapture(`npx prisma migrate deploy ${schemaArg}`);
  }
  if (!res.ok) {
    console.error('[migrate] could not recover automatically — see the error above.');
    process.exit(1);
  }
  console.log('[migrate] recovered.');
}
