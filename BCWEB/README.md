# BCWEB — BetterCommunity Web

The web platform uniting **BMM**, **BSM** and future Better* projects: per-project
blogs, an official catalog + **community-hosted catalogs** (public or private, gated by
IP / creator id / BC id / email / Discord), a full-page **submit wizard**, user accounts,
an admin back-office, and **storage-pool hosting** — buy space and fill it freely with
repos and/or catalogs (billing anchors to the pool).

📚 **All guides live in [`guides/`](./guides/)** — deployment (EN/FR), local setup,
domain & HTTPS, app features, technical analysis, architecture, API reference.
Full design + feature spec + roadmap → **[guides/ARCHITECTURE.md](./guides/reference/ARCHITECTURE_EN.md)**.
Deploying to production → **[guides/DEPLOY_EN.md](./guides/run/DEPLOY_EN.md)** · **[FR](./guides/run/DEPLOY_FR.md)**.

## Run it (Docker)

```bash
cd infra/compose
cp .env.example .env      # set POSTGRES_PASSWORD, JWT_SECRET, S3 keys…
docker compose up -d      # api + web + postgres + redis + minio + caddy + telemetry
```

Then:
- Site: `http://localhost:5176`
- API health: `http://localhost:5176/api/health`
- BMM telemetry: `http://telemetry.localhost/`

### When everything says "Up" and nothing answers

`docker ps` shows every container running, the Caddy log says `server running`, and the
browser still cannot reach the site. Check the **ports column** and the **network**:

```bash
docker ps --format "{{.Names}}\t{{.Ports}}"
docker inspect bcweb-caddy-1 --format '{{json .NetworkSettings.Networks}}'
```

A container that lists `80/tcp, 443/tcp, 5176/tcp` with no `0.0.0.0:80->80/tcp`, and whose
networks print as `{}`, is running with **no network attached** — it can reach nothing and
nothing can reach it, including the host. Docker Desktop leaves containers in that state
after a restart or a WSL resume: they come back up without being re-attached, and every
symptom points at the app instead.

```bash
docker compose up -d --force-recreate caddy
```

Caddy is stateless, so recreating it is free — the database and MinIO volumes are untouched.

## Run it (dev, no Docker)

Two servers, and **run them from `apps/`, never from this folder**:

```bash
npm --prefix apps/api run dev    # :3000 — needs Postgres (docker compose up -d db)
npm --prefix apps/web run dev    # :5176 — proxies /api to :3000
```

There is a `package.json` here now whose only job is to make `npm run dev` work from this
directory. Before it existed, npm found no `package.json` in BCWEB, **walked up out of the
repo**, landed on the parent `BetterModsManager/package.json`, and ran *its* `dev` script —
which builds the BMM desktop app. No error mentioning BCWEB, and the site never starts.

Same trap for every other script name the two repos share: `npm run build`, `npm test`.

## Layout

```
apps/api      Fastify API — accounts/2FA/OAuth, catalogs, blog, repos, hosting,
              billing, admin, server-control, per-element BC ids (fully implemented)
apps/web      React 18 + Vite + Tailwind SPA — full site (Three.js/GSAP hero orb, i18n)
apps/bot      Discord.js bot — gating, automod + logging, welcome, join-to-create,
              giveaways, role panels, Ko-fi/payment/blog/alert announcements, DMs,
              the points economy (shop, casino, seasons). Guide: guides/run/DISCORD_BOT_EN.md
packages/db   Prisma schema + migrations (the full data model)
bmm/          BMM assets, telemetry-dashboard (moved here), official-server-repo, other
bsm/          BSM assets / seed presets
infra/        docker-compose + Caddy reverse proxy (edge anti-bot/CSP)
```

