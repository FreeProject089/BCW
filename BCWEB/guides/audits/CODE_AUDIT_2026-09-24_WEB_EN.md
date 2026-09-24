# Code audit, web, Sept 24 2026

Scope: `apps/web`, `packages/bmd`, `packages/bmd-editor`, `packages/studio`. Companion to the
"Full audit, Sept 24 2026 (web)" section of `SECURITY_AUDIT.md`, which holds the five security
findings (W1 to W5) and their tests. This file is the code, performance and maintainability half:
what was changed, what was measured, and what is left, most useful first. Nothing committed.

## Measured starting point

| | |
|---|---|
| First-load JS (budget 300 KB gzip) | 239 KB: entry 146 KB (budget 190) + `showcase` modulepreload 93 KB |
| French visitors, in addition | `i18n-fr` chunk 265 KB gzip (845 KB raw) |
| Admin chunk | 2.0 MB raw, 566 KB gzip, one module: `pages/admin.jsx`, 25,660 lines, 221 top-level components |
| Tests / gates | 542 web tests; `lint` chain of 36 checks plus the tests; `i18n:check`, `css:check`, `legal:check`, `build`, `budget` all green |
| `npm audit` (prod) | 1 advisory, `maplibre-gl`, already judged unreachable (SECURITY_AUDIT F10-14) |

## Changed in this pass (behaviour unchanged unless stated)

### 1. The dashboard no longer downloads the admin screen (performance, 559 KB gzip per member)

`pages/dashboard.jsx` loaded two member-facing tabs with
`lazyNamed(() => import('./admin.jsx'), 'OwnerCatalogs' | 'MyReports')`. A lazy import of a
module pulls its whole chunk, so a member opening "My catalogs" or "Reports" fetched the entire
admin screen (559 KB gzip, and a readable map of every staff route) to draw one list.

- `OwnerCatalogs`, `OwnerCatalogItems`, `OwnerCatalogAccess`, `CatalogSyncPassword` →
  `pages/owner-catalogs.jsx` (5.8 KB gzip chunk).
- `MyReports`, `ReportThreadModal`, `ReportPeoplePanel`, `REPORT_STATUS_TONE`,
  `REPORT_TARGET_ICON` → `pages/my-reports.jsx` (4.3 KB gzip chunk). `admin.jsx` imports
  `ReportThreadModal` and `REPORT_TARGET_ICON` back for the staff report queue.
- `fmtBytes` and `fmtAgo`, private helpers of `admin.jsx` both groups needed, → `lib/format.js`
  (exported, same bodies); `admin.jsx` imports them.

How it was done, so it can be repeated: a script moved each top-level declaration byte for byte
with its leading comment, refused to move anything that used an `admin.jsx` name not moved with
it, wrote the new module's imports from `admin.jsx`'s own import lines (only the names used), and
imported back into `admin.jsx` the names still used there. Checked by `eslint` (`no-undef`,
`react/jsx-no-undef`), `check-lazy-named`, `check-undefined-jsx`, the build, and by grepping the
built `dashboard` / `owner-catalogs` / `my-reports` chunks for any reference to the admin chunk
(none). The gates that read `admin.jsx` by name (`check-settings-pointers`, `check-usage-parts`,
`check-capabilities`, `check-guide-coverage`) were checked first: none of them reads the moved
code. Budget unchanged (entry 147 KB, first load 239 KB). `admin.jsx` is 25,127 lines after.

### 2. One safe renderer for translated sentences with markup

`lib/rich-text.js` (`<RichText text={t(…)} />`) replaces five `dangerouslySetInnerHTML={{ __html:
t(…) }}` (W2). It is also the answer for the next string that needs a `<b>`: no new
innerHTML sink is allowed by `test/rich-text.test.mjs`, which sweeps `src` and the three packages
and accepts only the named escaping producers.

### 3. One rule for `?next=`

`lib/next-path.js` `nextTarget()` is now the only place the sign-in page decides where to go
afterwards (three hand-written `startsWith('/')` checks before, one of them with a blanket `/api/`
real navigation). W4.

### 4. Smaller things

- `ReplayPlayer` fetches cookieless; `DocReplay` passes a vetted URL (W3).
- KaTeX: `maxSize: 20` and paint containment per formula run (W5).
- The 2FA step names the API's new per-account lock (`auth.2faLocked`, with FR), without offering
  a backup code the lock would also refuse.

## Remaining improvements, most useful first

### A. `admin.jsx` (25,127 lines, 221 components): carry on the extraction, in this order

The file already imports ~40 `admin-*.jsx` modules; the pattern works. Candidates measured with
the same dependency script (components whose code uses NO other `admin.jsx` top-level name, so
the move is mechanical): `AdminHostingPlans` (331 lines), `ProjectVersionHistory` (218),
`AdminNewsletter` (196), `MailGallery` (182), `LegalPagesManager` (172), `UserExtras` (170),
`AdminExpenses` (165). Next tier, each with a short list of helpers to move along:
`AdminServerPerf` (862 lines; 17 helpers: charts, thresholds, formatters),
`AdminSiteTheme` (468; 5), `AdminFooter` (341; 5), `AdminAssets` (313; 7).

