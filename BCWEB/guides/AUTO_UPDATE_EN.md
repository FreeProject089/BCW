# Auto-updates — how BMM & BSM update, and how to host them on BCWEB

*How the desktop apps check for and apply updates, how to cut a release, and how to serve
updates from **BetterCommunity (BCWEB)** instead of (or alongside) GitHub. 🇫🇷 [Version FR](AUTO_UPDATE_FR.md).*

---

## 1. How BMM's updater works

BMM checks an **`autoupdate_api`** endpoint that returns data in the **GitHub Releases API
shape**. The URL comes from `links.json` (`autoupdate_api`), so it's editable without
recompiling — see [ARCHITECTURE.md](ARCHITECTURE_EN.md) and the links loader.

On check (`check_for_update` in `src-tauri/src/commands/autoupdate.rs`):
1. Fetch the latest release (`{api}/latest`, or the list when pre-releases are enabled).
2. Read `tag_name` → the latest version; compare with the running version.
3. In the release **assets**, find:
   - the installer — `*.msi`, else `*.exe` / `*.zip` → **`download_url`** (full install);
   - **`update-manifest.json`** → **`manifest_url`** (optional **incremental** update).
4. If newer: either apply the **incremental** update (download only the changed files listed
   in the manifest, each verified by SHA-256 + a path-traversal guard) or download and run
   the **full installer**.

So there are two moving parts per release: **the installer** (always) and an optional
**`update-manifest.json`** (for fast, small incremental updates).

## 2. Cutting a BMM release

1. Bump `version` in `src-tauri/tauri.conf.json`.
2. Build the app (your normal Tauri build → produces the `.exe` / `.msi` installer).
3. Generate the incremental manifest + loose assets:
   ```bash
   node scripts/gen-update-manifest.mjs            # uses tauri.conf.json version
   # or: node scripts/gen-update-manifest.mjs --version 1.2.3
   ```
   Output lands in `dist/release-assets-v<version>/` (`update-manifest.json` + the tracked
   loose files, e.g. `lang-en.json`).
4. Publish the release with these assets attached — either on **GitHub** (tag `v<version>`)
   or on **BCWEB** (§3).

## 3. Serving updates from BCWEB (instead of GitHub)

BCWEB exposes a GitHub-Releases-compatible feed built from a hosted installer, so you can
point `autoupdate_api` at BCWEB:

| Endpoint | Returns |
|---|---|
| `GET /api/updates/bmm/latest` | the latest release (GitHub `/releases/latest` shape) |
| `GET /api/updates/bmm/releases` | a one-element release list (GitHub `/releases` shape) |

(`bsm` and `bi` work the same way.)

**Setup (Admin → Downloads & assets):**
1. Upload the installer to the **`bmm-installer`** slot; set its **version** and **channel**
   (`stable`, or anything else → treated as a *pre-release*).
2. *(Optional)* upload/paste **`bmm-update-manifest`** (JSON) for incremental updates, and
   **`bmm-release-notes`** (`{ "body": "…" }`) for the notes shown in-app.
3. In the **`links.json`** asset, set:
   ```json
   "autoupdate_api": "https://bettercommunity.ch/api/updates/bmm/releases"
   ```
   BMM reads `links.json` **BCWEB-first**, so every client picks this up with no recompile.

:::note
If BCWEB is unreachable, `links.json` itself falls back to the GitHub copy then the bundled
local copy — so a BCWEB outage never bricks the updater; it just uses the last-known links.
:::

**Incremental note:** the file URLs inside `update-manifest.json` must be reachable. If you
host on BCWEB and want incremental updates, host the loose files as assets too and point the
manifest entries at them; otherwise omit the manifest and BCWEB serves **full-installer**
updates (which always work).

## 4. BSM auto-updates

BSM releases live at **https://github.com/FreeProject089/Better-Sound.Maker/releases**. Two
options, mirroring BMM:
- **GitHub (simplest):** point BSM's update endpoint at
  `https://api.github.com/repos/FreeProject089/Better-Sound.Maker/releases` and attach the
  installer to each GitHub release.
- **BCWEB:** upload the BSM installer to the **`bsm-installer`** slot (version + channel) and
  point BSM at `https://bettercommunity.ch/api/updates/bsm/releases`.

## 5. Verify it works

- Hit `https://bettercommunity.ch/api/updates/bmm/latest` in a browser — you should get JSON
  with `tag_name`, `assets[].browser_download_url`, `prerelease`.
- In the app, run the "Check for updates" action; the log line
  `[UPDATE] …` shows the source and result.
- Bump the hosted `version` above the app's version and confirm the app offers the update.

:::tip[Keep GitHub as a fallback]
Even when serving from BCWEB, keeping a GitHub release as a mirror is cheap insurance —
just change `autoupdate_api` back if you ever need to.
:::
