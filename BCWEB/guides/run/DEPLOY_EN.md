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
| `SITE_URL` | Full public URL, e.g. `https://community.example.com` (used in emails, Stripe redirects, bot links) |
| `SITE_DOMAIN` | Your **bare** domain, e.g. `community.example.com` — Caddy binds to it and **auto-provisions HTTPS**. (Local dev default: `http://localhost:5176`) |
| `COOKIE_DOMAIN` | `.your-domain.com` (leading dot) so the session cookie also reaches sub-domains (telemetry) |
| `POSTGRES_PASSWORD` | A strong DB password |
| `JWT_SECRET` | A long random string (`openssl rand -hex 32`) |
| `BOT_SHARED_SECRET` | Long random string — the API↔bot shared secret |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | From the Stripe dashboard (see §6) |
| `DISCORD_TOKEN` | Optional — else set the token from the admin dashboard |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Object-storage (MinIO) credentials |

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

Caddy provisions and auto-renews a Let's Encrypt certificate for `SITE_DOMAIN` —
**no manual cert handling**. First issuance takes a few seconds once DNS resolves.

The API runs the checked-in migrations on boot (`boot-migrate.mjs` → `prisma migrate
deploy`), so the schema is created automatically. Visit `https://community.example.com` —
you should get the app over HTTPS.

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

## 8b. SSO — "Sign in with BetterCommunity" (OpenID Connect provider)

BCWEB is a standards **OpenID Connect provider** — other services (yours or third-party)
can let users sign in with their BetterCommunity account. **Zero config:** the RS256
signing key is generated automatically on first use and the issuer is your `SITE_URL`.
Caddy already routes `/.well-known/*` and `/oauth2/*` to the API.

1. **Register the client** in Admin → **SSO / OAuth**: a name, redirect URI(s), and scopes
   (`openid`, `profile`, `email`). You get a **client_id**, and for confidential (server)
   clients a **client_secret shown once** (store it; you can rotate it later). Public
   clients (SPA / mobile) use **PKCE** and have no secret.
2. **Point the client's OIDC library at the discovery document** — it finds everything else:
   ```
   https://community.example.com/.well-known/openid-configuration
   ```
   It advertises the authorize / token / userinfo / jwks / revoke endpoints, `RS256`, and
   PKCE `S256`.

Flow: standard **authorization code + PKCE**; users see a branded consent screen (remembered
after the first time); tokens are RS256 (verify via the JWKS); refresh tokens **rotate**
(reuse is detected and revokes the whole token family).

## 8c. Email (account confirmation + password reset)

Transactional email is **off by default** — without it, password reset returns the token in
the API response (dev flow) and no confirmation email is sent. To enable it in production,
set these in `.env` and `docker compose up -d api`:
```
EMAIL_ENABLED=true
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587                # 465 = implicit TLS, otherwise STARTTLS
SMTP_USER=…
SMTP_PASS=…
SMTP_FROM=BetterCommunity <no-reply@your-domain.com>
```
Once on: new sign-ups receive a **confirmation email** (link → `/verify-email`), and
**password resets** email a one-hour link (→ `/auth?reset=…`). Both tokens are single-use.
Any SMTP provider works — your host's, SendGrid, Mailgun, Amazon SES, or a self-hosted relay.

## 9. Updating

### The short way

```bash
infra/deploy.sh
```

Backs up, pulls, rebuilds, waits for the API to actually answer, and **puts the previous
commit back if it does not**. Use this one.

| Flag | Effect |
|---|---|
| `--dry-run` | Print every step, change nothing. Safe to run right now. |
| `--no-backup` | Skip the dump — only if you took one minutes ago. |
| `--no-rollback` | Leave the broken version up so you can look at it. |

It refuses to start if the working tree has uncommitted changes, because the rollback is a
`git reset --hard` and would take them with it.

### What it waits for

`/ready` returns **503** until the API can query the database, so the script waits for the
site to work rather than for a process to exist. Migrations run at container boot, so that
window covers them too. `READY_TIMEOUT=120` seconds by default.

### The one thing it will not do

**It does not roll the database back.** Migrations run forwards only, so returning to the
previous commit restores the code and leaves the schema where it is. A rollback that silently
reverted data could destroy anything written between the backup and the failure, and only you
can judge that — so the script prints the dump's location and stops. Restoring is section 10.

### By hand

```bash
git pull
cd infra/compose
docker compose up -d --build      # rebuilds changed images, applies migrations on boot
```

