// One-shot seed: projects, an admin account, default hosting plans + admin settings.
// Run inside the api container: `node src/seed.mjs` (idempotent).
import argon2 from 'argon2';
import { toCurrentShape, DEFAULT_STACKS } from './lib/project-config.mjs';
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
  { name: 'Pool 5 GB', storageGB: 5, uploadLimitKbps: 2048, cpuShare: 0.25, priceMonthlyCents: 300 },
  { name: 'Pool 10 GB', storageGB: 10, uploadLimitKbps: 4096, cpuShare: 0.5, priceMonthlyCents: 500 },
  { name: 'Pool 25 GB', storageGB: 25, uploadLimitKbps: 8192, cpuShare: 0.75, priceMonthlyCents: 1000 },
  { name: 'Pool 50 GB', storageGB: 50, uploadLimitKbps: 16384, cpuShare: 1.0, priceMonthlyCents: 1800 },
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
  // Seeded true so the admin screen shows a real state rather than an empty checkbox.
  // The code treats a MISSING row as enabled too, so an existing install that upgrades
  // into these keys keeps working before anybody seeds or touches them.
  'features.paymentsEnabled': true,
  'features.oauthLoginEnabled': true,
  'features.ssoEnabled': true,
  'features.webhooksEnabled': true,
  'features.publicApiEnabled': true,
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
    // "How it runs" — the tab renders c.stack.nodes, and a config without them has no tab at
    // all. These are the seed DEFAULTS: real architecture, kept coarse on purpose, because an
    // admin edits this by hand in the dashboard and a ten-node graph is where they stop.
    ...DEFAULT_STACKS.community,
  },
  bmm: {
    name: 'Better Mods Manager', tagline: 'Apps, plugins & themes for DCS modding.', version: '0.9.11',
    downloads: [
      { label: 'Download (Windows)', url: 'https://github.com/FreeProject089/BetterModsManager/releases/latest', primary: true },
      { label: 'Source code', url: 'https://github.com/FreeProject089/BetterModsManager/archive/refs/heads/Tdev.zip' },
    ],
    releaseNotes: { owner: 'FreeProject089', repo: 'BetterModsManager', branch: 'Tdev', path: 'Update' },
    ...DEFAULT_STACKS.bmm,
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
    ...DEFAULT_STACKS.bsm,
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
    ...DEFAULT_STACKS.installer,
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
// Written through toCurrentShape, and NEVER over an existing row.
//
// Two separate corrections to what this used to do. The literals above are in the pre-rewrite
// flat shape, so seeding a brand-new site produced project pages the current project.jsx
// cannot read — a fresh install came up blank BY CONSTRUCTION, and nothing noticed because a
// new site looking bare is what a new site looks like.
//
// And it used to overwrite on every run. The old comment said so and asked people to remember
// not to re-seed, which is not a safeguard: `seed:all` is exactly what somebody runs on a site
// they have already customised, precisely because they want the parts they are MISSING. A
// seed that resets a topbar somebody built is worse than a seed that does nothing.
for (const [key, value] of Object.entries(projectConfigs)) {
  const k = `project.${key}`;
  const { out } = toCurrentShape(value);
  await p.adminSetting.upsert({ where: { key: k }, create: { key: k, value: out }, update: {} });
}

// One pinned, open poll — so the home page's poll section EXISTS on a fresh install.
//
// The whole pipeline (route filter, PollSlider, the section markup) was complete and
// invisible, because nothing ever created a poll that was pinned AND open: the section's
// render condition. Only when there are no polls at all — a database with any poll in it
// belongs to an admin who has already made their own choices about what is pinned.
const anyPoll = await p.poll.findFirst({ select: { id: true } });
if (!anyPoll) {
  await p.poll.create({ data: {
    question: 'What should the Better projects focus on next?',
    description: 'Seed example — edit or replace it from Admin → Polls.',
    audience: 'all', status: 'open', pinned: true, visibility: 'public',
    options: { create: [
      { label: 'More catalog content', sort: 0 },
      { label: 'Performance & stability', sort: 1 },
      { label: 'New tools & automations', sort: 2 },
      { label: 'Documentation & tutorials', sort: 3 },
    ] },
  } });
  console.log('  seeded one pinned home-page poll');
}

// Markdown guide — hosted in the blog and linked from the blog editor toolbar.
const adminUser = await p.user.findUnique({ where: { email: ADMIN_EMAIL } });
const communityProject = await p.project.findUnique({ where: { key: 'community' } });
if (adminUser && communityProject) {
  // The complete vocabulary, in one page.
  //
  // It documented ten directives out of thirty-two: no file cards, no columns, no steps, no
  // tabs, no buttons, no progress, no collapse, no alignment, not even badges by name. A
  // reference that covers a third of what exists is worse than none, because the third it
  // covers is the part people already knew.
  //
  // check-md-guide.mjs now fails the build when the renderer learns a directive this page does
  // not name, so the gap cannot come back quietly.
  const guideBody = `The BetterCommunity blog, docs and FAQ all use the **same Markdown**, plus a **GitBook-style block system**. Write in **Markdown** or switch to **Visual** mode — both save the same content, and Visual now carries the same select-to-format toolbar.

::toc[Contents]

:::tip[Two ways to write]
Use the **Blocks** button in Markdown mode, or toggle **Visual** and build the post by dragging blocks. Select any words in either mode to format them.
:::

## Text basics
\`**bold**\` · \`*italic*\` · \`~~strikethrough~~\` · \`inline code\` · \`[a link](https://example.com)\`

A rule between sections is three dashes on their own line. A quote is a \`>\` at the start of the line.

## Buttons
One shape, three sizes, any colour — and a logo when it is a brand.

:button[Watch]{brand=youtube href=https://youtube.com} :button[Join]{brand=discord href=https://discord.gg} :button[Tip]{brand=kofi href=https://ko-fi.com}

\`:button[Label]{brand=youtube href=…}\` — brands: \`youtube\` \`discord\` \`kofi\` \`github\` \`twitch\` \`x\` \`reddit\` \`telegram\`
\`:button[Label]{color=#0a7 size=lg href=…}\` — sizes \`sm\` \`md\` \`lg\`, add \`outline\` for the quiet version.

Short form: \`:btn[…]\` does the same thing.

## Coloured links
:link[a red link]{color=#e11 href=/docs} — \`:link[text]{color=#e11 href=/docs}\`. Underlined like every other link, because colour alone is not a signal everybody can see.

## Badges and tags
:badge[NEW] :badge[Custom]{color="#0a7"} — \`:badge[NEW]\` or \`:badge[Any text]{color="#0a7"}\`. \`:tag[…]\` is the same chip under another name.

## Emoji
:rocket: :tada: :white_check_mark: — written \`:rocket:\` \`:tada:\` \`:white_check_mark:\`. 384 names, the same ones GitHub uses. An unknown one stays as you typed it rather than vanishing, and nothing inside code is touched — \`10:30:45\` and a fenced block are safe.

## Icons and keys
:icon[rocket] :kbd[Ctrl+K] — \`:icon[rocket]\` takes any lucide name or a brand; \`:kbd[Ctrl+Shift+S]\` draws real keycaps.

## Callouts
:::note[Note]
\`:::note\` \`:::tip\` \`:::success\` \`:::warning\` \`:::danger\` — and \`:::callout{icon=rocket color="#7c3aed"}\` for one of your own — \`:::custom\` is the same block under the name the editor's Blocks menu uses.
:::

## Hours and times
:::schedule[Support]{tz=Europe/Paris}
| Day | Open |
|---|---|
| Mon-Fri | 09:00-18:00 |
| Sat | 10:00-14:00 |
:::

\`:::schedule{tz=...}\` (or \`:::hours\`) states a repeating schedule in ONE timezone. The rows are shown exactly as you wrote them and the zone is named on the card, because converting them would be wrong: \`Monday 09:00 Europe/Paris\` is 09:00 in Paris every week of the year, and what moves across a daylight-saving boundary is how far that is from the reader. A converted row would be right today and wrong in March. What the block computes instead is the difference **right now**, and says so.

For a single moment there is no such ambiguity, so it IS converted: \`:time[2026-09-01T20:00]{tz=Europe/Paris}\` (or \`:at\`) shows that instant in each reader's own timezone, with what you typed kept in the tooltip. The date is what makes it exact - it settles which side of a daylight-saving change the time falls on.

## Tabs
:::tabs
:::tab{title="Windows"}
Run \`install.exe\`.
:::
:::tab{title="Linux"}
Run \`./install.sh\`.
:::
:::

\`:::tabs\` wrapping \`:::tab{title="…"}\` blocks. Each tab holds whatever markdown you like — code, images, callouts.

## Cards
:::cards
:::card{title="A card" href=/docs icon=book}
Cards sit side by side inside \`:::cards\`. One on its own works too.
:::
:::

## File downloads
:file[setup.exe]{href=/api/assets/setup.exe size="42 MB"} — the icon follows the extension: PDF, zip, image, video, audio, code. \`:file[name.ext]{href=… size="…"}\`

## Columns and alignment
:::columns
:::column
\`:::columns\` with \`:::column\` inside. \`:::row\` and \`:::col\` are the same.
:::
:::column
\`:::center\`, \`:::left\` and \`:::right\` align a block.
:::
:::

## Steps
:::steps
:::step[First]
Numbered, in order.
:::
:::step[Then]
\`:::steps\` wrapping \`:::step[Title]\`. Add \`{type=A}\` for A/B/C, or \`{marker=icon}\` to make each step's \`icon=\` its marker — an icon list instead of numbers.
:::

:::steps{marker=icon}
:::step[Install]{icon=download}
Each row is marked by its own icon, not a number.
:::
:::step[Configure]{icon=settings}
Set \`marker=icon\` on \`:::steps\`, then give every \`:::step\` an \`icon=\`.
:::
:::

## Configuration rows
Document a screen of settings without a table — one \`:::field\` per option: a bold label, an optional TYPE tag, a monospace key, and a description.

:::field[Tile shape]{key=icons.shape type=select icon=palette}
Rounded, circle, square, or no tile — the shape of every button icon in the set.
:::
:::field[Glyph colour]{key=icons.fg type=colour}
The colour of the glyph inside each tile.
:::

## Collapse and details
:::collapse[Click to open]
Hidden until asked for. \`:::collapse[Summary]\` — \`:::details\` is the same.
:::

## Progress
\`:::progress\` is the roadmap block under a second name — write whichever reads better. There is no inline percentage: a number on its own is a percentage of nothing, and the roadmap below is what says of what.

## Roadmap
The short way — stages, no JSON. Every bullet under a stage becomes a tracked item:

:::roadmap[Where we are]
:::stage[Shipped]{state=done}
- The block system
:::
:::stage[Under way]{state=doing percent=40}
- The page builder
:::
:::

\`:::stage[Title]{state=done|doing|planned}\`, plus \`percent=\` and \`eta=\`. \`:::phase\` is the same block.
For per-item percentages, put a \`json\` block inside instead — \`{ "categories": [{ "name": "v1.0", "items": [{ "label": "Core", "status": "done" }] }] }\` — or point at one with \`:::roadmap{src="https://…/progress.json"}\`. \`orientation=horizontal\` lays the stages along a track.

## Media
Images and YouTube go in from the editor toolbar. A \`.bmmreplay\` recording embeds with \`:::replay{src="…"}\` — \`:::bmmreplay\` is the same block.

## Maths
Written \`$$…$$\`, inline or as its own block:

$$E = mc^2$$

Single-dollar \`$x$\` is deliberately off: this site quotes prices, and "\$5 and \$10" would be typeset as a formula.

## Tables and code
| Feature | Status |
|---|---|
| Dark theme | Shipped |
| Repo sync | Faster |

Fenced code blocks are highlighted by language.

## Cross-references
\`:ref[label]{href=…}\` links with the target's own name. Internal doc links show a preview card on hover, with the page's icon and first line.

## New in B.MD 2.0

Ten more blocks, all documented with live examples on the **Documentation blocks** page of the
docs: a dated **timeline** (\`:::timeline\` / \`:::event\`), a **before / after** pair
(\`:::compare\`), **stats** tiles (\`:::stats\` / \`:::stat\`), a **quote** with a name under it, a
**hero** banner, a **changelog** (\`:::version\`), a **spoiler**, a **FAQ** (\`:::faq\` / \`:::q\`),
a **checklist** that counts its ticks, a fixed **grid**, and an inline **meter**
(\`:meter[60]{label=Done}\`). Icons now come from **Phosphor** too: \`:icon[ph:rocket]\`, with a
weight as prefix (\`ph-bold:\`, \`ph-fill:\`, \`ph-duotone:\`).

:::stats
:::stat[Blocks]{value="70" delta="+22" icon=ph:stack}
:::
:::stat[Icons]{value="3 000+" icon=ph:palette}
:::
:::

That is the whole vocabulary. Combine callouts, cards and short bullets for pages people actually read.`;
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

// ── Welcome / announcement blog posts (bilingual EN + FR) ──
// Real articles (not format guides) that greet visitors and summarise the platform.
// Upserted by slug so re-running the seed refreshes their content in place.
if (adminUser && communityProject) {
  const POSTS = [
    {
      slug: 'bmm-1-0-release', daysAgo: 0,
      title: 'BMM 1.0 is here — with BetterInstaller and BetterCommunity',
      excerpt: 'The first stable Better Mods Manager, a real installer that updates in place, and the hub that ties every Better* app to one account.',
      titleFr: 'BMM 1.0 est là — avec BetterInstaller et BetterCommunity',
      excerptFr: 'La première version stable de Better Mods Manager, un vrai installeur qui met à jour en place, et le hub qui relie chaque app Better* à un seul compte.',
      body:
`:badge[Release]{color="#f97316"} :badge[BMM 1.0]{color="#16a34a"}

Three things ship together today: **Better Mods Manager 1.0**, the **BetterInstaller** that puts it on your machine, and **BetterCommunity**, the hub they both talk to. This is the release the beta was building toward — stable, self-updating, and wired into one account.

::toc[On this page]

## Better Mods Manager 1.0

BMM is a desktop manager for your mods, modpacks, plugins and themes — one window instead of a dozen browser tabs. 1.0 is the first build we call stable.

:::cards
:::card{title="One-click installs" icon=download}
Every catalog button hands BMM a \`bmm://\` link — no unzipping, no guessing at a folder.
:::
:::card{title="Profiles & modpacks" icon=layers}
Keep setups apart, switch between them, and share a pack as a single file.
:::
:::card{title="Plugins, themes & a scheduler" icon=puzzle}
Extend the app, restyle it, and automate chores with scripted tasks.
:::
:::card{title="Yours, offline" icon=shield}
Your profiles and settings live on your machine. Nothing leaves it unless you send it.
:::
:::

## BetterInstaller — installs, and updates in place

BMM no longer ships as a loose archive. **BetterInstaller** is a proper installer/maintainer: it puts BMM in one place, registers it in Add/Remove Programs, and drops a maintenance binary beside it for **Repair / Update / Uninstall**.

:::note[Updates never wipe your data]
An update — the incremental Quick Update or a full BetterInstaller pass — only replaces the app's files. Your profiles, mods, plugins and settings live in a separate data folder that an update never touches. A 1.0.1 over a 1.0.0 is an update, not a reinstall.
:::

## BetterCommunity — one account

Everything BMM installs from lives here, and one account carries across every Better* app: the catalogs, your hosted repos, feedback and crash reports, levels and the shop, and this blog. Find something you like on the site and it is one click into BMM.

## Get it

:button[Download BMM]{href=https://github.com/FreeProject089/BetterModsManager/releases brand=github} :button[Read the docs]{href=/docs} :button[Join the Discord]{brand=discord href=https://discord.com/invite/CTaaEF9R75}

:::tip[Coming from the beta?]
Open **Settings → check for updates**. The 0.9.x → 1.0 jump is a manual, one-time install (the app id and installer changed); after 1.0, patches update themselves.
:::`,
      bodyFr:
`:badge[Sortie]{color="#f97316"} :badge[BMM 1.0]{color="#16a34a"}

Trois choses sortent ensemble aujourd'hui : **Better Mods Manager 1.0**, le **BetterInstaller** qui l'installe sur ta machine, et **BetterCommunity**, le hub avec lequel les deux dialoguent. C'est la version que la bêta préparait — stable, capable de se mettre à jour, et reliée à un seul compte.

::toc[Sur cette page]

## Better Mods Manager 1.0

BMM est un gestionnaire de bureau pour tes mods, modpacks, plugins et thèmes — une seule fenêtre au lieu d'une dizaine d'onglets. La 1.0 est la première version qu'on qualifie de stable.

:::cards
:::card{title="Installation en un clic" icon=download}
Chaque bouton de catalogue passe un lien \`bmm://\` à BMM — pas de dézippage, pas de dossier à deviner.
:::
:::card{title="Profils & modpacks" icon=layers}
Sépare tes configurations, bascule entre elles, et partage un pack en un seul fichier.
:::
:::card{title="Plugins, thèmes & planificateur" icon=puzzle}
Étends l'app, change son style, et automatise les corvées avec des tâches scriptées.
:::
:::card{title="À toi, hors-ligne" icon=shield}
Tes profils et réglages vivent sur ta machine. Rien n'en part sans que tu l'envoies.
:::
:::

## BetterInstaller — installe, et met à jour en place

BMM ne se livre plus en archive brute. **BetterInstaller** est un vrai installeur/mainteneur : il pose BMM à un seul endroit, l'inscrit dans Ajouter/Supprimer des programmes, et dépose à côté un binaire de maintenance pour **Réparer / Mettre à jour / Désinstaller**.

:::note[Une mise à jour n'efface jamais tes données]
Une mise à jour — la Quick Update incrémentale ou une passe complète de BetterInstaller — ne remplace que les fichiers de l'app. Tes profils, mods, plugins et réglages vivent dans un dossier de données séparé qu'une mise à jour ne touche jamais. Une 1.0.1 par-dessus une 1.0.0 est une mise à jour, pas une réinstallation.
:::

## BetterCommunity — un seul compte

Tout ce que BMM installe vit ici, et un compte suit chaque app Better* : les catalogues, tes dépôts hébergés, les retours et rapports de plantage, les niveaux et la boutique, et ce blog. Trouve quelque chose sur le site, c'est un clic vers BMM.

## Récupère-le

:button[Télécharger BMM]{href=https://github.com/FreeProject089/BetterModsManager/releases brand=github} :button[Lire la doc]{href=/docs} :button[Rejoindre le Discord]{brand=discord href=https://discord.com/invite/CTaaEF9R75}

:::tip[Tu viens de la bêta ?]
Ouvre **Réglages → vérifier les mises à jour**. Le saut 0.9.x → 1.0 est une installation manuelle unique (l'id de l'app et l'installeur ont changé) ; après la 1.0, les correctifs se mettent à jour tout seuls.
:::`,
    },
    {
      slug: 'welcome-to-bettercommunity', daysAgo: 2,
      title: 'Welcome to BetterCommunity',
      excerpt: 'One account, from "I just want this mod" to "here is the catalog I maintain."',
      titleFr: 'Bienvenue sur BetterCommunity',
      excerptFr: 'Un seul compte, de « je veux juste ce mod » à « voici le catalogue que je maintiens ».',
      body:
`:badge[Welcome]{color="#16a34a"}

Modding used to mean a dozen browser tabs: one site for the mod, another for its dependencies,
a Discord for the update you missed. **BetterCommunity** is the attempt to put all of that
behind one account.

## What is actually here

Everything BMM installs from. Apps, plugins, themes, BSM presets and scheduled-task
automations — each one submitted by somebody and **read by a human before it reaches you**. A
submission sits in a queue until a moderator publishes it; nothing appears in the catalog on
upload alone.

Find something you like and it is one click into BMM. The install button hands the app a
\`bmm://\` link and BMM takes it from there — nothing to unzip, no folder to guess at.

:::steps
:::step[Make an account]
Free, and the only thing it needs is an address you can read mail at.
:::
:::step[Open the catalog]
Filter by project and kind, or search. Sort by *popular*, *this month*, *newest* or *most
viewed*.
:::
:::step[Install]
The button opens BMM on the entry. If the publisher included a checksum, BMM verifies the
download against it before anything runs.
:::
:::

## When you want to give something back

The same account publishes. **Dashboard → Submit content** takes your file, your description
and your tags, and puts it in the same queue as everybody else's.

If you want it to live at a stable address with real update detection, host it: **one free
repository per account**, and paid space above that — priced on what you actually store, not
on a tier you grew out of.

:::tip[Link your accounts]
Discord, your BMM creator id, GitHub, Ko-fi. The platform then knows who you are across all of
it: roles, credit on your uploads, and access to gated channels.
:::

One account, from "I just want this mod" to "here is the catalog I maintain."

:::card{title="Open the catalog" href=/catalog icon=box}
See what the community has already built.
:::`,
      bodyFr:
`:badge[Bienvenue]{color="#16a34a"}

Modder, c'était une douzaine d'onglets : un site pour le mod, un autre pour ses dépendances, un
Discord pour la mise à jour qu'on a ratée. **BetterCommunity**, c'est la tentative de tout
mettre derrière un seul compte.

## Ce qu'on trouve vraiment ici

Tout ce que BMM installe. Apps, plugins, thèmes, presets BSM et automatisations de tâches
planifiées — chaque élément soumis par quelqu'un et **relu par un humain avant de t'arriver**.
Une soumission attend en file jusqu'à ce qu'un modérateur la publie ; rien n'apparaît au
catalogue par le seul fait d'avoir été téléversé.

Tu trouves ce qui te plaît, et c'est un clic dans BMM. Le bouton d'installation passe un lien
\`bmm://\` à l'app, et BMM prend le relais — rien à dézipper, aucun dossier à deviner.

:::steps
:::step[Crée un compte]
Gratuit, et la seule chose qu'il demande est une adresse où tu lis ton courrier.
:::
:::step[Ouvre le catalogue]
Filtre par projet et par type, ou cherche. Trie par *populaire*, *ce mois-ci*, *récent* ou *le
plus vu*.
:::
:::step[Installe]
Le bouton ouvre BMM sur l'entrée. Si l'auteur a publié une somme de contrôle, BMM vérifie le
téléchargement avant que quoi que ce soit ne s'exécute.
:::
:::

## Quand tu veux rendre la pareille

Le même compte publie. **Tableau de bord → Proposer du contenu** prend ton fichier, ta
description et tes tags, et les met dans la même file que ceux de tout le monde.

Si tu veux que ça vive à une adresse stable avec une vraie détection des mises à jour,
héberge-le : **un dépôt gratuit par compte**, puis de l'espace payant au-delà — facturé sur ce
que tu stockes réellement, pas sur un palier que tu as dépassé.

:::tip[Lie tes comptes]
Discord, ton creator id BMM, GitHub, Ko-fi. La plateforme sait alors qui tu es partout : rôles,
crédit sur tes envois, et accès aux salons réservés.
:::

Un seul compte, de « je veux juste ce mod » à « voici le catalogue que je maintiens ».

:::card{title="Ouvrir le catalogue" href=/catalog icon=box}
Découvre ce que la communauté a déjà créé.
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

  // Exactly three articles, by request: the 1.0 release, the B.MD guide, and the welcome.
  // Anything else — the old catalog guides and news posts, or drafts left over from a prior
  // seed — is removed so the blog converges to these three. Dependents (reactions, editor
  // comments, revisions) are cleared first because their FKs would otherwise block the delete.
  const KEEP = ['bmm-1-0-release', 'markdown-guide', 'welcome-to-bettercommunity'];
  const doomed = await p.blogPost.findMany({ where: { slug: { notIn: KEEP } }, select: { id: true } });
  if (doomed.length) {
    const ids = doomed.map((d) => d.id);
    await p.blogReaction.deleteMany({ where: { postId: { in: ids } } });
    await p.blogComment.deleteMany({ where: { postId: { in: ids } } });
    await p.blogRevision.deleteMany({ where: { postId: { in: ids } } });
    await p.blogPost.deleteMany({ where: { id: { in: ids } } });
    console.log(`[seed] blog: pruned ${doomed.length} non-canonical post(s); kept ${KEEP.length}.`);
  }
}

// ── Code map sources ─────────────────────────────────────────────────────────
//
// The map needs three things and the config only supplied one: the flag (now in
// DEFAULT_STACKS), a repository to read (here), and a SNAPSHOT — which is a GitHub crawl.
//
// The crawl is deliberately not done here. A seed that reaches the network is a seed that
// fails on a rate limit or an offline machine, and it would be doing the job the webhook and
// the Rebuild button already own. So this writes the address and says what is left.
const CODE_REPOS = {
  bmm: 'https://github.com/FreeProject089/BetterModsManager',
  bsm: 'https://github.com/FreeProject089/Better-Sound.Maker',
  installer: 'https://github.com/FreeProject089/BetterInstaller',
};
for (const [key, url] of Object.entries(CODE_REPOS)) {
  const k = `codegraph.settings.${key}`;
  const row = await p.adminSetting.findUnique({ where: { key: k } });
  // An existing url is left alone: the row may carry a webhook secret this has no business
  // regenerating, and an admin who changed the address meant it.
  if (row?.value?.url) continue;
  await p.adminSetting.upsert({
    where: { key: k },
    create: { key: k, value: { ...(row?.value || {}), url } },
    update: { value: { ...(row?.value || {}), url } },
  });
}
console.log(`  code map: ${Object.keys(CODE_REPOS).length} repositories configured — rebuild each from Admin → Projects → Code graph to fill it in`);

console.log('[seed] done');
process.exit(0);
