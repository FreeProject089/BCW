# BCWEB — Enabling the optional components (EN)

> 🇫🇷 [ADDONS_FR.md](ADDONS_FR.md) · Deployment overview: [DEPLOY_EN.md](DEPLOY_EN.md)

How to turn on each **optional** piece (CDN, pooler, replicas, R2, separate DB, off-site
backup). Every recipe follows the same shape: **When to add it · How · After (verify)**.

> 🟢 **Golden rule:** add a piece only **when a limit actually shows up** (watch the admin
> **Server perf** tab: CPU/RAM/disk/latency). Nothing is required up front — everything else
> already runs for free on your VPS.

---

## 1. Cloudflare CDN (free)

**When to add it:** as soon as you have a domain. Immediate win, no downside.

**How:**
1. Cloudflare → **Add a site** → your domain.
2. Set the given **nameservers** at your registrar (where you bought the domain).
3. **DNS:** the `A` record (your VPS IP) in **Proxied** mode (orange cloud 🟠).
4. **SSL/TLS → Full (strict)** (Caddy keeps real TLS at the origin).

**After (verify):**
- Reload → `cf-cache-status: HIT` should appear on `/assets/*` (DevTools → Network). The HTML
  shell stays `DYNAMIC` (intended: instant deploys).
- Nothing to change in the app — cache headers are already correct.

---

## 2. PgBouncer — connection pooler (free)

**When to add it:** **only** once you run **≥ 2 API replicas** (§3). With a single API
container it buys you nothing.

**How:**
```bash
docker compose --profile pgbouncer up -d
```
Then in `infra/compose/.env`:
```ini
DB_HOST=pgbouncer
DB_PORT=6432
DB_URL_PARAMS=?pgbouncer=true
```
`docker compose up -d api` to reload.

**After (verify):**
- API boots and answers (`/ready` = 200).
- **Migrations** still run directly via `DIRECT_DATABASE_URL` (handled automatically — a
  pooler can't run them).

---

## 3. API replicas (free)

**When to add it:** when **one API container saturates** (high CPU / latency rising under
load). Enable **PgBouncer (§2) first**.

**How:**
```bash
docker compose up -d --scale api=3
```
Then list the 3 upstreams in Caddy (Redis cache + limiter already make this safe: the budget
is shared across replicas).

**After (verify):**
- Requests spread across the containers (check all 3 logs).
- A `docker compose up -d --build` replaces replicas **one at a time** → invisible rollout
  (thanks to the graceful SIGTERM shutdown already in place).

---

## 4. R2 — Cloudflare object storage (paid per use)

**When to add it:** when the **VPS disk fills up** with hosted files, or **download egress**
saturates your uplink / gets billed. (The free CDN is a separate thing — R2 ≠ CDN.)

**How (env-only, no code):**
1. Create an R2 bucket + a token (Access Key / Secret) in the Cloudflare dashboard.
2. In `infra/compose/.env`:
   ```ini
   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_PUBLIC_ENDPOINT=https://<your-public-or-custom-R2-domain>
   S3_BUCKET=<bucket>  S3_ACCESS_KEY=<key>  S3_SECRET_KEY=<secret>
   ```
3. Copy existing objects once: `rclone sync minio:bcweb r2:bcweb`.
4. `docker compose up -d api provisioner`.

**After (verify):**
- An upload + a download work from the UI.
- Only then remove the `minio` service + its volume.

---

## 5. Postgres on a separate server (your own 2nd VPS, or managed)

**When to add it:** when the **DB needs dedicated resources** (CPU/RAM/IO), or you want it off
the app box. As long as one VPS holds both comfortably → **scale it vertically**, it's
simpler. (No K8s for this.)

**How (pure `.env` flip):**
```ini
DATABASE_URL=postgresql://user:pass@db-host:5432/bcweb?sslmode=require        # pooled endpoint
DIRECT_DATABASE_URL=postgresql://user:pass@db-host:5432/bcweb?sslmode=require # direct (migrations)
```
```bash
docker compose up -d api provisioner
docker compose stop db     # the DB now lives on the other server (local volume kept)
```

**Security (self-hosted 2nd VPS) — mandatory:**
- **Private network** between the two VPS (provider private network or a WireGuard tunnel).
- **Never** expose port `5432` to the internet — firewall it to the app VPS's IP only.
- **Same region / datacenter** (every query round-trips → latency is critical).
- `?sslmode=require` (or `verify-full`) unless it's a trusted private LAN.

**After (verify):**
- `/ready` = 200 (DB reachable). Migrations run (via the direct endpoint).
- Reconfigure **backups**: the Postgres dump now runs on the **DB VPS**.

---

## 6. Off-site backup (free)

**When to add it:** **at go-live** — it's your safety net, do it from day one.

**How:**
1. `rclone config` once → a free remote (**Google Drive** 15 GB / **Mega** 20 GB).
2. Add it to the backup cron line:
   ```
   30 3 * * * BACKUP_REMOTE=gdrive:bcweb BACKUP_DIR=/mnt/backups /path/.../infra/backup/backup.sh >> /var/log/bcweb-backup.log 2>&1
   ```

**After (verify):**
- A file shows up on the remote after a manual run.
- **Test a restore** at least once (commands in [DEPLOY_EN.md §10](DEPLOY_EN.md)) — an untested
  backup isn't a backup.
- Size tip: DB dumps are tiny (~130 KB) → off-site freely; the MinIO archive is the big one →
  lower its retention or use an incremental mirror if needed.
