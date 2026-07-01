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
  'pricing.featurePerDayCents': 50,   // paid "featured listing" promotion, per day
  'features.hostingEnabled': true,
};
for (const [key, value] of Object.entries(settings)) {
  await p.adminSetting.upsert({ where: { key }, create: { key, value }, update: {} }); // don't clobber admin edits
}

// Default per-project config (admin-editable later via the dashboard).
const projectConfigs = {
  community: {
    name: 'BetterCommunity', tagline: 'The home for all Better projects.',
    links: { kofi: 'https://ko-fi.com/bettercommunity', github: 'https://github.com/FreeProject089' },
    downloads: [], contributors: [], progress: [], legal: {},
  },
  bmm: {
    name: 'Better Mods Manager', tagline: 'Apps, plugins & themes for DCS modding.',
    downloads: [
      { label: 'Download (Windows)', url: 'https://github.com/FreeProject089/BetterModsManager/releases/latest', primary: true },
    ],
    releaseNotes: { owner: 'FreeProject089', repo: 'BetterModsManager', branch: 'Tdev', path: 'Update' },
    links: {
      github: 'https://github.com/FreeProject089/BetterModsManager',
      discord: 'https://discord.gg/', kofi: 'https://ko-fi.com/bettercommunity',
      reddit: '', forum: 'https://forum.dcs.world/',
    },
    contributors: [
      { name: 'FreeProject089', role: 'Creator & Developer', category: 'staff', pfp: '', links: { github: 'https://github.com/FreeProject089' } },
    ],
    // Community contributors are pulled from this GitHub JSON; pfp filenames resolve
    // against pfpBase. Messages scroll one at a time (no author shown).
    contributorsUrl: 'https://raw.githubusercontent.com/FreeProject089/BetterModsManager/Tdev/frontend/assets/contributors.json',
    pfpBase: 'https://raw.githubusercontent.com/FreeProject089/BetterModsManager/Tdev/frontend/assets/userpfp/',
    replayUrl: '/bmm-replay.bmmreplay',   // real rrweb session, played as a transparent live preview
    messages: [
      { message: 'Welcome to the new BetterCommunity hub — thanks for being here!' },
      { message: 'Share your mods, plugins and themes with the community.' },
    ],
    progress: [
      { title: 'v1.0 release', status: 'in-progress', percent: 75, eta: 'Q3 2026', note: 'Final stabilization before the stable launch.',
        items: [{ label: 'Core mod engine', done: true }, { label: 'Plugin API', done: true }, { label: 'Theme editor', done: true }, { label: 'Crash reporter', done: true }, { label: 'Full docs', done: false }, { label: 'Installer handoff', done: false }] },
      { title: 'Plugin marketplace', status: 'in-progress', percent: 35, eta: 'Q4 2026', note: 'Browse & install community plugins in-app.',
        items: [{ label: 'Catalog format', done: true }, { label: 'In-app browser', done: false }, { label: 'Ratings', done: false }] },
      { title: 'Cloud sync', status: 'planned', percent: 0, eta: '2027', note: 'Sync your setup across machines.',
        items: [{ label: 'Account linking', done: false }, { label: 'Conflict resolution', done: false }] },
    ],
    legal: {
      license: 'GPL-3.0',
      licenseUrl: 'https://github.com/FreeProject089/BetterModsManager/blob/Tdev/LICENSE.md',
      tos: 'https://github.com/FreeProject089/BetterModsManager/blob/Tdev/TOS.md',
      tosFr: 'https://github.com/FreeProject089/BetterModsManager/blob/Tdev/TOS_FR.md',
      privacy: 'https://github.com/FreeProject089/BetterModsManager/blob/Tdev/PRIVACY.md',
      privacyFr: 'https://github.com/FreeProject089/BetterModsManager/blob/Tdev/PRIVACY_FR.md',
      readme: 'https://github.com/FreeProject089/BetterModsManager/blob/Tdev/README.md',
    },
  },
  bsm: {
    name: 'Better Sound Maker', tagline: 'Community sound presets.',
    downloads: [{ label: 'Download (Windows)', url: '', primary: true }],
    releaseNotes: { owner: 'FreeProject089', repo: 'Better-Sound.Maker', branch: 'main', path: 'Update' },
    links: { github: 'https://github.com/FreeProject089/Better-Sound.Maker', discord: '', kofi: 'https://ko-fi.com/bettercommunity' },
    contributors: [], messages: [], progress: [], legal: { license: '', tos: '', privacy: '' },
  },
  installer: {
    name: 'BetterInstaller', tagline: 'The modern installer for the Better* suite.',
    downloads: [{ label: 'Download (Windows)', url: '', primary: true }],
    links: { github: '', kofi: 'https://ko-fi.com/bettercommunity' },
    contributors: [], progress: [], legal: {},
  },
};
// NOTE: project configs are overwritten on seed (still being set up). Once you
// customize them via Admin → Projects config, avoid reseeding or they'll reset.
for (const [key, value] of Object.entries(projectConfigs)) {
  const k = `project.${key}`;
  await p.adminSetting.upsert({ where: { key: k }, create: { key: k, value }, update: { value } });
}

console.log('[seed] done');
process.exit(0);
