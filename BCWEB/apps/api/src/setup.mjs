// One command to bring a database from empty to usable: migrate, then every seed, in order.
//
// It existed as four separate npm scripts you had to remember and run in the right sequence,
// with a Prisma-generate step in the middle that lands in the wrong directory on a host
// checkout (see below). Getting one of them wrong leaves a half-populated database that fails
// later, somewhere unrelated.
//
//   npm run setup            migrate + core seed + docs + FAQ
//   npm run setup -- --demo  ... and the demo fixtures (sample repos, catalogs, users)
//   npm run setup -- --skip-migrate
//
// Every step is idempotent, so running it on an existing database is safe: the core seed
// upserts projects/plans/settings and only creates the admin account when it is missing.
import { spawnSync } from 'node:child_process';
import { existsSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = resolve(HERE, '..');
const SCHEMA = resolve(API, '../../packages/db/schema.prisma');

const args = new Set(process.argv.slice(2));
const withDemo = args.has('--demo');
const skipMigrate = args.has('--skip-migrate');

let step = 0;
const say = (msg) => console.log(`\n[setup ${++step}] ${msg}`);
const fail = (msg, extra) => {
  console.error(`\n[setup] FAILED: ${msg}`);
  if (extra) console.error(extra);
  process.exit(1);
};

const run = (cmd, cmdArgs, label) => {
  const r = spawnSync(cmd, cmdArgs, { cwd: API, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`${label} exited with code ${r.status}`);
};

// Prisma needs BOTH of these or it fails with a P1012 that looks nothing like a missing
// environment variable. Checking here turns a confusing schema error into a clear one.
if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set.', 'Set it to the Postgres URL, e.g. postgresql://user:pass@localhost:5432/bcweb');
if (!skipMigrate && !process.env.DIRECT_DATABASE_URL) {
  console.warn('[setup] note: DIRECT_DATABASE_URL is unset; Prisma may reject the schema with P1012. Set it to the same value as DATABASE_URL for a plain local Postgres.');
}

if (!skipMigrate) {
  say('applying migrations');
  run('npx', ['prisma', 'migrate', 'deploy', '--schema', SCHEMA], 'prisma migrate deploy');

  say('generating the Prisma client');
  run('npx', ['prisma', 'generate', '--schema', SCHEMA], 'prisma generate');

  // The generate above resolves its output from the SCHEMA's location. packages/db has no
  // package.json and BCWEB has no root one, so Prisma walks up and writes the client into the
  // PARENT repo — while the API loads apps/api/node_modules/.prisma/client. Both then exist
  // and drift, and the symptom is an instant 500 on an obviously correct route, because the
  // model is undefined and it threw at query-build time without ever reaching Postgres.
  //
  // Running `prisma generate` again does not fix it (it regenerates the same wrong copy), so
  // the fix is to mirror the directory. This is host-only: the Dockerfile copies packages/db
  // into the image as ./prisma, which flattens everything into one client.
  const parentClient = resolve(API, '../../../node_modules/.prisma/client');
  const apiClient = join(API, 'node_modules/.prisma/client');
  if (existsSync(parentClient) && parentClient !== apiClient) {
    say('mirroring the generated client into apps/api');
    try {
      rmSync(apiClient, { recursive: true, force: true });
      cpSync(parentClient, apiClient, { recursive: true });
      console.log(`  ${parentClient}\n  -> ${apiClient}`);
    } catch (e) {
      // The running API holds query_engine-windows.dll.node open, and a half-finished copy
      // leaves a BROKEN client behind — worse than not copying at all. Say so explicitly.
      fail('could not mirror the Prisma client (is the API server running? it holds the query engine open)', e.message);
    }
  }
}

say('seeding projects, admin account, hosting plans and settings');
run('node', ['src/seed.mjs'], 'seed');

say('seeding documentation');
run('node', ['src/seed-docs.mjs'], 'seed:docs');

say('seeding the FAQ');
run('node', ['src/seed-faq.mjs'], 'seed:faq');

say('seeding the site guide');
run('node', ['src/seed-site-guide.mjs'], 'seed:site');

if (withDemo) {
  say('seeding demo fixtures');
  run('node', ['src/seed-demo.mjs'], 'seed:demo');
} else {
  console.log('\n[setup] demo fixtures skipped (pass --demo to include them)');
}

console.log(`
[setup] done.

  Admin account: ${process.env.SEED_ADMIN_EMAIL || 'admin@bettercommunity.local'}
  Password:      ${process.env.SEED_ADMIN_PASSWORD ? '(from SEED_ADMIN_PASSWORD)' : 'change-me-now  ← CHANGE THIS'}

Set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD before the first run to avoid the default.
The account is only created when it does not already exist, so re-running never resets a
password you have since changed.
`);
