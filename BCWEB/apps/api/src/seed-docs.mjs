// Documentation content — a full, from-scratch rewrite of the user-facing docs (no
// admin / staff topics). Idempotent: upserts each page by slug, so re-running just
// refreshes the content. Run: `docker compose exec api node src/seed-docs.mjs`.
import { PrismaClient } from '@prisma/client';
import { DOCS_FR } from './seed-docs-fr.mjs';
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
    body: `::toc[On this page]

# App catalog format

An App Catalog is a \`catalog.json\` with an \`apps\` array. Each entry describes one standalone app; BMM installs from it in one click.

## Envelope

\`\`\`json
{ "version": "1.0", "name": "My catalog", "description": "…", "apps": [ … ] }
\`\`\`

## App entry — required fields

| Field | Values |
|---|---|
| \`id\` | Unique slug (dashes). |
| \`title\` | Display name (note: \`title\`, not \`name\`). |
| \`description\` | 1–3 sentences shown on the card. |
| \`category\` | \`game\` · \`utility\` · \`other\` |
| \`price\` | \`free\` · \`freemium\` · \`paid\` |
| \`tags\` | Up to 3. |
| \`download.url\` | Direct download link. |
| \`download.file_type\` | \`zip\` · \`exe\` · \`msi\` · \`script\` |

## Optional fields

\`version\`, \`requirements\`, \`md_link\`, \`images.thumb\` (16:9, ≥400×225) and \`images.extra\`, \`download.size\`.

:::note[Integrity]
\`download.sha256\` is optional but **recommended** — BMM verifies it on install.
:::

:::tip[Don't hand-write it]
Create official apps via **Admin → Catalogs**, or community apps via **Dashboard → Submit content**. Either way BMM builds the \`catalog.json\` and a \`bmm://\` deeplink, so an "Install in BMM" button just works. Host the payload yourself, or with us.
:::`,
  },
  {
    slug: 'plugin-catalog', category: 'BetterCommunity', title: 'Plugin catalog (.bmmplug)', icon: 'puzzle', order: 303,
    body: `::toc[On this page]

# Plugin catalog · \`.bmmplug\`

Two things share this page: the **catalog entry** (what a \`plugins\` feed lists) and the **\`.bmmplug\` package** (the file itself). They're different — the entry points at the package.

## Catalog entry

Emitted into a \`plugins\` array. **Required:** \`id\`, \`name\`, \`version\`, \`author\`, \`download_url\`. **Optional:** \`game\`, \`description\`, \`official\`, \`tags\`, \`icon_url\`, and a \`sha256\` of the \`.bmmplug\`.

## The \`.bmmplug\` package (a ZIP)

- \`plugin.json\` — the manifest (**required**).
- \`icon.png\` — 40×40 (optional).
- \`checksums.json\` — **sha256 of every file** in the package.
- \`bmm_signature.json\` — the signature, when BMM wrote the package (optional).

The manifest declares \`id\`, \`name\`, \`version\`, \`author\`, \`description\`, \`game\`, \`permissions\`, and how it applies (\`scripts\`, \`folders\`, \`apply_mode\`) — plus an optional \`modlist\`.

:::warning[Permissions are a fixed set — and they're shown to users]
A plugin requests capabilities from the API's real permission set (\`mods.write\`, \`profiles.write\`, \`modpacks.write\`, \`plugins.read\`/\`write\`, \`catalog.read\`/\`write\`, \`app.read\`/\`write\`, \`repo.write\`) — **not** free-form things like "network" or "files". Request only what you use; the user grants each one. See the [API reference](/docs/api-reference).
:::

:::danger[Both checksums are validated]
The catalog entry's \`sha256\` covers the whole \`.bmmplug\`; \`checksums.json\` covers each file inside. If either fails, BMM flags the plugin **invalid** and recommends not installing it. Catalog plugins are always validated.
:::

## Signatures

\`checksums.json\` answers "is this package internally consistent". It cannot answer "did this
come from the person who claims to have made it" — anyone repacking a plugin recomputes it.

So a package BMM wrote carries one more entry, \`bmm_signature.json\`: an ed25519 signature over
a list of **every other file and its SHA-256**. Verifying is two questions and both must pass —
does the signature verify over the list, and does every file hash to what the list says. That
second half is the point: signing only the manifest would say "this plugin is intact" while
every script beside the manifest could have been swapped.

Anyone can check one without installing it, at **Inspect a BMM file** — the check runs in the
browser and the file is never uploaded.

:::warning[Unsigned is not invalid]
A package with no \`bmm_signature.json\` reads as **unsigned**, not broken. Everything published
before signatures existed is unsigned, and a package built by any tool other than BMM will be
too. And \`author_id\` is a **public key, not an identity** — it says two files came from the
same install, not that their author is trustworthy. Which is why the id is shown next to the
verdict rather than being turned into a name.
:::`,
  },
  {
    slug: 'theme-catalog', category: 'BetterCommunity', title: 'Theme catalog (.bmmtheme)', icon: 'palette', order: 304,
    body: `::toc[On this page]

# Theme catalog · \`.bmmtheme\`

As with plugins, there's a **catalog entry** and the **\`.bmmtheme\` package**.

## Catalog entry

Emitted into a \`themes\` array: \`id\`, \`name\`, \`description\`, \`author\`, \`version\`, \`url\` (the download), \`tags\`.

## The \`.bmmtheme\` package (a ZIP)

- \`theme.json\` — the manifest (**required**).
- \`assets/\` — optional (embedded images: logo, wallpaper, mascot).
- \`fonts/\` — optional (the font files the manifest references).

On import BMM copies **those three paths and nothing else**. A \`LICENSE\` or a screenshot at
the root of the archive is dropped without an error, so anything that must survive the install
goes under \`assets/\`.

## The manifest

\`id\`, \`name\`, \`author\`, \`version\`, \`mode\` (\`dark\` or \`light\`), and a **\`vars\`** map
of \`--bmm-*\` custom properties. Optional: \`fonts\`, \`assets\`, \`global_css\`, \`pages\`
(per-view CSS), \`element_overrides\` (per-selector properties) and \`html_swaps\`.

:::warning[The map is \`vars\`, and \`id\` is a directory name]
A manifest that spells the map \`tokens\` loads without complaining and changes nothing — it is
read by name.

And \`id\` is where the theme is installed on disk. Two themes sharing one overwrite each other
on a stranger's machine, with no collision check and no warning. Namespace it:
\`yourname-midnight\`, not \`dark\`.
:::

:::tip[Don't hand-write it]
Export a theme from the in-app **[Theme Editor](/docs/themes)** — it writes a valid \`theme.json\`. Then publish via **Dashboard → Submit content** (Project **BMM**, Type **Theme**). Installing applies instantly and is reversible.
:::`,
  },
  {
    slug: 'legal-pages', category: 'Reference', title: 'The legal pages', icon: 'scale', order: 340,
    body: `::toc[On this page]

# The legal pages

Five documents — Privacy, Terms, Cookies, Payments & Refunds, About — with a plain-language
summary at the top of each. They are served from the DATABASE once imported, and from the
application's built-in defaults until then.

## Two states, per document

A document is in exactly one of them, and never half in each.

| State | What it means |
|---|---|
| **Built-in** | Rendered from the code. Nothing in the dashboard is editable, and the page is byte-identical to what shipped. |
| **Database-backed** | Imported. The dashboard edits it, and the site serves what you saved. |

Importing is per document and refuses to run twice. **Back to the built-in text** deletes the
rows and the page keeps working, rendering from the code again.

There is deliberately no state where half a policy comes from the code and half from the
database. That failure would be invisible — the page would simply say two different things and
look completely normal doing it.

:::warning[Editing the code no longer changes the site]
Once a document is imported, \`legal.jsx\` is only the default for a fresh install. Editing it
does nothing for a visitor. Edit the document in **Admin → Legal**.
:::

## Writing

Bodies are markdown with the same block directives as these docs — \`:::note\`, \`:::steps\`,
cards, columns. Each section has an English and a French field; a section with no French text
falls back to English on a French page, and the editor marks those **no FR** so it is visible
rather than discovered by a French reader.

## Publishing a version

**Publish** freezes the whole document and gives it a number.

That number is what an acceptance records. Without it, \`termsAcceptedAt\` says *when* somebody
agreed and never *what* — and a timestamp pointing at a document that can still be edited
proves nothing in a dispute. With it, you can produce the exact text a person accepted.

Nothing published is ever edited. A correction is a new version, and there is no endpoint that
changes or deletes one. The archive is public, so somebody who accepted v2 can read v2 without
asking you for it.

Unpublished edits are live on the site but are **not** what an acceptance points at. Publish
when a change is one you would want to be able to prove.

## Telling people

Two checkboxes, deliberately separate.

:::steps
:::step[Tell everyone]
An email to every active address, and an in-site notification. On by default. Cheap, and
almost always the right thing.
:::
:::step[Require agreement again]
Adds a banner on every page for every signed-in user until they accept. **Off by default** —
this interrupts everybody, so it is only right when the change actually alters what they
agreed to.
:::
:::

Nothing happens to an account that has not accepted. The banner is persistent, not blocking:
holding the product hostage over a policy update is the pattern this platform exists to avoid.

Both emails can be previewed under **Admin → Emails** without sending one.

## Two guards

- A test fails if the legal text changes without its date changing. The last-updated line is
  what a reader uses to decide whether a policy is current, so it is not allowed to go stale.
- Once a document is database-backed, the page shows **its own** newest edit as that date
  rather than the constant in the code, which would otherwise freeze while the text moved.
`,
    titleFr: 'Les pages légales', categoryFr: 'Référence',
    bodyFr: `::toc[Sur cette page]

# Les pages légales

Cinq documents — Confidentialité, Conditions, Cookies, Paiements & remboursements, À propos —
avec un résumé en langage clair en tête de chacun. Ils sont servis depuis la BASE DE DONNÉES
une fois importés, et depuis les valeurs intégrées à l'application tant qu'ils ne le sont pas.

## Deux états, par document

Un document est dans exactement l'un des deux, jamais à moitié dans chacun.

| État | Ce que ça veut dire |
|---|---|
| **Intégré** | Rendu depuis le code. Rien n'est modifiable dans le dashboard, et la page est identique à ce qui a été livré. |
| **En base** | Importé. Le dashboard le modifie, et le site sert ce que vous avez enregistré. |

L'import se fait par document et refuse de tourner deux fois. **Revenir au texte intégré**
supprime les lignes et la page continue de fonctionner, rendue depuis le code.

Il n'existe délibérément aucun état où la moitié d'une politique vient du code et l'autre de
la base. Cette panne serait invisible — la page dirait simplement deux choses différentes en
ayant l'air parfaitement normale.

:::warning[Modifier le code ne change plus le site]
Une fois un document importé, \`legal.jsx\` n'est plus que le défaut d'une installation neuve.
Le modifier ne change rien pour un visiteur. Modifiez le document dans **Admin → Légal**.
:::

## Rédiger

Les contenus sont en markdown, avec les mêmes blocs que cette documentation — \`:::note\`,
\`:::steps\`, cartes, colonnes. Chaque section a un champ anglais et un champ français ; une
section sans texte français retombe sur l'anglais sur une page française, et l'éditeur marque
celles-là **pas de FR** pour que ce soit visible plutôt que découvert par un lecteur français.

## Publier une version

**Publier** fige le document entier et lui donne un numéro.

Ce numéro est ce qu'une acceptation enregistre. Sans lui, \`termsAcceptedAt\` dit *quand*
quelqu'un a accepté et jamais *quoi* — et un horodatage qui pointe vers un document encore
modifiable ne prouve rien en cas de litige. Avec lui, vous pouvez produire le texte exact
qu'une personne a accepté.

Rien de publié n'est jamais modifié. Une correction est une nouvelle version, et aucun
endpoint ne permet d'en changer ou d'en supprimer une. L'archive est publique : qui a accepté
la v2 peut lire la v2 sans vous la demander.

Les modifications non publiées sont en ligne sur le site mais ne sont **pas** ce vers quoi
pointe une acceptation. Publiez quand un changement est de ceux que vous voudriez pouvoir
prouver.

## Prévenir les gens

Deux cases à cocher, volontairement séparées.

:::steps
:::step[Prévenir tout le monde]
Un e-mail à chaque adresse active, et une notification sur le site. Activé par défaut. Peu
coûteux, et presque toujours la bonne chose à faire.
:::
:::step[Redemander l'accord]
Ajoute une bannière sur chaque page pour chaque utilisateur connecté jusqu'à ce qu'il accepte.
**Désactivé par défaut** — ça interrompt tout le monde, donc ce n'est justifié que si le
changement modifie réellement ce à quoi ils ont consenti.
:::
:::

Rien n'arrive à un compte qui n'a pas accepté. La bannière est persistante, pas bloquante :
prendre le produit en otage pour une mise à jour de politique est exactement le motif que
cette plateforme évite.

Les deux e-mails se prévisualisent dans **Admin → E-mails** sans en envoyer un seul.

## Deux garde-fous

- Un test échoue si le texte légal change sans que sa date change. La ligne « mis à jour le »
  est ce qu'un lecteur utilise pour juger si une politique est actuelle : elle n'a pas le
  droit de vieillir en silence.
- Dès qu'un document vient de la base, la page affiche **sa propre** dernière modification
  comme date, et non la constante du code, qui resterait figée pendant que le texte bouge.
`,
  },
  {
    slug: 'catalog-index', category: 'BetterCommunity', title: 'Catalogue index', icon: 'list', order: 306,
    body: `::toc[On this page]

# Catalogue index

A catalog lists things to install. An **index** lists catalogs.

Without one, following you means somebody collecting a URL for your apps, another for your
plugins, another for your themes, and pasting each into a different screen in BMM. An index
is one address that brings in all of them — and keeps working when you publish a new one.

## What we publish

One generator, several addresses. \`scope\`, \`app\` and \`type\` combine.

\`\`\`
/api/catalogs.json                     everything
/api/catalogs.json?scope=official      only ours
/api/catalogs.json?scope=community     only published by people
/api/catalogs.json?app=bmm             only for BMM
/api/catalogs.json?type=plugin         only plugin catalogs
\`\`\`

:::note
A feed is listed only when something is actually published in it. An index entry leading to
an empty document teaches people to stop trusting the index.
:::

## Telling us which app yours is for

A catalog you publish here can say which Better\\* product it is for, on its card in
**Dashboard → Catalogs**. It matters more than it looks:

- BMM keeps an entry marked \`bmm\`, and drops one marked \`bsm\`.
- An entry marked with **nothing** is kept by everyone. "Nobody said" is not "not for you",
  and every catalog published before this field existed is in that state.

So leaving it unset is safe, and setting it wrongly is not — a catalog labelled for the
wrong product is invisible to the people it was made for.

## Publishing your own index

Serve JSON at a stable https address. No account and no registration: an index is read by
its shape, not by who hosts it.

\`\`\`json
{
  "version": "1.0",
  "kind": "catalog-index",
  "name": "My community catalogs",
  "catalogs": [
    { "type": "plugin", "app": "bmm", "name": "Our plugins", "url": "https://example.com/plugins.json" }
  ]
}
\`\`\`

Only \`catalogs\` is required, and inside it only \`type\` and \`url\`.

:::warning
\`official\` is **ignored** wherever it appears. A client decides trust from the address a
catalog was fetched from, never from what the catalog says about itself — an index able to
grant that badge would be a way around the rule rather than part of it.
:::

Full field list, including \`repo\` and \`preset\` catalogs:
[the catalogue index format guide](/docs/app-catalog).
`,
  },
  {
    slug: 'bmmscript', category: 'Using BMM', title: 'BMMScript & sharing automations', icon: 'terminal', order: 204,
    body: `::toc[On this page]

# BMMScript

BMM's scheduler builds automations from blocks. **BMMScript** is the same automations written
as text — and it is not a second engine. It **compiles to the blocks**: the text becomes
exactly the steps the block editor produces, and the same runner executes them.

Three things follow, and they are the whole design.

- **It is never behind the app.** An action is written \`do <name>(…)\` and the language
  holds no list of action names. An action added to BMM is writable in script the same day.
- **Either direction.** Code opens as blocks; blocks print as code. Neither loses anything.
- **It cannot do more than a block can.** Permissions, variable substitution, loop limits and
  error handling are the runner's, unchanged.

:::warning[There is one compiler, and it is in BMM]
Nothing on this site compiles BMMScript, and nothing should. A second implementation would be
behind the app the day it was written — and it would be the one telling authors their scripts
are fine. The [checker in /dev/tools](/dev/tools?tool=bmmscript) reads the shape and the names,
and says out loud when it could not check the names.
:::

## Sharing a .bmmscript

A \`.bmmscript\` is a plain text file, so it shares like any other. Double-click one and BMM
**opens** it — it does not run it.

What you get is a review screen: the file is compiled first (a broken one names the line rather
than half-running), every step is listed, and every script body is printed in full rather than
summarised as "runs a script".

| The file | What opening it offers |
|---|---|
| grants itself nothing | one click to run — everything it does, you could do with the app’s own buttons |
| grants \`command\`, \`script\`, \`deeplink\`, \`stopProcess\` or \`delete\` | Run stays disabled until you tick that you have read what it does |

The first four are the only things a task can do that the app’s own buttons cannot. \`delete\` is
in the list for the opposite reason: the app’s buttons do it too, but they do it while somebody
is watching, and a file that removes a profile at 3am does not. **Run it now** and **Add to my
tasks** are separate buttons, because running a file once and keeping it forever are different
intentions.

## Publishing a catalogue of automations

An automation catalogue is a \`PRESET\` catalogue on a **BMM** project. The entry POINTS at a
\`.bmmpa\` — the file BMM already exports and imports — rather than describing its contents, so
there is no second parser to keep in step with the first.

:::tip[BMM writes the whole folder for you]
**Settings → Scheduler → From a catalogue… → Publish my own…** picks your automations and writes
one signed \`.bmmpa\` each plus a \`catalog.json\` beside them. Drop the folder anywhere static.
:::

\`\`\`json
{
  "version": "1.0",
  "name": "My automations",
  "presets": [
    {
      "id": "nightly-tidy",
      "name": "Nightly tidy",
      "description": "Scan, then disable anything huge",
      "version": "1.0",
      "download_url": "nightly-tidy.bmmpa",
      "tasks": 1
    }
  ]
}
\`\`\`

| Field | Required | What it does |
|---|---|---|
| \`id\` | yes | Unique within the catalogue. Listing one twice keeps the first. |
| \`name\` | yes | What people see. |
| \`download_url\` | yes | Where the \`.bmmpa\` lives. **Relative is preferred** — see below. |
| \`description\` | no | One or two lines. |
| \`version\` | no | Shown beside the name. |
| \`tags\` | no | Up to eight. |
| \`tasks\` | no | How many automations are inside. Omitted means "not stated", which is not zero. |

### Relative addresses, and why they are the default

A \`download_url\` of \`nightly-tidy.bmmpa\` resolves against wherever BMM fetched the catalogue
from. A catalogue that names its own host stops working the moment it is moved, mirrored or
forked — and being forked is the normal life of a folder on GitHub.

Absolute \`http(s)\` addresses work too, for files that genuinely live somewhere else. Anything
that is not http(s) **after resolving** is dropped — an absolute URL keeps its own scheme through
resolution, so the check has to be on the result.

:::warning[A .bmmpa can carry scripts]
Which is why BMM signs it on export, shows every step before importing, and imports tasks
**disabled** — never registering an OS scheduled task on the file author’s say-so.
:::

:::card{title="Every action, condition and value" href=https://freeproject089.github.io/BMM-Docs/features/bmmscript-reference/ icon=book}
The complete reference — 75 actions with their parameters, 28 conditions, the values a
comparison can read — generated from BMM's own registry.
:::`,
  },
  {
    slug: 'preset-catalog', category: 'BetterCommunity', title: 'Preset catalog (BSM)', icon: 'sliders', order: 305,
    body: `::toc[On this page]

# Preset catalog · BSM

A BSM preset is a **single JSON file**. No ZIP, no separate manifest, no folder structure —
its metadata lives inside the file, which is why a preset can be shared by pasting it.

## A whole preset

This is a complete, valid file — checked against the schema that accepts uploads. Copy it,
change the names, and you have something publishable.

\`\`\`json
{
  "name": "Warm Cabin",
  "version": "1.2.0",
  "color": "#c2410c",
  "UpdateNumber": 4,
  "date": "2026-08-14",
  "assetPaths": [
    "ambience/rain_light",
    "ambience/fire_crackle",
    "ui/click"
  ]
}
\`\`\`

## The fields

| Field | Required | What it does |
|---|---|---|
| \`name\` | yes | What people see in the catalog and in BSM. 1–120 characters. |
| \`version\` | yes | Up to 24 characters. Compared numerically, so \`1.10.0\` is newer than \`1.9.0\`. |
| \`assetPaths\` | yes | The list of assets the preset drives — see below. |
| \`color\` | no | Accent colour. 3 to 8 hex characters; the \`#\` is optional. |
| \`UpdateNumber\` | no | A number. Your own revision counter, shown beside the version. |
| \`date\` | no | Free text, up to 40 characters. \`YYYY-MM-DD\` is the convention. |

:::tip[Extra keys are kept]
The validator passes anything it does not recognise straight through, so a field BSM adds
later will not make your existing presets invalid. Do not rely on us for its meaning, though
— only the fields above are read here.
:::

## What goes in assetPaths

**An array of strings.** Each one is an asset path as BSM knows it — up to 300 characters, up
to 10 000 entries. It is a list of what the preset touches, not a map of settings: the values
live in BSM, this file names the targets.

\`\`\`json
"assetPaths": [
  "weather/thunder_far",
  "weather/thunder_near"
]
\`\`\`

:::warning[assetPaths is the preset]
Everything else is labelling. An empty array publishes fine and drives nothing when installed,
which is the one failure nobody reports — it looks like it worked.
:::

## Publishing one

::::steps[From a file to a listing]{type=1}
:::step[Export it from BSM]
Your preset is already a file — BSM writes it. Open it in a text editor if you want to check
the name and version before it goes out.
:::
:::step[Submit it]
**Dashboard → Submit content**, project **BSM**, type **Preset**. Attach the \`.json\`.
:::
:::step[Wait for a human]
Every submission is reviewed. You get a notification either way, and a rejection says why.
:::
:::step[Watch the numbers]
Downloads and views land on your dashboard. Sorting on the catalog is by popular (all-time or
month), newest, or most viewed — so a preset that people keep coming back to keeps surfacing.
:::
::::

:::card{title="Using presets in BMM" href=/docs/presets icon=sliders}
Installing, exporting and switching between them.
:::
`,
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

From your repo dashboard you can set access (public / whitelist), bans, and the upload limit — all within the sandbox.

## Locking a repo to a key

A **download password** is a shared secret: whoever has it can sync, and whoever has it can pass it on. That is what you want for a group, and the problem when you want to admit exactly one machine.

A **public key** cannot be handed on. Paste the public half into **Access → Authorised keys** on your repo dashboard; the client has to hold the matching private half and *sign* for it on every request. Nothing sent over the wire can be replayed elsewhere, and revoking access is deleting one line.

:::warning[Adding the first key locks the repo for everyone]
With no keys listed, the check does not apply. The moment one key is listed it becomes a condition on **every** request — so add your own key before you add anybody else's, or you will lock yourself out of your own repo.
:::

Accepted: **ed25519, RSA and ECDSA** (nistp256/384/521), in the one-line OpenSSH form your \`.pub\` file already contains — \`ssh-ed25519 AAAAC3… you@machine\`. DSA is not supported; OpenSSH removed it. A line that cannot be parsed is refused as you paste it rather than stored, because a key nothing can verify would be a requirement nothing could ever satisfy.

Note this is the **public** half. Never paste a private key here.

## What the client sends

Not the key — a short-lived signed statement, in the \`X-BMM-Key-Proof\` header:

\`\`\`
X-BMM-Key-Proof: bmmk2.<payload>.<signature>
\`\`\`

The payload names the audience (this server), so a proof captured here cannot be replayed against a different one. In BMM the private half is configured once under **Settings → Identity & API → Identity keys**; only the path is stored, and the file is read at the moment a proof is signed.

A request with no proof against a locked repo answers **401**, not 403 — the client can do something about it, and BMM reads a 401 as "there is a credential to supply".`,
  },

  // ── Authoring ───────────────────────────────────────────────────────────────
  {
    slug: 'documentation-blocks', category: 'Authoring', title: 'Documentation blocks', icon: 'blocks', order: 500,
    body: `::toc[On this page]

# Documentation blocks

Docs and blog posts are written in **B.MD** (better.markdown) — the block vocabulary this site
shares with BMM, so a page written once reads the same in the browser and in the app. Here is
the whole toolkit: every block below is shown twice, the source and what it renders to.

:::note[Write everything with three colons]
Including blocks inside blocks. The renderer sorts the nesting out for you.

Leave a blank line before a directive — \`:::note\` on the line right after a paragraph is read
as part of that paragraph — and always close what you open.
:::

## Callouts

\`\`\`
:::tip[Optional title]
Your text here.
:::
\`\`\`

Kinds: \`:::note\` · \`:::tip\` · \`:::success\` · \`:::warning\` · \`:::danger\`. Each has synonyms so
you can write the word you mean — \`info\` = note, \`hint\` = tip, \`check\` = success,
\`caution\` and \`important\` = warning, \`error\` = danger.

:::success[Result]
That renders a coloured callout like this one.
:::

\`:::callout[Title]{icon=rocket color=#c2410c}\` picks its own icon (any [lucide](https://lucide.dev)
name) and colour — \`:::custom\` is the same block under the name the editor's Blocks menu uses.

## Steps

\`\`\`
:::steps
:::step[Install]
Download and run the installer.
:::
:::step[Sign in]
Use your BetterCommunity account.
:::
:::
\`\`\`

:::steps
:::step[Install]
Download and run the installer.
:::
:::step[Sign in]
Use your BetterCommunity account.
:::
:::

Numbering is automatic — don't number the titles yourself. On \`:::steps\`: \`type\` picks the
alphabet (\`1\` · \`a\` · \`i\` · \`dot\`), \`start\` offsets it, \`orientation=horizontal\` lays them in a
row, \`color\` paints the markers. On a single \`:::step\`: \`icon\`, \`color\`, \`status=done\`.

## Roadmap

Write the stages inline — no JSON needed:

\`\`\`
:::roadmap[Where we are]
:::stage[Shipped]{state=done}
- Grid questions
- Recipe checker
:::
:::stage[In progress]{state=doing percent=40}
- Blog roadmaps
:::
:::
\`\`\`

:::roadmap[Where we are]
:::stage[Shipped]{state=done}
- Grid questions
- Recipe checker
:::
:::stage[In progress]{state=doing percent=40}
- Blog roadmaps
:::
:::stage[Planned]{state=planned}
- MCP parity
:::
:::

Every bullet under a stage becomes a tracked item and inherits that stage's state. \`state=\` is
\`done\`, \`doing\` or \`planned\`; \`percent=\` fills the bar of a stage that is under way; \`eta=\`
adds a date. For per-item percentages or bilingual labels, put a \`json\` code block inside the
roadmap instead; for numbers that live elsewhere, use \`:::roadmap{src="https://…/progress.json"}\`.

## Cards

\`\`\`
:::cards
:::card{title="A card" href=/docs icon=book}
Body text.
:::
:::
\`\`\`

Attributes: \`title\`, \`href\`, \`image\`, \`video\`, \`icon\`, \`color\`.

\`:ref[label]{href=…}\` is a card used as a cross-reference: same block, sized for a line
of prose rather than a grid.

## Columns

\`\`\`
:::columns
:::column
Left.
:::
:::column
Right.
:::
:::
\`\`\`

They stack on narrow screens, so never write "the table on the left" in the prose.
\`:::row\` and \`:::col\` are the same two blocks under shorter names.
\`:::center\`, \`:::left\` and \`:::right\` align a block.

## Collapsible

\`\`\`
:::details[Show the full output]
Hidden until clicked.
:::
\`\`\`

\`:::collapse[…]\` is the same block.

:::details[Show the full output]
Hidden until clicked.
:::

## Download link

\`\`\`
:::file{href=/api/assets/setup.exe name="BMM Setup" size="42 MB"}
:::
\`\`\`

Renders a file row with Download and Open buttons. Without \`icon\`, the icon comes from the
file extension.

## Session replay

\`\`\`
:::replay{src="/api/assets/demo.bmmreplay" title="Installing a plugin"}
:::
\`\`\`

Plays a \`.bmmreplay\` recording inline (\`:::bmmreplay\` is the same block); \`autoplay\` and \`loop\` are bare flags. Prefer an asset
served by this site — a replay that 404s leaves a dead frame mid-page.

## Buttons

\`\`\`
:button[Watch the video]{brand=youtube href=https://youtube.com/…}
:button[Read the guide]{color=#0a7 size=lg href=/docs}
\`\`\`

:button[Watch]{brand=youtube href=https://youtube.com} :button[Join]{brand=discord href=https://discord.gg} :button[Read the guide]{color=#0a7 href=/docs}

One shape, three sizes (\`sm\` \`md\` \`lg\`), any colour. \`brand\` sets the colour **and** the
logo together — \`youtube\` \`discord\` \`kofi\` \`github\` \`twitch\` \`x\` \`reddit\`
\`telegram\` — because a YouTube-red button wearing a Discord glyph is a mistake nobody makes
on purpose. \`outline\` is the quiet version, and \`:btn[…]\` is the short name.

A button with no \`href\` renders as a plain span rather than a dead link.

## Coloured links

\`\`\`
:link[read this first]{color=#e11 href=/docs/quick-start}
\`\`\`

:link[read this first]{color=#e11 href=/docs/quick-start} — still underlined, like every other
link on the site. Colour alone is not a signal everybody can see.

## Hours and times
:::schedule[Support]{tz=Europe/Paris}
| Day | Open |
|---|---|
| Mon-Fri | 09:00-18:00 |
| Sat | 10:00-14:00 |
:::

\`:::schedule{tz=...}\` (or \`:::hours\`) states a repeating schedule in ONE timezone. The rows are shown exactly as you wrote them and the zone is named on the card, because converting them would be wrong: \`Monday 09:00 Europe/Paris\` is 09:00 in Paris every week of the year, and what moves across a daylight-saving boundary is how far that is from the reader. A converted row would be right today and wrong in March. What the block computes instead is the difference **right now**, and says so.

A single moment has no such ambiguity, so it IS converted: \`:time[2026-09-01T20:00]{tz=Europe/Paris}\` (or \`:at\`) shows that instant in each reader's own timezone, keeping what you typed in the tooltip. The date is what makes it exact - it settles which side of a daylight-saving change the time falls on.

## Tabs

\`\`\`
:::tabs
:::tab{title="Windows"}
Run \`install.exe\`.
:::
:::tab{title="Linux"}
Run \`./install.sh\`.
:::
:::
\`\`\`

:::tabs
:::tab{title="Windows"}
Run \`install.exe\`.
:::
:::tab{title="Linux"}
Run \`./install.sh\`.
:::
:::

A panel holds whatever markdown you like, including other blocks. The strip reads its labels
off the panels, so a tab's name and its content cannot drift apart.

## Progress

\`:::progress\` is the roadmap block above under a second name — identical in every
way, so write whichever reads better in the document.

There is deliberately no inline percentage block. A bar on its own is a percentage of
nothing; a stage inside a roadmap is a percentage of something named.

## Maths

Written \`$$…$$\`, inline or as its own block:

\`\`\`
$$E = mc^2$$
\`\`\`

$$E = mc^2$$

Single-dollar \`$x$\` is deliberately off. This site quotes prices, and the alternative is
that "\$5 and \$10" is typeset as a formula — silently, because a price does not error, it
becomes italic nonsense.

## Inline bits

- Keyboard: \`:kbd[Ctrl+S]\` → :kbd[Ctrl+S]
- Icon: \`:icon[rocket]\` → :icon[rocket]
- Badge: \`:badge[New]{color="#16a34a"}\` → :badge[New]{color="#16a34a"} — \`:tag[…]\` is the same chip under another name
- Emoji: \`:rocket:\` → :rocket: · \`:tada:\` → :tada: · \`:white_check_mark:\` → :white_check_mark:

:::note[What the shortcodes cannot break]
Only the 384 names in the list are replaced, so \`10:30:45\` is a timestamp, \`3:4\` is a ratio, and a French sentence ending in a colon is a sentence. Code is never touched — not inline, not fenced — because the substitution runs on text nodes, and code is not one. An unknown shortcode stays exactly as typed, so a typo is visible rather than invisible.
:::

## Table of contents

Add \`::toc[On this page]\` at the top and it builds a summary from your \`##\` / \`###\` headings automatically.

## Timeline

\`\`\`
:::timeline[How we got here]
:::event[First release]{date="2025-03-01" state=done}
The library, profiles and the first catalog.
:::
:::event[Server repos]{date="2026-01-12" state=done icon=server}
Shared repositories, hosted or self-served.
:::
:::event[Where we are]{date="now" state=now}
Levels, the shop, the casino.
:::
:::event[Next]{state=next}
Whatever the vote says.
:::
:::
\`\`\`

:::timeline[How we got here]
:::event[First release]{date="2025-03-01" state=done}
The library, profiles and the first catalog.
:::
:::event[Server repos]{date="2026-01-12" state=done icon=server}
Shared repositories, hosted or self-served.
:::
:::event[Where we are]{date="now" state=now}
Levels, the shop, the casino.
:::
:::event[Next]{state=next}
Whatever the vote says.
:::
:::

\`state\` is \`done\`, \`now\` or \`next\` (aliases: past/shipped, current/active, planned/future). \`:::moment\` is the same block.

## Before / after

\`\`\`
:::compare{before="v1" after="v2"}
:::before
One profile at a time, and a restart between them.
:::
:::after
Profiles switch live, and the game is told.
:::
:::
\`\`\`

:::compare{before="v1" after="v2"}
:::before
One profile at a time, and a restart between them.
:::
:::after
Profiles switch live, and the game is told.
:::
:::

## Stats

\`\`\`
:::stats
:::stat[Downloads]{value="12 400" delta="+8%" icon=download}
:::
:::stat[Members]{value="2 310" delta="+3%" icon=users color=#16a34a}
:::
:::stat[Open issues]{value="7" delta="-4" icon=bug}
Since last month.
:::
:::
\`\`\`

:::stats
:::stat[Downloads]{value="12 400" delta="+8%" icon=download}
:::
:::stat[Members]{value="2 310" delta="+3%" icon=users color=#16a34a}
:::
:::stat[Open issues]{value="7" delta="-4" icon=bug}
Since last month.
:::
:::

The delta's sign picks the colour. A body is the small print under the number. \`:::kpi\` is the same block.

## Quote

\`\`\`
:::quote[Ada Lovelace]{role="Analyst, 1843" avatar=/icons/bmm.png}
The engine might compose elaborate pieces of music of any degree of complexity.
:::
\`\`\`

:::quote[Ada Lovelace]{role="Analyst, 1843" avatar=/icons/bmm.png}
The engine might compose elaborate pieces of music of any degree of complexity.
:::

\`href\` makes the name a link; \`color\` recolours the bar. \`:::testimonial\` is the same block.

## Hero

\`\`\`
:::hero[Better Mods Manager]{subtitle="One library, every game." icon=rocket align=center color=#7c3aed}
:button[Download]{href=/p/bmm size=lg} :button[Read the docs]{href=/docs outline}
:::
\`\`\`

:::hero[Better Mods Manager]{subtitle="One library, every game." icon=rocket align=center color=#7c3aed}
:button[Download]{href=/p/bmm size=lg} :button[Read the docs]{href=/docs outline}
:::

\`image=\` puts a cover above the text; \`align\` is left, center or right.

## Changelog

\`\`\`
:::changelog
:::version[1.4.0]{date="2026-09-01" label=latest}
- [NEW] A template gallery for automations
- [FIXED] Casino: a 1× bucket returned less than the bet
:::
:::version[1.3.2]{date="2026-08-14"}
- [IMPROVED] Faster repo sync
:::
:::
\`\`\`

:::changelog
:::version[1.4.0]{date="2026-09-01" label=latest}
- [NEW] A template gallery for automations
- [FIXED] Casino: a 1× bucket returned less than the bet
:::
:::version[1.3.2]{date="2026-08-14"}
- [IMPROVED] Faster repo sync
:::
:::

The \`[NEW]\` / \`[FIXED]\` / \`[IMPROVED]\` chips are the ordinary shorthand. \`:::release\` is the same block.

## Spoiler

\`\`\`
:::spoiler[The answer]
Forty-two.
:::
\`\`\`

:::spoiler[The answer]
Forty-two.
:::

## FAQ

\`\`\`
:::faq[Questions people ask]
:::q[Is hosting free?]{open}
There is a free tier; above it, you pay by the size you use.
:::
:::q[Can I move a repo to another account?]
Yes — Ownership transfers, in the repo's dashboard.
:::
:::
\`\`\`

:::faq[Questions people ask]
:::q[Is hosting free?]{open}
There is a free tier; above it, you pay by the size you use.
:::
:::q[Can I move a repo to another account?]
Yes — Ownership transfers, in the repo's dashboard.
:::
:::

\`:::question\` is the same block as \`:::q\`.

## Checklist

\`\`\`
:::checklist[Launch day]
- [x] Tag the release
- [x] Write the notes
- [ ] Post on Discord
:::
\`\`\`

:::checklist[Launch day]
- [x] Tag the release
- [x] Write the notes
- [ ] Post on Discord
:::

The count and the bar come from the ticked items; nothing to keep in step.

## Grid

\`\`\`
:::grid{cols=3 gap=lg}
:::card[One]
a
:::
:::card[Two]
b
:::
:::card[Three]
c
:::
:::
\`\`\`

Where \`:::columns\` sizes itself, \`:::grid\` takes a fixed number of columns (1–6) and folds to two, then one, on narrow screens.

## Inline meter

\`\`\`
Migration: :meter[72]{label=Done} · Tests: :meter[9]{max=12 color=#16a34a}
\`\`\`

Migration: :meter[72]{label=Done} · Tests: :meter[9]{max=12 color=#16a34a}

## Phosphor icons

Anywhere an icon name goes — \`:icon[…]\`, a card's \`icon=\`, a stat, a button — a **Phosphor**
icon works next to the lucide ones: \`:icon[ph:rocket]\` :icon[ph:rocket], and a weight as a
prefix: \`:icon[ph-bold:rocket]\` :icon[ph-bold:rocket] · \`:icon[ph-fill:heart]\` :icon[ph-fill:heart] · \`:icon[ph-duotone:star]\` :icon[ph-duotone:star].
The picker in every editor lists all 1 500 of them.

## Settings rows

\`\`\`
:::field[Tile shape]{key=icons.shape type=select icon=palette}
Square, rounded or circle. Applies to every tile in the library.
:::
:::field[Autosave]{key=editor.autosave type=toggle}
Saves a draft every thirty seconds while you type.
:::
\`\`\`

:::field[Tile shape]{key=icons.shape type=select icon=palette}
Square, rounded or circle. Applies to every tile in the library.
:::
:::field[Autosave]{key=editor.autosave type=toggle}
Saves a draft every thirty seconds while you type.
:::

A bold label, an optional type tag, the key in monospace on the right, then the description. \`anchor=\` makes the row a deep-link target; \`:::setting\` is the same block.

## Divider

\`\`\`
:::divider[Part two]
:::
\`\`\`

:::divider[Part two]
:::

\`---\` still draws a plain rule. This one takes a label, set in the middle of the line.

## Table

\`\`\`
:::table[Plans]{style="striped bordered" align=center width=100%}
| Plan | Storage | Price |
|---|---|---|
| Free | 200 MB | 0 |
| Pool | per GB | monthly |
:::
\`\`\`

:::table[Plans]{style="striped bordered" align=center width=100%}
| Plan | Storage | Price |
|---|---|---|
| Free | 200 MB | 0 |
| Pool | per GB | monthly |
:::

The table inside is ordinary GFM, so cells keep holding links, code and icons. \`style\` takes any of \`striped\`, \`bordered\`, \`compact\`, \`hover\`, \`plain\`, \`wide\`, \`sticky\`, \`numbers\`.

## Image

\`\`\`
:img[The app logo]{src=/logo.png width=96 align=center caption="Everything \`![alt](src)\` cannot carry." border}
\`\`\`

:img[The app logo]{src=/logo.png width=96 align=center caption="Everything ![alt](src) cannot carry." border}

\`width\` / \`height\` / \`max\`: a number is pixels, anything else (\`50%\`, \`20rem\`) passes through. \`link=\` wraps it, \`zoom=false\` disables the lightbox, \`lazy=false\` loads it eagerly. \`:image\` is the same block; inline in a sentence it is a \`<span>\`.

## Media

\`\`\`
::audio{src=/uploads/ep12.mp3 title="Episode 12"}
::youtube{src=https://youtu.be/dQw4w9WgXcQ start=90}
::spotify{src=https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC compact}
\`\`\`

\`::audio\` is a native player (\`preload=none\`, nothing downloads until pressed). \`::youtube\` (\`::yt\`) accepts a full URL, a short one, a Shorts or a bare id, and frames it from youtube-nocookie. \`::spotify\` takes a share URL or \`track:ID\` / \`album:ID\` / \`playlist:ID\` / \`episode:ID\` / \`show:ID\` / \`artist:ID\`; an unrecognised link says so in place of the player.

## API cards

\`\`\`
:::api[GET /api/feedback/:project]{auth=session summary="The last hundred entries for a project."}
:::params
| Name | In | Type |
|---|---|---|
| project | path | string |
:::
:::request
\`GET /api/feedback/bmm\`
:::
:::response{status=200}
A JSON array, newest first.
:::
:::
\`\`\`

:::api[GET /api/feedback/:project]{auth=session summary="The last hundred entries for a project."}
:::params
| Name | In | Type |
|---|---|---|
| project | path | string |
:::
:::request
\`GET /api/feedback/bmm\`
:::
:::response{status=200}
A JSON array, newest first.
:::
:::

The method colours the card; \`auth=\` names who may call it; \`deprecated\` adds the badge. \`:::endpoint\` is the same block. \`::openapi{src=/api/openapi.json tag=feedback filter=/feedback toc}\` (\`::swagger\`) fetches a spec and draws every operation as one of these cards, through the same pipeline, so a generated card and a hand-written one look the same.

## Live values

\`\`\`
Downloads so far: :counter[downloads]{src=/api/stats.json path=downloads refresh=60 name=dl}
Status: :fetch[status]{src=/api/status.json path=message}
::live{src=/api/status.json path=message refresh=30}
:action[Vote]{href=/api/vote method=POST body='{"id":1}' confirm="Sure?" done="Thanks!" counter=dl once}
\`\`\`

\`:counter\` formats a number, \`:fetch\` shows text inline and \`::live\` is the block form; \`refresh=\` is in seconds. \`:action\` is a button that calls a URL when pressed — \`confirm=\` asks first, \`done=\` is the label afterwards, \`once\` disables it after one success, and \`counter=\` names a counter to refresh. The URL goes through the same policy as every other link, and a refused one renders an em-dash rather than a request.

## Include

\`\`\`
::include{src=/docs/partials/install.md}
\`\`\`

Renders another document in place, two levels deep at most. \`::embed-md\` is the same block.

## Diagram

\`\`\`\`
:::mermaid[How a notice moves]
\`\`\`mermaid
graph LR; New --> Reviewing --> Closed
\`\`\`
:::
\`\`\`\`

\`:::diagram\` is the same block, and a bare \`\`\`mermaid fence with no directive works too. Mermaid draws it in the browser under its strict setting.

## Two extras that aren't directives

A blockquote starting with \`[!NOTE]\`, \`[!TIP]\`, \`[!IMPORTANT]\`, \`[!WARNING]\` or \`[!CAUTION]\`
becomes the matching callout — handy when pasting from GitHub. French spellings work too.

A bare \`[NEW]\`, \`[FIXED]\`, \`[IMPROVED]\`, \`[REFINE]\`, \`[VISUAL]\` or \`[MAJOR]\` becomes a
coloured change badge (each has a French spelling: \`[NOUVEAU]\`, \`[FIXÉ]\`, \`[AMÉLIORÉ]\`,
\`[RAFFINEMENT]\`, \`[VISUEL]\`, \`[MAJEUR]\`). Anything inside code is left alone.

:::tip[Annotations]
Wrap text in a \`<doc-comment data-comment="…">\` to add a hover note — great for glossary terms.
:::`,
  },

  // ── Reference ─────────────────────────────────────────────────────────────────
  // Read from apps/api/src/routes/api-keys.mjs. If a scope or an endpoint changes there,
  // change it here too — this page is the contract third parties read.
  {
    slug: 'bcweb-api', category: 'Reference', title: 'BetterCommunity API', icon: 'key', order: 599,
    body: `::toc[On this page]

# BetterCommunity API

A read-first HTTP API for your own account, your hosted repos and the public catalog. It is what you use to mirror a catalog, watch a repo for changes, or wire BetterCommunity into a script.

This is **not** the same thing as [the plugin API](/docs/api-reference), which runs inside BMM on your own machine.

## Getting a key

Keys are minted from your **profile page**, under *API keys*. Each key has a name, a set of scopes, and an optional expiry.

:::warning[The key is shown once]
The server stores only a hash of your key, so it genuinely cannot show it to you again. Copy it when you create it. If you lose it, revoke it and mint another — that is the only path.
:::

You can hold up to 20 live keys. A key cannot create another key: minting requires your browser session, so revoking a leaked key actually ends the problem.

## Authenticating

\`\`\`bash
curl -H "Authorization: Bearer bck_YOUR_KEY" https://YOUR-HOST/api/v1/account
\`\`\`

\`X-API-Key\` works too, if a bearer header is awkward in your client.

Failures are deliberately uninformative: a key that never existed, one that was revoked, and one that expired all answer \`401 invalid_key\`. A key that is real but lacks the scope answers \`403 insufficient_scope\` and tells you which scope was needed.

## Scopes

A key is allowed exactly what its scopes say, and a key with no scopes can do nothing.

| Scope | What it opens |
|---|---|
| \`account:read\` | Your profile. |
| \`account:write\` | Your display name and bio. |
| \`repos:read\` | Your repos, their file lists, their change history. |
| \`catalog:read\` | Published catalog items and their change history. |
| \`users:read\` | Public profiles — exactly what a signed-out visitor sees. |

Nothing that spends money, changes access control, or deletes anything is reachable by key. That is on purpose: a key lives in a script on a machine we do not control, so losing one should cost you read access and nothing more.

## Endpoints

### \`GET /api/v1/scopes\`

Every scope and what it means. No key needed — it is how a client discovers what to ask for.

### \`GET /api/v1/account\` · \`account:read\`

\`\`\`json
{ "user": { "id": "…", "displayName": "…", "bio": "…", "role": "USER", "createdAt": "…" },
  "scopes": ["account:read"] }
\`\`\`

### \`PATCH /api/v1/account\` · \`account:write\`

Accepts \`displayName\` (2–60 characters) and \`bio\` (up to 500). Anything else is ignored, and a body with nothing usable answers \`400 nothing_to_update\`.

### \`GET /api/v1/repos\` · \`repos:read\`

Your hosted repos: id, name, status, \`hostPath\`, whether they are published and listed, whether the manifest verified, the content \`sha\`, and storage used against quota.

### \`GET /api/v1/repos/:id/files\` · \`repos:read\`

Every file BetterCommunity holds for that repo — path, size, sha256, content type, last change.

This is the answer to a real gap: a plain web host with directory listing lets BMM discover a repo's files on its own, and BetterCommunity does not serve listings. This endpoint is that listing.

### \`GET /api/v1/repos/:id/changes\` · \`repos:read\`

What happened to the repo's contents, newest first.

\`\`\`json
{ "retentionDays": 30,
  "changes": [ { "action": "upload", "path": "mods/foo/data.pak", "at": "2026-08-11T09:12:04.000Z" },
               { "action": "delete", "path": "mods/old/bad.pak", "at": "2026-08-10T22:40:11.000Z" } ] }
\`\`\`

\`action\` is one of \`upload\`, \`delete\`, \`publish\`, \`unpublish\`, \`settings\`, \`access\`, \`ban\`, \`unban\`.

:::warning[The history has a horizon]
Per-repo history is pruned to 30 days and 1000 entries. \`retentionDays\` tells you where the edge is. If you have been away longer than that, re-read the file list — do not read an empty change feed as "nothing changed".
:::

### \`GET /api/v1/users/:id\` · \`users:read\`

A public profile: display name, avatar, bio, badges, join date, the connections the owner chose to show, and their listed repos and catalogs. Never an email.

\`:id\` accepts an account id or a **BC id** (\`BCU-XXXX-XXXX\`), so a BMM integration holding only a creator id can resolve it without knowing the internal id.

A private profile answers \`403 private_profile\`; a banned or unknown account answers \`404\`.

:::warning[A key is not a staff badge]
Signed in on the site, a moderator can open a private profile. Through the API, **nobody can** — the profile is built as if for a signed-out visitor, whatever role the key's owner holds. Staff powers live behind a browser session and 2FA; a bearer token pasted into a script is not that.
:::

### \`GET /api/v1/users?q=\` · \`users:read\`

Search by display name, BC id, repo id, or catalog slug — each of the last three resolving to the owner. Public, non-banned profiles only, so a search can never surface something a direct fetch would refuse. Minimum two characters; \`?limit=\` up to 100.

### \`GET /api/v1/catalog\` · \`catalog:read\`

Published items only. Filter with \`?kind=APP|PLUGIN|THEME|PRESET\`. Items still in review, rejected or hidden are not visible to a key — the review process is not something an API key routes around.

### \`GET /api/v1/catalog/changes\` · \`catalog:read\`

Additions and removals, newest first.

\`\`\`json
{ "changes": [ { "slug": "my-theme", "kind": "THEME", "action": "published",
                 "version": "1.2.0", "id": "clx…", "at": "2026-08-11T09:12:04.000Z" },
               { "slug": "old-plugin", "kind": "PLUGIN", "action": "deleted",
                 "version": null, "id": null, "at": "2026-08-09T14:02:55.000Z" } ] }
\`\`\`

\`action\` is one of \`created\`, \`updated\`, \`published\`, \`rejected\`, \`hidden\`, \`restored\`, \`deleted\`.

A deleted item really is deleted — its row is gone — so \`id\` comes back \`null\` and **the slug is the identity to key your mirror on**. This feed is the only place a removal is ever recorded; nothing else survives it.

## Polling

Both change feeds take \`?since=<ISO-8601>\` and return only what is newer, and \`?limit=\` (default 100, max 500).

\`\`\`bash
curl -H "Authorization: Bearer $KEY" \
  "https://YOUR-HOST/api/v1/catalog/changes?since=2026-08-01T00:00:00Z&limit=200"
\`\`\`

A \`since\` value that does not parse is ignored rather than rejected, so a client replaying a bad cursor gets everything back instead of looping on a 400.

Read endpoints allow 120 requests per minute; key management and writes allow 30.`,
  },

  // Read from src-tauri/src/api/mod.rs (routes, bearer auth, require_permission filters).
  // If the API changes, re-read that file — do not trust this page over the source.
  {
    slug: 'sso', category: 'Developers', title: 'Sign in with BetterCommunity', icon: 'shield', order: 700,
    body: `::toc[On this page]

# Sign in with BetterCommunity

Let people sign in to **your** app with their BetterCommunity account. This is plain
**OpenID Connect** — if your language has an OIDC library, you already have a client, and
there is no SDK of ours to install.

## Register your app

Profile → **Sign in with BetterCommunity** → *Register an app*. You get a \`client_id\`, and
a \`client_secret\` **shown once** — it is stored only as a hash, so a lost secret is rotated,
never recovered.

Two things worth getting right at registration:

- **Redirect URIs are matched exactly.** They are where the authorization code is delivered,
  so the rules are strict: \`https\` only, except \`http://localhost\` for development; no
  \`#fragment\`, no embedded credentials, no wildcard host. A refusal tells you which rule
  you hit.
- **Public or confidential.** If your app runs where users can read its code — a mobile
  app, a desktop app, a single-page site — tick *public client*. No secret is issued and
  **PKCE is required**, which is the correct trade: a secret shipped inside an app is not
  a secret.

Your app starts **unverified**. It works exactly the same; what differs is that the consent
screen tells people it has not been reviewed and who registered it. Anyone can type any
name into a registration form, and that screen exists to answer "which app is this,
really".

## Discovery

Everything else follows from one document:

\`\`\`
GET /.well-known/openid-configuration
\`\`\`

It advertises the authorization, token, userinfo, revocation and end-session endpoints, the
JWKS URL, and the scopes we support. Point your library at it rather than hard-coding paths.

## The flow

Authorization code with PKCE:

\`\`\`
GET /oauth2/authorize
  ?response_type=code
  &client_id=<your id>
  &redirect_uri=<one you registered>
  &scope=openid profile email
  &state=<random, checked on return>
  &code_challenge=<S256 of your verifier>
  &code_challenge_method=S256
\`\`\`

The person signs in (or is already signed in), sees what you are asking for, and comes back
to your redirect URI with \`code\` and \`state\`. Exchange it:

\`\`\`
POST /oauth2/token
  grant_type=authorization_code
  code=<the code>
  redirect_uri=<the same one>
  client_id=<your id>
  code_verifier=<your verifier>          # public clients
  client_secret=<your secret>            # confidential clients
\`\`\`

You get an \`id_token\` (RS256, verify it against the JWKS), an \`access_token\`, and a
\`refresh_token\`.

Three behaviours to expect, because they are deliberate:

- A code is **single-use**. Replaying one fails with \`invalid_grant\`.
- Refresh tokens **rotate**: each refresh returns a new one and revokes the old. Presenting
  a revoked refresh token fails — that is reuse detection, and it means somebody has a copy
  of your token.
- A refresh may ask for a **narrower** scope (RFC 6749 §6) and gets it; asking for a wider
  one is refused with \`invalid_scope\`.
- The account is re-checked on **every** refresh. If it has been suspended, banned or
  closed, the refresh fails with \`invalid_grant\` and the whole token family is revoked —
  an app cannot outlive the account that authorised it.
- \`prompt=none\` never shows a screen. It answers \`login_required\` or \`consent_required\`
  instead, which is what makes it usable in a hidden iframe.

## Scopes

| Scope | What it gives you |
|---|---|
| \`openid\` | Required. The \`id_token\` and the \`sub\` claim. |
| \`profile\` | \`name\` and \`picture\`. |
| \`email\` | \`email\` and \`email_verified\`. |
| \`items\` | \`GET /oauth2/me/items\` — their catalog items. |
| \`repos\` | \`GET /oauth2/me/repos\` — the Server-Repos they own. |
| \`pools\` | \`GET /oauth2/me/pools\` — their storage pools and usage. |
| \`catalogs\` | \`GET /oauth2/me/catalogs\` — the catalogs they own. |
| \`payments\` | \`GET /oauth2/me/payments\` — their own invoices. Amounts and dates, never card data. |
| \`polls\` | \`GET /oauth2/me/polls\` — how they answered polls. |

Ask for what you use. Every extra scope is a line on the consent screen that somebody has
to decide about.

## Subject types

Chosen at registration and **never changeable**:

- **public** — \`sub\` is the BetterCommunity user id, the same value every client sees.
- **pairwise** — \`sub\` is opaque and unique to your client, so two clients comparing notes
  cannot tell they are looking at the same person.

It cannot be switched later because changing it re-identifies every one of your users at
once: their accounts would be orphaned, not migrated.

## Signing out

\`GET /oauth2/logout\` (RP-initiated logout) ends the BetterCommunity session and returns to
your \`post_logout_redirect_uri\` when it is registered.

## Not this: API keys

If your program acts as **you** — a script, a sync job, a bot you run — you want an
[API key](/docs/api-reference) instead. Keys are personal and scoped, and they need nobody's
consent because they act for one person: you. SSO is for apps that act on behalf of *other*
people.

Try either from the [developer hub](/dev), which sends a real call with a real key and shows
you the real answer, refusals included.
`,
  },
  {
    slug: 'api-reference', category: 'Reference', title: 'Plugin API reference', icon: 'plug', order: 600,
    body: `::toc[On this page]

# Plugin API reference

BMM runs a local HTTP API. It's what [plugins](/docs/plugins) talk to, what the scheduler drives, and what you can \`curl\` yourself.

**Base URL:** \`http://127.0.0.1:51274\` — local only. 51274 is the default; if it's taken BMM binds another port and reports the effective one, so read it from the app rather than hard-coding it.

## Authenticating

Every call carries a bearer token:

\`\`\`bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:51274/api/health
\`\`\`

There are **two kinds of token**, and the difference is the whole security model:

| Token | Where it comes from | What it can do |
|---|---|---|
| **Admin token** | Settings — one per install | Everything. No permission checks. |
| **Plugin token** | Issued per plugin | Only what that plugin has been granted. |

:::tip[Give each plugin its own token]
BMM resolves *who is calling* from the token itself, never from a header a caller could forge. That's what makes permissions mean anything — so authenticate each plugin with its own token, not the admin one.
:::

## Permissions

**Writes are gated. Reads are not.** A read endpoint (\`GET /api/mods\`, \`/api/profiles\`, …) needs no token; what protects it is the loopback bind + CORS (release allows only the app's own origins). A write endpoint demands a specific permission, and a caller without it gets an error naming exactly which one it lacked.

| Permission | Gates |
|---|---|
| \`mods.write\` | Enable / disable / delete a mod |
| \`profiles.write\` | Create / activate / delete a profile |
| \`modpacks.write\` | Enable / disable / create a modpack |
| \`plugins.read\` · \`plugins.write\` | \`plugins/compare\` · \`plugins/apply\` |
| \`catalog.read\` · \`catalog.write\` | App Catalog |
| \`app.read\` · \`app.write\` | App-level actions |
| \`repo.write\` | Server Repo actions |

## Endpoints

\`GET\` reads, \`POST\` acts.

| Endpoint | Does |
|---|---|
| \`GET /api/health\` · \`/api/status\` | Liveness · current activity (no auth). |
| \`GET /api/mods\` · \`/api/mods/active\` · \`/api/mods/{id}\` | The library · what's enabled · one mod. |
| \`GET /api/profiles\` · \`/api/modpacks\` · \`/api/plugins\` | Lists. |
| \`GET /api/creator-id\` | Your creator ID (how repos know you). |
| \`POST /api/mods/enable\` · \`/api/mods/disable\` | \`mods.write\`. |
| \`POST /api/profiles/create\` · \`/api/profiles/activate\` | \`profiles.write\`. |
| \`POST /api/plugins/compare\` · \`/api/plugins/apply\` | Dry-run · run a plugin's mod list. |

:::warning[compare before apply]
\`plugins/compare\` says what *would* change without changing it — use it before \`apply\`, especially in strict mode, where apply disables everything not in the plugin's list.
:::

Test any endpoint from **Plugins → API** in the app. That tester uses the admin token, so it sees everything — which is the wrong place to check whether a *plugin's* permissions are right; use the plugin's own token for that.`,
    bodyFr: `::toc[Sur cette page]

# Référence de l'API plugins

BMM fait tourner une API HTTP locale. C'est ce à quoi parlent les [plugins](/docs/plugins), ce que pilote le planificateur, et ce que tu peux interroger toi-même au \`curl\`.

**URL de base :** \`http://127.0.0.1:51274\` — locale uniquement. 51274 est le défaut ; s'il est pris, BMM en lie un autre et annonce le port effectif : lis-le depuis l'app plutôt que de le coder en dur.

## S'authentifier

Chaque appel porte un token :

\`\`\`bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:51274/api/health
\`\`\`

Il existe **deux sortes de tokens**, et la différence *est* le modèle de sécurité :

| Token | D'où il vient | Ce qu'il peut faire |
|---|---|---|
| **Token admin** | Paramètres — un par installation | Tout. Aucun contrôle. |
| **Token de plugin** | Émis par plugin | Uniquement ce qui lui est accordé. |

:::tip[Donne à chaque plugin son propre token]
BMM déduit *qui appelle* du token lui-même, jamais d'un en-tête qu'un appelant pourrait forger. C'est ce qui donne un sens aux permissions — authentifie donc chaque plugin avec son propre token, pas celui d'admin.
:::

## Les permissions

**Les écritures sont contrôlées, pas les lectures.** Une route de lecture (\`GET /api/mods\`, \`/api/profiles\`…) n'exige aucun token ; ce qui la protège, c'est l'écoute en loopback + le CORS (en release, seules les origines de l'app sont autorisées). Une écriture exige une permission précise, et un appelant qui ne l'a pas reçoit une erreur nommant celle qui manque.

| Permission | Contrôle |
|---|---|
| \`mods.write\` | Activer / désactiver / supprimer un mod |
| \`profiles.write\` | Créer / activer / supprimer un profil |
| \`modpacks.write\` | Activer / désactiver / créer un modpack |
| \`plugins.read\` · \`plugins.write\` | \`plugins/compare\` · \`plugins/apply\` |
| \`catalog.read\` · \`catalog.write\` | App Catalog |
| \`app.read\` · \`app.write\` | Actions au niveau de l'app |
| \`repo.write\` | Actions Dépôt Serveur |

## Les endpoints

\`GET\` lit, \`POST\` agit.

| Endpoint | Rôle |
|---|---|
| \`GET /api/health\` · \`/api/status\` | Vivant · activité en cours (sans auth). |
| \`GET /api/mods\` · \`/api/mods/active\` · \`/api/mods/{id}\` | La bibliothèque · ce qui est actif · un mod. |
| \`GET /api/profiles\` · \`/api/modpacks\` · \`/api/plugins\` | Listes. |
| \`GET /api/creator-id\` | Ton creator ID (comment les dépôts te connaissent). |
| \`POST /api/mods/enable\` · \`/api/mods/disable\` | \`mods.write\`. |
| \`POST /api/profiles/create\` · \`/api/profiles/activate\` | \`profiles.write\`. |
| \`POST /api/plugins/compare\` · \`/api/plugins/apply\` | Simulation · exécute la liste d'un plugin. |

:::warning[compare avant apply]
\`plugins/compare\` dit ce qui *changerait* sans rien changer — utilise-le avant \`apply\`, surtout en mode strict, où apply désactive tout ce qui n'est pas dans la liste du plugin.
:::

Teste n'importe quel endpoint depuis **Plugins → API** dans l'app. Ce testeur utilise le token admin : il voit donc tout — mauvais endroit pour vérifier les *permissions* d'un plugin ; pour ça, sers-toi du token du plugin.`,
  },

  // ── Filling out the thin categories ───────────────────────────────────────────
  // Hosting, Authoring and Developers each had exactly one page, which reads as a
  // section somebody abandoned. Each of these was written from the code, not from
  // memory: the sandbox rules from lib/lib.mjs (apiAuth), the pool lifecycle from
  // lib/sweeper.mjs, the post fields from schema.prisma.
  {
    slug: 'sandbox', category: 'Developers', title: 'Trying the API safely', icon: 'flask-conical', order: 701,
    body: `::toc[On this page]

# Trying the API without breaking anything

Every write in the public API can be run as a **rehearsal**: authenticated for real,
scope-checked for real, and then nothing is written. It exists so that learning the API
never costs you your own data.

## The console

**/dev → Try a call.** Pick an endpoint, paste a key, send it. You get the real status code
and the real body — refusals included, which are the half worth reading.

The sandbox switch is **on by default for writes** and cannot be turned on for reads (see
below). Your key stays in the browser; it is sent to the API and nowhere else.

## Doing it yourself

Add one header:

\`\`\`
X-BCW-Sandbox: 1
\`\`\`

A simulated call answers \`200\` with a body that says what it would have done:

\`\`\`json
{
  "sandbox": true,
  "method": "PATCH",
  "path": "/v1/account",
  "scope": "account:write",
  "note": "Sandbox: authentication and scope were checked, and nothing was written."
}
\`\`\`

## What is still real

Everything except the write:

| Checked | Still happens in the sandbox |
|---|---|
| Is the key real, unrevoked, unexpired? | Yes — a bad key gets \`401 invalid_key\` |
| Does it carry the scope? | Yes — \`403 insufficient_scope\`, naming what it lacks |
| Is the account suspended or banned? | Yes — \`403\`, with \`status\` |
| Rate limits | Yes |
| Recorded for the owner's usage view | Yes, as a sandbox call |

:::tip[Why the checks stay]
A console that skipped them would teach you an API that does not exist — you would write
your integration against a permissive fiction and meet the real rules in production.
:::

## What it will not do

- **A \`GET\` is never simulated.** A read changes nothing by definition, so there is nothing
  to rehearse, and answering you with invented data would make the console worse than
  useless for the one thing it is for. The header is ignored on reads.
- **It does not count as usage.** Sandbox calls are tallied apart from real traffic, so
  exploring never inflates the figures on your keys.

## Reading a refusal

| Body | What went wrong |
|---|---|
| \`{"error":"unauthenticated"}\` | No \`Authorization: Bearer <key>\` header |
| \`{"error":"invalid_key"}\` | Unknown, revoked or expired — one answer for all three, on purpose |
| \`{"error":"insufficient_scope","required":"…","granted":[…]}\` | The key is fine, the scope is missing |
| \`{"error":"account_suspended"}\` | The account behind the key is under sanction |

:::warning[A 403 is a result, not a failure]
If the sandbox refuses you for a missing scope, that is the answer: your integration would
have been refused too. Add the scope to the key rather than working around it.
:::
`,
  },
  {
    slug: 'storage-pools', category: 'Hosting', title: 'Storage pools', icon: 'hard-drive', order: 401,
    body: `::toc[On this page]

# Storage pools

Hosting is bought as a **pool of space**, not as a repo. You buy the space first and decide
afterwards what goes in it: server repos, catalog items, or nothing yet.

## Why a pool and not a repo

Because a repo is a decision you should be able to change. A pool can hold several repos and
several catalogs at once, they share its space, and moving content between them costs
nothing. A purchase that came bolted to one repo forced you to buy again the day you wanted
a second.

:::tip[Nothing is reserved]
A new pool starts empty. The whole of it is available to whatever you put in first.
:::

## What counts against the space

Everything stored: the files in each repo, and the payload of each catalog item hosted in
the pool. The figure on the pool page is recomputed from its contents, not accumulated —
so deleting something gives the space back immediately, with no bookkeeping to wait for.

## When a term ends

A subscription has a term. Before it runs out you get **one warning** — one per term, not a
daily reminder.

If it ends without renewal:

1. The subscription is marked expired and the pool shrinks by that subscription's share.
2. Anything now over the remaining space is **suspended**: repos stop serving, catalog items
   stop being listed.
3. A **72-hour grace window** opens before anything is deleted.

Renewing inside the window restores every repo and catalog in the pool and clears the
warning — the content was suspended, never thrown away.

:::warning[A pool with several subscriptions shrinks, it does not stop]
If a pool is fed by more than one subscription and only one ends, the pool simply loses that
subscription's share and keeps everything that still fits online. Only the content that no
longer fits is suspended.
:::

## The free tier

Every account can claim one free repo and one free catalog item. The claim is remembered per
account, so unlinking and relinking does not hand out a second one.

## Ownership

A pool belongs to an account. Transferring a repo to somebody else moves it out of your pool
and into theirs — the space follows the content, and both pools are recomputed.
`,
  },
  {
    slug: 'landing-pages', category: 'Authoring', title: 'Building a landing page', icon: 'layers', order: 502,
    body: `::toc[On this page]

# Building a landing page

\`/\` and \`/dev\` can be arranged block by block instead of chosen from three built-in layouts.
**Admin → Navigation & footer → Page builder.**

A built page replaces the built-in one entirely. Until you switch it on, nothing changes —
and the switch is refused while the page has no blocks in it, so a half-built layout cannot
become the front page by accident.

## What a page is made of

:::columns
:::column
**Layout** — \`section\`, \`row\`, \`col\`. Rows are a wrapping flex line by default; give one a
number of columns and it becomes a real grid.
:::
:::column
**Content** — headings, text, buttons, images, dividers, spacers and live numbers.
:::
:::column
**Live sections** — the blocks the landing pages already draw: the showcase, the products,
the news, the open poll, reviews, commissions, and the developer tiles.
:::
:::

:::tip[One block does most of the work]
A **text** block holds ordinary BetterCommunity markdown, so callouts, cards, tabs, columns,
buttons, code and maths are all available inside it without the builder needing to know what
any of them are. If you are reaching for a block and cannot find it, write it in a text block.
:::

## Numbers that are real

Type \`{{members}}\` in any heading or text block and it renders the live count. The panel on
the right lists every name with its current value beside it, so you can see what you are
about to publish.

\`members\` · \`items\` · \`downloads\` · \`repos\` · \`catalogs\` · \`posts\` · \`projects\` · \`apps\` ·
\`plugins\` · \`themes\` · \`presets\`

A **stat** block is the same numbers drawn as a tile with a label and an icon. A name that is
not on that list renders as nothing rather than as \`{{typo}}\` — a visitor never sees the
template that failed.

## Desktop and phone

Two layouts, and the phone one **inherits** by default: it draws the desktop tree, reflowed.
That is not the same as being empty, and it is why the phone tab says so rather than quietly
copying your desktop blocks.

:::warning[Give it its own layout only when you mean it]
The moment you press **Give it its own layout**, the two stop tracking each other. An edit to
the desktop page will not reach the phone, and nothing will tell you which edit that was.

Most pages want inheritance plus a couple of blocks hidden. Select a block and use **Shown
on** — a block hidden on one layout is dimmed and hatched in the editor rather than removed,
so it is still there to select.
:::

## The orb

Each page decides whether the backdrop orb is drawn on it: **as the visitor prefers**, or
**hidden on this page**. There is deliberately no option that turns it on for somebody who
switched it off — they did that for a reason, and a landing page is not a good enough one to
overrule it.

## Components, export and import

Select a block and **Save selection** to keep it as a named component. It appears in the
palette and can be dropped into any page, with fresh ids each time, so two copies of a header
are two headers rather than one that moves twice.

**Export page** writes the current page as JSON; **Import page** reads one back. Ids are
regenerated on the way in, so importing a page exported from this same site cannot collide
with what is already there.

:::note[Nothing is live until you save]
The canvas is the real renderer with the real data, so what you are looking at is what
visitors will get. It is still only in your browser until **Save**.
:::
`,
  },
  {
    slug: 'blog-posts', category: 'Authoring', title: 'Writing a blog post', icon: 'newspaper', order: 501,
    body: `::toc[On this page]

# Writing a blog post

The blog editor takes the same blocks as the documentation — callouts, cards, keyboard keys,
badges, a table of contents. If you have written a doc page you already know the syntax; see
**Documentation blocks**. What follows is what a post has that a doc page does not.

## The parts of a post

| Field | What it is for |
|---|---|
| Title & excerpt | The excerpt is the card text in listings. Write it; a truncated first paragraph reads like a mistake. |
| Cover | Shown on the card, and at the top of the article unless you switch that off — useful when your first block is already an image. |
| Body | Markdown plus the block toolkit. |

## Both languages

Title, excerpt and body each have a French counterpart. A missing French body falls back to
the English one silently — the reader sees no warning, so an untranslated post looks
finished. Fill both, or accept that half your readers get the other language.

## Co-authors

A post has one author and any number of **co-authors**. They are credited on the article and
can edit it. Add them before publishing: credit added afterwards is credit nobody saw.

## Reactions

Reactions are **off by default**. Switch them on and choose up to three emoji — one reaction
per reader per post. Three is a deliberate limit: a wall of emoji measures nothing.

## Publishing

A post is a draft until it has a publication date. Publishing does two things beyond making
it visible:

- It can **announce the post to the newsletter**, once. A post that was already announced is
  never announced again, so editing and re-publishing does not re-mail your subscribers.
- It starts the **edit history**. Every subsequent save is kept, within the retention the
  administrators set, and you can compare or restore any of them.

:::warning[Announcing is one-way]
There is no unsend. Check the excerpt and the French version before you publish, because
that is the text that leaves.
:::

## Where a post appears

A post can be attached to a project or to a showcase project, which decides where it is
listed. Home-page news is a separate switch — being published does not put a post on the
front page unless it is meant to be there.
`,
  },
  {
    slug: 'webhooks', category: 'Developers', title: 'Webhooks', icon: 'webhook', order: 702,
    body: `::toc[On this page]

# Webhooks

Stop asking. Register an address and we call it when something happens to what you own.

## Why this instead of polling

An integration without webhooks asks \`/v1/catalogs\` every minute in case an item was
published. That is wasted on both sides and always up to a minute late. A webhook is the same
information, at the moment it becomes true.

## Setting one up

::::steps[From nothing to a delivery]{type=1}
:::step[Add the endpoint]
**/dev/config → Webhooks → Add.** The URL must be \`https\` (localhost is allowed while you
build). Tick only the events you will act on.
:::
:::step[Keep the signing secret]
It is shown once, like an API key. We keep it to sign with; we cannot show it to you again.
Lost one is rotated, never recovered.
:::
:::step[Verify what arrives]
Every delivery carries \`X-BCW-Signature: v1=…\`, \`X-BCW-Timestamp\` and \`X-BCW-Event\`. Compute
HMAC-SHA256 over \`timestamp + "." + body\` with your secret and compare.

:::danger[Check the timestamp too]
A signature alone lets anyone who ever saw one delivery replay it at you for ever. Reject
anything whose \`X-BCW-Timestamp\` is more than a few minutes old.
:::
:::
:::step[Answer 2xx, quickly]
Anything else counts as a failure. Take ten seconds at most — queue the real work and reply.
A receiver doing its processing inline is a receiver that times out under load.
:::
::::

## Verifying, in code

\`\`\`javascript
import crypto from 'node:crypto';

export function verify(req, rawBody, secret) {
  const ts = req.headers['x-bcw-timestamp'];
  const sig = String(req.headers['x-bcw-signature'] || '').replace(/^v1=/, '');
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay window
  const mine = crypto.createHmac('sha256', secret).update(\`\${ts}.\${rawBody}\`).digest('hex');
  // Constant-time: a normal === leaks the answer one character at a time.
  return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig));
}
\`\`\`

:::warning[Sign the RAW body]
Not the parsed-and-re-stringified object. Key order and whitespace change, the signature does
not match, and the cause is invisible.
:::

## What we send

\`\`\`json
{
  "event": "catalog.item.published",
  "at": "2026-08-14T09:12:44.019Z",
  "data": { "id": "cl…", "slug": "warm-cabin", "name": "Warm Cabin", "kind": "preset" }
}
\`\`\`

Download events carry a \`count\`: they are coalesced to one delivery per subject per minute,
because a webhook per download on a popular item is a denial of service we would be
performing on your server.

## When it goes wrong

- **Retries** back off from one minute to ten hours over six attempts.
- **Twenty consecutive failures** switch the endpoint off and notify you. Fix the receiver,
  turn it back on — the failure count resets, so one bad delivery afterwards does not switch
  it off again.
- **A refused URL** (private address, bad scheme) is not retried at all. It would be refused
  identically every time.
- **Every attempt is kept for 30 days**, with the payload and the response, and any of them
  can be replayed — the same payload, which is what makes it useful after fixing a receiver
  that was down.

:::card{title="Set one up" href=/dev/config icon=webhook}
Endpoints, secrets and the delivery log.
:::
`,
  },
  {
    slug: 'feedback-reports', category: 'BetterCommunity', title: 'Feedback, bugs & crash reports', icon: 'bug', order: 305,
    titleFr: 'Retours, bugs & rapports de plantage', categoryFr: 'BetterCommunity',
    body: `::toc[On this page]

# Feedback, bugs & crash reports

Every Better* app can send a **suggestion**, a **bug report** or a **crash report** to the
BetterCommunity feedback centre. This is where they land, and what happens to them.

## From the app

In BMM: **Settings → Feedback & bug reports**, or the button on the crash dialog. Pick a kind,
write what happened, and optionally attach screenshots, the app log, a crash zip, or a DxDiag
report. Nothing leaves your machine until you press Send.

:::note[Linked vs anonymous]
If your BetterCommunity account is linked, a report opens a **thread in your dashboard** and you
are notified when staff reply. Otherwise you can leave an e-mail or Discord so they can reach you.
:::

## Where reports go

Staff read them in **Admin → Feedback & crash reports**. New reports are grouped by kind — a
crash first, since it is the one you could not work around — with the oldest untriaged one shown
so nothing rots. Each report can be triaged, replied to, resolved or ignored.

## If the site is down

A report the app could not send is **kept locally and retried on the next launch**. The app also
limits itself (a handful per ten minutes, a couple of dozen a day) so a stuck loop cannot flood
the centre.

See also: [Levels, XP & points](/docs/economy) · the app's own privacy policy for exactly what a
report attaches.`,
    bodyFr: `::toc[Sur cette page]

# Retours, bugs & rapports de plantage

Chaque app Better* peut envoyer une **suggestion**, un **rapport de bug** ou un **rapport de
plantage** au centre de retours BetterCommunity. Voici où ils arrivent et ce qu'ils deviennent.

## Depuis l'app

Dans BMM : **Réglages → Retours & rapports de bug**, ou le bouton du dialogue de plantage. Choisis
un type, décris ce qui s'est passé, et joins au besoin des captures, le journal de l'appli, un zip
de plantage ou un rapport DxDiag. Rien ne quitte ta machine tant que tu n'as pas appuyé sur Envoyer.

:::note[Lié ou anonyme]
Si ton compte BetterCommunity est lié, un rapport ouvre un **fil dans ton tableau de bord** et tu
es notifié des réponses. Sinon tu peux laisser un e-mail ou un Discord pour être recontacté.
:::

## Où vont les rapports

L'équipe les lit dans **Admin → Retours & plantages**. Les nouveaux sont groupés par type — un
plantage d'abord, car c'est celui qu'on ne peut pas contourner — avec le plus ancien non traité en
évidence. Chaque rapport peut être trié, répondu, résolu ou ignoré.

## Si le site est injoignable

Un rapport que l'appli n'a pas pu envoyer est **gardé localement et renvoyé au prochain démarrage**.
L'appli se limite aussi elle-même (quelques-uns par dix minutes, quelques dizaines par jour) pour
qu'une boucle bloquée ne noie pas le centre.

Voir aussi : [Niveaux, XP & points](/docs/economy).`,
  },
  {
    slug: 'economy', category: 'BetterCommunity', title: 'Levels, XP, points & the shop', icon: 'coins', order: 306,
    titleFr: 'Niveaux, XP, points & boutique', categoryFr: 'BetterCommunity',
    body: `::toc[On this page]

# Levels, XP, points & the shop

Being active on a Discord server the community bot is in earns **XP**. XP raises your **level**,
and every few levels grant **points** you can spend in the shop. Your level and balance show on
your BetterCommunity profile.

## How XP is earned

Messages, reactions and time in voice each grant XP at a rate the server sets. Only a **linked**
account accrues — link Discord from **Profile → Connections** first. Nothing is retroactive.

## The shop

Spend points on badges, a storage boost, a hosting code, or a discount, from the Discord \`/shop\`
or the site. Some items are **sealed**: you buy them now and **reveal** the code when you want it,
and a giftable item can be handed to another member before it is revealed.

:::tip[Fair play]
Points are entertainment, not currency: they are earned by taking part and spent on cosmetic or
convenience items. They are never bought with money.
:::

## The casino

The bot's \`/casino\` lets you wager points on small games. The house edge is taken from the
**profit** of a win, never from your stake, and every game's page shows its odds before you bet.

Three of the games are **live tables** other members can join from the same message —
**Crash** (a multiplier climbs; cash out before it stops), **Race** (six cars, pick yours) and
**Pot** (everyone stakes what they like; the more you put in, the likelier you win) — and
**Multi** opens coin flip, dice, roulette or the wheel as one shared roll.

:::note[The pot rule]
With **two or more** at a table the game settles between the players, not against the house:
the losers' stakes form the pot, every winner keeps their own stake and takes a share of the
pot in proportion to stake × multiplier, and the house edge is taken on that share only.
Nobody wins → the house keeps the pot. Alone at a table you play the house as usual. Crash is
never pooled — everybody cashes out on their own clock.
:::

Each game can carry its own house edge, and the maximum bet is whatever the server set — if it
set none, **All-in** is really all of it; the table says what the cap is otherwise.

See also: [Feedback, bugs & crash reports](/docs/feedback-reports).`,
    bodyFr: `::toc[Sur cette page]

# Niveaux, XP, points & boutique

Être actif sur un serveur Discord où se trouve le bot communautaire gagne de l'**XP**. L'XP fait
monter ton **niveau**, et tous les quelques niveaux accordent des **points** à dépenser en boutique.
Ton niveau et ton solde s'affichent sur ton profil BetterCommunity.

## Comment l'XP est gagnée

Messages, réactions et temps en vocal donnent de l'XP à un taux fixé par le serveur. Seul un compte
**lié** accumule — lie Discord depuis **Profil → Connexions** d'abord. Rien n'est rétroactif.

## La boutique

Dépense des points en badges, un boost de stockage, un code d'hébergement ou une remise, depuis le
\`/shop\` Discord ou le site. Certains articles sont **scellés** : tu les achètes maintenant et tu
**révèles** le code quand tu veux, et un article offrable peut être donné à un autre membre avant
d'être révélé.

:::tip[Fair-play]
Les points sont un divertissement, pas une monnaie : ils se gagnent en participant et se dépensent
en articles cosmétiques ou pratiques. Ils ne s'achètent jamais avec de l'argent.
:::

## Le casino

Le \`/casino\` du bot permet de miser des points sur de petits jeux. L'avantage de la maison est
pris sur le **gain** d'une victoire, jamais sur ta mise, et chaque page de jeu montre ses cotes
avant que tu mises.

Trois des jeux sont des **tables en direct** que d'autres membres rejoignent depuis le même
message — **Crash** (un multiplicateur grimpe ; encaisse avant qu'il s'arrête), **Course** (six
voitures, choisis la tienne) et **Cagnotte** (chacun mise ce qu'il veut ; plus tu mises, plus
tu as de chances) — et **Multi** ouvre pile ou face, dés, roulette ou roue en un seul tirage
partagé.

:::note[La règle de la cagnotte]
À **deux ou plus** à une table, le jeu se règle entre les joueurs, pas contre la maison : les
mises des perdants forment la cagnotte, chaque gagnant garde sa propre mise et prend une part
de la cagnotte au prorata de mise × multiplicateur, et l'avantage maison n'est pris que sur
cette part. Personne ne gagne → la maison garde la cagnotte. Seul à une table, tu joues contre
la maison comme d'habitude. Crash n'est jamais mis en commun — chacun encaisse à son moment.
:::

Chaque jeu peut porter son propre avantage maison, et la mise maximale est celle que le serveur
a fixée — s'il n'en a fixé aucune, **Tapis** est vraiment tout ; sinon la table dit le plafond.

Voir aussi : [Retours, bugs & rapports de plantage](/docs/feedback-reports).`,
  },
  {
    slug: 'make-your-own', category: 'BetterCommunity', title: 'Make Your Own — paid commissions', icon: 'wand-2', order: 307,
    titleFr: 'Make Your Own — commandes sur mesure', categoryFr: 'BetterCommunity',
    body: `::toc[On this page]

# Make Your Own — paid commissions

**Make Your Own** (/myo) is where you commission something built for you: a Discord bot, an app, a
website, a security audit, or anything else. It runs in two clearly separated stages so you never
pay for a product before you have agreed its price.

## Stage 1 — the consultation

You pay a **fixed consultation fee** and describe what you want. That opens a private thread with
someone who advises you and writes a **fixed, itemised quote**. The fee buys advice and the quote;
it is **not** the price of the product.

## Stage 2 — the build

Building starts only once you **approve the quote and pay it**. You say no and it stops there, with
the advice already yours. Whether **source code** is included is stated on the quote, so it is
never a surprise.

:::warning[Read before you start]
The consultation fee and the quote are two different payments. The fee is never refunded once the
advice is given, and the product is only built after the quote is paid.
:::

## Following your request

Your open requests, their status and any replies are on the /myo page and in your dashboard
notifications.`,
    bodyFr: `::toc[Sur cette page]

# Make Your Own — commandes sur mesure

**Make Your Own** (/myo) sert à commander quelque chose de construit pour toi : un bot Discord, une
app, un site, un audit de sécurité, ou autre chose. Ça se passe en deux étapes bien séparées pour
que tu ne paies jamais un produit avant d'en avoir validé le prix.

## Étape 1 — la consultation

Tu paies des **frais de consultation fixes** et tu décris ce que tu veux. Ça ouvre un fil privé avec
un conseiller qui t'oriente et rédige un **devis ferme, ligne par ligne**. Les frais achètent le
conseil et le devis ; ce n'est **pas** le prix du produit.

## Étape 2 — la réalisation

La réalisation ne commence qu'une fois que tu as **validé le devis et payé**. Tu dis non et ça
s'arrête là, le conseil déjà acquis. Que le **code source** soit inclus ou non est écrit sur le
devis, donc jamais une surprise.

:::warning[À lire avant de démarrer]
Les frais de consultation et le devis sont deux paiements distincts. Les frais ne sont pas
remboursés une fois le conseil donné, et le produit n'est construit qu'après paiement du devis.
:::

## Suivre ta demande

Tes demandes ouvertes, leur statut et les réponses sont sur la page /myo et dans les notifications
de ton tableau de bord.`,
  },
  {
    slug: 'site-bans', category: 'Reference', title: 'Site bans & the auto-shield', icon: 'shield', order: 505,
    titleFr: 'Bans du site & bouclier automatique', categoryFr: 'Référence',
    body: `::toc[On this page]

# Site bans & the auto-shield

Admins can keep an address, a client or a creator out of **every** service — the site, the API, the
hosted repos, the bot's endpoints — from **Admin → Roles & access → Bans & shield**. It is separate
from a per-repo access policy: this is the front door.

## What you can ban

- **IP addresses and ranges** — a single address or a CIDR range.
- **User-agent fragments** — a substring; a client whose UA contains it is refused.
- **BMM creator ids** — the id an app sends as \`X-Creator-ID\`.

One entry per line, an optional note after a \`#\`. Changes apply within about fifteen seconds — no
restart.

## The automatic shield

The shield blocks an address on its own after it is rate-limited too many times in a short window —
cheaper than answering it. Known scanners and attack tools are refused before this. You set how many
strikes and for how long, and can block or lift an address by hand from the same screen.

:::note[This is the application layer]
A volumetric flood has to be absorbed **before** it reaches the server — a CDN or the VPS provider's
DDoS protection — with the edge (Caddy) connection limits between the two. The shield handles abusive
clients, not a network flood.
:::`,
    bodyFr: `::toc[Sur cette page]

# Bans du site & bouclier automatique

Les admins peuvent tenir une adresse, un client ou un créateur hors de **tous** les services — le
site, l'API, les dépôts hébergés, les endpoints du bot — depuis **Admin → Rôles & accès → Bans &
bouclier**. C'est distinct d'une politique d'accès par dépôt : c'est la porte d'entrée.

## Ce qu'on peut bannir

- **Adresses IP et plages** — une adresse seule ou une plage CIDR.
- **Fragments de User-Agent** — une sous-chaîne ; un client dont le UA la contient est refusé.
- **Identifiants créateur BMM** — l'id qu'une app envoie en \`X-Creator-ID\`.

Une entrée par ligne, une note optionnelle après un \`#\`. Les changements s'appliquent en une
quinzaine de secondes — sans redémarrage.

## Le bouclier automatique

Le bouclier bloque seul une adresse après qu'elle a été limitée trop de fois en peu de temps — moins
cher que de lui répondre. Les scanners et outils d'attaque connus sont refusés avant. Tu règles le
nombre de coups et la durée, et tu peux bloquer ou lever une adresse à la main depuis le même écran.

:::note[C'est la couche applicative]
Une inondation volumétrique doit être absorbée **avant** d'atteindre le serveur — un CDN ou la
protection anti-DDoS du fournisseur VPS — avec les limites de connexion de la bordure (Caddy) entre
les deux. Le bouclier gère les clients abusifs, pas une inondation réseau.
:::`,
  },
];

