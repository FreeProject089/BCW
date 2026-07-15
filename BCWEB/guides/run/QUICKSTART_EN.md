# BCWEB — Production Quickstart (EN)

> 🇫🇷 [QUICKSTART_FR.md](QUICKSTART_FR.md) · Full details & the *why* behind each step:
> [DEPLOY_EN.md](DEPLOY_EN.md)

The short path from a fresh box to a live HTTPS site. **Assumes:** a Linux VPS with
SSH/root access + Docker & Compose v2, and a domain you control. Everything is free and
self-hosted.

---

### 1. Get the code
```bash
git clone --recurse-submodules <your-repo> bcweb
cd bcweb/BCW/BCWEB
```

### 2. Fill the secrets
```bash
cp infra/compose/.env.example infra/compose/.env
nano infra/compose/.env
```
Minimum for production:
```ini
SITE_DOMAIN=community.example.com          # bare domain → Caddy auto-provisions HTTPS
SITE_URL=https://community.example.com
COOKIE_DOMAIN=.example.com                  # leading dot (shares cookie with sub-domains)
POSTGRES_PASSWORD=<strong>
JWT_SECRET=<openssl rand -hex 32>
BOT_SHARED_SECRET=<strong>
S3_ACCESS_KEY=<minio-user>   S3_SECRET_KEY=<minio-pass>
# Stripe keys only if you enable paid hosting — see DEPLOY_EN.md §6
```
> Never commit `.env` — it's gitignored (only `.env.example` is tracked).

### 3. Point DNS (you manage the domain)
| Type | Name | Value |
|---|---|---|
| `A` | `community.example.com` | your VPS IPv4 |
| `A` *(optional)* | `telemetry.example.com` | same IP |

### 4. Launch
```bash
cd infra/compose
docker compose up -d --build
docker compose ps                 # every service healthy/running
docker compose logs -f caddy      # watch the TLS cert get issued
```
→ open **https://community.example.com**. (Schema is created automatically on boot.)

### 5. Make yourself admin
Register your account in the UI first, then:
```bash
docker compose exec db psql -U bcweb -d bcweb -c \
  "UPDATE \"User\" SET role='SUPERADMIN' WHERE email='you@example.com';"
```

### 6. Firewall (only Caddy faces the internet)
```bash
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
```

### 7. CDN — Cloudflare (free, recommended)
1. Cloudflare → **Add a site** → your domain → set the given **nameservers** at your registrar.
2. **DNS:** the `A` record in **Proxied** mode (orange cloud 🟠).
3. **SSL/TLS → Full (strict)** (Caddy keeps real TLS at the origin).

### 8. Backups (cron + free off-site)
```bash
crontab -e
# daily 03:30:
30 3 * * * BACKUP_DIR=/mnt/backups /path/BCW/BCWEB/infra/backup/backup.sh >> /var/log/bcweb-backup.log 2>&1
```
Free off-site: `rclone config` (Google Drive 15 GB / Mega 20 GB), then add
`BACKUP_REMOTE=gdrive:bcweb-backups` in front of the command. **Test a restore once**
([DEPLOY_EN.md §10](DEPLOY_EN.md)).

---

**Done — you're live, hardened, backed up, all for €0.**
Optional next: Stripe payments (§6), Discord bot (§7), telemetry (§8), scaling — all in
[DEPLOY_EN.md](DEPLOY_EN.md).
