# BCWEB — Production Deployment Guide (EN)

> 🇫🇷 Version française : [DEPLOY_FR.md](DEPLOY_FR.md)

How to deploy the full BetterCommunity Web stack (SPA + Fastify API + Postgres +
Redis + object storage + Discord bot + telemetry + Caddy) to a real server with automatic
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
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Object-storage credentials (the bundled `storage` service takes them as its own). The API refuses to boot in production on an `S3_SECRET_KEY` that is empty, a `change-me…` placeholder or under 24 characters ([ENV_EN.md](ENV_EN.md) §4) |

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
   Subscribe to at least: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.deleted`, `charge.refunded`.
3. Copy the endpoint's **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
4. `docker compose up -d api` to reload.

> **If the webhook was down while somebody paid:** nothing is lost. Every checkout is
> recorded in a `PendingCheckout` ledger when it opens; at boot, and every ten minutes, the
> API asks Stripe about the ones still open and finishes them through the same webhook code.
> Admin → **Hosting & billing → Pending payments** shows the ledger and has a **Reconcile
> now** button for the impatient. A payment that had to be finished this way is reported on
> the admin Errors page (source `reconcile`) and notified to super-admins.

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

`/demo` on that same origin opens the dashboard on **generated data**, with every write,
delete and export refused — it is for showing what the dashboard looks like without showing
anyone's telemetry. It is not a public page: everything on this origin except the ingest paths
sits behind the edge's `forward_auth` gate, so `/demo` still needs a BCWEB login with the
telemetry grant.

**Live errors (Issues).** BMM installs that send errors live post them to `/issues` on the same
origin; Caddy lets that path through like `/batch` (public ingest key, its own rate bucket). The
dashboard's **Issues** screen streams them live and asks Laya for labels through the API (see
[AI_LAYA_EN.md](AI_LAYA_EN.md) §12); `TELEMETRY_ISSUES_AI=0` turns that off from this side.

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

## 8d. AI for moderation (optional, off by default)

Nothing to do for a normal install: without it the rules engine moderates alone. To add the
Laya classifier as a second opinion, put `COMPOSE_PROFILES=ai` and a `LAYA_API_KEY` in `.env`,
run `docker compose --profile ai build laya` once, then `docker compose up -d`: a one-shot
`laya-fetch` downloads the model (~0.7 GB) and `laya` serves it on an internal network with no
published port, capped at 1.5 CPU and 2 GB. Then pick the provider in Admin → Moderation → AI
provider. The kill switch, the resource figures, the external-API option and what it means for
privacy: [AI_LAYA_EN.md](AI_LAYA_EN.md).

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

### From GitHub (CD)

`.github/workflows/deploy.yml` deploys the tip of `master` to the VPS. The trade the paragraph
that used to stand here worried about (a key in GitHub's secrets is a new way in) is paid down
by what that key is allowed to do: **one forced command**.

- **The key.** A dedicated ed25519 key, in `~/.ssh/authorized_keys` of the deploy user as
  `restrict,command="/srv/BetterCommunity/deploy-gate.sh" ssh-ed25519 AAAA… bcweb-deploy@github-actions`.
  `restrict` disables the pty and every forwarding; `command=` makes sshd run the gate whatever
  the client asks. A stolen key gets no shell, no file copy, no tunnel to the database.
- **The gate** (`infra/deploy-gate.sh`, installed OUTSIDE the repository with
  `install -m 0755 BCWEB/infra/deploy-gate.sh /srv/BetterCommunity/deploy-gate.sh`, so a commit
  cannot rewrite the gate that deploys it) accepts only `status` and
  `deploy <40-hex sha> [--dry-run]`, and the sha must be the current tip of `origin/master`,
  fetched by the server. It refuses a dirty checkout, takes a lock (one deploy at a time), runs
  `infra/deploy.sh` (backup, pull, build, wait for `/ready`, roll the code back if it never comes
  up) and logs to `/srv/BetterCommunity/deploy-logs/`.
- **The kill switch.** While `/srv/BetterCommunity/deploy-gate.disabled` exists, every deploy is
  refused (`status` still answers). `touch` it to stop CD at once, `rm` it to allow deploys.
- **Triggers.** By hand: Actions > *BCWEB deploy (production)* > Run workflow on `master`, with a
  dry-run box. Automatically after a green *BCWEB CI* on a push to `master`, only when the
  repository variable `CD_AUTO_DEPLOY` is exactly `true`. Both go through the GitHub environment
  `production`: add required reviewers there to make every deploy wait for your approval.
- **Security first.** Before the key is even written to the runner, the job checks that
  *BCWEB security* (Gitleaks, Semgrep, Trivy) **passed for the exact commit** it deploys:
  `gh api` lists that commit's workflow runs with the job's own read-only token
  (`actions: read`, `checks: read`, on that job only) and `.github/scripts/security-verdict.mjs`
  decides. Not started or still running: it polls every 30 s for up to 20 minutes, then fails
  ("no successful BCWEB security run for it after 20 minutes": start that workflow by hand on
  `master`, then deploy again). Failed or cancelled: it fails at once. A pull-request run does
  not count (it tested a merge, not this commit). *BCWEB DAST* is **not** waited for: it does
  not run on the push to `master`, it needs a whole running instance and ten minutes, and it
  judges the site's headers rather than one commit, so it stays advisory; read it on the PR and
  in the weekly run. Details: [CI_CD_EN.md](CI_CD_EN.md#bcweb-deploy-deployyml--the-cd).
- **Configuration** (Settings > Secrets and variables > Actions): secret `DEPLOY_SSH_KEY` (the
  private key); variables `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS` (the
  server's host key line, required: no trust-on-first-use) and optionally `CD_AUTO_DEPLOY`.

**Server-local changes** must not live in tracked files, or the gate (and `deploy.sh`) refuses
to deploy: compose additions go in `infra/compose/docker-compose.override.yml` (gitignored;
`deploy.sh` and a plain `docker compose` both read it), other sites in
`infra/caddy/sites.d/<name>.caddy` (gitignored, imported by the Caddyfile).

**Test it without deploying**: `ssh -i <deploy key> -p <port> <user>@<host> status`, or run the
workflow with *dry run* ticked (the gate still checks the sha and the tree, then
`deploy.sh --dry-run` prints every step and changes nothing).

**The first deploy after September 2026** is a migration and is done by hand, kill switch on:
move the server's local edits (the `bettervault` site block into `caddy/sites.d/`, `extra_hosts`
into the override file) and `git checkout` the two tracked files; update `.env`
(`BOT_SHARED_SECRET`, an `S3_SECRET_KEY` of 24+ characters, `S3_CORS_ALLOW_ORIGIN` replacing
`MINIO_API_CORS_ALLOW_ORIGIN`, `DOMAIN_ASK_KEY`; `node infra/check-env-spec.mjs` lists what is
missing); follow *Moving off MinIO* for the storage; then `infra/deploy.sh`. Remove the kill
switch only once that deploy is green.

## 10. Backups

Use the bundled script — it makes a consistent `pg_dump`, archives the object-storage + audit-anchor
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
# Object storage (stop it first: docker compose stop storage):
docker run --rm -v bcweb_s3-data:/data -v "$PWD":/backup alpine \
  sh -c 'cd /data && tar xzf /backup/s3-YYYYMMDD-HHMMSS.tar.gz'
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
  and recent alerts (deduped, copyable). Each alert carries a **severity** decided where it is
  raised — `critical` (a service is down, capacity oversold), `warning` (a threshold crossed),
  `info` — and a **condition key** (`cpu`, `disk`, `service_down:db`…). On every tick the
  monitor **closes** the open alerts whose condition it no longer sees, so "still happening"
  is answerable; that is separate from acknowledging, which only records that a human looked.
  Only a check that actually returned may close its own alerts: one that threw has no opinion,
  and is not allowed to mark an outage as over.
- Load test: `cd loadtest && npm install && BASE=https://community.example.com node run.mjs`.

