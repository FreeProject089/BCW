#!/usr/bin/env bash
# BCWEB deploy — back up, pull, rebuild, and put it back if it does not come up.
#
# The two-command update (git pull + docker compose up -d --build) works and is what the
# guide documented. What it does not have is the part you need at 2am: a way back. This adds
# three things around it, and nothing else.
#
#   1. A BACKUP FIRST. Migrations run at container boot and they do not run backwards. Going
#      back to the previous commit restores the code and leaves the schema where it was, so
#      the dump taken before the deploy is the only thing that can undo a bad migration.
#   2. A WAIT ON /ready. That endpoint returns 503 until the API can reach the database, so
#      "the container started" and "the site works" are not confused with each other.
#   3. AN AUTOMATIC ROLLBACK of the CODE if the probe never goes green — back to the commit
#      you were on, rebuilt, and re-checked.
#
# What it deliberately does NOT do: restore the database automatically. A rollback that
# silently reverts data is a rollback that can destroy work committed between the dump and
# the failure. The dump's path is printed instead, and restoring it is your decision.
#
# USAGE
#   infra/deploy.sh                 # backup, pull, deploy, verify, roll back on failure
#   infra/deploy.sh --no-backup     # skip the dump (you already have one from minutes ago)
#   infra/deploy.sh --no-rollback   # leave the broken version up so you can look at it
#   infra/deploy.sh --dry-run       # print what would happen, change nothing
#
# ENV
#   READY_TIMEOUT   seconds to wait for /ready        (default 120)
#   READY_URL       probe address                     (default http://127.0.0.1:3000/ready)
#   BACKUP_DIR      passed through to backup.sh       (default: backup.sh's own)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_DIR="$SCRIPT_DIR/compose"
READY_URL="${READY_URL:-http://127.0.0.1:3000/ready}"
READY_TIMEOUT="${READY_TIMEOUT:-120}"

DO_BACKUP=1; DO_ROLLBACK=1; DRY=0
for a in "$@"; do
  case "$a" in
    --no-backup)   DO_BACKUP=0 ;;
    --no-rollback) DO_ROLLBACK=0 ;;
    --dry-run)     DRY=1 ;;
    -h|--help)     sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then printf '  would run: %s\n' "$*"; else "$@"; fi; }

cd "$REPO_DIR"
command -v docker >/dev/null || die "docker not found"
[ -f "$COMPOSE_DIR/docker-compose.yml" ] || die "no compose file at $COMPOSE_DIR"

# The commit to come back to, resolved BEFORE anything moves. If the working tree is dirty
# the deploy stops: rolling back with `git reset --hard` would take uncommitted work with it,
# and a deploy script is not the place to discover that.
BEFORE="$(git rev-parse HEAD)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  die "working tree has uncommitted changes — commit or stash them first (rollback would discard them)"
fi
say "Deploying from $(git rev-parse --short HEAD) on $(git rev-parse --abbrev-ref HEAD)"

# ── 1. Backup ───────────────────────────────────────────────────────────────
DUMP_HINT=""
if [ "$DO_BACKUP" = 1 ]; then
  say "Backing up first"
  if [ -x "$SCRIPT_DIR/backup/backup.sh" ]; then
    run "$SCRIPT_DIR/backup/backup.sh" || die "backup failed — refusing to deploy without one (use --no-backup to override)"
    DUMP_HINT="${BACKUP_DIR:-/var/backups/bcweb}"
  else
    warn "backup/backup.sh not executable — skipping. chmod +x it."
  fi
else
  warn "backup skipped (--no-backup)"
fi

# ── 2. Pull ─────────────────────────────────────────────────────────────────
say "Pulling"
run git pull --ff-only || die "pull failed (not a fast-forward?) — resolve it by hand"
AFTER="$(git rev-parse HEAD)"
if [ "$BEFORE" = "$AFTER" ] && [ "$DRY" = 0 ]; then
  warn "already at the newest commit — rebuilding anyway"
else
  echo "  $(git rev-parse --short "$BEFORE") → $(git rev-parse --short "$AFTER")"
fi

# ── 3. Build and start ──────────────────────────────────────────────────────
# Build BEFORE up, as its own step: a compile error should fail here with the running site
# untouched, rather than half way through replacing containers.
say "Building"
run docker compose -f "$COMPOSE_DIR/docker-compose.yml" build || die "build failed — nothing was replaced, the site is still up on the old version"

say "Starting"
run docker compose -f "$COMPOSE_DIR/docker-compose.yml" up -d

# ── 4. Wait for it to actually work ─────────────────────────────────────────
# /ready is 503 until the API can query the database, so this waits for the thing that
# matters rather than for a process to exist. Migrations run at boot, so this window also
# covers them.
wait_ready() {
  local deadline=$(( $(date +%s) + READY_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 "$READY_URL" >/dev/null 2>&1; then return 0; fi
    sleep 3
  done
  return 1
}

if [ "$DRY" = 1 ]; then
  echo "  would wait up to ${READY_TIMEOUT}s for $READY_URL"
  say "Dry run — nothing changed."
  exit 0
fi

say "Waiting for $READY_URL (up to ${READY_TIMEOUT}s)"
if wait_ready; then
  printf '\033[1;32m✓ up and ready\033[0m\n'
  [ -n "$DUMP_HINT" ] && echo "  backup from before this deploy: $DUMP_HINT"
  exit 0
fi

# ── 5. It did not come up ───────────────────────────────────────────────────
warn "never became ready within ${READY_TIMEOUT}s"
echo
echo "Last 40 lines from the API:"
docker compose -f "$COMPOSE_DIR/docker-compose.yml" logs --tail=40 api || true
echo

if [ "$DO_ROLLBACK" = 0 ]; then
  warn "rollback disabled (--no-rollback) — the broken version is still up, go and look at it"
  exit 1
fi

if [ "$BEFORE" = "$AFTER" ]; then
  die "nothing to roll back to — this was already the deployed commit, so the failure is not the pull"
fi

say "Rolling the CODE back to $(git rev-parse --short "$BEFORE")"
git reset --hard "$BEFORE"
docker compose -f "$COMPOSE_DIR/docker-compose.yml" build
docker compose -f "$COMPOSE_DIR/docker-compose.yml" up -d

if wait_ready; then
  printf '\033[1;32m✓ rolled back and ready\033[0m\n'
else
  warn "the OLD version is not ready either — this is probably not the deploy. Check the database."
fi

echo
warn "THE DATABASE WAS NOT ROLLED BACK."
cat <<TXT

  Migrations run at boot and do not run backwards, so the schema is still the new one. If
  the failure was a migration, the dump taken before this deploy is what undoes it:

    ${DUMP_HINT:-<no backup was taken>}

  Restoring is deliberately manual — it would discard anything written between that dump and
  now, and only you can say whether that is acceptable. The restore procedure is in
  guides/run/DEPLOY_EN.md, section 10.

TXT
exit 1
