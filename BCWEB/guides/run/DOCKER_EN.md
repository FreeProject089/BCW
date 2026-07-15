# BCWEB — Docker files explained (EN)

> 🇫🇷 Version française : [DOCKER_FR.md](DOCKER_FR.md)

What every Docker piece of the stack does, where it lives, and how to update it for
production. Everything is driven by **one** compose file:
`infra/compose/docker-compose.yml` + its `.env` (copied from `.env.example`).

---

## 1. The services (docker-compose.yml)

| Service | Image / build | Role | Exposed |
|---|---|---|---|
| `db` | `postgres:16-alpine` | Main database (Prisma) | internal only |
| `redis` | `redis:7-alpine` | Shared cache + rate-limiter state (+ future queues) | internal only |
| `minio` | `minio/minio` | S3-compatible object storage (uploads, hosted repos) | `9000` (S3), `9001` (console) |
| `api` | build `apps/api/Dockerfile` | Fastify API — accounts, catalogs, hosting, billing… | `3000` |
| `provisioner` | build `apps/provisioner/Dockerfile` | Background worker that provisions hosted repos | — |
| `web` | build `apps/web/Dockerfile` | React SPA compiled and served by **nginx** | via caddy |
| `bot` | build `apps/bot/Dockerfile` | Discord bot (connection manager) | — |
| `telemetry-db` | `postgres:16-alpine` | Separate Postgres for BMM telemetry | internal only |
| `telemetry` | build `bmm/telemetry-dashboard/Dockerfile` | Telemetry ingest + dashboard (Rust + React) | via caddy |
| `caddy` | `caddy:2-alpine` | Edge reverse proxy — HTTPS, security headers, anti-bot | `80`, `443`, `5176` |
| `pgbouncer` | `edoburu/pgbouncer` | **Opt-in** (profile `pgbouncer`) Postgres connection pooler | internal only |

**Dependency order** is handled by `depends_on` + healthchecks: `db` must be healthy
before `api`/`provisioner` start; `caddy` fronts everything.

## 2. The Dockerfiles

- **`apps/api/Dockerfile`** — `node:20-alpine` + `openssl` (Prisma), `git` (the
  admin file/DB backup system shells out to real git), fonts (welcome-banner canvas).
  Build runs `prisma generate`; **at container start** it runs
  `prisma db push` (syncs the schema — this is why a fresh DB "just works") then
  `node src/server.mjs`.
- **`apps/web/Dockerfile`** — multi-stage: stage 1 builds the Vite bundle, stage 2 is
  plain **nginx** serving `dist/` with `apps/web/nginx.conf` (immutable cache on
  hashed `/assets/*`, no-cache on `index.html`, SPA fallback). ⚠️ `VITE_*` vars are
  **baked at build time** — changing `VITE_GTM_ID` requires a rebuild, not a restart.
- **`apps/bot/Dockerfile`** — `node:20-alpine`, prod-only deps, fonts for the welcome
  banner. Idles cleanly when no token is configured.
- **`apps/provisioner/Dockerfile`** — small Node worker + Prisma client.
- **`bmm/telemetry-dashboard/Dockerfile`** — 3-stage: React build → Rust (Axum)
  release build → **distroless/cc** runtime (no shell, minimal CVE surface).

## 3. Volumes (the data that must survive)

| Volume | Holds | Loss means |
|---|---|---|
| `db-data` | the whole main database | accounts, repos, billing — everything |
| `minio-data` | every uploaded/hosted file | all hosted repos + catalog payloads |
| `telemetry-data` | telemetry DB | BMM telemetry history |
| `redis-data` | cache/limiter state | harmless (rebuilt automatically) |
| `caddy-data` / `caddy-config` | TLS certificates | re-issued automatically |
| `audit-anchor` | tamper-evidence anchor for the audit log | audit chain verification |

> **Never run `docker compose down -v` in production** — `-v` deletes these volumes.
> `docker compose down` (without `-v`) is always safe.

## 4. Day-to-day commands

```bash
cd infra/compose
docker compose up -d                  # start (build if never built)
docker compose up -d --build api      # rebuild ONE service after a code change
docker compose ps                     # status + health
docker compose logs -f api bot        # follow logs
docker compose restart api            # restart without rebuild (env change only)
docker compose down                   # stop everything (volumes kept)
```

Rule of thumb: **code change → `--build`**, **`.env` change → `up -d`** (recreates the
containers with the new env; a plain `restart` does NOT re-read `.env`).

## 5. Updating in production

1. `git pull --recurse-submodules`
2. `cd infra/compose && docker compose up -d --build`
   - Only changed images rebuild (Docker layer cache).
   - The api runs `prisma db push` at boot → schema migrations apply automatically.
   - nginx serves the new hashed assets; `index.html` is no-cache so clients pick the
     new build up immediately (Ctrl+Shift+R never needed in prod).
3. Check `docker compose ps` (healthy) and the admin **Server perf** tab.

**Zero-ish downtime:** rebuild order barely matters — Caddy keeps serving while a
service recreates (a few seconds gap on that service only). For the api you can
`docker compose up -d --build --no-deps api` to avoid touching anything else.

## 6. Production-specific settings (recap)

- `.env`: real `POSTGRES_PASSWORD`, `JWT_SECRET`, S3 keys, `SITE_DOMAIN`/`SITE_URL`
  (https), `COOKIE_DOMAIN=.your-domain.com`, Stripe keys + webhook secret.
- Ports: in prod you can remove the published `3000` (api) and `9001` (MinIO console)
  from the compose if you don't need them from outside — Caddy routes internally.
- Scaling: `docker compose up -d --scale api=3` + enable the `pgbouncer` profile
  (see DEPLOY guide §Performance) once traffic justifies it.
- Backups: `pg_dump` for `db`, mirror `minio-data` (see DEPLOY guide §10).

## 7. Common pitfalls

| Symptom | Cause |
|---|---|
| env change has no effect | used `restart` instead of `up -d` (env is applied at container creation) |
| GTM id / VITE_* change has no effect | it's baked at build → `up -d --build web` |
| payments never recorded | `STRIPE_WEBHOOK_SECRET` missing → webhook 503s (see admin bot → Payments diagnostic) |
| bot offline | no token (env or dashboard) or privileged intents disabled in the Discord portal |
| everything gone after `down -v` | `-v` deleted the volumes — restore from backups |