Updates are **graceful** either way: when the API container is replaced it catches `SIGTERM`,
finishes in-flight requests, then closes its DB/Redis handles before exiting (10 s
budget) — a rebuild never hard-drops a live request. With 2+ replicas (next section)
the rollout is effectively invisible to users.

### Why there is no GitHub deploy

CI (`.github/workflows/ci.yml`) **checks** — build, tests, migration drift, secret scan — and
deliberately does not deploy. Automatic deployment would mean an SSH key or registry
credentials living in GitHub's secrets, which is a new way in to your server, in exchange for
saving one command. That trade is worth it when several people push or there is a staging
environment. Until then this script is the better shape.

## 10. Backups

Use the bundled script — it makes a consistent `pg_dump`, archives the MinIO + audit-anchor
volumes, prunes old copies, and can push off-site with rclone:
```bash
infra/backup/backup.sh                                       # → /var/backups/bcweb
BACKUP_DIR=/mnt/backups BACKUP_REMOTE=b2:bucket/bcweb infra/backup/backup.sh   # + off-site
```
Automate it daily (03:30) with `crontab -e`:
```
30 3 * * * BACKUP_DIR=/mnt/backups /path/to/BCW/BCWEB/infra/backup/backup.sh >> /var/log/bcweb-backup.log 2>&1
```
**Restore:**
```bash
# Postgres:
gunzip -c pg-bcweb-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U bcweb bcweb
# MinIO objects:
docker run --rm -v bcweb_minio-data:/data -v "$PWD":/backup alpine \
  sh -c 'cd /data && tar xzf /backup/minio-YYYYMMDD-HHMMSS.tar.gz'
```
> **Never** run `docker compose down -v` in production — `-v` deletes the volumes
> (database + object storage). And **test a restore at least once** — an untested backup
> isn't a backup.

## 11. Health & monitoring

The API exposes three probes (all exempt from the rate limiter, no request logs):

- **Liveness — `GET /live`**: cheap, **no dependencies**, 200 while the process is up.
  It deliberately never touches the DB, so a database blip can't trigger a restart loop.
- **Readiness — `GET /ready`**: 200 when the DB is reachable, **503** when it isn't — so a
  load balancer / orchestrator takes the instance out of rotation *without killing it*.
- **`GET /health`**: the combined probe (always 200 with a `db: true/false` flag); the
  Docker healthcheck and Caddy's `depends_on` use this one.
- Admin **Server perf** tab shows CPU/RAM/disk, dependency health, downtime history
  and recent alerts (deduped, copyable).
- Load test: `cd loadtest && npm install && BASE=https://community.example.com node run.mjs`.

## 12. Lock it down — firewall (do this right after the first deploy)

Only Caddy should face the internet. The compose file also publishes `3000` (api) and
`9000`/`9001` (MinIO) on the host for convenience; close everything except SSH + HTTP(S):
```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
```
Postgres, Redis and MinIO's data stay on the internal Docker network — never expose them.
(MinIO's `9000` is only needed publicly if you serve pre-signed upload URLs directly; in
that case put it behind a Caddy sub-domain rather than opening the raw port.) The **CDN**
setup is the very next thing — see *Performance & scaling → put a CDN in front* below.

## Performance & scaling

**Already built in** (see `loadtest/BENCHMARK.md`):
- Hot public reads (`/kofi/stats`, `/showcase`) are cached in **Redis** (shared across
  API replicas) with request-coalescing.
- The per-IP rate limiter is **Redis-backed** when `REDIS_URL` is set, so the 600/min
  budget is shared across replicas.
- **CDN-ready headers**: Caddy sets `Cache-Control: immutable` on `/assets/*` (Vite's
  content-hashed bundles) and hosted file downloads get `max-age=300` + an ETag.

**The one external step — put a CDN (Cloudflare) in front:**
1. Add your domain to Cloudflare, set the DNS records to **proxied** (orange cloud).
2. SSL/TLS mode **Full (strict)** — Caddy still terminates real TLS at the origin.
3. That's it: hashed `/assets/*` and repeat downloads are now served from the edge
   with ~0 origin hits; the HTML shell stays uncached so deploys are instant.

**When you outgrow one API container:**
- Run 2–4 `api` replicas behind Caddy — set `API_REPLICAS=3` in `.env` and run the usual
  `docker compose up -d`. Nothing else: the host port is a range and Caddy resolves `api`
  dynamically, so the spread follows on its own. The Redis cache/limiter already make that
  safe. (Use the setting, not `--scale` — a flag does not survive the next deploy.)
