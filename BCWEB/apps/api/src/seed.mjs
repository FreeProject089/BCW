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

## Icons and keys
:icon[rocket] :kbd[Ctrl+K] — \`:icon[rocket]\` takes any lucide name or a brand; \`:kbd[Ctrl+Shift+S]\` draws real keycaps.

## Callouts
:::note[Note]
\`:::note\` \`:::tip\` \`:::success\` \`:::warning\` \`:::danger\` — and \`:::callout{icon=rocket color="#7c3aed"}\` for one of your own — \`:::custom\` is the same block under the name the editor's Blocks menu uses.
:::

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
\`:::steps\` wrapping \`:::step[Title]\`.
:::
:::

## Collapse and details
:::collapse[Click to open]
Hidden until asked for. \`:::collapse[Summary]\` — \`:::details\` is the same.
:::

## Progress and stages
:progress[70]{label="Beta"} — \`:progress[70]{label="…"}\`. \`:stage[…]\` marks a phase inside a roadmap.

## Roadmap
\`:::roadmap{title="Roadmap"}\` with a \`json\` code block inside, or \`:::roadmap{src="https://…/progress.json"}\`. Shape: \`{ "categories": [{ "name": "v1.0", "items": [{ "label": "Core", "status": "done" }] }] }\`. Statuses: \`done\` · \`progress\` · \`planned\`.

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

// Catalog guides — one per catalog type, hosted in the blog.
if (adminUser && communityProject) {
  const GUIDES = [
    { slug: 'guide-app-catalog', title: 'Publishing an app: what BMM reads before it downloads anything', excerpt: 'Three labels decide what a user sees before your file exists on their disk — and the ones you leave out are filled in with opinions.', body:
`:badge[Catalog]{color="#2563eb"} :badge[Apps]{color="#16a34a"}

An app catalog entry looks like a link with labels around it. It is not. BMM reads several of
those labels **before** the download starts and acts on them — and the ones you leave out are
not left blank. They are filled in with a default that looks exactly as deliberate as a choice.

::toc[On this page]

## The URL is read, not only followed

Before installing, BMM decides whether to ask *where* to put the app. It asks when the download
is a plain archive; it does not ask when the download is a setup program, because a setup
program picks its own destination and a second question would be a lie.

