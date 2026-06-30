# BCWEB — BetterCommunity Web

The web platform uniting **BMM**, **BSM** and future Better* projects: per-project
blogs & catalogs, user accounts, an admin back-office, and paid Server-Repo hosting.

Full design + feature spec + roadmap → **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Run it (Docker)

```bash
cd infra/compose
cp .env.example .env      # set POSTGRES_PASSWORD, JWT_SECRET, S3 keys…
docker compose up -d      # api + web + postgres + redis + minio + caddy + telemetry
```

Then:
- Site (placeholder for now): `http://localhost`
- API health: `http://localhost/api/health`
- BMM telemetry: `http://localhost/telemetry/`

## Layout

```
apps/api      Fastify API (auth scaffold today; catalogs/hosting/billing per roadmap)
apps/web      Web front (static placeholder → React/Vite/Tailwind SPA in phase 2)
packages/db   Prisma schema + migrations (the full data model)
bmm/          BMM assets, telemetry-dashboard (moved here), official-server-repo, other
bsm/          BSM assets / seed presets
infra/        docker-compose + Caddy reverse proxy
```

## API (implemented so far)

After `docker compose up`, run the seed once: `docker compose exec api npm run seed`
(creates the projects, an admin account, hosting plans + default admin settings).

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` · `/auth/login` · `/auth/logout` | – | accounts (argon2 + JWT cookie) |
| GET | `/api/me` · `/me/items` · `/me/notifications` · `/me/repos` | user | user dashboard data |
| GET | `/api/catalog` · `/catalog/:slug` | – | browse published apps/plugins/themes/presets |
| POST | `/api/catalog` · `/catalog/:id/update` | user | submit / propose update (→ moderation) |
| GET/POST | `/api/mod/submissions` · `/…/approve` · `/…/reject` | mod/admin | moderation queue (notifies the owner) |
| GET | `/api/blog` · `/blog/:slug` | – | per-project blog |
| POST | `/api/blog` | mod/admin | publish a post |
| GET | `/api/repos` | – | public hosted Server-Repos + status |
| GET/PUT | `/api/admin/settings` · `/…/:key` | admin | hosting cap, pricing knobs… |

## Web (React/Vite/Tailwind SPA)

`apps/web` — pages wired to the API: **Home** (landing + news), **Catalog** (browse +
filter by project/kind/search), **Item detail**, **Blog**, **Server Repos**, **Auth**
(login/register), **Dashboard** (submit to a catalog, my items + statuses,
notifications), **Admin** (moderation queue: approve/reject). Dev: `npm run dev`
(proxies `/api` → :3000); prod: built and served by nginx behind Caddy.

## Status

✅ **Full vertical slice**: Docker stack, DB schema, accounts, catalogs, submissions +
moderation, notifications, blog, repos, admin settings — **and a working React front**
covering browse + user dashboard + admin moderation.

▶️ **Next** (ARCHITECTURE §8): S3 pre-signed uploads (real payloads/preset files) →
BSM preset schema-validation → Server-Repo **provisioner** → **Stripe** hosting
(plans, checkout, webhooks, capacity/quota enforcement) → admin pricing UI.

Nothing here touches the BMM app repo; this is its own project (the `BCW` repo).