Two rules learned here: (1) do not move code that a gate reads out of `admin.jsx` by text
(`<SettingsPointer keys=…>`, `ADMIN_CAPS`, the `{ id: '…', label: t('adm.tab…` sidebar
literal, the backup usage panel) without pointing that gate at the new file in the same change,
or the gate goes on passing while reading nothing; (2) run `npm run budget` after each move: a
module imported by an eager page AND a lazy one can drag a whole page into the entry chunk (see
the `bcweb-entry-chunk-hoist` note).

Splitting does not change what an admin downloads (the admin page imports all of it); it changes
what a reviewer has to hold in their head, and it is what made item 1 possible.

### B. The French dictionary: 265 KB gzip for every French visitor

`i18n-fr.js` is 845 KB raw, fetched in parallel with the entry by every French visitor (on top of
the 239 KB first load). `i18n:check` reports **1,779 dead FR keys** (in the French dictionary,
never used by a literal `t('key')`). They were NOT removed here: template-built keys
(`t(\`cst.preview.why.${r}\`)`) are invisible to a static scan, and deleting a key that one of
them builds would silently switch that line to English. Suggested route: extend
`check-dynamic-i18n.mjs`'s prefix list into an allow-list of dynamic prefixes, delete the dead
keys outside those prefixes, and let `i18n:check --strict` confirm nothing used went missing.
A second, independent option: split the dictionary by area (admin strings are most of it and only
staff read them), loaded with the page that uses them.

### C. Dead code, measured (exported, and named nowhere else in `src`, `test` or `scripts`)

- **`pages/admin-fingerprint.jsx` (`AdminFingerprint`, 188 lines) is never mounted.** Its header
  says "Admin → Accounts → Creator IDs", the API routes exist (`routes/admin-fingerprint.mjs`,
  audited, audit-logged), and no sidebar entry or import reaches the screen. Either wire it in
  (owner decision: it is a moderation tool) or delete it.
- **The studio `replay` block draws nothing**: `canvas-view.jsx` renders
  `<div data-replay=…>` and no code reads that attribute, while the comment says the docs' player
  plays it. Wire `ReplayPlayer` (with W3's URL policy) or drop the block from the palette.
- 24 more unused exports: `App.jsx` `UTIL_KEYS`, `NAV_ICON_NAMES`, `MOBILE_MENU_DEFAULT`;
  `hero/scene-config.js` `TRANSITION_TRIGGERS`, `TRANSITION_STYLES`; `hero/scene-shapes.js`
  `SCENE_SHAPES`; `i18n.jsx` `LANG_SELECTOR_TYPES`; `lib/hosting-settings.js` `hsGroupKey`,
  `hsGroupDescKey`; `lib/leave-guard.js` `hasDirtyGuard`; `lib/navLayout.js` `pillDensity`,
  `labelClass`, `iconClass`; `lib/patterns.js` `PATTERN_IDS`; `lib/pwa.js` `purgeCaches`;
  `lib/reports-unseen.js` `refreshReportsUnseen`; `lib/shortcuts.js` `shortcutById`;
  `lib/stack-layout.js` `isStackKind`; `pages/admin-tasks-vocab.jsx` `TERMINAL`;
  `pages/charity.jsx` `CHARITY_CLASS_SLOTS`; `pages/contact-triage.js` `requiredFields`;
  `pages/dev.jsx` `devCards`; `pages/discord-pickers.jsx` `roleName`; `pages/project.jsx`
  `TL_KIND_KEYS`; `ui/theme-tokens.js` `TOKENS_BY_NAME`. Each is small; some may be kept as a
  documented API of a module (the `navLayout` class helpers look like it). Worth one pass by
  someone who knows which are intended.

### D. Render-side link safety (security hardening, owner decision)

About 70 `href={value}` sinks trust the API to have refused `javascript:` at write. That holds
today (`httpUrl`, `configLinkProblems`, `check-url-schemas.mjs`), but one missed field is XSS
because React 18 only warns and the CSP allows inline script. A `safeHref()` in the shared
`<a>`-rendering components (`ui.jsx` `ActionBar`/menus, `feed-link.jsx`, the project page) or
the move to React 19 would turn that into a dead link.

### E. Build-time dependencies

`npm audit` (dev): `browserslist`, `js-yaml`, `baseline-browser-mapping`, all build-time with
trusted input. `npm audit fix` (no `--force`) clears them; not run here to avoid moving the
lockfile under the other agent's builds.

### F. First load: `showcase` is preloaded on every page (93 KB gzip)

The `manualChunks` rule that fixed the entry hoist (Aug 27) names `showcase`, and it is now a
modulepreload of the entry: 93 of the 239 KB first-load bytes. If the showcase only draws on the
landing pages, preloading it everywhere costs every deep link 93 KB. Worth measuring which import
makes it a static dependency of the entry before changing anything (sourcemap `sources` diff, the
method in the `bcweb-entry-chunk-hoist` note).

## What was verified, and how

`npm run lint` (all 36 checks + 544 tests), `npm run --silent i18n:check`, `npm run css:check`,
`npm run legal:check`, `npm run build`, `npm run budget`: all green after the changes. The
extraction was checked by lint + build + chunk inspection, not in a browser. The KaTeX fix was
measured in Chromium (geometry and hit-testing; the tab was hidden, so paint was not observed).
