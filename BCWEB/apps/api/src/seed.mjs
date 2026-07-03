// One-shot seed: projects, an admin account, default hosting plans + admin settings.
// Run inside the api container: `node src/seed.mjs` (idempotent).
import argon2 from 'argon2';
import { db } from './lib.mjs';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@bettercommunity.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'change-me-now';

const p = await db();

// Projects
for (const [key, name] of [['community', 'BetterCommunity'], ['bmm', 'Better Mods Manager'], ['bsm', 'Better Sound Maker'], ['installer', 'BetterInstaller']]) {
  await p.project.upsert({ where: { key }, create: { key, name }, update: { name } });
}

// Admin user — seeded as SUPERADMIN so there's always at least one account able to
// grant/reassign roles (SUPERADMIN can only be granted by an existing SUPERADMIN,
// via PUT /admin/users/:id/role — this bootstraps that chain on a fresh deploy).
const existing = await p.user.findUnique({ where: { email: ADMIN_EMAIL } });
if (!existing) {
  await p.user.create({ data: {
    email: ADMIN_EMAIL, displayName: 'Admin', role: 'SUPERADMIN', emailVerified: true,
    passwordHash: await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id }),
  } });
  console.log(`[seed] admin created: ${ADMIN_EMAIL} (change the password!)`);
}

// Hosting plans (storage GB / upload kbps / cpu share / price)
const plans = [
  // A genuinely free tier — small enough that a real hobby repo fits, at $0/mo. Shown
  // with its own "Get it free" styling on the hosting page instead of blending in as
  // just another paid tier.
  { name: 'Free', storageGB: 1, uploadLimitKbps: 512, cpuShare: 0.1, priceMonthlyCents: 0 },
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
  'hosting.tempMarginGB': 20,            // dedicated margin for catalog submission payloads
  'pricing.perGBCents': 50,              // flexible pricing inputs
  'pricing.perUploadMbpsCents': 20,
  'pricing.perCpuShareCents': 400,
  'pricing.featurePerDayCents': 50,   // paid "featured listing" promotion, per day
  'features.hostingEnabled': true,
};
for (const [key, value] of Object.entries(settings)) {
  await p.adminSetting.upsert({ where: { key }, create: { key, value }, update: {} }); // don't clobber admin edits
}

// Core staff shown on every project's Community tab (category resolves to "Staff").
const PFP_BASE = 'https://raw.githubusercontent.com/FreeProject089/BetterModsManager/Tdev/frontend/';
const STAFF = [
  { name: 'FreeProject089', role: 'Creator & Developer', category: 'staff', pfp: `${PFP_BASE}assets/pfp.webp`, links: { github: 'https://github.com/FreeProject089' } },
  { name: 'c0c0_1er', role: 'Community Support / Staff', category: 'staff', pfp: `${PFP_BASE}assets/pfpc0c0.png`, links: { github: 'https://github.com/WarGameRP' } },
];

