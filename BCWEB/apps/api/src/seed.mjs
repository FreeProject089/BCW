// One-shot seed: projects, an admin account, default hosting plans + admin settings.
// Run inside the api container: `node src/seed.mjs` (idempotent).
import argon2 from 'argon2';
import { db } from './lib/lib.mjs';
import { BLOG_FR } from './seed-blog-fr.mjs';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@bettercommunity.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'change-me-now';

// The fallback creates an ADMIN whose password is in the repository. That is fine on a
// laptop and is the whole point of a default; run against a production database it is a
// working administrator account for anybody who has read this file.
//
// Guarded here rather than in the server's boot check because the server never reads this
// variable — a guard there would refuse to start over something the running process does
// not use, and this is the only place the value becomes an account.
if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) {
  console.error('[fatal] SEED_ADMIN_PASSWORD is unset — seeding would create an admin whose password is in the repository.');
  process.exit(1);
}

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

// Default profile badges (admins can edit/add more under Admin → Badges). Includes the
// footer "Built for the Better* community" 5-click easter-egg badge so the secret works
// out of the box. Idempotent by slug.
const badges = [
  { slug: 'verified', name: 'Verified', description: 'Certified by the BetterCommunity team.', iconType: 'lucide', icon: 'BadgeCheck', color: '#38bdf8', grant: 'manual', priority: 100 },
  { slug: 'staff', name: 'Staff', description: 'BetterCommunity team member.', iconType: 'lucide', icon: 'Shield', color: '#f97316', grant: 'manual', priority: 90 },
  { slug: 'developer', name: 'Developer', description: 'Builds tools & plugins for the community.', iconType: 'lucide', icon: 'Code', color: '#a78bfa', grant: 'manual', priority: 60 },
  { slug: 'content-creator', name: 'Content Creator', description: 'YouTuber / streamer.', iconType: 'lucide', icon: 'Youtube', color: '#ef4444', grant: 'manual', priority: 50 },
  { slug: 'curious', name: 'Curious', description: 'Found the footer secret.', iconType: 'lucide', icon: 'Sparkles', color: '#f59e0b', grant: 'easter_egg', trigger: 'footer5x', earnMessage: 'You clicked five times — nice. Here\'s a little badge for the curious. Thanks for being part of the Better* community. ✨', priority: 10 },
];
for (const b of badges) {
  await p.badge.upsert({ where: { slug: b.slug }, create: b, update: {} }); // don't clobber admin edits
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

// A custom topbar out of the box: a "Projects" DROPDOWN group (with per-item descriptions, so
// the desktop menu reads well) plus flat links. Matches the navItem schema in routes/misc.mjs
// (group needs ≥1 child; every `to` starts with '/'), and the icon names resolve in App.jsx's
// NAV_ICONS. Seeded create-if-absent — the moment an admin edits the topbar in
// Admin → Topbar navigation, this never overwrites their version.
await p.adminSetting.upsert({
  where: { key: 'nav.config' },
  update: {}, // never clobber admin edits
  create: { key: 'nav.config', value: {
    enabled: true,
    items: [
      { type: 'group', label: 'Projects', labelFr: 'Projets', icon: 'Boxes', children: [
        { label: 'BMM', labelFr: 'BMM', to: '/p/bmm', desc: 'The mods manager', descFr: 'Le gestionnaire de mods', icon: 'Boxes' },
        { label: 'BSM', labelFr: 'BSM', to: '/p/bsm', desc: 'Sound presets', descFr: 'Presets sonores', icon: 'Music2' },
        { label: 'Installer', labelFr: 'Installeur', to: '/p/installer', desc: 'Get set up fast', descFr: 'Installe en un clin d’œil', icon: 'Download' },
      ] },
      { type: 'link', label: 'Blog', labelFr: 'Blog', to: '/blog', icon: 'Newspaper' },
      { type: 'link', label: 'Docs', labelFr: 'Docs', to: '/docs', icon: 'BookOpen' },
      { type: 'link', label: 'Repos', labelFr: 'Dépôts', to: '/repos', icon: 'Server' },
      { type: 'link', label: 'Hosting', labelFr: 'Hébergement', to: '/hosting', icon: 'Rocket' },
    ],
    utility: {},
  } },
});

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
  const guideBody = `The BetterCommunity blog uses the **same Markdown** as the BMM update notes, plus a **GitBook-style block system**. Write in **Markdown** or switch to **Visual** mode (drag-and-drop blocks) — both save the same content.

::toc[Contents]

:::tip[Two ways to write]
Use the **Blocks** button (Markdown mode) to insert rich blocks, or toggle **Visual** to build the post by dragging blocks around. The **⌘K**-style content is identical either way.
:::

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
Callouts use lucide icons (no emoji). Pick a type or make a custom one:

:::warning[Careful]
Only install content from sources you trust.
:::
:::callout[Custom]{icon=rocket color="#7c3aed"}
Custom callouts let you choose the icon and colour.
:::

Types: \`note\`, \`tip\`, \`success\`, \`warning\`, \`danger\`, or \`callout\` for a custom one. The classic \`> [!TIP]\` blockquote form still works too.

## Rich blocks
Insert these from the **Blocks** menu (or build them in **Visual** mode):

:::details[Collapsible section]
Hidden content that expands on click — supports **markdown** inside.
:::

::::cards
:::card{title="Cards" icon=star}
Group links or highlights into a responsive grid.
:::
:::card{title="Docs" href=/docs icon=book}
Cards can link anywhere.
:::
::::

Add a keyboard shortcut like :kbd[Ctrl+S], an inline icon :icon[sparkles], columns, code blocks and a \`::toc\` sommaire — all from the same menu.

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

## Roadmap / progress tracker
Embed the same customisable progress tracker used on the project pages — right inside a post or doc.

:::note[Two sources]
**Remote** — point it at a hosted JSON file: \`:::roadmap{src="https://example.com/progress.json" title="Roadmap"}:::\`
**Static** — put a \`json\` code block inside the \`:::roadmap{title="Roadmap"} … :::\` block. Shape: \`{ "categories": [{ "name": "v1.0", "items": [{ "label": "Core", "status": "done" }, { "label": "Docs", "status": "progress", "percent": 40 }] }] }\`. Statuses: \`done\` · \`progress\` · \`planned\`; optional \`percent\`, \`eta\`, and \`code\`/\`art\`/\`lastUpdate\` meters. Labels can be \`{ "en": …, "fr": … }\` for bilingual roadmaps.
:::

That's everything — combine badges + callouts + short bullets for clean, readable posts.`;
  const guideFr = BLOG_FR['markdown-guide'] || {};
  const guide = {
    title: 'Markdown guide — writing notes & blog posts',
    excerpt: 'Every Markdown feature the blog supports: badges, callouts, media, tables and more.',
    body: guideBody, status: 'PUBLISHED',
    titleFr: guideFr.title ?? null, excerptFr: guideFr.excerpt ?? null, bodyFr: guideFr.body ?? null,
  };
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
`:badge[Catalog]{color="#2563eb"} :badge[Apps]{color="#16a34a"}

The **App Catalog** is a hosted \`catalog.json\` with an \`apps\` array.

:::tip[Publishing]
Create official apps via **Admin → Catalogs**; community apps via **Dashboard → Submit content**. Both build a \`bmm://\` deeplink so an "Install in BMM" button just works.
:::

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

## Optional fields
:::note[Integrity]
\`download.sha256\` is optional but **recommended** — BMM checks it on install. Also: \`version\`, \`requirements\`, \`md_link\`, \`images.thumb\` (16:9 ≥400×225), \`images.extra\`, \`download.size\`.
:::

:::card{title="Full reference in the docs" href=/docs/app-catalog icon=book}
The canonical, always-updated App Catalog format lives in the documentation.
:::` },
    { slug: 'guide-plugin-catalog', title: 'Plugin Catalog & .bmmplug format', excerpt: 'Plugin catalog fields + the .bmmplug package and its checksums.', body:
`:badge[Catalog]{color="#2563eb"} :badge[Plugins]{color="#7c3aed"}

A plugin catalog entry (**required**): \`id\`, \`name\`, \`version\`, \`author\`, \`download_url\`. Optional: \`game\`, \`description\`, \`official\`, \`tags\`, \`icon_url\`, and a \`sha256\` of the \`.bmmplug\`.

## .bmmplug package (a ZIP)
- \`plugin.json\` — the manifest (**required**)
- \`icon.png\` — 40×40 (optional)
- \`checksums.json\` — **sha256 of every file** in the package (integrity)

## Integrity
The catalog entry's \`sha256\` covers the whole \`.bmmplug\`; \`checksums.json\` covers each file inside. BMM validates both.

:::danger[Trust]
If either checksum fails, the plugin is flagged **invalid** and a modal recommends **not installing**. Only install plugins that pass validation — catalog plugins are always validated.
:::

:::card{title="Full reference in the docs" href=/docs/plugin-catalog icon=book}
Read the complete .bmmplug format in the documentation.
:::` },
    { slug: 'guide-preset-catalog', title: 'Preset Catalog (BSM)', excerpt: 'The BSM preset JSON format and how to share presets.', body:
`:badge[Catalog]{color="#2563eb"} :badge[BSM]{color="#db2777"}

A BSM preset is a single JSON: \`name\`, \`version\`, \`assetPaths\` (**required**); \`color\`, \`UpdateNumber\`, \`date\` (optional). Its metadata lives inside the file.

:::tip[Publishing]
Publish via **Dashboard → Submit content** (Project **BSM**, Type **Preset**). On the catalog you can **download**, **multi-select download**, and sort by *popular (all-time / month)*, *newest* or *most viewed* — every download counts toward the uploader's stats.
:::

:::card{title="Full reference in the docs" href=/docs/preset-catalog icon=book}
The BSM preset format, in the documentation.
:::` },
    { slug: 'guide-theme-catalog', title: 'Theme Catalog (.bmmtheme)', excerpt: 'The .bmmtheme package format and how to publish a theme.', body:
`:badge[Catalog]{color="#2563eb"} :badge[Themes]{color="#d97706"}

A \`.bmmtheme\` is a ZIP with \`theme.json\` (**required**) + optional \`assets/\`. The manifest carries \`id\`, \`name\`, \`author\`, \`version\`, a \`tokens\` map of \`--bmm-*\` CSS variables, and optional per-selector \`overrides\`.

:::tip[Fastest path]
Export one from the in-app **Theme Editor** — it writes a valid \`theme.json\`. Then publish via **Dashboard → Submit content** (Project **BMM**, Type **Theme**). Installing applies instantly and is reversible.
:::

:::card{title="Full reference in the docs" href=/docs/theme-catalog icon=book}
The .bmmtheme package format, in the documentation.
:::` },
  ];
  for (const g of GUIDES) {
    // BLOG_FR carries the French for the reference posts. The four news posts below already
    // hold theirs inline; these five never had any, and an untranslated post is easy to miss
    // because it renders in English with only a small "not translated" note.
    const fr = BLOG_FR[g.slug] || {};
    const data = {
      title: g.title, excerpt: g.excerpt, body: g.body, status: 'PUBLISHED',
      titleFr: fr.title ?? null, excerptFr: fr.excerpt ?? null, bodyFr: fr.body ?? null,
    };
    await p.blogPost.upsert({ where: { slug: g.slug }, create: { slug: g.slug, projectId: communityProject.id, authorId: adminUser.id, publishedAt: new Date(), ...data }, update: data });
  }
}