> A full, from-scratch developer walkthrough (every file, every subsystem, how to
> host) lives in **[guides/Technical_Analysis_EN.md](./guides/reference/Technical_Analysis_EN.md) / [_FR](./guides/reference/Technical_Analysis_FR.md)**;
> a feature-by-feature tour in **[guides/App_Features_EN.md](./guides/reference/App_Features_EN.md) / [_FR](./guides/reference/App_Features_FR.md)**.

## API (implemented so far)

After `docker compose up`, run the seed once: `docker compose exec api npm run seed`
(creates the projects, an admin account, hosting plans + default admin settings).

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` · `/auth/login` · `/auth/logout` | – | accounts (argon2 + JWT cookie) |
| GET | `/api/me` · `/me/items` · `/me/notifications` · `/me/repos` | user | user dashboard data |
| GET | `/api/catalog` · `/catalog/:slug` | – | browse published apps/plugins/themes/presets |
| POST | `/api/catalog` · `/catalog/:id/update` | user | submit / propose update (→ moderation); presets validated |
| POST | `/api/uploads/presign` | user | pre-signed PUT URL (direct-to-S3, size/type capped) |
| GET | `/api/catalog/:slug/download` | – | pre-signed GET URL for a published payload |
| GET/POST | `/api/mod/submissions` · `/…/approve` · `/…/reject` | mod/admin | moderation queue (notifies the owner) |
| GET | `/api/blog` · `/blog/:slug` | – | per-project blog |
| POST | `/api/blog` | mod/admin | publish a post |
| GET | `/api/repos` | – | public hosted Server-Repos + status |
| GET | `/api/hosting/plans` · `/hosting/capacity` · `/hosting/price` | – | plans, capacity status, live price preview |
| POST | `/api/hosting/checkout` | user | Stripe Checkout for a hosted repo (capacity-guarded) |
| POST | `/api/hosting/webhook` | Stripe | provisions repo on payment (signature-verified) |
| POST | `/api/me/billing/portal` | user | Stripe Customer Portal link (manage subs, receipts) |
| POST | `/api/repos/:id/push` | user | update a hosted repo — **valid SHA only** |
| GET/PUT | `/api/admin/settings` · `/…/:key` | admin | hosting cap, pricing knobs… |

## Web (React/Vite/Tailwind SPA)

`apps/web` — pages wired to the API: **Home** (landing + news), **Catalog** (browse +
filter by project/kind/search), **Item detail**, **Blog**, **Server Repos**, **Auth**
(login/register), **Dashboard** (submit to a catalog, my items + statuses,
notifications), **Admin** (moderation queue: approve/reject). Dev: `npm run dev`
(proxies `/api` → :3000); prod: built and served by nginx behind Caddy.

## Status

✅ **All roadmap phases implemented.** Docker stack · DB schema · accounts · catalogs ·
submissions + moderation · notifications · blog · repos · admin settings · S3/MinIO
pre-signed uploads + downloads · BSM preset validation · **Stripe hosting** (plans,
capacity-guarded checkout, signature-verified webhook, flexible pricing knobs,
SHA-only repo updates) · **provisioner** service (brings repos ONLINE, owns
isolation/quota) · React front for all of it (browse, upload, hosting purchase, user
dashboard, admin moderation + settings).

### Security hardening (in place)
- **HTTP security headers** at the edge (Caddy): `Content-Security-Policy` (locked to
  self + the app's real needs — data/blob images, MinIO uploads, GitHub fetches,
  youtube-nocookie embeds, rrweb blob frames), `X-Frame-Options: SAMEORIGIN`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and the
  `Server` header stripped. Validate any Caddyfile edit with
  `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile`.
- **Brute-force rate limit** on `/api/auth/login` + `/api/auth/register` (10/min/IP)
  on top of the global limiter.
- **Stripe billing portal** — every payer gets a Stripe customer; `POST /api/me/billing/portal`
  returns a portal link (manage subscriptions, cards, receipts) surfaced as
  "Manage billing" in the dashboard.
- **Hosted repo content is never executed** — served as `octet-stream`/`json`,
  download-only, admin-reviewed before publish.

## Production checklist

Before pointing a real domain at this:

1. **Secrets** — in `infra/compose/.env` set strong `POSTGRES_PASSWORD`, `JWT_SECRET`
   (32+ random bytes), `S3_ACCESS_KEY`/`S3_SECRET_KEY`, and the real
   `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. Never commit `.env`.