const run = async () => {
  let created = 0, updated = 0;
  let translated = 0;
  for (const pg of PAGES) {
    const existing = await p.docPage.findUnique({ where: { slug: pg.slug } });
    // A page's own inline `bodyFr` wins over the table: api-reference carries its French
    // beside its English on purpose (the two are read together when the API changes), and
    // this must not quietly replace it.
    const fr = DOCS_FR[pg.slug] || {};
    const data = {
      title: pg.title, category: pg.category, icon: pg.icon, body: pg.body, order: pg.order, published: true,
      bodyFr: pg.bodyFr ?? fr.body ?? null,
      // Inline wins for the TITLE and CATEGORY too, not only the body. A page could already
      // carry its French body beside its English; discarding an inline French title while
      // honouring an inline French body is the kind of asymmetry that gets found by a French
      // reader seeing an English heading over French text.
      titleFr: pg.titleFr ?? fr.title ?? null,
      categoryFr: pg.categoryFr ?? fr.category ?? null,
    };
    if (data.bodyFr) translated++;
    await p.docPage.upsert({ where: { slug: pg.slug }, update: data, create: { slug: pg.slug, ...data } });
    existing ? updated++ : created++;
  }
  // Loud rather than silent: a page with no French entry is invisible to a French reader as
  // "untranslated", it just shows up in English with no sign that anything is missing.
  const missing = PAGES.filter((pg) => !(pg.bodyFr ?? DOCS_FR[pg.slug]?.body)).map((pg) => pg.slug);
  if (missing.length) console.warn(`docs seed: no French body for ${missing.length} page(s): ${missing.join(', ')}`);
  // Drop leftover pages from the old structure: the scratch page, the features overview
  // (superseded by Introduction + it referenced admin-only telemetry), and the catalog
  // overview (superseded by the new Publishing page). 'api-reference' is kept — it's a
  // real public API reference, not an admin topic.
  await p.docPage.deleteMany({ where: { slug: { in: ['test', 'features', 'catalog-formats'] } } }).catch(() => {});
  console.log(`docs seed: ${created} created, ${updated} updated, ${PAGES.length} total, ${translated} with a French body.`);
  await p.$disconnect();
};
run().catch((e) => { console.error(e); process.exit(1); });
