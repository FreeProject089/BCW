# Codebase maps

Eight read-only maps in **Admin → Moderation**. Each reads the source (or, for one, this
instance's own environment) and prints a structure. They are closed by default and fetch on
first open — a page used every day should not pay for tools opened twice a year.

All eight are `requireRole('ADMIN')`, which means 2FA as well.

They exist because the answers below were all *derivable* from the code and none of them was
*written down anywhere* — so each was a thing somebody had to remember correctly.

---

## Which guard protects which route — `GET /admin/rbac-map`

677 routes, read from the route files themselves, so it cannot drift from the code the way a
document does. Seven guard forms are recognised (`requireRole`, `requireCap`, `optionalAuth`,
`apiAuth`, `resolve`, `oauthBearer`, `requireEditor`).

The number to read is **suspicious**: an `/admin` or `/me` route with no guard and no entry
in the public-by-design list. Today that is one — `GET /me`, which is `optionalAuth` and
correct.

## The database, and the drift — `GET /admin/schema-map`

104 models, 80 relations. Draws the widest models and the most depended-on ones, and — the
part that matters — the **index drift**: an index created in raw SQL and never declared in
`schema.prisma`.

That case is not cosmetic. The next generated migration proposes **dropping** it, because a
`migrate diff` believes the schema. Currently zero.

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
is the difference between a restore and a guess. There is exactly one here.

!!! note "A data migration is not a no-op"
    `INSERT`/`UPDATE` migrations write ROWS rather than change shape: they cannot simply be
    re-run, and a restore has to think about them. Two exist here, and both reported "no
    operations" until they were given their own category — an empty result that reads exactly
    like a clean one.

A database failure degrades to the on-disk half rather than a 500, and `pending` stays empty
in that case. "48 migrations pending" from an unreachable database is a lie that reads as an
emergency.

## The stack and its ports — `GET /admin/compose-map`

Services, `depends_on` edges, start order, and **what is published to the network**.

Not a fault list — the edge proxy is *supposed* to publish 80 and 443. It is the list of
things reachable from outside the machine, which is a list somebody should be able to recite
and usually cannot. On this stack it is six: Caddy's 80/443/5176, the API's 3000, and MinIO's
9000/9001. The last three are published for convenience and `run/DEPLOY_EN.md` §12 says the
firewall must close everything but 22/80/443 right after the first deploy — which is the
point of putting the same fact on a screen somebody looks at more than once.

Nothing copies `infra/` into the API image, so **in a container this returns 404** and the
card says so in words. "No ports exposed" would be the wrong answer said confidently.

## Secrets with a hardcoded fallback — `GET /admin/secrets-map`

Reads every `process.env` access across the 94 API modules. `process.env.JWT_SECRET || 'dev'`
means an instance deployed without that variable does not fail — it signs tokens with a value
anybody reading the repository knows. It fails open, silently, and looks fine.

The first pass reported eighteen. Thirteen were `JWT_SECRET`, which `server.mjs` already
refuses to boot on in production, so guarded and live fallbacks are now told apart. Five are
live: `LINK_LOOKUP_SECRET` in four files and `SEED_ADMIN_PASSWORD` in `seed.mjs`.

!!! warning "Two limits worth knowing"
    The `JWT_SECRET` boot guard only fires when `NODE_ENV=production` is actually set, and
    `LINK_LOOKUP_SECRET` has no boot guard at all.

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

## Where the data goes — `GET /admin/data-flow`

Route → model → read/write, joined with the guard. 682 routes, 101 models, 1212 database
calls. `user` is touched by 97 routes; 226 calls sit outside any route (sweepers, boot code,
helpers) and are reported separately.

The list to read is **what an anonymous request can write** — 18 routes. Every one is
deliberate: analytics ingestion, sign-up, email verification, password reset, the OAuth and
social callbacks, the Ko-fi webhook, newsletter double opt-in, Discord link codes, doc
feedback. Not a fault list; a list somebody should be able to recite.

!!! note "Not every guard is a `preHandler`"
    The `/bot/*` routes authenticate with `botAuth(req, reply)` *inside* the handler — a
    `safeEqual` against a shared secret. The RBAC map only reads `preHandler`, so a naive
    join called fifteen of them "writable by an unauthenticated request". They are listed
    separately now.

    Two routes check something inline instead: `/webhooks/kofi` `safeEqual`s a token and
    401s before writing, and `/auth/login/2fa` also 401s — on a failed password check, on a
    genuinely public endpoint. Identical shape, opposite meaning. The row carries the fact
    (`rejects with 401/403 in its own body`) and no verdict is invented.

## What builds and ships this — `GET /admin/infra-map`

You asked for a Terraform state visualizer. There is no Terraform in any of the four
repositories — no `.tf`, no `.tfstate`, not a mention — so a reader for one would read a file
that does not exist. This answers the same question against what is really here.

A Terraform state says two things: what is declared, and what puts it there. The compose map
above is the first. This is the second — the GitHub Actions workflows, what each one
publishes (read from the ACTIONS it uses, never from its name), and which secrets a fresh
clone would need.

On these repositories: 3 workflows, 7 jobs. `Release` is the only one that publishes anything
and the only one needing secrets. Both CI workflows need none, so a contributor on a fork can
check their work — a one-line fact that otherwise lives only in whoever set them up.

`.github/` is not copied into the API image, so in a container this returns 404 rather than an
empty stack. "No workflows" would read as "nothing builds this".

---

## What these are not

Every one is **line-based and shallow** rather than a real parser. That is a deliberate
trade: the failure mode is reporting *fewer* routes, calls or edges than exist, which shows
up in a count, instead of inventing edges that send somebody to read code that does nothing.

Each route refuses to answer from an empty parse — a map built from zero files reports zero
problems, which is the most dangerous answer a tool like this can give.
