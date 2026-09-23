# Codebase maps

Eight read-only maps in **Admin → Moderation**. Each reads the source (or, for one, this
instance's own environment) and prints a structure. They are closed by default and fetch on
first open — a page used every day should not pay for tools opened twice a year.

All eight are `requireRole('ADMIN')`, which means 2FA as well.

They exist because the answers below were all *derivable* from the code and none of them was
*written down anywhere* — so each was a thing somebody had to remember correctly.

!!! warning "Counts in this page are either pinned or dated, never just quoted"
    Every figure below is one of two kinds. A **pinned** figure is one somebody would act on,
    and it lives in the table at the bottom, "Figures this document pins", which
    `apps/api/test/codebase-maps-doc.test.mjs` re-derives from the builders on every test run:
    if the code moves and this page does not, the suite goes red and names the row.

    Everything else is a **snapshot**, written as "measured 2026-09-17" and true only of that
    day. A count of routes or models tells you the order of magnitude and nothing more, and an
    earlier version of this page quoted a route total that had drifted by four hundred while
    reading as current fact. Where a number was only ever decoration, this page now says what
    the map *means* instead.

---

## Which guard protects which route — `GET /admin/rbac-map`

Every `app.get|post|put|patch|delete('/path'` in `apps/api/src/routes`, read from the route
files themselves, so it cannot drift from the code the way a document does. Seven guard forms
are recognised (`requireRole`, `requireCap`, `optionalAuth`, `apiAuth`, `resolve`,
`oauthBearer`, `requireEditor`). Measured 2026-09-17: 1080 routes across 71 files.

The number to read is **suspicious**: an `/admin` or `/me` route with no guard and no entry
in the public-by-design list. Measured 2026-09-17 it is **1**, and that one is `GET /me`,
which is `optionalAuth` and correct.

It was 51 the same morning, and what changed was the parser rather than the code. The story
is worth keeping, because it is how a security report stops being read.

!!! note "Why it said 51, and what it does now"
    The parser matches the guard as text in the six lines under the path. So
    `{ preHandler: requireCap('manage_rights') }` was seen, and this was not:

    ```js
    const CAP = { preHandler: requireCap('manage_reports', 'MOD') };
    app.get('/admin/rights/works', CAP, async (req) => { … });
    ```

    A file with one capability over twenty routes writes it once, which is good code and was
    invisible here. `rights.mjs` (`CAP`), `feedback.mjs` (`READ`), `tasks.mjs` (`board`),
    `content-backup.mjs` and `og.mjs` (`RACE_CAP`) are all that shape: exactly the fifty. The
    bot's endpoints were a second case, guarded by `botAuth` in the first line of the handler
    because the check needs the reply object, which put all fifty of them in the
    "writable by an unauthenticated request" list.

    `parseRoutes` now reads a file's own top-level guard constants and resolves a route's
    `preHandler` through them, and recognises the two in-handler guards whose failure branch
    returns. Measured over the real tree: routes reported unguarded fell from 257 to 116,
    suspicious from 51 to 1, and anonymous-writable from 83 to 32. The remainder is spread
    thinly, a handful per file, rather than whole subsystems at a time.

    Both mechanisms are deliberately narrow: same file, one level, no imports, and only the
    identifiers that appear as the route's options or as its `preHandler`. A constant it
    cannot resolve leaves the route exactly as it was, unguarded and reported. The map's
    failure mode is back to undercounting, which is the direction a reader can live with.

## The database, and the drift — `GET /admin/schema-map`

Draws the widest models and the most depended-on ones, and — the part that matters — the
**index drift**: an index created in raw SQL and never declared in `schema.prisma`. Measured
2026-09-17: 162 models, 135 relations, 483 declared indexes against 329 created by migrations.

That case is not cosmetic. The next generated migration proposes **dropping** it, because a
`migrate diff` believes the schema. It is pinned as `indexDrift` below, and it is zero.

!!! note "Postgres truncates identifiers at 63 characters and keeps the suffix"
    The middle is clipped, not the end. Comparing full names reported two false positives
    before that rule was applied.

## The migration history — `GET /admin/migration-map`

The schema map compares `schema.prisma` against the SQL. This is the other axis, and two of
its three answers need a live database:

- a migration recorded as **applied whose folder is gone**. Prisma re-validates a checksum per
  migration, so a deleted or renamed folder breaks `migrate deploy` on every machine *except*
  the one where it was deleted — which is what makes it hard to notice.
- a migration **started and never finished**, or rolled back. The database is then in a state
  no migration describes and the next deploy refuses to run at all.

And one the SQL answers alone: which migrations **lost data**. `DROP COLUMN`, `DROP TABLE` and
`DELETE FROM` cannot be undone by another migration, and knowing which release contained one
is the difference between a restore and a guess. Pinned as `dataLossMigrations` below, because
it is the one figure here somebody would act on. There are three, out of 126 folders on disk:

| Migration | What it did |
| --- | --- |
| `20260812090000_drop_legacy_api_token` | `DROP COLUMN` on `User` |
| `20260901160000_discord_member_storage` | `DELETE FROM` on `DiscordActivity`, `BotGuild`, `ModerationLog` |
| `20260923120000_task_board_links_suggestions` | `DROP COLUMN` `assigneeId` on `AdminTask`, after the same migration copied it into `assigneeIds` |

!!! note "A data migration is not a no-op"
    `INSERT`/`UPDATE` migrations write ROWS rather than change shape: they cannot simply be
    re-run, and a restore has to think about them. They reported "no operations" until they
    were given their own category, an empty result that reads exactly like a clean one.
    Measured 2026-09-17 there are nine such folders, carrying 3 `INSERT` and 8 `UPDATE`
    statements between them; read `totals.insertData` and `totals.updateData` in the response
    rather than a figure from this page.

A database failure degrades to the on-disk half rather than a 500, and `pending` stays empty
in that case. "126 migrations pending" from an unreachable database is a lie that reads as an
emergency.

## The stack and its ports — `GET /admin/compose-map`

Services, `depends_on` edges, start order, and **what is published to the network**.

Not a fault list — the edge proxy is *supposed* to publish 80 and 443. It is the list of
things reachable from outside the machine, which is a list somebody should be able to recite
and usually cannot. It is pinned as `publishedPorts` below and it is six entries, over eleven
services:

| Service | Published | Note |
| --- | --- | --- |
| `caddy` | `80`, `443`, `5176` | The edge. 80 and 443 are the point of it. |
| `api` | `3000-3009` | A **range**, not one port. |
| `minio` | `9000`, `9001` | Object storage and its console. |

`db` publishes `5432` bound to `127.0.0.1` only, which is why it is not on this list: the map
reads the bind address, and loopback is not the network.

!!! warning "The API publishes a range, so its host port moves"
    `3000-3009:3000` lets Compose scale the API, and it means the host port the API answers on
    is whichever one in that range was free when the container started. Anything that assumes
    3000 (a dev proxy, a curl in a runbook, a firewall rule written once) is right until a
    restart. Read the map, or `docker compose port api 3000`, rather than the first port in the
    range.

The last three rows above are published for convenience, and `run/DEPLOY_EN.md` §12 says the
firewall must close everything but 22/80/443 right after the first deploy, which is the point
of putting the same fact on a screen somebody looks at more than once.

!!! note "This answers inside the container now"
    It used to 404 on every deployed instance, because nothing copies `infra/` into the API
    image. The compose file now bind-mounts itself read-only at `/infra/compose/docker-compose.yml`,
    which is where the route's path resolution lands once the image has flattened the checkout.
    The 404 branch is kept for a deploy that ships only the image: "no ports exposed" would be
    the wrong answer said confidently.

## Secrets with a hardcoded fallback — `GET /admin/secrets-map`

Reads every `process.env` access across every `.mjs` under `apps/api/src` (202 of them,
measured 2026-09-17). `process.env.JWT_SECRET || 'dev'` means an instance deployed without
that variable does not fail — it signs tokens with a value anybody reading the repository
knows. It fails open, silently, and looks fine.

**Live fallbacks: zero.** That is pinned as `liveSecretFallbacks` below, and it is the one
number on this page worth the test on its own: it is a claim a reader would act on by *not*
looking, so it must never be able to go stale in the reassuring direction.

It was not always zero. The first pass reported eighteen fallbacks and called five of them
live: `LINK_LOOKUP_SECRET` in four files and `SEED_ADMIN_PASSWORD` in `seed.mjs`. Those are
fixed. `apps/api/src/lib/boot-guard.mjs` now declares three purposes (session tokens, Discord
bot authentication, telemetry and link lookup) and `server.mjs` refuses to boot when any of
them would run on the repository's own value. The count of fallbacks in the source has not
changed much (eighteen occurrences, measured 2026-09-17: fourteen `JWT_SECRET`, three
`LINK_LOOKUP_SECRET`, one `SEED_ADMIN_PASSWORD`); what changed is that all eighteen are now
guarded, and the map tells the two apart so the unguarded ones would stand out.

!!! warning "One limit worth knowing"
    The boot guard only runs when `NODE_ENV=production` is actually set. An instance that
    forgets it skips the whole check, and every fallback in the list goes live again at once.
    That is the single condition the "zero" above rests on.

**The fallback value is never returned** — only its `file:line`. It is in the source for
anyone who should be fixing it, and an API that hands out a signing key an instance may
actually be using would be worse than the finding it reports.

## Config vs `.env.example` — `GET /admin/config-diff`

The secrets map reads the source. Only a running instance can answer the other half: of
everything documented, what is unset here, and **what is still set to the example file's own
value**.

`POSTGRES_PASSWORD=change-me` copied verbatim into a deployed `.env` is the most common way a
Compose stack ends up with a credential that is in the repository, and nothing else would
notice — the app starts, the database connects, everything works.

For a **secret-ish name, matching the example is the finding**, regardless of how the value
looks. An earlier version only flagged values that *looked* like placeholders, and the dev
stack's `JWT_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` and `TELEMETRY_ADMIN_KEY` — all equal
to the example's values, none of them reading like `change-me` — were filed under "meant to
be copied".

**No value is ever returned**, only names and verdicts. A test asserts that on the real
output shape. An admin session must not become a way to read the instance's environment.

This page carries no count from this map, deliberately: its answer is a property of the
machine it runs on, so a figure here would describe one deployment and be read as describing
yours.

## Where the data goes — `GET /admin/data-flow`

Route → model → read/write, joined with the guard. Measured 2026-09-17: 1080 routes, 156
models, 1995 database calls, plus 406 calls sitting outside any route (sweepers, boot code,
helpers) which are reported separately because attributing them to the nearest route would be
a confident lie about who can reach them.

The model to watch is not the one you would guess. `user` is touched by 136 routes, but the
most touched model is `adminSetting`, at 126 routes and 184 calls: the settings table is read
on the way into almost everything, which is worth knowing before you change its shape.

The list to read is **what an anonymous request can write**. Measured 2026-09-17 it is 32
routes, and it is a list somebody can go through in a sitting. Most of it is deliberate and
always was: analytics ingestion, sign-up, email verification, password reset, the OAuth and
social callbacks, the Ko-fi webhook, newsletter double opt-in, Discord link codes, doc
feedback, status-page subscriptions.

It was 83 that morning, for the two reasons described under the RBAC map: guards held in a
constant, and the bot's `botAuth` checked in the first line of the handler because it needs
the reply object. `parseRoutes` reads both now, so the `/admin/tasks`, `/admin/rights`,
`/admin/feedback` and `/bot/*` families have left this list, which is 51 routes that were
never writable by a stranger.

!!! note "What `writableInHandlerGuard` is still for"
    Three routes, whose rejecting helper is declared in the same file and is not one of the
    two the parser knows by name: `POST /catalog`, `POST /oauth2/token`, `POST /oauth2/revoke`.
    The category exists precisely for the shapes the parser cannot see, and keeping it small
    is the point: when it grows, either a new guard idiom has appeared or one has moved.

!!! note "`selfRejects` is a fact, not a verdict"
    5 of the 32 reply 401 or 403 somewhere in their own body, and the map says so without
    deciding what it means. `/webhooks/kofi` `safeEqual`s a token and 401s before writing;
    `/auth/login/2fa` also 401s, on a failed password check, on a genuinely public endpoint.
    Identical shape, opposite meaning. The row carries the fact and no verdict is invented.

## What builds and ships this — `GET /admin/infra-map`

You asked for a Terraform state visualizer. There is no Terraform in any of the four
repositories — no `.tf`, no `.tfstate`, not a mention — so a reader for one would read a file
that does not exist. This answers the same question against what is really here.

A Terraform state says two things: what is declared, and what puts it there. The compose map
above is the first. This is the second — the GitHub Actions workflows, what each one
publishes (read from the ACTIONS it uses, never from its name), and which secrets a fresh
clone would need.

What it reports is **one workflow, five jobs, no secrets at all**: `BCW/.github/workflows/ci.yml`,
running `web-build`, `api-check`, `native`, `caddyfile` and `secret-scan` on push and on
pull_request. All three figures are pinned below. Nothing in CI needs a secret, so a
contributor on a fork can check their work, which is a one-line fact that otherwise lives only
in whoever set it up.

!!! warning "The release workflow is outside what this map can see"
    The route tries two directories, `BCWEB/.github/workflows` and `BCW/.github/workflows`,
    and stops at the first that answers. `release.yml` lives in the parent repository, above
    both, so this map has never reported it and does not claim to. An earlier version of this
    page said "`Release` is the only one that publishes anything", which was true of the
    repositories and was never what the screen showed. If you need to know what publishes a
    release, read that workflow; do not expect this card to mention it.

    Reading both directories instead of stopping at the first was also a bug once: in the
    image they resolve to the same path, and every workflow was counted twice.

!!! note "This answers inside the container now"
    Like the compose map, `.github/` is not copied into the API image, and the compose file
    bind-mounts `BCW/.github/workflows` read-only at `/.github/workflows` so the card works on
    a deployed stack. The 404 branch is kept for a deploy without that mount: "no workflows"
    would read as "nothing builds this".

---

## Figures this document pins

`apps/api/test/codebase-maps-doc.test.mjs` rebuilds each map from the source and compares it
against this table, in both language versions. A number here that stops matching the code is
a failing test with the row named in the message, not a sentence somebody has to notice.

Nothing volatile belongs here. Route, model and call totals move every week and are written in
the prose above as dated snapshots on purpose; a test that failed on every new endpoint would
be switched off within a month.

| Key | What it counts | Value |
| --- | --- | --- |
| `liveSecretFallbacks` | Secret-ish `process.env` reads with a hardcoded fallback and no boot guard | **0** |
| `dataLossMigrations` | Migrations containing `DROP TABLE`, `DROP COLUMN` or `DELETE FROM` | **3** |
| `indexDrift` | Indexes created by a migration and absent from `schema.prisma` | **0** |
| `publishedPorts` | Port entries reachable from outside the machine | **6** |
| `workflows` | GitHub Actions workflow files the map can reach | **1** |
| `workflowJobs` | Jobs across those workflows | **5** |
| `workflowSecrets` | Distinct secrets those workflows need | **0** |

## What these are not

Every one is **line-based and shallow** rather than a real parser. That is a deliberate
trade: the intended failure mode is reporting *fewer* routes, calls or edges than exist, which
shows up in a count, instead of inventing edges that send somebody to read code that does
nothing.

The hoisted `preHandler` above is where that trade does not hold, and it is worth saying
plainly: on the guard question the maps currently fail in the loud direction rather than the
quiet one. A reader who does not know that reads fifty false alarms and stops reading.

Each route refuses to answer from an empty parse — a map built from zero files reports zero
problems, which is the most dangerous answer a tool like this can give.
