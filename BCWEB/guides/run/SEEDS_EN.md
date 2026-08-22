# Seeds — what each one puts in the database

A fresh BCWEB database is empty: no projects, no admin, no hosting plans, no docs, no
catalog. The seeds fill it. There are several because they answer different questions, and
running the wrong one is how you end up with a site that looks finished and is not.

**Every seed is idempotent.** They upsert by a stable key (slug, email, project key), so
re-running one refreshes its content rather than duplicating it. That is what makes them
usable as repair tools and not only as a bootstrap.

Run them inside the API container:

```bash
docker compose -f infra/compose/docker-compose.yml exec api npm run seed
```

Or from `apps/api/` with `DATABASE_URL` set, if you are running the API on the host.

---

## At a glance

| Command | Script | Writes | Safe on a live site? |
|---|---|---|---|
| `npm run seed` | `apps/api/src/seed.mjs` | `Project`, `User` (the admin), `HostingPlan`, `AdminSetting`, `Badge`, `BlogPost` | **Read the warning below** |
| `npm run seed:content` | `apps/api/src/seed-content.mjs` | nothing itself — runs the four below, in order | Yes |
| `npm run seed:docs` | `apps/api/src/seed-docs.mjs` | `DocPage` (BMM's user documentation, EN + FR) | Yes |
| `npm run seed:faq` | `apps/api/src/seed-faq.mjs` | `FaqItem` | Yes |
| `npm run seed:site` | `apps/api/src/seed-site-guide.mjs` | `DocPage` (the "Using the site" tour) | Yes |
| `npm run seed:demo` | `apps/api/src/seed-demo.mjs` | `CatalogItem`, `User`, `Project` | **Dev only** |

Two files in that directory are **not** runnable seeds — they are translation data
imported by the seeds above, and running them directly does nothing:

- `apps/api/src/seed-docs-fr.mjs` — French bodies for the seeded doc pages, keyed by slug.
  Imported by `seed-docs.mjs`.
- `apps/api/src/seed-blog-fr.mjs` — French for the seeded blog posts. Imported by `seed.mjs`.

They live beside their English halves rather than inside them because a translation is
reviewed as a whole: you want to read the French pages in a row, not hunt for them between
backticks.

---

## The one with a warning on it: `npm run seed`

This is the bootstrap. It creates the platform itself — the fixed projects, the hosting
plans, the default admin settings, the badges, the news posts — and **an administrator
account**.

If `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are not set, it falls back to
`admin@bettercommunity.local` with a password that is **in the repository**. On a laptop
that is the point of a default. On a production database it is a working administrator
account for anybody who has read this repo.

There is a guard: with `NODE_ENV=production` and no `SEED_ADMIN_PASSWORD`, the seed
refuses to run and says why. It protects the case it can see. It cannot see a staging box
that forgot to set `NODE_ENV`, or a machine that is "temporarily" reachable — so set the
two variables and do not rely on the guard.

So, before the first seed on anything that is not your own machine:

```bash
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='<something long>' npm run seed
```

`infra/bootstrap.sh` puts these in the environment before it seeds, for the same reason.
Setting them *after* the seed has run does nothing — the account already exists with the
password it was created with.

---

## The content set: `npm run seed:content`

One command to put the site's written content back after a wipe, in the right order:

1. `seed.mjs` — base: admin, projects, hosting plans, blog posts
2. `seed-docs.mjs` — documentation pages (EN + FR)
3. `seed-faq.mjs` — FAQ entries
4. `seed-site-guide.mjs` — the site guide

It stops at the first failure and says which step stopped it, leaving the rest unrun. That
is deliberate: a half-seeded site is worse than an unseeded one, because it looks finished.
Every step is idempotent, so fixing the failing step and re-running the whole thing is
safe.

### Why the docs come in two seeds

`seed:docs` documents **BMM, the desktop app**. `seed:site` documents **the website** —
the catalog, the repo browser, the hosting page, the dashboard, and how they relate. Both
write `DocPage` rows; they do not overlap, and a first-time visitor needs the second one
as much as the first.

---

## Dev only: `npm run seed:demo`

Catalog items whose *shape* matches production, so a fresh dev stack has something to
render and the load harness in `loadtest/` has something to render it against. `seed.mjs`
creates no catalog items at all, so without this the catalog page is empty.

It creates demo users and items. Do not run it against a site real people use — you cannot
tell demo content from real content once it is in the list.

---

## After a wipe

`npm run clear-content` empties user content (repos, catalogs, items). It does not remove
the platform: projects, plans, settings and the admin survive. So the usual recovery is:

```bash
npm run clear-content   # then, to put the written content back:
npm run seed:content
```

`npm run nuke` goes further. Read what it says before answering it.
