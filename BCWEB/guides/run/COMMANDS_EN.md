# BCWEB — every command, and when you want it

One page for "what do I type". Grouped by what you are trying to do rather than by which tool
provides it, because at the moment you need a command you know the goal, not the package.

Paths are relative to `BCWEB/` unless stated. Everything here is taken from the actual
`package.json` scripts, `infra/`, and `.github/workflows/ci.yml`.

---

## Day to day, in production

```bash
infra/deploy.sh                 # back up, pull, rebuild, verify, roll back if it fails
infra/deploy.sh --dry-run       # print every step, change nothing
infra/backup/backup.sh          # a dump right now, without deploying
```

`deploy.sh` is the one to use. It refuses to run with uncommitted changes, waits for `/ready`
rather than for a container to exist, and puts the previous commit back if the site never
answers. It does **not** roll the database back — see [Deploy §9](DEPLOY_EN.md).

### If you would rather do it by hand

```bash
git pull
cd infra/compose
docker compose up -d --build
```

---

## Docker

All of these take `-f infra/compose/docker-compose.yml`, or run them from `infra/compose/`.

```bash
docker compose up -d                    # start everything
docker compose up -d api                # start/replace one service
docker compose build api                # rebuild one image without starting it
docker compose ps                       # what is running, and is it healthy
docker compose logs -f api              # follow one service's logs
docker compose logs --tail=100 api      # the last 100 lines and stop
docker compose restart api              # restart WITHOUT re-reading .env
docker compose up -d --force-recreate api   # restart AND re-read .env
docker compose down                     # stop everything, keep the volumes
docker compose exec api sh              # a shell inside the API container
docker compose exec db psql -U bcweb -d bcweb   # a psql prompt
```

!!! warning "`restart` does not re-read `.env`"
    Changing a variable and running `restart` leaves the old value in place. Use
    `up -d --force-recreate` for anything that touches the environment.

### Services

`db` · `redis` · `pgbouncer` · `minio` · `api` · `provisioner` · `web` · `bot` ·
`telemetry-db` · `telemetry` · `caddy`

---

## Rebuilding and scaling

```bash
docker compose up -d --build              # rebuild what changed, replace, keep the volumes
docker compose build --no-cache api       # ignore the Docker cache (a dependency that won't update)
docker compose up -d --force-recreate api # re-read .env without rebuilding
```

For several API replicas, put `API_REPLICAS=3` in `.env` and run the normal command:

```bash
docker compose --profile pgbouncer up -d --build
```

Replicas are replaced **one at a time** (the SIGTERM drain is already in place), so a build on
a scaled stack is a rollout with no downtime.

`--scale api=3` on the command line works too, but it **does not last**: the next
`docker compose up -d` drops back to one replica — and `infra/deploy.sh` runs exactly that. On
a scaled stack a routine deploy would therefore lose two thirds of your capacity without a
word in the logs. `API_REPLICAS` survives deploys; prefer it.

Check the scale-up took:

```bash
docker compose ps api                     # one line per replica, host ports 3000, 3001, 3002…
docker compose logs api | grep "incoming request"   # every replica is serving
```

---

## Setting a database up

```bash
cd apps/api
npm run setup                   # migrate + core seed + docs + FAQ
npm run setup -- --demo         # ... and demo fixtures (sample repos, catalogs, users)
npm run setup -- --skip-migrate # seeds only
```

Every step is idempotent, so running it against an existing database is safe. Prefer this to
running the seeds by hand — they have an order, and getting it wrong leaves a half-populated
database that fails later somewhere unrelated.

### The individual seeds, if you need one

```bash
npm run seed            # projects, users, plans, badges, settings, posts
npm run seed:demo       # sample content to click around in
npm run seed:content    # catalog items and repos
npm run seed:docs       # the documentation pages
npm run seed:faq        # the FAQ entries
npm run seed:site       # the in-site guide
npm run gen             # generated relational sample data
```

---

## Migrations

```bash
cd apps/api
npm run migrate                 # apply pending migrations (what the container does at boot)
```

Creating one, from `BCWEB/`:

```bash
npx prisma migrate dev --name what_changed --schema packages/db/schema.prisma
npx prisma validate --schema packages/db/schema.prisma
npx prisma migrate diff \
  --from-schema-datasource packages/db/schema.prisma \
  --to-schema-datamodel  packages/db/schema.prisma --exit-code   # 0 = no drift
```

`--exit-code` is what CI uses: a schema change without a matching migration fails there,
because `migrate deploy` would silently skip it in production.

!!! danger "Two Prisma clients"
    `prisma generate` resolves its output from the schema's location and lands in the PARENT
    repo's `node_modules`, while the API loads `apps/api/node_modules/.prisma/client`. Both
    exist and they drift. After generating, mirror it — and stop the API first, because it
    holds the query engine open:

    ```bash
    docker compose stop api
    npx prisma generate --schema packages/db/schema.prisma
    cp -r ../../node_modules/.prisma/client/. apps/api/node_modules/.prisma/client/
    docker compose up -d api
    ```

    The symptom of getting this wrong is an instant 500 on an obviously-correct route, because
    `p.someModel` was `undefined` and it threw before reaching Postgres.

