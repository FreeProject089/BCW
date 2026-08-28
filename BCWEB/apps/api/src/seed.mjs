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
    {
      slug: 'whats-new-platform', daysAgo: 3,
      title: 'Six things the platform does that are easy to miss',
      excerpt: 'Private links for unlisted content, a free tier on every submission, and why nothing is deleted the day a payment fails.',
      titleFr: 'Six choses que la plateforme fait et qu\'on rate facilement',
      excerptFr: 'Des liens privés pour le contenu non listé, un palier gratuit sur chaque soumission, et pourquoi rien n\'est supprimé le jour où un paiement échoue.',
      body:
`:badge[Platform]{color="#2563eb"}

Some of the most useful things here are one menu deep and nobody goes looking for them. Six of
them, with what they actually do.

::toc[On this page]

## 1. Unlisted does not mean unshareable

Every repository has a public page at \`/r/<id>\`. Content that is deliberately *not* in the
browse list still has one — it just needs the key: a \`?k=…\` link opens it for whoever holds
the link and nobody else.

That is what to hand a tester, and it is why "unlisted" is a useful state rather than a
half-deleted one.

## 2. A storage pool is not a repository

You buy **space**, not a repo. The purchase gives you an empty pool with a byte quota, and what
goes in it is up to you: repositories, catalog items, or both, sharing the same bytes.

Pools can be **merged** into one, **split** apart again, and **consolidated** — several small
plans traded for one larger one, when that is cheaper. Subscriptions follow the pool.

## 3. The first 25 MB of any submission are free

Not the first submission — *every* submission. Hosting cost is computed on the bytes **above**
the free threshold, so a 3 MB theme costs nothing at all and a 30 MB plugin is billed for five
megabytes.

:::note[It was not always like this]
Every byte used to be billed, and the rounding took a 1 KB file up to a full paid megabyte.
Small, ordinary uploads had no free tier at all.
:::

## 4. The free tier is a shared pool, and it can run out

One free repository per **account** — a claim that is recorded and survives unlinking and
relinking, so it cannot be re-taken by disconnecting Discord.

Behind it there is a site-wide capacity for free hosting. When it is exhausted the answer is an
honest *the free tier is full* rather than a checkout that quietly charges you.

## 5. Nothing is deleted the day a payment fails

A lapsed subscription **suspends**: repositories stop serving and catalog items are hidden. It
opens a grace window — 72 hours by default — and only after that does anything get removed.
Renew inside it and everything in the pool comes back, in the state it was in.

## 6. Undo is real, and it is six seconds long

Destructive actions here do not ask "are you sure?" — they do the thing, show a toast, and
give you six seconds to take it back. Nothing is written until the window closes, so cancelling
is not a second operation that could itself fail.

:::tip[And the analytics are first-party]
No third-party trackers anywhere on the site, and nothing is collected without consent. The
numbers are ours, computed here.
:::

:::card{title="See how hosting is priced" href=/hosting icon=server}
The free tier, the per-megabyte cost above it, and what a pool holds.
:::`,
      bodyFr:
`:badge[Plateforme]{color="#2563eb"}

Certaines des choses les plus utiles ici sont à un menu de distance et personne ne va les
chercher. En voici six, avec ce qu'elles font vraiment.

::toc[Sur cette page]

## 1. Non listé ne veut pas dire impartageable

Chaque dépôt a une page publique à \`/r/<id>\`. Le contenu volontairement absent de la liste en
a une aussi — il lui faut juste la clé : un lien \`?k=…\` l'ouvre pour qui détient le lien, et
pour personne d'autre.

C'est ce qu'on donne à un testeur, et c'est pour cela que « non listé » est un état utile
plutôt qu'un demi-effacement.

## 2. Un pool de stockage n'est pas un dépôt

Tu achètes de l'**espace**, pas un dépôt. L'achat te donne un pool vide avec un quota, et ce
qu'on y met te regarde : des dépôts, des éléments de catalogue, ou les deux, sur les mêmes
octets.

Les pools se **fusionnent**, se **séparent** à nouveau, et se **consolident** — plusieurs
petits plans échangés contre un plus grand, quand c'est moins cher. Les abonnements suivent le
pool.

## 3. Les 25 premiers Mo de toute soumission sont gratuits

Pas de la première soumission — de *chaque* soumission. Le coût d'hébergement est calculé sur
les octets **au-dessus** du seuil gratuit : un thème de 3 Mo ne coûte rien du tout, et un
plugin de 30 Mo est facturé cinq mégaoctets.

:::note[Ça n'a pas toujours été le cas]
Chaque octet était facturé, et l'arrondi montait un fichier de 1 Ko à un mégaoctet payant
entier. Les petits envois ordinaires n'avaient aucun palier gratuit.
:::

## 4. Le palier gratuit est une réserve commune, et elle peut s'épuiser

Un dépôt gratuit par **compte** — un droit enregistré qui survit à une déliaison suivie d'une
reliaison, donc impossible à reprendre en déconnectant Discord.

Derrière, il y a une capacité gratuite à l'échelle du site. Quand elle est épuisée, la réponse
est un franc *le palier gratuit est plein* plutôt qu'un paiement qui te débite en silence.

## 5. Rien n'est supprimé le jour où un paiement échoue

Un abonnement en défaut **suspend** : les dépôts cessent de servir et les éléments de catalogue
sont masqués. Cela ouvre une fenêtre de grâce — 72 heures par défaut — et ce n'est qu'ensuite
que quelque chose est retiré. Renouvelle pendant la fenêtre et tout le pool revient, dans
l'état où il était.

## 6. L'annulation existe, et elle dure six secondes

Les actions destructrices ici ne demandent pas « tu es sûr ? » : elles font la chose, affichent
un toast, et te laissent six secondes pour revenir en arrière. Rien n'est écrit tant que la
fenêtre n'est pas fermée, donc annuler n'est pas une seconde opération qui pourrait elle-même
échouer.

:::tip[Et les statistiques sont internes]
Aucun traqueur tiers nulle part sur le site, et rien n'est collecté sans consentement. Les
chiffres sont les nôtres, calculés ici.
:::

:::card{title="Voir comment l'hébergement est facturé" href=/hosting icon=server}
Le palier gratuit, le coût au mégaoctet au-dessus, et ce que contient un pool.
:::`,
    },
    {
      slug: 'roadmap-whats-next', daysAgo: 7,
      title: 'How we decide what to build next',
      excerpt: 'Polls that take sentences as well as votes, three small things that changed because somebody complained, and what is coming.',
      titleFr: 'Comment on décide de la suite',
      excerptFr: 'Des sondages qui prennent des phrases autant que des votes, trois petites choses changées parce que quelqu\'un s\'est plaint, et ce qui arrive.',
      body:
`:badge[Roadmap]{color="#7c3aed"}

We build in the open, which is easy to say and mostly means one thing in practice: **the
decisions are visible before they are made, and there is somewhere to argue with them.**

## Where the arguing happens

:::columns
:::column
**Polls** — real ones. A poll can take a vote *and* a written answer, and the written answers
are the part that changes plans. A tally tells you which option won; a sentence tells you why
somebody wanted it.
:::
:::column
**Contact and Discord** — for the things a poll cannot ask, because nobody knew to ask them.
Feature requests, bug reports, and "this is confusing" — the last one being the most useful
message we get.
:::
:::

## What that has already changed

Small things, mostly, and small things are the point. The free tier for catalog submissions
exists because billing every byte made a 1 KB upload cost a full megabyte. Unlisted content got
a private share link because "not in the list" and "not shareable" were the same state and
should not have been. Destructive actions got an undo window instead of a confirmation dialog
because a confirmation asks you to be sure in advance, which is not when people know.

## What is next

**BetterInstaller** is here — a fast, modern installer for the whole suite, replacing the old
one.

Beyond that: deeper creator dashboards (what your uploads, repos and pools are actually doing),
and more tooling around presets, themes and plugins. The order those land in is not fixed, and
that is deliberate.

:::tip[The most useful thing you can send us]
Not "add feature X". *"I tried to do Y and stopped at Z."* The second one names a problem; the
first one names one solution to a problem we may not have understood yet.
:::

:::card{title="Tell us what to build" href=/contact icon=message-circle}
Contact, Discord, and the current polls.
:::`,
      bodyFr:
`:badge[Roadmap]{color="#7c3aed"}

On construit à ciel ouvert, ce qui est facile à dire et veut surtout dire une chose en
pratique : **les décisions sont visibles avant d'être prises, et il y a un endroit pour les
contester.**

## Où ça se discute

:::columns
:::column
**Les sondages** — de vrais sondages. Un sondage peut prendre un vote *et* une réponse écrite,
et ce sont les réponses écrites qui changent les plans. Un décompte dit quelle option a gagné ;
une phrase dit pourquoi quelqu'un la voulait.
:::
:::column
**Contact et Discord** — pour ce qu'un sondage ne peut pas demander, faute d'avoir su qu'il
fallait le demander. Demandes de fonctionnalités, bugs, et « je ne comprends pas » — ce dernier
étant le message le plus utile qu'on reçoive.
:::
:::

## Ce que ça a déjà changé

De petites choses, surtout, et les petites choses sont le sujet. Le palier gratuit sur les
soumissions de catalogue existe parce que facturer chaque octet faisait coûter un mégaoctet
entier à un envoi de 1 Ko. Le contenu non listé a gagné un lien de partage privé parce que
« absent de la liste » et « impartageable » étaient le même état, et n'auraient pas dû l'être.
Les actions destructrices ont gagné une fenêtre d'annulation au lieu d'une boîte de
confirmation, parce qu'une confirmation demande d'être sûr à l'avance, et ce n'est pas à ce
moment-là qu'on sait.

## La suite

**BetterInstaller** est là — un installeur moderne et rapide pour toute la suite, en
remplacement de l'ancien.

Ensuite : des tableaux de bord créateurs plus profonds (ce que font réellement tes envois, tes
dépôts et tes pools), et plus d'outillage autour des presets, thèmes et plugins. L'ordre dans
lequel tout cela arrive n'est pas figé, et c'est volontaire.

:::tip[Le message le plus utile que tu puisses nous envoyer]
Pas « ajoutez la fonctionnalité X ». *« J'ai essayé de faire Y et je me suis arrêté à Z. »* Le
second nomme un problème ; le premier nomme une solution à un problème qu'on n'a peut-être pas
encore compris.
:::

:::card{title="Dis-nous quoi construire" href=/contact icon=message-circle}
Contact, Discord, et les sondages en cours.
:::`,
    },
    {
      slug: 'hosting-storage-pools', daysAgo: 1,
      title: 'Hosting: you buy space, not a thing to put in it',
      excerpt: 'Pools that merge and split, 25 free megabytes on every submission, and a 72-hour grace window instead of a deletion.',
      titleFr: 'L\'hébergement : tu achètes de l\'espace, pas une chose à mettre dedans',
      excerptFr: 'Des pools qui fusionnent et se séparent, 25 mégaoctets gratuits sur chaque soumission, et une fenêtre de grâce de 72 heures au lieu d\'une suppression.',
      body:
`:badge[Hosting]{color="#0ea5e9"}

Hosting here is built on one idea, and everything else follows from it: **you buy space, not a
thing to put in it.**

::toc[On this page]

## The pool is the unit

A purchase gives you an **empty storage pool** with a byte quota. What goes in is your
decision: repositories, catalog items, or both, sharing the same bytes.

That sounds like a detail until you have three of them. Pools can be:

:::steps
:::step[Merged]
Several pools become one, and the subscriptions come with them. Useful when you bought space
twice and now want one number to look at.
:::
:::step[Split]
The reverse, when a project should stop sharing a quota with another.
:::
:::step[Consolidated]
Several small plans traded for a single larger one — offered when it costs less than what you
are paying now.
:::
:::

## What it costs, honestly

**One free repository per account.** The claim is recorded against the account, so unlinking
and relinking Discord does not hand you a second one.

Above that, you pay for bytes. For catalog submissions the **first 25 MB of each item are
free** and only the excess is billed — a 3 MB theme costs nothing, a 30 MB plugin is billed for
five megabytes.

:::warning[The free tier is shared, and it can be full]
There is a site-wide capacity for free hosting. When it is exhausted you are told so, plainly,
instead of being moved onto a paid plan without noticing.
:::

## Sharing what is not listed

Every repository has a public page at \`/r/<id>\`. A repository that is deliberately out of the
browse list still has that page — reached with a \`?k=…\` key in the URL, which is the whole
access check. Hand it to a tester; do not put it in a public message.

The same mechanism covers unlisted catalog items.

## If a payment fails

Nothing is deleted that day. The subscription lapses, repositories stop serving, catalog items
are hidden — and a grace window opens, **72 hours by default**. Renew inside it and every repo
and item in the pool comes back exactly as it was.

That is the difference between a service that suspends you and one that punishes you for a
declined card.

:::card{title="Open hosting" href=/hosting icon=server}
Start on the free tier — no card required.
:::

:::card{title="Storage pools, in the docs" href=/docs/storage-pools icon=book}
Quotas, merging, and how billing attaches to a pool.
:::`,
      bodyFr:
`:badge[Hébergement]{color="#0ea5e9"}

L'hébergement ici repose sur une seule idée, et tout le reste en découle : **tu achètes de
l'espace, pas une chose à mettre dedans.**

::toc[Sur cette page]

## Le pool est l'unité

Un achat te donne un **pool de stockage vide** avec un quota d'octets. Ce que tu y mets te
regarde : des dépôts, des éléments de catalogue, ou les deux, sur les mêmes octets.

Ça ressemble à un détail jusqu'au jour où tu en as trois. Les pools peuvent être :

:::steps
:::step[Fusionnés]
Plusieurs pools n'en font plus qu'un, et les abonnements suivent. Utile quand tu as acheté de
l'espace deux fois et que tu veux un seul chiffre à regarder.
:::
:::step[Séparés]
L'inverse, quand un projet ne devrait plus partager son quota avec un autre.
:::
:::step[Consolidés]
Plusieurs petits plans échangés contre un seul plus grand — proposé quand cela coûte moins que
ce que tu paies aujourd'hui.
:::
:::

## Ce que ça coûte, franchement

**Un dépôt gratuit par compte.** Le droit est enregistré sur le compte : délier puis relier
Discord ne t'en donne pas un second.

Au-delà, tu paies des octets. Pour les soumissions de catalogue, **les 25 premiers Mo de chaque
élément sont gratuits** et seul le surplus est facturé — un thème de 3 Mo ne coûte rien, un
plugin de 30 Mo est facturé cinq mégaoctets.

:::warning[Le palier gratuit est commun, et il peut être plein]
Il existe une capacité gratuite à l'échelle du site. Quand elle est épuisée, on te le dit
franchement, au lieu de te basculer sur un plan payant sans que tu le remarques.
:::

## Partager ce qui n'est pas listé

Chaque dépôt a une page publique à \`/r/<id>\`. Un dépôt volontairement hors de la liste garde
cette page — on l'atteint avec une clé \`?k=…\` dans l'URL, et c'est tout le contrôle d'accès.
Donne-la à un testeur ; ne la mets pas dans un message public.

Le même mécanisme couvre les éléments de catalogue non listés.

## Si un paiement échoue

Rien n'est supprimé ce jour-là. L'abonnement tombe en défaut, les dépôts cessent de servir, les
éléments de catalogue sont masqués — et une fenêtre de grâce s'ouvre, **72 heures par défaut**.
Renouvelle pendant cette fenêtre et chaque dépôt et chaque élément du pool revient exactement
comme il était.

C'est la différence entre un service qui te suspend et un service qui te punit pour une carte
refusée.

:::card{title="Ouvrir l'hébergement" href=/hosting icon=server}
Commence sur le palier gratuit — aucune carte requise.
:::

:::card{title="Les pools de stockage, dans la doc" href=/docs/storage-pools icon=book}
Quotas, fusion, et comment la facturation s'attache à un pool.
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