// ── Welcome / announcement blog posts (bilingual EN + FR) ──
// Real articles (not format guides) that greet visitors and summarise the platform.
// Upserted by slug so re-running the seed refreshes their content in place.
if (adminUser && communityProject) {
  const POSTS = [
    {
      slug: 'welcome-to-bettercommunity', daysAgo: 0,
      title: 'Welcome to BetterCommunity',
      excerpt: 'The home for every Better* project — catalogs, presets, hosting and accounts, all in one place.',
      titleFr: 'Bienvenue sur BetterCommunity',
      excerptFr: 'La maison de tous les projets Better* — catalogues, presets, hébergement et comptes, au même endroit.',
      body:
`:badge[Announcement]{color="#f59e0b"} :badge[Welcome]{color="#16a34a"}

Modding used to mean a dozen browser tabs: one site for the mod, another for its dependencies, a Discord for the update you missed. **BetterCommunity** is the attempt to put all of that in one place — and behind one account.

It's the hub for the whole Better* ecosystem. Everything BMM installs from lives here: **moderated** catalogs of apps, plugins, themes and BSM presets, where "moderated" isn't a slogan — every submission is reviewed by a human before it reaches you. Find something you like and it's one click into BMM; nothing to unzip, no folder to guess at.

:::tip[A minute to your first install]
Create a free account, open the **Catalog**, and install straight into BMM. That's the whole loop.
:::

When you're ready to give back, the same account lets you **publish** your own work and **host** it: a Server-Repo gives your content a stable URL and real update detection, on a free tier to start and pay-for-what-you-use above it. Link your **Discord** and **BMM creator id** and the platform knows who you are across all of it — roles, credit on your uploads, access to gated channels.

One account, from "I just want this mod" to "here's the catalog I maintain."

:::card{title="Open the catalog" href=/catalog icon=box}
See what the community has already built.
:::`,
      bodyFr:
`:badge[Annonce]{color="#f59e0b"} :badge[Bienvenue]{color="#16a34a"}

Modder, c'était une douzaine d'onglets : un site pour le mod, un autre pour ses dépendances, un Discord pour la mise à jour qu'on a ratée. **BetterCommunity**, c'est la tentative de tout réunir au même endroit — et derrière un seul compte.

C'est le hub de tout l'écosystème Better*. Tout ce que BMM installe vit ici : des catalogues **modérés** d'apps, plugins, thèmes et presets BSM — et « modéré » n'est pas un slogan : chaque soumission est relue par un humain avant de t'arriver. Tu trouves ce qui te plaît, et c'est un clic dans BMM ; rien à dézipper, aucun dossier à deviner.

:::tip[Une minute avant ta première install]
Crée un compte gratuit, ouvre le **Catalogue**, et installe directement dans BMM. Toute la boucle est là.
:::

Quand tu veux rendre la pareille, le même compte te laisse **publier** ton travail et l'**héberger** : un Server-Repo donne à ton contenu une URL stable et une vraie détection des mises à jour, sur un palier gratuit pour commencer et à l'usage au-delà. Lie ton **Discord** et ton **creator id BMM**, et la plateforme sait qui tu es partout — rôles, crédit sur tes envois, accès aux salons réservés.

Un seul compte, de « je veux juste ce mod » à « voici le catalogue que je maintiens ».

:::card{title="Ouvrir le catalogue" href=/catalog icon=box}
Découvre ce que la communauté a déjà créé.
:::`,
    },
    {
      slug: 'whats-new-platform', daysAgo: 3,
      title: 'What’s new — catalogs, hosting & Discord',
      excerpt: 'A quick roundup of what shipped recently across BetterCommunity.',
      titleFr: 'Nouveautés — catalogues, hébergement & Discord',
      excerptFr: 'Un tour d’horizon rapide des dernières nouveautés sur BetterCommunity.',
      body:
`:badge[Changelog]{color="#2563eb"}

Here's a snapshot of what's new on the platform.

| Area | What changed |
|---|---|
| Catalogs | Community catalogs — public or private, one-click install via \`bmm://\`, and \`?k=\` share links for unlisted ones |
| Hosting | Buy a **storage pool** and fill it with repos *and* catalogs; merge/split pools, consolidate billing, colour + collapse them |
| Repos | Every repo has a public page at \`/r/<id>\`; unlisted repos share via a private link |
| Topbar | Admins can show/hide + reorder every topbar button and design the nav |
| Discord | Multi-server bot: per-server config + blog news routing |
| Accounts | Link Discord, BMM creator id, GitHub, Ko-fi and more from your profile |

:::note[Privacy-first]
Analytics are anonymous and first-party — no third-party trackers, and only with your consent.
:::

:::card{title="See the hosting plans" href=/hosting icon=server}
Host a repo and pay only for what you use.
:::`,
      bodyFr:
`:badge[Journal]{color="#2563eb"}

Voici un aperçu des nouveautés sur la plateforme.

| Domaine | Ce qui a changé |
|---|---|
| Catalogues | Catalogues communautaires — publics ou privés, install en un clic via \`bmm://\`, et liens \`?k=\` pour les non listés |
| Hébergement | Achète un **pool de stockage** et remplis-le de dépôts *et* catalogues ; fusionne/défusionne, consolide la facturation, couleur + repli |
| Dépôts | Chaque dépôt a une page publique \`/r/<id>\` ; les non listés se partagent via un lien privé |
| Topbar | Les admins peuvent afficher/masquer + réordonner chaque bouton et concevoir la nav |
| Discord | Bot multi-serveur : config par serveur + routage des news blog |
| Comptes | Lie Discord, creator id BMM, GitHub, Ko-fi et plus depuis ton profil |

:::note[Vie privée d'abord]
Les statistiques sont anonymes et internes — aucun traqueur tiers, et uniquement avec ton consentement.
:::

:::card{title="Voir les offres d'hébergement" href=/hosting icon=server}
Héberge un dépôt et ne paie que ce que tu utilises.
:::`,
    },
    {
      slug: 'roadmap-whats-next', daysAgo: 7,
      title: 'Roadmap — what’s coming next',
      excerpt: 'Where BetterCommunity is headed, and how to help shape it.',
      titleFr: 'Roadmap — la suite',
      excerptFr: 'Où va BetterCommunity, et comment aider à le façonner.',
      body:
`:badge[Roadmap]{color="#7c3aed"}

We're building in the open. A few things on the horizon:

- **BetterInstaller** — now here: a fast, modern installer for the whole suite
- **Richer creator dashboards** — deeper stats on your uploads, repos and storage pools
- **More community tooling** — around presets, themes and plugins

:::tip[Have an idea?]
The **Contact** page and our **Discord** are the fastest ways to reach us — feature requests welcome.
:::

:::card{title="Join the Discord" href=/contact icon=message-circle}
Tell us what you'd like to see next.
:::`,
      bodyFr:
`:badge[Roadmap]{color="#7c3aed"}

On construit à ciel ouvert. Quelques éléments à l'horizon :

- **BetterInstaller** — désormais là : un installeur moderne et rapide pour toute la suite
- **Tableaux de bord créateurs enrichis** — des stats plus poussées sur tes envois, dépôts et pools
- **Plus d'outils communautaires** — autour des presets, thèmes et plugins

:::tip[Une idée ?]
La page **Contact** et notre **Discord** sont les moyens les plus rapides de nous joindre — les demandes de fonctionnalités sont les bienvenues.
:::

:::card{title="Rejoindre le Discord" href=/contact icon=message-circle}
Dis-nous ce que tu aimerais voir ensuite.
:::`,
    },
    {
      slug: 'hosting-storage-pools', daysAgo: 1,
      title: 'Hosting, made simple: storage pools & sharing',
      excerpt: 'Buy space once, fill it with repos and catalogs, and share even unlisted content with a private link.',
      titleFr: 'L’hébergement simplifié : pools de stockage & partage',
      excerptFr: 'Achète de l’espace une fois, remplis-le de dépôts et catalogues, et partage même le contenu non listé via un lien privé.',
      body:
`:badge[Hosting]{color="#0ea5e9"} :badge[Guide]{color="#16a34a"}

Hosting on BetterCommunity is built around one idea: **you buy a storage pool, then use it however you like.**

## Storage pools
A purchase gives you an **empty pool** with a byte quota. Fill it with **repos, catalogs, or both** — they share the same space. You can **colour** and **collapse** pools, **merge** several into one (subscriptions move with them, with a 6-second undo), and even **consolidate** several plans into one bigger one to save.

## Share what isn't listed
Every repo has a public page at \`/r/<id>\`. Content that isn't in the browse list can still be shared with a private **\`?k=\` link** — perfect for betas.

:::tip[Read the full guide]
The **"Good little host"** guide walks through pools, billing, sharing and the do's & don'ts.
:::

:::card{title="Open hosting" href=/hosting icon=server}
Start with the free tier — no card required.
:::`,
      bodyFr:
`:badge[Hébergement]{color="#0ea5e9"} :badge[Guide]{color="#16a34a"}

L’hébergement sur BetterCommunity repose sur une idée : **tu achètes un pool de stockage, puis tu l’utilises comme tu veux.**

## Les pools de stockage
Un achat te donne un **pool vide** avec un quota. Remplis-le de **dépôts, catalogues, ou les deux** — ils partagent le même espace. Tu peux **colorer** et **replier** les pools, **fusionner** plusieurs pools en un (les abonnements suivent, avec un undo de 6 s), et même **consolider** plusieurs plans en un seul plus grand pour économiser.

## Partager le non listé
Chaque dépôt a une page publique \`/r/<id>\`. Le contenu absent de la liste peut quand même se partager via un **lien privé \`?k=\`** — parfait pour les bêtas.

:::tip[Lis le guide complet]
Le guide **« Le bon petit hébergeur »** couvre les pools, la facturation, le partage et les bonnes pratiques.
:::

:::card{title="Ouvrir l’hébergement" href=/hosting icon=server}
Commence avec le palier gratuit — aucune carte requise.
:::`,
    },
  ];
  for (const post of POSTS) {
    const { slug, daysAgo, ...rest } = post;
    const data = { ...rest, status: 'PUBLISHED', coverInBody: true };
    await p.blogPost.upsert({
      where: { slug },
      create: { slug, projectId: communityProject.id, authorId: adminUser.id, publishedAt: new Date(Date.now() - daysAgo * 86400000), ...data },
      update: data,
    });
  }
}

console.log('[seed] done');
process.exit(0);
