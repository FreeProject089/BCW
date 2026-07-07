// Documentation content — a full, from-scratch rewrite of the user-facing docs (no
// admin / staff topics). Idempotent: upserts each page by slug, so re-running just
// refreshes the content. Run: `docker compose exec api node src/seed-docs.mjs`.
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

// category order is derived from each page's `order` (see toTree in docs.mjs); we keep
// blocks of 100 per category so pages stay grouped and easy to reorder later.
const PAGES = [
  // ── Getting started ─────────────────────────────────────────────────────────
  {
    slug: 'introduction', category: 'Getting started', title: 'Introduction', icon: 'book', order: 100,
    body: `::toc[On this page]

# Welcome to BetterModsManager

**BetterModsManager (BMM)** is a desktop app that installs, organises and updates your mods — with a plugin API, a theme engine, and a built-in link to **BetterCommunity**, where creators publish apps, plugins, themes and presets.

:::tip[New here?]
Jump straight to the :icon[rocket] **[Quick start](/docs/quick-start)** — you'll have your first mods managed in a couple of minutes.
:::

## What you can do

:::cards
:::card{title="Manage mods" icon=boxes}
Keep every mod in one library, toggle them on/off, and update them safely from a valid SHA.
:::
:::card{title="Extend with plugins" icon=puzzle}
Install community plugins that add whole new features to the app.
:::
:::card{title="Theme everything" icon=palette}
Build and share themes with the visual theme editor.
:::
:::card{title="Publish & share" href=/docs/publishing icon=upload}
Submit your own apps, plugins, themes and presets to the BetterCommunity catalog.
:::
:::

## The two halves

| | What it is |
|---|---|
| **BMM** | The desktop app you run locally. |
| **BetterCommunity** | The web hub for discovering, publishing and hosting content. |`,
  },
  {
    slug: 'quick-start', category: 'Getting started', title: 'Quick start', icon: 'rocket', order: 101,
    body: `# Quick start

Get from a fresh install to a managed library in three steps.

## 1 · Install & launch

Download BMM, run the installer, and open the app. On first launch it sets up your library folder — you can change it later in **Settings**.

## 2 · Add your mods

Drag mods into the **Library**, or install them from the catalog. Each mod becomes a card you can enable, disable, or update.

:::tip
Use the search bar and filters at the top of the Library to find anything fast once you have a lot of mods.
:::

## 3 · Keep things updated

When an update is available, BMM shows it on the mod card. Updates only apply from a **valid SHA**, so you always know exactly what you're getting.

:::success[That's it]
You're set up. Next, explore [Plugins](/docs/plugins), [Themes](/docs/themes), or head to [BetterCommunity](/docs/community).
:::`,
  },

  // ── Using BMM ───────────────────────────────────────────────────────────────
  {
    slug: 'library-and-mods', category: 'Using BMM', title: 'Your library & mods', icon: 'boxes', order: 200,
    body: `::toc[On this page]

# Your library & mods

The **Library** is the home for every mod you manage.

## Adding mods

- **Drag & drop** a mod file or folder onto the Library.
- **Install from the catalog** — browse [BetterCommunity](/docs/community) and install in one click.

## Managing a mod

Each mod is a card. From it you can:

- **Enable / disable** without deleting anything,
- **Update** when a new version is available (from a valid SHA),
- **Inspect** its details, version and source.

:::warning[Archived mods]
Zipped mods are stored as \`.zip\` and extracted to a temporary cache on demand — you never lose the original archive.
:::

## Finding things

Use the search box and status filters at the top of the Library to narrow down large collections instantly.`,
  },
  {
    slug: 'plugins', category: 'Using BMM', title: 'Plugins', icon: 'puzzle', order: 201,
    body: `::toc[On this page]

# Plugins

Plugins extend BMM with entirely new features — extra panels, integrations, automations and more.

## Installing a plugin

Install a \`.bmmplug\` from the catalog, or drop one into the app. Plugins are sandboxed and ask for the permissions they need up front.

:::tip[Discover plugins]
Browse the **Plugins** section on [BetterCommunity](/docs/community) to find what the community has built.
:::

## Permissions

A plugin declares the capabilities it wants (network, files, deep links…). You approve them before it runs, and you can review them any time.

:::card{title="Publish your own plugin" href=/docs/plugin-catalog icon=upload}
See the \`.bmmplug\` catalog format to package and submit a plugin.
:::`,
  },
  {
    slug: 'themes', category: 'Using BMM', title: 'Themes & the theme editor', icon: 'palette', order: 202,
    body: `::toc[On this page]

# Themes & the theme editor

BMM is fully themeable. Pick a built-in theme, or design your own in the **visual theme editor**.

## Using a theme

Open **Settings → Appearance** and choose from the built-in themes (including a light mode), or apply one you installed from the catalog.

## Building a theme

The theme editor exposes the app's design **tokens** — colours, surfaces, borders, text. Adjust them live and watch the whole app update.

:::tip
Because everything uses tokens, your theme applies consistently across every page and component.
:::

## Sharing a theme

Export your theme as a \`.bmmtheme\` and submit it to the catalog so others can install it.

:::card{title="Theme catalog format" href=/docs/theme-catalog icon=book}
Package and publish a \`.bmmtheme\`.
:::`,
  },
  {
    slug: 'presets', category: 'Using BMM', title: 'Presets (BSM)', icon: 'sliders', order: 203,
    body: `# Presets (BSM)

Presets are shareable configuration bundles for BSM. Install one to apply a known-good setup in seconds, or export your own to share.

## Installing a preset

Install a preset \`.json\` from the catalog, or import a file directly.

## Sharing a preset

Export your configuration and submit it to the **Preset** catalog.

:::card{title="Preset catalog format" href=/docs/preset-catalog icon=book}
The BSM preset format reference.
:::`,
  },

  // ── BetterCommunity ─────────────────────────────────────────────────────────
  {
    slug: 'community', category: 'BetterCommunity', title: 'Community & blog', icon: 'newspaper', order: 300,
    body: `::toc[On this page]

# BetterCommunity

**BetterCommunity** is the web hub — and a page right inside BMM — where you discover content and follow news.

## The catalog

Browse and install **apps, plugins, themes and presets** published by the community. Everything installs straight into BMM.

## The blog

Project teams post release notes, guides and announcements. You can read them on the web or in the **BetterCommunity Blog** page inside BMM.

:::tip[Reactions & comments]
Posts can have reactions, and editors collaborate on drafts with threaded comments and full edit history.
:::

## Publishing

Want to share your own work?

:::card{title="Publishing to the catalog" href=/docs/publishing icon=upload}
How to submit apps, plugins, themes and presets.
:::`,
  },
  {
    slug: 'publishing', category: 'BetterCommunity', title: 'Publishing to the catalog', icon: 'upload', order: 301,
    body: `::toc[On this page]

# Publishing to the catalog

Share your work with every BMM user by submitting it to the BetterCommunity catalog.

## Pick your type

:::cards
:::card{title="App" href=/docs/app-catalog icon=boxes}
A standalone app entry.
:::
:::card{title="Plugin" href=/docs/plugin-catalog icon=puzzle}
A \`.bmmplug\` that extends BMM.
:::
:::card{title="Theme" href=/docs/theme-catalog icon=palette}
A \`.bmmtheme\` design.
:::
:::card{title="Preset" href=/docs/preset-catalog icon=sliders}
A BSM preset bundle.
:::
:::

## Hosting your files

You can link to your own download URL, or let us host the payload for you. For a repository, see **[Server repos](/docs/server-repos)**.

:::warning[Every submission is reviewed]
Files sit in a temporary area until a moderator approves them — then they become part of the public catalog.
:::`,
  },
  {
    slug: 'app-catalog', category: 'BetterCommunity', title: 'App catalog format', icon: 'boxes', order: 302,
    body: `# App catalog format

An app entry describes a standalone app in the catalog.

## Fields

| Field | Meaning |
|---|---|
| \`name\` | Display name |
| \`version\` | Semantic version, e.g. \`1.4.0\` |
| \`category\` | \`game\` · \`utility\` · \`other\` |
| \`description\` | Short summary shown on the card |
| \`download_url\` | Direct download, **or** host it with us |

:::tip
Keep \`version\` accurate — updates in BMM are driven by it.
:::`,
  },
  {
    slug: 'plugin-catalog', category: 'BetterCommunity', title: 'Plugin catalog (.bmmplug)', icon: 'puzzle', order: 303,
    body: `# Plugin catalog · \`.bmmplug\`

A plugin is packaged as a \`.bmmplug\` and declares what it needs to run.

## Key fields

| Field | Meaning |
|---|---|
| \`name\` / \`version\` | Identity |
| \`permissions\` | Capabilities the plugin requests (network, files, deep links…) |
| \`entry\` | The plugin's entry point |

:::warning[Permissions are shown to users]
Only request what you actually use — users approve each permission before the plugin runs.
:::`,
  },
  {
    slug: 'theme-catalog', category: 'BetterCommunity', title: 'Theme catalog (.bmmtheme)', icon: 'palette', order: 304,
    body: `# Theme catalog · \`.bmmtheme\`

A theme is a set of design tokens exported from the theme editor.

## Fields

| Field | Meaning |
|---|---|
| \`name\` | Theme name |
| \`tokens\` | Colours, surfaces, borders, text |
| \`mode\` | \`dark\` or \`light\` base |

:::tip
Test your theme across every page before publishing — tokens apply app-wide.
:::

:::card{title="Build one" href=/docs/themes icon=palette}
See the theme editor guide.
:::`,
  },
  {
    slug: 'preset-catalog', category: 'BetterCommunity', title: 'Preset catalog (BSM)', icon: 'sliders', order: 305,
    body: `# Preset catalog · BSM

A preset is a shareable BSM configuration bundle.

## Fields

| Field | Meaning |
|---|---|
| \`name\` | Preset name |
| \`config\` | The BSM settings payload |
| \`version\` | Semantic version |

:::card{title="Using presets" href=/docs/presets icon=sliders}
Install and export presets in BMM.
:::`,
  },

  // ── Hosting ─────────────────────────────────────────────────────────────────
  {
    slug: 'server-repos', category: 'Hosting', title: 'Server repos', icon: 'server', order: 400,
    body: `::toc[On this page]

# Server repos

Host a repository with us so BMM users can install and update your content from a stable URL.

## How it works

- We run the repo; **you** manage its content and access.
- Hosting is **prepaid per term** — pick the size you need. Deleting a repo stops future renewals; there's no recurring charge to cancel.
- You get an auto-managed URL (\`owner/repo\`), or point BMM at your own self-hosted repo.

## Limits & pricing

Storage, upload speed and CPU are set per repo. The first slice of storage is free; you only pay for what's above the free floor.

:::warning[Deletion has a grace window]
A deleted repo is kept for **72 hours** before its files are removed — you can undo within that window from your dashboard.
:::

## Managing access

From your repo dashboard you can set access (public / whitelist), bans, and the upload limit — all within the sandbox.`,
  },

  // ── Authoring ───────────────────────────────────────────────────────────────
  {
    slug: 'documentation-blocks', category: 'Authoring', title: 'Documentation blocks', icon: 'blocks', order: 500,
    body: `::toc[On this page]

# Documentation blocks

Docs and blog posts support rich blocks on top of Markdown. Here's the toolkit.

## Callouts

\`\`\`
:::tip[Optional title]
Your text here.
:::
\`\`\`

Kinds: \`:::note\` · \`:::tip\` · \`:::success\` · \`:::warning\` · \`:::danger\`.

:::success[Result]
That renders a coloured callout like this one.
:::

## Cards

\`\`\`
:::cards
:::card{title="A card" href=/docs icon=book}
Body text.
:::
:::
\`\`\`

## Inline bits

- Keyboard: \`:kbd[Ctrl+S]\` → :kbd[Ctrl+S]
- Icon: \`:icon[rocket]\` → :icon[rocket]
- Badge: \`:badge[New]{color="#16a34a"}\` → :badge[New]{color="#16a34a"}

## Table of contents

Add \`::toc[On this page]\` at the top and it builds a summary from your \`##\` / \`###\` headings automatically.

:::tip[Annotations]
Wrap text in a \`<doc-comment data-comment="…">\` to add a hover note — great for glossary terms.
:::`,
  },
];

const run = async () => {
  let created = 0, updated = 0;
  for (const pg of PAGES) {
    const existing = await p.docPage.findUnique({ where: { slug: pg.slug } });
    await p.docPage.upsert({
      where: { slug: pg.slug },
      update: { title: pg.title, category: pg.category, icon: pg.icon, body: pg.body, order: pg.order, published: true },
      create: { slug: pg.slug, title: pg.title, category: pg.category, icon: pg.icon, body: pg.body, order: pg.order, published: true },
    });
    existing ? updated++ : created++;
  }
  // Drop leftover pages from the old structure: the scratch page, the features overview
  // (superseded by Introduction + it referenced admin-only telemetry), and the catalog
  // overview (superseded by the new Publishing page). 'api-reference' is kept — it's a
  // real public API reference, not an admin topic.
  await p.docPage.deleteMany({ where: { slug: { in: ['test', 'features', 'catalog-formats'] } } }).catch(() => {});
  console.log(`docs seed: ${created} created, ${updated} updated, ${PAGES.length} total.`);
  await p.$disconnect();
};
run().catch((e) => { console.error(e); process.exit(1); });
