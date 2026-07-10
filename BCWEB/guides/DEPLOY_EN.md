# BCWEB — Production Deployment Guide (EN)

> 🇫🇷 Version française : [DEPLOY_FR.md](DEPLOY_FR.md)

How to deploy the full BetterCommunity Web stack (SPA + Fastify API + Postgres +
Redis + MinIO + Discord bot + telemetry + Caddy) to a real server with automatic
HTTPS. Everything runs in Docker Compose behind Caddy.

---

## 1. What you need

- A Linux server (VPS or box) with **Docker + Docker Compose v2** and a **public IP**.
- **Ports 80 and 443 open** to the internet (80 is required for the Let's Encrypt
  ACME challenge, 443 serves HTTPS).
- A **domain** you control (e.g. `community.example.com`) — and optionally a
  `telemetry.example.com` subdomain.
- Stripe (test or live) keys if you want paid hosting/boosts.

## 2. Clone & configure

```bash
git clone --recurse-submodules <your-repo> bcweb
cd bcweb/BCW/BCWEB           # (the compose lives under infra/compose)
cp infra/compose/.env.example infra/compose/.env
```

Edit `infra/compose/.env` — the important keys:

| Key | What it is |
|---|---|
| `SITE_URL` | Public URL, e.g. `https://community.example.com` (used in emails, Stripe redirects, bot links) |
| `CADDY_DOMAIN` | The domain Caddy serves + auto-provisions TLS for |
| `POSTGRES_PASSWORD` | A strong DB password |
| `JWT_SECRET` | A long random string (`openssl rand -hex 32`) |
| `BOT_SHARED_SECRET` | Long random string — the API↔bot shared secret |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | From the Stripe dashboard (see §6) |
| `DISCORD_TOKEN` | Optional — else set the token from the admin dashboard |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | Object-storage credentials |

> **Never commit `.env`.** It holds live secrets and is gitignored. Only
> `.env.example` is tracked.

## 3. Point DNS at the server

At your DNS provider:

| Type | Name | Value |
|---|---|---|
| `A` | `community.example.com` | server IPv4 |
| `AAAA` (optional) | `community.example.com` | server IPv6 |
| `A` (optional) | `telemetry.example.com` | server IPv4 |

Wait for propagation: `nslookup community.example.com` should return your IP.

## 4. Bring the stack up

```bash
cd infra/compose
docker compose up -d --build
docker compose ps            # every service should be "healthy"/"running"
docker compose logs -f caddy # watch the TLS certificate get issued
```

Caddy provisions and auto-renews a Let's Encrypt certificate for `CADDY_DOMAIN` —
**no manual cert handling**. First issuance takes a few seconds once DNS resolves.

The API runs migrations on boot (`prisma db push`), so the schema is created
automatically. Visit `https://community.example.com` — you should get the app over
HTTPS.

## 5. First-run admin

1. Register the first account through the UI.
2. Promote it to admin in the DB (one-off):
   ```bash
   docker compose exec db psql -U bcweb -d bcweb -c \
     "UPDATE \"User\" SET role='SUPERADMIN' WHERE email='you@example.com';"
   ```
3. Reload — the **Admin** area is now available (moderation, hosting caps, bot,
   analytics, settings).

## 6. Stripe (payments)

1. In the Stripe dashboard grab your **Secret key** → `STRIPE_SECRET_KEY`.
2. Create a webhook endpoint pointing at
   `https://community.example.com/hosting/webhook` (a `/webhook` alias also works).
   Subscribe to at least: `checkout.session.completed`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.deleted`, `charge.refunded`.
3. Copy the endpoint's **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
4. `docker compose up -d api` to reload.

> **Without `STRIPE_WEBHOOK_SECRET` the webhook returns 503** — no checkout is ever
> recorded or provisioned. The admin **Discord bot → Payments** tab shows a
> ✓/✗ diagnostic for the Stripe key + webhook secret.
>
> **Local testing:** `stripe listen --forward-to http://localhost:3000/hosting/webhook`
> and use the printed `whsec_…` as `STRIPE_WEBHOOK_SECRET`. The API container is on
> **:3000** (not Stripe's sample `:4242`).

## 7. Discord bot (optional)

Either set `DISCORD_TOKEN` in `.env`, or leave it empty and paste the token in the
admin **Discord bot** tab (it connects within ~20s, no restart). The Discord app
needs **Server Members + Message Content** privileged intents enabled in the
Developer Portal.

## 8. Telemetry (optional)

The BMM telemetry dashboard runs as its own service (`telemetry` + `telemetry-db`).
Point `telemetry.example.com` at the server and set `TELEMETRY_INTERNAL_URL` +
`TELEMETRY_ADMIN_KEY` in `.env` to manage its limits from the BCWEB admin.

## 9. Updating

```bash
git pull --recurse-submodules
cd infra/compose
docker compose up -d --build      # rebuilds changed images, runs db push on boot
```

## 10. Backups

- **Postgres:** `docker compose exec db pg_dump -U bcweb bcweb | gzip > bcweb-$(date +%F).sql.gz`
- **MinIO (uploads/hosted repos):** back up the `minio-data` volume (or mirror the
  bucket with `mc mirror`).
- **Never** run `docker compose down -v` in production — `-v` deletes the volumes
  (database + object storage).

## 11. Health & monitoring

- `GET /health` on the API returns 200 when live.
- Admin **Server perf** tab shows CPU/RAM/disk, dependency health, downtime history
  and recent alerts (deduped, copyable).
- Load test: `cd loadtest && npm install && BASE=https://community.example.com node run.mjs`.

## Scaling notes

- Put a **CDN (Cloudflare)** in front for the static shell + assets — it absorbs the
  bulk of read traffic and the 100k+ tier for free.
- The per-IP API rate limiter is generous for humans and cheap under abuse; keep it.
- For sustained >1k concurrent API sockets, run 2–4 API replicas behind Caddy and a
  Postgres connection pooler. See `loadtest/BENCHMARK.md`.
