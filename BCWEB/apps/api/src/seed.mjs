// One-shot seed: projects, an admin account, default hosting plans + admin settings.
// Run inside the api container: `node src/seed.mjs` (idempotent).
import argon2 from 'argon2';
import { db } from './lib.mjs';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@bettercommunity.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'change-me-now';

const p = await db();

// Projects
for (const [key, name] of [['community', 'BetterCommunity'], ['bmm', 'Better Mods Manager'], ['bsm', 'Better Sound Maker']]) {
  await p.project.upsert({ where: { key }, create: { key, name }, update: { name } });
}

// Admin user
const existing = await p.user.findUnique({ where: { email: ADMIN_EMAIL } });
if (!existing) {
  await p.user.create({ data: {
    email: ADMIN_EMAIL, displayName: 'Admin', role: 'ADMIN', emailVerified: true,
    passwordHash: await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id }),
  } });
  console.log(`[seed] admin created: ${ADMIN_EMAIL} (change the password!)`);
}

// Hosting plans (storage GB / upload kbps / cpu share / price)
const plans = [
  { name: 'Repo 5GB', storageGB: 5, uploadLimitKbps: 2048, cpuShare: 0.25, priceMonthlyCents: 300 },
  { name: 'Repo 10GB', storageGB: 10, uploadLimitKbps: 4096, cpuShare: 0.5, priceMonthlyCents: 500 },
  { name: 'Repo 25GB', storageGB: 25, uploadLimitKbps: 8192, cpuShare: 0.75, priceMonthlyCents: 1000 },
  { name: 'Repo 50GB', storageGB: 50, uploadLimitKbps: 16384, cpuShare: 1.0, priceMonthlyCents: 1800 },
];
for (const plan of plans) {
  const found = await p.hostingPlan.findFirst({ where: { name: plan.name } });
  if (!found) await p.hostingPlan.create({ data: plan });
}

// Admin settings: total hosting capacity + reserved free margin + pricing knobs.
const settings = {
  'hosting.totalCapacityGB': 500,        // total storage we offer
  'hosting.reservedFreeGB': 50,          // the host must always keep this free
  'pricing.perGBCents': 50,              // flexible pricing inputs
  'pricing.perUploadMbpsCents': 20,
  'pricing.perCpuShareCents': 400,
  'features.hostingEnabled': true,
};
for (const [key, value] of Object.entries(settings)) {
  await p.adminSetting.upsert({ where: { key }, create: { key, value }, update: {} }); // don't clobber admin edits
}

console.log('[seed] done');
process.exit(0);
