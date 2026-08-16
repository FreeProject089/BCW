# What is left — four items

The previous batch is finished. These are what remain from the one after it, each with what is
already known so the next session does not re-investigate.

**Done since this file was last rewritten:** the scheduler as a language (reusable blocks,
`a2041da`) · the catalogue panel opening on click and wearing the house modal (`dd6aa23`,
`35948c2`, `cfc8590`, `a506d69`) · undo on deleting a landing review (`7d988d3`) · dev tools
grouped by purpose (`f2d30f2`) · poll scales as stars or buttons (`8ff43e4`) · poll ranking,
storage and UI (`c6e8e04`, `602d3d8`).

---

## 1. Grid questions — designed, not built

The whole design is in `POLLS_V2_DESIGN_EN.md` under "Grids". The short version: no migration is
needed. `choiceId` + `number` in one row, meaning fixed by kind — column + row for a grid, the
same shape ranking already uses. Rows are labels in `config.rows`.

Build it the way ranking was: `validateGrid` as a whole-submission check first, with tests, then
the endpoint branch, then the editor and the renderer in the same commit as each other.

## 2. Follow a catalogue INDEX

Asked for across all four catalogues — apps, plugins, themes, automations. Today each one follows
individual catalogue URLs; the ask is to follow an index that lists catalogues, so adding a
source adds everything it points at.

**Not investigated yet.** Start by finding whether the four catalogue browsers share a source
list or each keep their own — that answers whether this is one change or four. The automations
one is `showPresetCatalog` / `loadPresetSources` in `frontend/src/features/settings/scheduler.ts`
(BMM); the theme one is `frontend/src/features/themes/theme-catalog.ts`.

## 3. Dev tools for BetterInstaller

Half done: `dev-tools.jsx` now reads a `GROUPS` list that drives both the jump nav and the
sections, so a new category is one entry rather than edits in three places. The tools themselves
do not exist — decide what an installer developer actually needs (a manifest validator? a handoff
payload builder?) before adding a group for them.

## 4. mkdocs for BetterInstaller

Like BMM Docs. Nothing exists. BMM Docs is the model to copy — `BMM Docs/mkdocs.yml`, bilingual
pages under `docs/`, and `scripts/sync-docs.mjs` if the in-app reader should carry them too.

---

## Two things that will waste your time if you do not know them

**The web container serves a bundle baked into its image.** No volume mount. `npm run build` on
the host does NOT reach the running site — the served bundle stays whatever was there when the
image was made. `docker cp apps/web/dist/. bcweb-web-1:/usr/share/nginx/html/` is what makes a
change visible, and without it a browser check tests the wrong code and looks like a bug in your
work.

**The API test suite needs Postgres reachable and Redis unset.** 5432 is published on loopback
now, so `DATABASE_URL=…@127.0.0.1:5432/bcweb npm test` from `apps/api` matches CI. Two failures
are expected and unrelated: `rollup` wants a fresh database (this one has
`AdminSetting['analytics.rollupAt']` because the server has run) and one sandbox scope test.
