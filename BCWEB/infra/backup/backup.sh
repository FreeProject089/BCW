#!/usr/bin/env bash
# BCWEB backup — dumps Postgres + archives object storage (MinIO) and the audit
# anchor, prunes old backups, and (optionally) copies off-site with rclone.
#
# Postgres is dumped with pg_dump (a consistent logical dump — the right way to back
# up a live DB; far safer than tarring db-data underneath a running server). MinIO and
# the audit anchor are archived from their Docker volumes.
#
# USAGE
#   infra/backup/backup.sh                # uses defaults below
#   BACKUP_DIR=/mnt/backups infra/backup/backup.sh
#
# CRON (daily at 03:30, log to a file) — `crontab -e` on the VPS:
#   30 3 * * * BACKUP_DIR=/mnt/backups /opt/bcweb/BCW/BCWEB/infra/backup/backup.sh >> /var/log/bcweb-backup.log 2>&1
#
# OFF-SITE (recommended): set BACKUP_REMOTE to an rclone remote (configure once with
# `rclone config` — e.g. Backblaze B2 / S3 / R2 / Google Drive):
#   BACKUP_REMOTE=b2:my-bucket/bcweb infra/backup/backup.sh
set -euo pipefail

# ── Config (override via env) ────────────────────────────────────────────────
# Compose dir is two levels up from this script (infra/backup → infra → compose).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$SCRIPT_DIR/../compose}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/bcweb}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"          # delete local backups older than this
PROJECT="${COMPOSE_PROJECT_NAME:-bcweb}"         # compose project → volume name prefix
POSTGRES_USER="${POSTGRES_USER:-bcweb}"
POSTGRES_DB="${POSTGRES_DB:-bcweb}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"               # optional rclone remote (off-site copy)
TS="$(date +%Y%m%d-%H%M%S)"

log() { printf '[backup %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
mkdir -p "$BACKUP_DIR"
cd "$COMPOSE_DIR"

# Pick the compose CLI (v2 plugin preferred, fall back to docker-compose).
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi

# ── 1. Postgres (consistent logical dump) ────────────────────────────────────
PG_OUT="$BACKUP_DIR/pg-$POSTGRES_DB-$TS.sql.gz"
log "dumping Postgres ($POSTGRES_DB)…"
$DC exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$PG_OUT"
log "  → $(du -h "$PG_OUT" | cut -f1)  $PG_OUT"

# ── 2. Object storage + audit anchor (from their Docker volumes) ─────────────
# A read-only helper container tars each named volume. Volume names are
# <project>_<key> (compose prefixes them). Skips any volume that doesn't exist.
archive_volume() {
  # NOTE: separate `local` lines on purpose — a single `local a=$1 b=$a` expands all
  # words before assigning, so `$name` would be unbound under `set -u`.
  local vol="$1"
  local name="$2"
  local out="$BACKUP_DIR/$name-$TS.tar.gz"
  if ! docker volume inspect "$vol" >/dev/null 2>&1; then
    log "skip $vol (not found)"; return 0
  fi
  log "archiving volume $vol…"
  # Non-fatal: a volume hiccup must never abort the (already-saved) Postgres dump.
  if docker run --rm -v "$vol":/data:ro -v "$BACKUP_DIR":/backup alpine \
       tar czf "/backup/$name-$TS.tar.gz" -C /data . ; then
    log "  → $(du -h "$out" | cut -f1)  $out"
  else
    log "WARN: failed to archive $vol — backup continues"; rm -f "$out"
  fi
}
archive_volume "${PROJECT}_minio-data"    "minio"
archive_volume "${PROJECT}_audit-anchor"  "audit-anchor"

# ── 3. Prune old local backups ───────────────────────────────────────────────
log "pruning local backups older than ${RETENTION_DAYS}d…"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name '*.sql.gz' -o -name '*.tar.gz' \) \
  -mtime "+$RETENTION_DAYS" -print -delete || true

# ── 4. Off-site copy (optional) ──────────────────────────────────────────────
if [ -n "$BACKUP_REMOTE" ]; then
  if command -v rclone >/dev/null 2>&1; then
    log "copying off-site → $BACKUP_REMOTE"
    rclone copy "$BACKUP_DIR" "$BACKUP_REMOTE" --transfers 4
  else
    log "WARN: BACKUP_REMOTE set but rclone not installed — skipping off-site copy"
  fi
fi

log "done. Backups in $BACKUP_DIR"