## 12. Lock it down — firewall (do this right after the first deploy)

Only Caddy should face the internet. The compose file also publishes `5432` (db), `3000-3009`
(api), `9000` (object storage) and Caddy's local-site `5176` — on `127.0.0.1` only, so they answer
on the server itself (the deploy scripts' `/ready` probe, an SSH tunnel) and nowhere else. Only
Caddy's `80` and `443` are published to the network, and CI fails on any other
(`node BCWEB/infra/check-published-ports.mjs`, every compose file in the repo).

**The bind address is the protection, not the firewall.** Docker writes its own iptables rules
for published ports, ahead of ufw's, so `ufw deny 3000` does nothing for a container published on
`0.0.0.0:3000`. An Alpine host or LXC (the production server is one, on Proxmox) has no ufw at all.
Check what the running server really publishes — after every deploy, not just the first:
```bash
docker ps --format '{{.Names}} {{.Ports}}'
# expected: 0.0.0.0/[::] ONLY on 80 and 443 (caddy); everything else 127.0.0.1:...
```
and from a machine **outside** (not the server itself), `nc -zv <server-ip> 3000 9000 9001 5176`
must fail for every port. Still close everything except SSH + HTTP(S) at the edge — the
hoster's/Proxmox firewall, or ufw on a Debian/Ubuntu host:
```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
```
Object storage has no console to reach; versitygw serves S3 only. To reach a loopback port from
your own machine, use an SSH tunnel: `ssh -L 9000:127.0.0.1:9000 -p <ssh-port> <user>@<server>`.
The production remediation of October 2026 (ports published on every interface), step by step
and in French: [SECURITY_PORTS_FIX_FR.md](SECURITY_PORTS_FIX_FR.md).
Postgres, Redis and the object store stay on the internal Docker network — never expose them.
(Storage's `9000` is needed publicly because browsers use pre-signed upload URLs directly:
put it behind the Caddy sub-domain `S3_DOMAIN` rather than opening the raw port.) The **CDN**
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
- Enable the **PgBouncer** pooler in `.env`: `COMPOSE_PROFILES=pgbouncer` plus
  `DB_HOST=pgbouncer DB_PORT=6432 DB_URL_PARAMS=?pgbouncer=true` (in `.env`, not as a
  `--profile` flag — the flag lasts one command and `deploy.sh` would stop the pooler)
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
  backups); the app VPS runs everything else (api / web / redis / storage / caddy / bot).
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

