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

The manifest declares \`id\`, \`name\`, \`version\`, \`author\`, \`description\`, \`game\`, \`permissions\`, and how it applies (\`scripts\`, \`folders\`, \`apply_mode\`) — plus an optional \`modlist\`.

:::warning[Permissions are a fixed set — and they're shown to users]
A plugin requests capabilities from the API's real permission set (\`mods.write\`, \`profiles.write\`, \`modpacks.write\`, \`plugins.read\`/\`write\`, \`catalog.read\`/\`write\`, \`app.read\`/\`write\`, \`repo.write\`) — **not** free-form things like "network" or "files". Request only what you use; the user grants each one. See the [API reference](/docs/api-reference).
:::

:::danger[Both checksums are validated]
The catalog entry's \`sha256\` covers the whole \`.bmmplug\`; \`checksums.json\` covers each file inside. If either fails, BMM flags the plugin **invalid** and recommends not installing it. Catalog plugins are always validated.
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

The manifest carries \`id\`, \`name\`, \`author\`, \`version\`, a \`tokens\` map of \`--bmm-*\` CSS variables, and optional per-selector \`overrides\`.

:::tip[Don't hand-write it]
Export a theme from the in-app **[Theme Editor](/docs/themes)** — it writes a valid \`theme.json\`. Then publish via **Dashboard → Submit content** (Project **BMM**, Type **Theme**). Installing applies instantly and is reversible.
:::`,
  },
  {
    slug: 'preset-catalog', category: 'BetterCommunity', title: 'Preset catalog (BSM)', icon: 'sliders', order: 305,
    body: `# Preset catalog · BSM

A BSM preset is a **single JSON file** — no ZIP, no separate manifest. Its metadata lives inside the file.

## Fields

| Field | Required | Meaning |
|---|---|---|
| \`name\` | yes | Preset name. |
| \`version\` | yes | Semantic version. |
| \`assetPaths\` | yes | The asset paths the preset drives. |
| \`color\` | no | Accent colour. |
| \`UpdateNumber\` | no | Revision counter. |
| \`date\` | no | Publish date. |

:::tip[Publishing]
Submit via **Dashboard → Submit content** (Project **BSM**, Type **Preset**). On the catalog, users can download, multi-select download, and sort by *popular (all-time / month)*, *newest* or *most viewed* — every download counts toward your stats.
:::

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

Read endpoints allow 120 requests per minute; key management and writes allow 30.
 \`/v1/me/repos\` and \`PATCH /v1/me\`. It has no scopes and is stored in clear, so it is kept only so existing scripts do not break.

Those responses now carry \`Deprecation: true\` and, where there is one, a \`Link\` header naming the successor — \`/v1/me\` → \`/v1/account\`, \`/v1/me/repos\` → \`/v1/repos\`. **Use a key for anything new**, and revoke the old token once nothing depends on it.`,
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
      titleFr: fr.title ?? null,
      categoryFr: fr.category ?? null,
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
