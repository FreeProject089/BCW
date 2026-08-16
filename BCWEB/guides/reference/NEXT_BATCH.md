# What is left

The previous version of this file listed four items. **Two of them were already built** — I had
written them down as "not investigated" and "nothing exists", and both were wrong. Check before
building is the whole lesson of the last two sessions, and this file was itself the counter-example.

---

## Done since the last rewrite

**Grid questions** (`859fd5b`). The design claimed no migration was needed; it was wrong, and the
reason was the unique key rather than the columns. `PollAnswer` gained `slot`. Proved rather than
argued: with the old key back in place, the normal case stored 1 of 2 rows. Full write-up in
`POLLS_V2_DESIGN_EN.md`.

**A question's options could never be edited** (`71af580`). The update branch of
`PUT /admin/polls/:id/questions` wrote everything except `choices`, so fixing a typo in an option
meant deleting the question and its answers. Now planned, refused when it would destroy answers,
and the refusal names the option.

**The catalog index** (BMM `610eef2`). Not "not investigated" — already built, at
`features/catalogs/catalog-index.ts` + `initCatalogIndexSettings()`. Two defects in it, both one
rule written twice: the preview compared against a hand-written list naming plugin and theme only,
and the preview's dedupe lowercased while the writer's did not.

**mkdocs for BetterInstaller.** Already exists: 24 bilingual pages under `BetterInstaller/docs/`,
`mkdocs.yml` on the same mkdocs-material + static-i18n stack as BMM Docs. Verified — builds clean
under `--strict` in both languages. Nothing to do.

---

## 1. Dev tools for BetterInstaller — the only item genuinely left

`dev-tools.jsx` reads a `GROUPS` list driving both the jump nav and the sections, so adding a
category is one entry. The tools themselves do not exist.

**The obvious one is a recipe validator** — paste an `installer.toml`, get back the keys the
schema silently drops. That failure is real and already documented: no struct in
`crates/bpkg-core/src/config.rs` uses `deny_unknown_fields`, so `[[componentss]]` builds an
installer with no components and nothing errors or warns. There is already a Rust test doing
exactly this check (`config.rs:751`), including a `KNOWN_DEAD` ratchet.

**Do not reimplement the schema in JavaScript.** That is the trap this codebase keeps falling
into — a second copy of a rule that agrees until it doesn't, and a stale checker reporting
nothing reads exactly like a clean one. The Rust test already derives the key set by
round-tripping the parsed config *rather than listing it*, and that derivation is the thing to
reuse.

Sketch, in build order:

1. `bpkg-cli schema --json` emitting the derived key set, using the same round-trip as the test.
2. Commit the output as an artifact in BetterInstaller, with a CI check that it matches what the
   CLI emits — so it cannot rot.
3. BCWEB's `/dev/validate-recipe` reads that artifact. It parses TOML and compares keys; it never
   restates the schema.

Note the round-trip goes through **JSON, not TOML**: `toml::Value::try_from` refuses an unset
`Option` with `UnsupportedType("unit")`, and JSON represents it as `null` — which is exactly what
"a key the schema knows and the recipe never sets" should look like.

---

## 2. Smaller things noticed and not done

- **`bmm_catalog_origins` provenance is re-stamped on re-import**, even for a source that was
  already followed, so the origin points at whichever index was imported last rather than the one
  it actually came from. `settings.ts`, in the import loop.
- **Only the Apps browser probes for a pasted index** in its plain source box
  (`apps-catalog.ts:942`, dynamic `looksLikeIndex`). Plugins, Themes, Scheduler and Repo have no
  such check, so pasting an index URL there follows a document none of them can read.
- **Origin badges are wired in three of five browsers.** `plugins.ts` and `theme-catalog.ts`
  import nothing from `catalog-index.ts`.
- **Deep links write the raw localStorage keys directly**, bypassing every helper —
  `core/deep_link_manager.ts:427`. Whatever rule the helpers enforce, that path does not.

---

## Two things that will waste your time if you do not know them

**The web container serves a bundle baked into its image.** No volume mount. `npm run build` on
the host does NOT reach the running site. `docker cp apps/web/dist/. bcweb-web-1:/usr/share/nginx/html/`
is what makes a change visible, and without it a browser check tests the wrong code and looks like
a bug in your work. **The API container is the same** — it runs code copied in at build time, so a
route change needs `docker compose build api && docker compose up -d api`, and a schema change
needs it too or Prisma will reject the new field.

**The API test suite needs Postgres reachable and Redis unset.** 5432 is published on loopback, so
`DATABASE_URL=…@127.0.0.1:5432/bcweb npm test` from `apps/api` matches CI: **376/378, 0 skipped**.
The two failures are expected and unrelated — `rollup` wants a fresh database (this one has
`AdminSetting['analytics.rollupAt']` because the server has run) and one sandbox scope test.

**Admin screens need `totpEnabled`.** Every admin write goes through `ensure2fa`, so a staff
fixture without that flag gets a 403 that looks exactly like a broken session cookie. It cost a
full round of red assertions to notice.
