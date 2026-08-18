// Repairs the state a long-lived dev database drifts into, idempotently.
//
// Everything here is a real defect that was FOUND in the database rather than imagined, and
// each one is repaired in a way that is safe to re-run: nothing here deletes anything a person
// or a subscription still points at.
//
//   npm --prefix apps/api run fix:drift          (add --dry to see without writing)
//
// Why a script and not a migration: a migration runs once, and drift comes back. This is the
// thing you run when a screen looks wrong, and it tells you what it found either way.

import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const DRY = process.argv.includes('--dry');
const say = (...a) => console.log(DRY ? '[dry]' : '     ', ...a);

let repaired = 0;

// ── 1. User.status casing ────────────────────────────────────────────────────
//
// The column is a plain string holding 'active' | 'suspended' | 'banned', and every check in
// the codebase compares it lowercase. One row held 'BANNED'.
//
// That is not cosmetic. `where: { status: 'banned' }` does not match 'BANNED' in Postgres, so
// the account is banned as far as the database is concerned and NOT banned as far as every
// query is concerned — it passes the sign-in gate, it is absent from the moderation list, and
// nobody would ever see why. The single worst kind of bug: the data says one thing, the code
// reads another, and neither complains.
async function fixStatusCasing() {
  const rows = await p.$queryRawUnsafe(
    `SELECT id, email, status FROM "User" WHERE status <> lower(status)`,
  );
  if (!rows.length) return say('user status casing: nothing to fix');
  for (const r of rows) say(`user status: ${r.email} "${r.status}" → "${r.status.toLowerCase()}"`);
  if (!DRY) {
    await p.$executeRawUnsafe(`UPDATE "User" SET status = lower(status) WHERE status <> lower(status)`);
  }
  repaired += rows.length;
}

// ── 2. Duplicate hosting plans ───────────────────────────────────────────────
//
// The public Hosting page is a shop window: a person reads it top to bottom and picks one, so
// thirty-nine copies of the same offer is not clutter, it is a broken page. They were created
// one at a time through the admin endpoint before it refused exact duplicates, every one of
// them active (the column defaults to true).
//
// Identity is the whole visible offer — name + storage + upload — matching the guard that now
// sits on the create route, so this cleans up exactly what that guard would now prevent.
//
// A duplicate is only removed when NOTHING references it. A plan is the anchor of a
// subscription: deleting one a subscription points at would either fail on the foreign key or,
// worse, orphan somebody's billing. The oldest of each group is kept — it is the one whose id
// is most likely to be written down somewhere.
async function fixDuplicatePlans() {
  const plans = await p.hostingPlan.findMany({
    orderBy: { id: 'asc' },
    include: { _count: { select: { subscriptions: true } } },
  });
  const groups = new Map();
  for (const pl of plans) {
    const key = `${pl.name.trim()}|${pl.storageGB}|${pl.uploadLimitKbps}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pl);
  }
  const doomed = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const [keep, ...rest] = list;                       // oldest id kept
    const removable = rest.filter((x) => x._count.subscriptions === 0);
    const kept = rest.length - removable.length;
    say(`plans "${key}": ${list.length} copies → keeping ${keep.id}, removing ${removable.length}`
      + (kept ? `, leaving ${kept} that a subscription still points at` : ''));
    doomed.push(...removable.map((x) => x.id));
  }
  if (!doomed.length) return say('hosting plans: no removable duplicates');
  if (!DRY) await p.hostingPlan.deleteMany({ where: { id: { in: doomed } } });
  repaired += doomed.length;
}

// ── 3. The base plans ────────────────────────────────────────────────────────
//
// The tiers the site ships with. They get deleted by content-clearing scripts and by hand, and
// a hosting page with one plan on it reads as a broken product rather than an empty one.
//
// Matched by NAME only, and never updated: an admin who re-priced "Repo 5GB" meant it, and a
// repair script that quietly reset their prices would be worse than the missing rows it came
// to fix. This only ever puts back what is absent.
const BASE_PLANS = [
  { name: 'Free',      storageGB: 1,  uploadLimitKbps: 512,   cpuShare: 0.1,  priceMonthlyCents: 0 },
  { name: 'Repo 5GB',  storageGB: 5,  uploadLimitKbps: 2048,  cpuShare: 0.25, priceMonthlyCents: 300 },
  { name: 'Repo 10GB', storageGB: 10, uploadLimitKbps: 4096,  cpuShare: 0.5,  priceMonthlyCents: 500 },
  { name: 'Repo 25GB', storageGB: 25, uploadLimitKbps: 8192,  cpuShare: 0.75, priceMonthlyCents: 1000 },
  { name: 'Repo 50GB', storageGB: 50, uploadLimitKbps: 16384, cpuShare: 1.0,  priceMonthlyCents: 1800 },
];
async function restoreBasePlans() {
  let added = 0;
  for (const plan of BASE_PLANS) {
    const found = await p.hostingPlan.findFirst({ where: { name: plan.name } });
    if (found) continue;
    say(`base plan missing: ${plan.name} — restoring`);
    if (!DRY) await p.hostingPlan.create({ data: plan });
    added++;
  }
  if (!added) say('base plans: all present');
  repaired += added;
}

// ── 4. Closed accounts ───────────────────────────────────────────────────────
//
// Closure anonymises the row and keeps it — the id is referenced by content, audit entries and
// sanctions, so deleting it would tear holes in other people's history. Reported rather than
// touched: seeing eleven of them in a list is confusing, but they are correct, and a script
// that "cleaned them up" would be destroying the record on purpose.
async function reportClosedAccounts() {
  const n = await p.user.count({ where: { closedAt: { not: null } } });
  if (n) say(`closed accounts: ${n} (kept on purpose — their ids are referenced by content and audit history)`);
}

const run = async () => {
  console.log(DRY ? 'Checking for data drift (no writes)…' : 'Repairing data drift…');
  await fixStatusCasing();
  await fixDuplicatePlans();
  await restoreBasePlans();
  await reportClosedAccounts();
  console.log(DRY ? `\n${repaired} thing(s) would change.` : `\n${repaired} thing(s) changed.`);
  await p.$disconnect();
};

run().catch(async (e) => { console.error(e); await p.$disconnect(); process.exit(1); });