2. **Domain + HTTPS** — set `SITE_DOMAIN=your-domain.com` and
   `TELEMETRY_DOMAIN=telemetry.your-domain.com` (Caddy auto-provisions TLS). Set
   `SITE_URL` and `S3_PUBLIC_ENDPOINT` to the public `https://` origins.
3. **Stripe** — create the webhook endpoint (`/api/hosting/webhook`) in the Stripe
   dashboard, enable the **Customer Portal**, and use live keys.
4. **MinIO/S3** — for scale, point at a managed S3 (or a hardened MinIO with its own
   credentials + backups); the `9000` port only needs to be reachable by browsers for
   pre-signed PUT/GET.
5. **Backups** — run `infra/backup/backup.sh` on a cron (consistent `pg_dump` + MinIO +
   audit-anchor archives, retention, optional off-site via rclone). Full run/restore steps:
   [guides/BACKUP_EN.md](./guides/run/BACKUP_EN.md) · [FR](./guides/run/BACKUP_FR.md). *(Don't tar the
   `db-data` volume under a live server — `pg_dump` is the safe path.)*
6. **Bring it up** — `docker compose up -d`, then seed once:
   `docker compose exec api npm run seed` and change the seeded admin password.

### Shipped since the original roadmap
- **Auth**: TOTP 2FA (QR + recovery codes, required for admin tiers, step-up for
  server-control), GitHub/Discord OAuth login, optional-2FA signup onboarding.
- **Community**: Discord bot (gating + `/refreshroles`, automod + per-category logging,
  Ko-fi/payment/blog/alert announcements, welcome banners, join-to-create voice, role
  panels, giveaways, and a points economy with a shop, a casino and seasons — full guide:
  **[guides/run/DISCORD_BOT_EN.md](./guides/run/DISCORD_BOT_EN.md) / [_FR](./guides/run/DISCORD_BOT_FR.md)**),
  per-project blogs, showcase "Other projects", Project-Announcement countdown pages.
- **Ops/admin**: server-perf dashboard + alerts, advanced server management (DB
  viewer/file manager/Docker/power, audit-logged), security log, promo codes,
  free-tier claims, per-element **BC ids** + admin lookup.
- **Analytics** (first-party, consent-gated, Rybbit-style): Site analytics (geo + globe,
  OS/browser/device, sessions), **Web Vitals** (24h/7d/30d/90d, sortable tables + tabs by
  page/country/device/browser/OS + path filter), **Events feed** (pageviews + clicks/
  submits/edits), **Errors** (grouped JS errors + stack traces), **Goals** (conversion
  goals + rate). See [guides/API_Reference_EN.md](./guides/reference/API_Reference_EN.md) §15.
- **Abuse/security**: Caddy + Fastify anti-bot/anti-DDoS, proof-of-work on
  signup/contact, constant-time secret compares (`safeEqual`), SSRF-guarded outbound
  fetch. DB-viewer audit tables are read-only.

### Still open (scale / ops, not blockers)
- **OS-level** repo isolation in `apps/provisioner` (`spinUpRepoContainer` extension
  point — dockerode volume + cgroup CPU limit). The sandbox rules themselves (bans,
  whitelist, bandwidth cap) are already enforced at serve time in the API; this
  remaining piece only adds kernel-level isolation.
- Usage metering reconciliation with Stripe; CDN in front of catalog downloads;
  Postgres read replicas when needed.

Nothing here touches the BMM app repo; this is its own project (the `BCW` repo).