## Object storage — bundled now, R2 later

**Don't confuse the two Cloudflare products:** the **CDN is free** (previous section —
enable it whenever you like); **R2** is their *paid-per-use object storage* that would
replace the bundled store. You do NOT need R2 to benefit from the CDN.

**Start (and stay a long while) on the bundled store** (`storage`, versitygw) — it's free,
stores files on your server's disk as plain files, and comfortably serves a small/medium
community (see `loadtest/BENCHMARK.md`, measured when the store was still MinIO).

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
   `rclone copy` then `rclone check`, the same commands as step 5 and 6 of
   [Moving off MinIO](#moving-off-minio) with R2 as the `new` remote.
4. `docker compose up -d api provisioner`, verify uploads/downloads, then remove the
   `storage` service + volume.

### Moving off MinIO

For an install that ran the `minio` service (before 2026-09-24). The code now runs `storage`
(versitygw, see [ADR_S3_STORAGE_EN.md](../reference/ADR_S3_STORAGE_EN.md)); the objects have to be
copied once from the old MinIO volume into the new one. MinIO's on-disk format is not plain
files, so this is an S3-to-S3 copy with **rclone**, which keeps each object's Content-Type. The
MinIO volume is only ever READ: if anything goes wrong, the old stack still has all its data.

Everything below runs on the server, in `infra/compose/`, with the compose project `bcweb`
(volumes `bcweb_*`, network `bcweb_default`). The MinIO image must still be on this host — it is
if MinIO ran here: `docker image inspect minio/minio:RELEASE.2025-09-07T16-13-09Z`.

1. **Back up first, with the OLD code** (the new `backup.sh` archives `s3-data`, not
   `minio-data`), or by hand:
   ```bash
   docker run --rm -v bcweb_minio-data:/data:ro -v /var/backups/bcweb:/backup alpine \
     tar czf /backup/minio-before-move.tar.gz -C /data .
   ```
2. **Pull the new code**, then stop what writes to storage (the site is down from here to step 7;
   presigned upload URLs live 10 minutes, so wait that long if uploads were in flight):
   ```bash
   docker compose stop api provisioner
   ```
3. **Put MinIO aside.** Its compose service no longer exists, so its container is now an orphan
   holding port 9000. Stop it and run the same image as a temporary, unpublished container on
   the stack's network:
   ```bash
   docker stop bcweb-minio-1
   S3K="$(grep '^S3_ACCESS_KEY=' .env | cut -d= -f2-)"; S3S="$(grep '^S3_SECRET_KEY=' .env | cut -d= -f2-)"
   docker run -d --name bcweb-minio-old --network bcweb_default \
     -v bcweb_minio-data:/data -e MINIO_ROOT_USER="$S3K" -e MINIO_ROOT_PASSWORD="$S3S" \
     minio/minio:RELEASE.2025-09-07T16-13-09Z server /data
   ```
4. **Start the new store** (volume-perms runs first and prepares the fresh `s3-data` volume):
   ```bash
   docker compose up -d storage && docker compose ps storage     # wait for (healthy)
   ```
5. **Copy.** rclone reads both remotes from environment variables, so nothing is written to disk:
   ```bash
   RC="docker run --rm --network bcweb_default \
     -e RCLONE_CONFIG_OLD_TYPE=s3 -e RCLONE_CONFIG_OLD_PROVIDER=Minio \
     -e RCLONE_CONFIG_OLD_ENDPOINT=http://bcweb-minio-old:9000 \
     -e RCLONE_CONFIG_OLD_ACCESS_KEY_ID=$S3K -e RCLONE_CONFIG_OLD_SECRET_ACCESS_KEY=$S3S \
     -e RCLONE_CONFIG_NEW_TYPE=s3 -e RCLONE_CONFIG_NEW_PROVIDER=Other \
     -e RCLONE_CONFIG_NEW_ENDPOINT=http://storage:9000 \
     -e RCLONE_CONFIG_NEW_ACCESS_KEY_ID=$S3K -e RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY=$S3S \
     rclone/rclone:1.75.1"
   $RC copy old:bcweb new:bcweb --metadata -v
   ```
   Use your `S3_BUCKET` if it is not `bcweb`. A line `ERROR ... 409` names a key that is also a
   "folder" of another key (`a` and `a/b`): MinIO kept both, a POSIX store cannot. Keep the one
   the site uses (look it up in the database) and copy it on its own.
6. **Verify — do not skip.** Same objects, same sizes, same bytes, same types:
   ```bash
   $RC check old:bcweb new:bcweb                   # sizes + checksums: "0 differences found"
   $RC check --download old:bcweb new:bcweb        # optional: compares every byte (slower)
   $RC lsf -R --files-only --format psm old:bcweb > /tmp/old.txt
   $RC lsf -R --files-only --format psm new:bcweb > /tmp/new.txt
   diff /tmp/old.txt /tmp/new.txt && echo "types and sizes identical"
   ```
7. **Switch over:** `docker compose up -d`. Then in the browser: open a blog image, download a
   catalog file, upload a new file; **Admin → Server perf** shows object storage up.
8. **Clean up:** `docker rm -f bcweb-minio-old && docker rm bcweb-minio-1`. Keep the
   `bcweb_minio-data` volume and `minio-before-move.tar.gz` until you are sure; deleting them
   (`docker volume rm bcweb_minio-data`) is a separate decision nothing here makes for you.

If a proxy **other than the bundled Caddy** routes your `s3.` hostname (for example a Traefik in
front of the stack), it must now reach `storage:9000` (container `bcweb-storage-1`) instead of
`minio:9000`. The host port stays `127.0.0.1:9000`.

**Going back** before step 8: `docker compose stop storage`, redeploy the previous commit, and
`docker start bcweb-minio-1` (after `docker rm -f bcweb-minio-old`). The MinIO volume was never
written to.