It works that out from two things: the declared \`file_type\`, **and the address itself**. A URL
containing \`setup\` or \`install\` is treated as an installer.

:::warning[An ordinary URL can change the install flow]
\`https://cdn.example.com/install/mytool-1.4.zip\` is a zip. BMM reads \`/install/\` in the path,
skips the folder picker, and tells the user to click through a wizard that does not exist.

Nothing errors. The app simply lands somewhere they did not choose. Serve the file from a path
without those two words and the archive flow comes back.
:::

## Omitted is not empty

The feed fills the gaps as it is built. No \`file_type\` and your zip is announced as an **EXE**
— on the card and in the install dialog. No \`category\` and it is filed under *other*. No
\`price\` and it is advertised as *free*.

None of that fails. It publishes an entry that states things you never said.

## The checksum is the optional field worth the trouble

\`download.sha256\` is optional, and it is genuinely verified: BMM recomputes the hash *while*
the file downloads and refuses to finish when it does not match — the \`.part\` file is never
renamed into place.

It is also visible before the click, as a small chip on the card:

:::columns
:::column
:badge[checksum]{color="#16a34a"}
The catalogue published a hash. What arrives is checked against it.
:::
:::column
:badge[unverified]{color="#64748b"}
No hash published. Common, and proof of nothing — but it is the difference between two entries
offering the same app.
:::
:::

:::tip[You do not have to compute it by hand]
The **Create app** form has a probe: give it the URL (or pick the local file) and it fills in
the size and the SHA-256 for you. Over plain \`http\` it says so out loud, because what it read
is the checksum of *whatever arrived* — and over http that is not only up to you.
:::

## An entry with no download URL is not an error

It is a silent omission. The item saves, its page renders, and the feed simply does not list it:
entries without a resolvable download are dropped when the feed is built. If your app is
published and does not show up in BMM, check this before anything else.

## One entry, filled in on purpose

\`\`\`json
{
  "id": "tag-cleaner",
  "title": "Tag Cleaner",
  "description": "Finds and merges duplicate tags across a mod library.",
  "category": "utility",
  "price": "free",
  "tags": ["tags", "cleanup"],
  "version": "1.4.0",
  "images": { "thumb": "https://example.com/tag-cleaner/thumb.png" },
  "download": {
    "url": "https://example.com/dl/tag-cleaner-1.4.0.zip",
    "file_type": "zip",
    "size": 4194304,
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
\`\`\`

Every field there is one you said. That is the whole point of the exercise.

:::card{title="Every field, always current" href=/docs/app-catalog icon=book}
The reference — required, optional, and the exact accepted values — lives in the documentation.
This article is about what happens once you have filled it in.
:::` },
    { slug: 'guide-plugin-catalog', title: 'Two checksums, three verdicts: how a .bmmplug is judged', excerpt: 'Most packages that come back invalid were not tampered with. Here is what the two hashes actually answer, and the verdict nobody expects.', body:
`:badge[Catalog]{color="#2563eb"} :badge[Plugins]{color="#7c3aed"}

A \`.bmmplug\` carries two checksums, and they answer two different questions. Most packages
that come back **invalid** violated neither of them.

::toc[On this page]

## Two questions, two hashes

The catalog entry's \`sha256\` covers the **whole package**: *are these the bytes we expected?*
Inside the ZIP, \`checksums.json\` covers **each file**: *is every file the file it claims to be?*

Tampering with one file changes that file's hash and the package's hash at the same time, so a
modified package cannot be valid while its inner list still is. That is the entire integrity
model, and it is small on purpose.

## The verdict nobody expects: \`unlisted_files\`

Validity is not "everything listed matches". It is **"everything listed matches *and* everything
present is listed"**. A file in the ZIP that \`checksums.json\` never mentions makes the package
invalid on its own, with no mismatch anywhere.

:::danger[The usual cause is a README]
Generate \`checksums.json\`, then drop a \`README.md\` or a \`LICENSE\` next to it, then zip. The
package is now invalid — and the failure reads like tampering when it is really housekeeping.

Regenerate the list **last**, after every file is in place.
:::

\`checksums.json\` is the one exception: it cannot list its own hash and is skipped.

## Invalid and unverified are not the same badge

There is a third state, and it exists because the first two were being used for something they
do not mean.

:::columns
:::column
**Invalid** — the package was fetched and it did not check out. A real integrity failure. BMM
recommends not installing it.
:::
:::column
**Unverified** — the package could not be fetched at all: no host yet, a dead link, an address
the fetcher refuses. Nothing is known about its contents.
:::
:::

A healthy plugin that simply has not been uploaded yet is not a tampered one, so it is not
badged red. The reason is recorded either way, and moderators see it.

## What checksums cannot tell you

They cannot tell you who made the package. Anybody who repacks a plugin recomputes them
honestly, and the result is a perfectly valid archive containing somebody else's work.

That is a different question, and it needs a different answer: a package **BMM itself wrote**
carries \`bmm_signature.json\` — an ed25519 signature over the entries. Integrity says the box
was not opened in transit. A signature says who packed it.

## Ask for the permissions you use

A plugin requests capabilities from the API's real permission set — \`mods.write\`,
\`profiles.write\`, \`catalog.read\`, \`app.write\` and the rest — not free-form words like
"network" or "files". **The user is shown the list and grants each one.**

A request for everything is not a safe default; it is the sentence a user reads just before
deciding whether to trust you.

:::card{title="The full package layout" href=/docs/plugin-catalog icon=book}
Manifest fields, the entry's fields, and the exact ZIP layout — in the documentation.
:::

:::card{title="The permission list" href=/docs/api-reference icon=code}
Every capability a plugin can ask for, and what it unlocks.
:::` },
    { slug: 'guide-preset-catalog', title: 'The word "preset" means two different things', excerpt: 'For BSM the preset is the file. For BMM it points at one. They share a name, a catalog kind and a feed — and nothing else.', body:
`:badge[Catalog]{color="#2563eb"} :badge[BSM]{color="#db2777"} :badge[BMM]{color="#2563eb"}

**"Preset" means two different things here**, and knowing which one you are publishing is most
of the job. They share a name, a catalog kind and a feed — and they are not the same document.

::toc[On this page]

## BSM: the preset *is* the file

A BSM preset is a **single JSON document whose metadata is the item**. There is no ZIP, no
manifest beside it, no folder: \`name\`, \`version\` and \`assetPaths\` live inside the file that
is being published.

That is why a BSM preset can be shared by pasting it into a chat window, and why the platform
validates its contents on submit — it *has* the contents.

## BMM: the preset points at a file

A BMM preset is a **scheduled-task automation**, a \`.bmmpa\`. The catalog entry does not carry
it; the entry *points* at it with a download URL, exactly like every other BMM catalog kind.

Nothing is validated beyond "there is an address to fetch". BMM signs and inspects the
automation itself, and a second opinion from a server that cannot open the file would be a guess
dressed up as a check.

:::warning[This is not a detail — it decided whether you could publish at all]
For a long time the feed already emitted the BMM shape, while every *write* path ran the BSM
schema over the submission regardless of project. So a BMM automation could not be submitted:
it was rejected as an invalid preset for lacking \`assetPaths\`, a field it is not supposed to
have.

Each half was self-consistent, which is exactly why nothing failed loudly. Pick the right
**project** on the submit form and the right rules follow it.
:::

## \`assetPaths\` is the preset; everything else is labelling

An array of strings, each one an asset path as BSM knows it. It names what the preset touches —
the values themselves live in BSM. This file names the targets.

:::danger[An empty array publishes fine]
\`"assetPaths": []\` is a valid preset. It uploads, it appears in the catalog, somebody installs
it, and it drives nothing.

That is the one failure nobody reports, because from the outside it looks like it worked.
:::

## Extra keys survive

The validator passes anything it does not recognise straight through, so a field BSM adds later
will not retroactively invalidate your presets. Do not read meaning into that: only the
documented fields are interpreted here.

## Publishing either one

**Dashboard → Submit content**, then the project decides the rest — **BSM** asks for the JSON,
**BMM** asks for a link to the \`.bmmpa\`.

On the catalog page, presets can be downloaded one at a time or several at once, and sorted by
*popular* (all-time or this month), *newest* or *most viewed*. Every download counts toward the
uploader's stats.

:::card{title="The BSM preset format, field by field" href=/docs/preset-catalog icon=book}
Required and optional fields, limits, and a complete working file.
:::` },
    { slug: 'guide-theme-catalog', title: 'Your theme id is an address, not a label', excerpt: 'What survives the ZIP, why two themes can quietly become one, and the manifest field everyone spells wrong.', body:
`:badge[Catalog]{color="#2563eb"} :badge[Themes]{color="#d97706"}

A \`.bmmtheme\` is a ZIP with a \`theme.json\` in it. The interesting part is what happens on the
other side: **the \`id\` in that manifest is not a label, it is an address.**

::toc[On this page]

## \`id\` is where the theme lives

On import, BMM reads \`theme.json\`, takes its \`id\`, and installs the theme into a folder of
that name under the user's themes directory.

:::danger[Two themes with the same id are one theme]
There is no collision check and no warning. The second import overwrites the first, on a
stranger's machine, and the only symptom is that somebody's theme changed by itself.

\`dark\` and \`blue\` are not ids. \`yourname-midnight\` is. Pick something nobody else will pick.
:::

A manifest with no \`id\` is the one hard error: the import stops and says \`missing id\`.

## Three paths survive the ZIP

The importer copies \`theme.json\`, anything under \`assets/\`, and anything under \`fonts/\`.

**Everything else in the archive is silently dropped.** A \`LICENSE\` or a screenshot sitting at
the root of the ZIP does not reach the user's disk — no error, it simply is not there
afterwards. Put what must survive under \`assets/\`.

Entries that try to escape the archive root are skipped outright, so a path like
\`assets/../../evil\` never gets written.

## The manifest field is \`vars\`

This is worth stating plainly, because it is easy to get wrong from memory: the map of
\`--bmm-*\` custom properties is called **\`vars\`**. A theme that spells it \`tokens\` loads
without complaint and changes nothing.

The rest of the manifest is optional and additive: \`mode\` (\`dark\` or \`light\`), \`fonts\`,
\`assets\`, \`global_css\`, \`pages\` for per-view CSS, \`element_overrides\` for per-selector
properties, and \`html_swaps\`.

## Export it, do not write it

The in-app **Theme Editor** exports a valid package in one step, and it does three things you
would otherwise have to remember:

:::steps
:::step[It walks the whole theme folder]
Assets and fonts come along, at the right paths. Hand-zipping is where files go missing.
:::
:::step[It writes \`bmm_signature.json\`]
A signature over every entry in the archive — collected before the ZIP is written, from the same
list the writer uses, so what was signed and what was written cannot drift apart.
:::
:::step[It names the file after the theme]
\`your-theme-id.bmmtheme\`, which is also the folder it will land in.
:::
:::

Then publish it: **Dashboard → Submit content**, project **BMM**, type **Theme**. Installing a
theme only writes style blocks — it never touches source files, and it is reversible from the
same screen.

:::card{title="The package and the catalog entry" href=/docs/theme-catalog icon=book}
The \`themes\` feed entry and the \`.bmmtheme\` layout, in the documentation.
:::

:::card{title="Theming from inside BMM" href=/docs/themes icon=palette}
The token surface, the editor, and what the runtime does for a theme that is incomplete.
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