- Enable the **PgBouncer** pooler: `docker compose --profile pgbouncer up -d`, then in
  `.env` set `DB_HOST=pgbouncer DB_PORT=6432 DB_URL_PARAMS=?pgbouncer=true`
  (`DIRECT_DATABASE_URL` stays on `db:5432` for migrations, handled automatically).

**Move Postgres to its own server (managed — this is the "DB on a separate server" goal,
no K8s needed).** Pure `.env` change — the full URLs override the local defaults:
```
DATABASE_URL=postgresql://user:pass@managed-host:5432/bcweb?sslmode=require        # pooled endpoint
DIRECT_DATABASE_URL=postgresql://user:pass@managed-host:5432/bcweb?sslmode=require # direct (migrations)
```
Then `docker compose up -d api provisioner`; once verified, `docker compose stop db` (its
volume is kept as a backup). Neon / Supabase / RDS give you backups + read-replicas for
free. To keep pooling in front of it, set `PGBOUNCER_UPSTREAM_HOST` to the managed host.

**Self-hosted variant — your own second VPS for the DB (same flip, still free, no K8s).**
The identical `.env` change points the app VPS at a Postgres you run on a second box you
control. Four things to get right:
- **Private networking:** link the two VPS over the provider's private network (Hetzner / DO /
  …) or a WireGuard tunnel, and **never expose Postgres `5432` to the public internet** —
  firewall it to the app VPS's IP only.
- **Same region / datacenter:** keep both boxes in the same location. Every query round-trips to
  the DB, so cross-region latency wrecks performance; same-DC is < 1 ms.
- **TLS:** add `?sslmode=require` (or `verify-full` with a CA) unless the hop is a trusted
  private LAN.
- **Split of duties:** the DB VPS runs only Postgres (+ optionally PgBouncer and its own
  backups); the app VPS runs everything else (api / web / redis / minio / caddy / bot).
Do this when one box can't comfortably hold both — until then, vertically scaling the single
VPS is simpler and cheaper.

**Going further — scale up first, orchestrate only if you must:**
- **Scale the VPS vertically first** — more CPU/RAM/disk on the one box is the cheapest,
  simplest win and takes you a very long way. A 2 vCPU / 4 GB box already serves thousands
  of concurrent users (`loadtest/BENCHMARK.md`); the real ceiling is Postgres connections,
  solved by the PgBouncer / managed-DB path above, not by an orchestrator.
- **Need multiple app nodes?** A managed container platform (**Fly.io / Railway / Render**)
  runs these same images with autoscaling + rollouts and far less ops than any orchestrator.
- **Genuinely multi-node, self-hosted?** Reach for **Nomad** (much simpler than Kubernetes),
  or — only if you become a large multi-tenant platform — **managed** Kubernetes, never a
  hand-rolled control plane. You are a long way from needing either. (Kubernetes is *not*
  the tool for the user-project container hosting described in
  [USER_PROJECT_HOSTING.md](../reference/USER_PROJECT_HOSTING_EN.md) — see that doc.)

## Object storage — MinIO now, R2 later

**Don't confuse the two Cloudflare products:** the **CDN is free** (previous section —
enable it whenever you like); **R2** is their *paid-per-use object storage* that would
replace the bundled MinIO. You do NOT need R2 to benefit from the CDN.

**Start (and stay a long while) on MinIO** — it's free, stores files on your server's
disk, and nginx + MinIO comfortably serve a small/medium community (see
`loadtest/BENCHMARK.md`).

**Switch to R2 when** one of these becomes true:
- hosted-repo storage is outgrowing your server's disk (or eating your backup budget),
- download egress is saturating your server's uplink / your host bills for traffic,
- you want files to survive independently of the VPS.

**How (env-only, no code changes — the app speaks the S3 API):**
1. Create an R2 bucket + an API token (Access Key ID / Secret) in the Cloudflare dash.
2. In `infra/compose/.env` set:
   ```
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_PUBLIC_ENDPOINT=https://<your-r2-public-or-custom-domain>
   S3_BUCKET=<bucket>  S3_ACCESS_KEY=<key>  S3_SECRET_KEY=<secret>
   ```
3. Copy the existing objects once:
   `rclone sync minio:bcweb r2:bcweb` (or `mc mirror`).
4. `docker compose up -d api provisioner`, verify uploads/downloads, then remove the
   `minio` service + volume.
