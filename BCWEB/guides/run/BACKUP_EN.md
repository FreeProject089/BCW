# BCWEB — Backup & Restore

Everything stateful in BCWEB lives in **three places**: the Postgres database, the MinIO
object store (uploads / blog media / hosted repo files), and the tamper-evident audit
anchor. `infra/backup/backup.sh` captures all three; this guide covers running it, storing
copies off-site, and — most importantly — **restoring**.

## What gets backed up

| Source | How | File |
|---|---|---|
| **Postgres** (all app data) | `pg_dump` logical dump (consistent, safe on a live DB) → gzip | `pg-bcweb-<ts>.sql.gz` |
| **MinIO** object storage | tar of the `<project>_minio-data` Docker volume | `minio-<ts>.tar.gz` |
| **Audit anchor** (HMAC chain root) | tar of the `<project>_audit-anchor` volume | `audit-anchor-<ts>.tar.gz` |

> Postgres is dumped with `pg_dump`, **not** by tarring the db volume under a running
> server — a live file copy is inconsistent and can restore to a corrupt state.

## Running it

```bash
# One-off, default target (/var/backups/bcweb):
infra/backup/backup.sh

# Custom target:
BACKUP_DIR=/mnt/backups infra/backup/backup.sh
```

Config via env (defaults in the script): `BACKUP_DIR`, `RETENTION_DAYS` (default 14 — local
backups older than this are pruned), `POSTGRES_USER`/`POSTGRES_DB` (default `bcweb`),
`COMPOSE_DIR`, `COMPOSE_PROJECT_NAME` (volume-name prefix).

## Schedule it (cron on the VPS)

```cron
# Daily at 03:30, appending to a log:
30 3 * * * BACKUP_DIR=/mnt/backups /opt/bcweb/BCW/BCWEB/infra/backup/backup.sh >> /var/log/bcweb-backup.log 2>&1
```

## Off-site copy (strongly recommended)

A backup on the same box is not a backup. Point `BACKUP_REMOTE` at an [rclone](https://rclone.org)
remote (configure once with `rclone config` — Backblaze B2 / S3 / Cloudflare R2 / Google
Drive all work):

```bash
BACKUP_REMOTE=b2:my-bucket/bcweb infra/backup/backup.sh
```

The script runs `rclone copy "$BACKUP_DIR" "$BACKUP_REMOTE"` after each backup. Give the
remote its own **lifecycle/versioning** (e.g. keep 30–90 days) so a bad local run can't
delete your off-site history.

## Restore

Run from `infra/compose/` (where `docker compose` sees the stack). **Restoring overwrites
current data — take a fresh backup first if the data still matters.**

### 1. Postgres

```bash
cd infra/compose
# (optional) drop & recreate a clean schema first if restoring into a dirty DB:
#   docker compose exec -T db psql -U bcweb -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c /var/backups/bcweb/pg-bcweb-<ts>.sql.gz | docker compose exec -T db psql -U bcweb bcweb
```

The API runs `prisma db push` at boot, so the schema self-heals — but the dump already
contains it, so a plain restore is enough. Restart the api after restoring: `docker compose restart api`.

### 2. MinIO object storage

```bash
cd infra/compose
docker compose stop api web            # avoid writes during restore
# Wipe + repopulate the volume from the archive:
docker run --rm -v bcweb_minio-data:/data -v /var/backups/bcweb:/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/minio-<ts>.tar.gz -C /data'
docker compose start api web
```

(Replace `bcweb_` with your `COMPOSE_PROJECT_NAME` prefix if different.)

### 3. Audit anchor (only if you also restored the DB from the same point)

```bash
docker run --rm -v bcweb_audit-anchor:/data -v /var/backups/bcweb:/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/audit-anchor-<ts>.tar.gz -C /data'
```

Keep the DB and audit-anchor from the **same** backup run so the audit HMAC chain still
verifies (`/admin/security` → verify chain).

## Verify your backups

A backup you've never restored is a hope, not a plan. Periodically: spin up a throwaway
Postgres, restore the latest `pg-*.sql.gz` into it, and confirm row counts look sane.
`gzip -t pg-*.sql.gz` at least checks the archive isn't truncated.

## Checklist

- [ ] `backup.sh` scheduled in cron.
- [ ] `BACKUP_REMOTE` set → off-site copies land.
- [ ] Off-site bucket has versioning/lifecycle.
- [ ] A restore has been tested at least once.
- [ ] Retention (`RETENTION_DAYS`) matches your recovery-window needs.