---

## Tests and checks

### API

```bash
cd apps/api
npm test                        # 751 tests
npm run test:e2e
```

!!! warning "Three ways this lies to you"
    - **No `DATABASE_URL`** → ~19 tests silently SKIP and it reports pass.
    - **`REDIS_URL` set** → `cache.test.mjs` fails for reasons unrelated to your change.
    - **API container running** → its sweeper writes a setting `rollup.test.mjs` needs absent.

    Match CI: stop the API, set `DATABASE_URL`, leave `REDIS_URL` unset, expect 751/751 with
    **0 skipped**.

    ```bash
    docker compose stop api
    DATABASE_URL="postgresql://bcweb:PASSWORD@127.0.0.1:5432/bcweb" npm test
    docker compose start api
    ```

### Web

```bash
cd apps/web
npm run lint
npm run i18n:check              # --strict: fails on any key used without a French entry
npm run legal:check             # fails if the legal text changed without its date
npm run css:check
npm run budget                  # bundle size against its ceiling
npm run i18n:untranslated       # French entries that are still the English string
npm run build
```

There is **no `package.json` at the BCWEB root**. Running `npm run i18n:check` from there
says `Missing script` and exits 1 — piped through `--silent` it prints nothing, which reads
exactly like success. Always `cd` into the workspace.

---

## Running it locally

```bash
cd apps/api && npm run dev      # API with --watch
cd apps/web && npm run dev      # Vite on :5176, proxies /api to :3000
```

Or the whole stack in Docker, and rebuild only what you changed:

```bash
npm --prefix apps/web run build
docker cp apps/web/dist/. bcweb-web-1:/usr/share/nginx/html/     # web, no rebuild
docker compose build api && docker compose up -d api             # api
```

---

## Showing it to somebody else

```bash
node infra/tunnel.mjs
```

Opens a Cloudflare quick tunnel in front of the local stack and tells Caddy to answer on the
hostname it hands out. Ctrl-C ends it and puts the config back.

```bash
node infra/tunnel.mjs --restore   # repair without opening a tunnel
```

Run this if a tunnel ended any way other than Ctrl-C — window closed, process killed, machine
rebooted. The script writes the original config to a file **before** changing it, so repair
does not depend on how the previous run ended. With nothing to undo it does nothing and says so.

!!! danger "A dirty exit breaks sign-in, silently"
    `.env` is left pointing at a dead tunnel. The site still loads, but the session cookie is
    scoped to a hostname that no longer exists: the browser drops it without a word, sign-in
    answers "welcome", and the next request arrives anonymous.

    A normal start also repairs this on its own before opening the new tunnel.

!!! warning "The hostname part is not optional"
    Caddy matches sites by `Host`. A request arriving as `something.trycloudflare.com` does
    not match the `localhost` site and Caddy answers **200 with an empty body** — not a 404.
    Without `TUNNEL_DOMAIN` the tunnel connects, the page is blank, and nothing says why.

    The same is why `curl http://127.0.0.1:5176/…` can look broken while the site is fine.
    Test the edge with `-H "Host: localhost"`.

---

## Secrets

```bash
node infra/rotate-secrets.mjs
```

`.env.example` is committed to a public repo with literal `change-me…` values. While
everything listens on localhost that is theoretical; the moment a tunnel or a domain is
opened, it is not.

---

## Cleaning up

```bash
cd apps/api
npm run clear-content            # DRY RUN — prints what it would delete, deletes nothing
npm run clear-content -- --yes   # actually delete repos and catalog items, keep accounts
npm run nuke                     # dry run of the full wipe
npm run nuke -- --yes            # wipe everything INCLUDING accounts
npm run fix:drift                # idempotent repair of known data drift
```

`clear-content` wipes **all** user content, not just yours. On a shared development database
that is somebody else's afternoon.

---

## What CI runs

`.github/workflows/ci.yml` is the source of truth for "is this green". It checks and
deliberately does **not** deploy.

| Job | What it does |
|---|---|
| `web-build` | lint, i18n:check, css:check, legal:check, vite build, budget |
| `api-check` | `node --check` on every `.mjs`, prisma generate/validate/migrate deploy, drift check, `npm test` |
| `native` | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, napi build |
| `secret-scan` | looks for committed credentials |

Reproducing it locally is the four blocks above. One trap when you do: after `cmd | tail`,
`$?` is **tail's** status and is almost always 0. Use `${PIPESTATUS[0]}` for the real one.

---

## Where things live

| | |
|---|---|
| Compose file | `infra/compose/docker-compose.yml` |
| Environment | `infra/compose/.env` (from `.env.example`) |
| Caddy | `infra/caddy/Caddyfile` |
| Schema + migrations | `packages/db/` |
| Backups | `/var/backups/bcweb` by default |