// Default per-project config (admin-editable later via the dashboard).
const projectConfigs = {
  community: {
    name: 'BetterCommunity', tagline: 'The home for all Better projects.',
    links: { kofi: 'https://ko-fi.com/bettercommunity', github: 'https://github.com/FreeProject089' },
    downloads: [], contributors: [], progress: [], legal: {},
  },
  bmm: {
    name: 'Better Mods Manager', tagline: 'Apps, plugins & themes for DCS modding.', version: '0.9.11',
    downloads: [
      { label: 'Download (Windows)', url: 'https://github.com/FreeProject089/BetterModsManager/releases/latest', primary: true },
      { label: 'Source code', url: 'https://github.com/FreeProject089/BetterModsManager/archive/refs/heads/Tdev.zip' },
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
    pfpBase: 'https://raw.githubusercontent.com/FreeProject089/BetterModsManager/Tdev/frontend/',
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
    name: 'Better Sound Maker', tagline: 'Community sound presets.', version: '1.0.9',
    downloads: [
      { label: 'Download (Windows)', url: 'https://github.com/FreeProject089/Better-Sound.Maker/releases/latest', primary: true },
      { label: 'Source code', url: 'https://github.com/FreeProject089/Better-Sound.Maker/archive/refs/heads/main.zip' },
    ],
    releaseNotes: { owner: 'FreeProject089', repo: 'Better-Sound.Maker', branch: 'main', path: 'Update' },
    links: { github: 'https://github.com/FreeProject089/Better-Sound.Maker', discord: '', kofi: 'https://ko-fi.com/bettercommunity' },
    contributors: STAFF, messages: [], progress: [], legal: { license: '', tos: '', privacy: '' },
  },
  installer: {
    name: 'BetterInstaller', tagline: 'The modern installer for the Better* suite.', version: '1.0.0',
    downloads: [{ label: 'Download source code', url: 'https://github.com/FreeProject089/BetterInstaller/archive/refs/heads/master.zip', primary: true }],
    links: { github: 'https://github.com/FreeProject089/BetterInstaller', kofi: 'https://ko-fi.com/bettercommunity' },
    contributors: STAFF, messages: [], progress: [],
    legal: {
      license: 'GPL-3.0',
      licenseUrl: 'https://github.com/FreeProject089/BetterInstaller/blob/master/LICENSE',
      readme: 'https://github.com/FreeProject089/BetterInstaller/blob/master/README.MD',
      readmeFr: 'https://github.com/FreeProject089/BetterInstaller/blob/master/README_FR.MD',
    },
  },
};
// NOTE: project configs are overwritten on seed (still being set up). Once you
// customize them via Admin → Projects config, avoid reseeding or they'll reset.
for (const [key, value] of Object.entries(projectConfigs)) {
  const k = `project.${key}`;
  await p.adminSetting.upsert({ where: { key: k }, create: { key: k, value }, update: { value } });
}

// Markdown guide — hosted in the blog and linked from the blog editor toolbar.
const adminUser = await p.user.findUnique({ where: { email: ADMIN_EMAIL } });
const communityProject = await p.project.findUnique({ where: { key: 'community' } });
if (adminUser && communityProject) {
  const guideBody = `The BetterCommunity blog uses the **same Markdown** as the BMM update notes. Everything below works here and in-app.

> [!TIP]
> Keep posts short and scannable — a heading, a few bullets, and the change badges do most of the work.

## Text basics
\`**bold**\` · \`*italic*\` · \`~~strikethrough~~\` · \`\\\`inline code\\\`\` · \`[a link](https://example.com)\`

## Change badges
Wrap a keyword in square brackets to get a coloured chip:

- [NEW] Added a dark theme
- [IMPROVED] Faster catalog loading
- [FIXED] Crash when opening an empty repo
- [REFINE] Tighter spacing · [VISUAL] New animation · [MAJOR] Big rewrite

French spellings work too: \`[NOUVEAU]\`, \`[AMÉLIORÉ]\`, \`[FIXÉ]\`, \`[RAFFINEMENT]\`, \`[VISUEL]\`, \`[MAJEUR]\`.

## Callouts
Start a blockquote with \`[!TYPE]\`:

> [!WARNING]
> Only install content from sources you trust.

Types: \`NOTE\`, \`TIP\`, \`IMPORTANT\`, \`WARNING\`, \`CAUTION\` (FR: \`REMARQUE\`, \`ASTUCE\`, \`IMPORTANT\`, \`AVERTISSEMENT\`, \`ATTENTION\`).

## Media
Use the editor toolbar buttons for images, YouTube, video and links — they insert the right snippet for you.

## Tables & code
| Feature | Status |
|---|---|
| Dark theme | Shipped |
| Repo sync | Faster |

\`\`\`json
{ "name": "example", "version": "1.0.0" }
\`\`\`

That's everything — combine badges + callouts + short bullets for clean, readable posts.`;
  const guide = { title: 'Markdown guide — writing notes & blog posts', excerpt: 'Every Markdown feature the blog supports: badges, callouts, media, tables and more.', body: guideBody, status: 'PUBLISHED' };
  await p.blogPost.upsert({
    where: { slug: 'markdown-guide' },
    create: { slug: 'markdown-guide', projectId: communityProject.id, authorId: adminUser.id, publishedAt: new Date(), ...guide },
    update: guide,
  });
}

// Catalog guides — one per catalog type, hosted in the blog.
if (adminUser && communityProject) {
  const GUIDES = [
    { slug: 'guide-app-catalog', title: 'App Catalog format', excerpt: 'How to publish an app to the BMM App Catalog.', body:
`The **App Catalog** is a hosted \`catalog.json\` with an \`apps\` array.

## App entry — required fields
| Field | Values |
|---|---|
| \`id\` | unique slug (dashes) |
| \`title\` | display name |
| \`description\` | 1–3 sentences |
| \`category\` | \`game\` · \`utility\` · \`other\` |
| \`price\` | \`free\` · \`freemium\` · \`paid\` |
| \`tags\` | up to 3 |
| \`download.url\` | direct link |
| \`download.file_type\` | \`zip\` · \`exe\` · \`msi\` · \`script\` |

Optional: \`version\`, \`requirements\`, \`md_link\`, \`images.thumb\` (16:9 ≥400×225), \`images.extra\`, \`download.size\`, \`download.sha256\` (recommended integrity checksum).

> [!TIP]
> On the site, create official apps via **Admin → Catalogs**; community apps via **Dashboard → Submit content**. Both build a \`bmm://\` deeplink.` },
    { slug: 'guide-plugin-catalog', title: 'Plugin Catalog & .bmmplug format', excerpt: 'Plugin catalog fields + the .bmmplug package and its checksums.', body:
`A plugin catalog entry (required): \`id\`, \`name\`, \`version\`, \`author\`, \`download_url\`. Optional: \`game\`, \`description\`, \`official\`, \`tags\`, \`icon_url\`, and a \`sha256\` of the \`.bmmplug\`.

## .bmmplug package (a ZIP)
- \`plugin.json\` — the manifest (**required**)
- \`icon.png\` — 40×40 (optional)
- \`checksums.json\` — **sha256 of every file** in the package (integrity)

## Integrity
The catalog entry's \`sha256\` covers the whole \`.bmmplug\`; \`checksums.json\` covers each file inside. BMM validates both — if either fails, the plugin is flagged **invalid** and a modal recommends **not installing**.

> [!WARNING]
> Only install plugins that pass validation. Catalog plugins are always validated.` },
    { slug: 'guide-preset-catalog', title: 'Preset Catalog (BSM)', excerpt: 'The BSM preset JSON format and how to share presets.', body:
`A BSM preset is a single JSON: \`name\`, \`version\`, \`assetPaths\` (**required**); \`color\`, \`UpdateNumber\`, \`date\` (optional). Its metadata lives inside the file.

Publish via **Dashboard → Submit content** (Project **BSM**, Type **Preset**). On the catalog you can **download**, **multi-select download**, and sort by *popular (all-time / month)*, *newest* or *most viewed*. Every download is counted for the uploader's stats.` },
    { slug: 'guide-theme-catalog', title: 'Theme Catalog (.bmmtheme)', excerpt: 'The .bmmtheme package format and how to publish a theme.', body:
`A \`.bmmtheme\` is a ZIP with \`theme.json\` (**required**) + optional \`assets/\`. The manifest carries \`id\`, \`name\`, \`author\`, \`version\`, a \`tokens\` map of \`--bmm-*\` CSS variables, and optional per-selector \`overrides\`.

Export one from the in-app **Theme Editor** (it writes a valid manifest), then publish via **Dashboard → Submit content** (Project **BMM**, Type **Theme**). Installing applies instantly and is reversible.` },
  ];
  for (const g of GUIDES) {
    const data = { title: g.title, excerpt: g.excerpt, body: g.body, status: 'PUBLISHED' };
    await p.blogPost.upsert({ where: { slug: g.slug }, create: { slug: g.slug, projectId: communityProject.id, authorId: adminUser.id, publishedAt: new Date(), ...data }, update: data });
  }
}

console.log('[seed] done');
process.exit(0);
