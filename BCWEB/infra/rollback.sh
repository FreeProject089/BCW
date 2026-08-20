#!/usr/bin/env bash
# BCWEB rollback — put the previous commit back, deliberately.
#
# deploy.sh already rolls back on its own when a deploy never becomes ready. This is for the
# other case, which is the more common one: the deploy SUCCEEDED, the site came up fine, and
# twenty minutes later somebody notices the thing it broke. Nothing automatic fires then,
# because nothing failed.
#
# WHAT IT DOES NOT DO, and this is the important part: it does not touch the database.
# Migrations run at container boot and do not run backwards. Going back to the previous commit
# restores the CODE against the NEW schema. That combination is usually fine — most migrations
# add things, and code that does not know about a new column simply ignores it — but it is not
# guaranteed, and a script cannot tell the difference. So this says plainly what it moved and
# what it did not, and leaves the database to you.
#
# USAGE
#   infra/rollback.sh               # back one commit, rebuild, verify
#   infra/rollback.sh <commit>      # back to a specific commit
#   infra/rollback.sh --dry-run     # print what would happen, change nothing
#
# ENV
#   READY_TIMEOUT   seconds to wait for /ready   (default 120)
#   READY_URL       probe address                (default http://127.0.0.1:3000/ready)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE="$SCRIPT_DIR/compose/docker-compose.yml"
READY_URL="${READY_URL:-http://127.0.0.1:3000/ready}"
READY_TIMEOUT="${READY_TIMEOUT:-120}"

DRY=0; TARGET=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    -*) echo "unknown option: $a" >&2; exit 2 ;;
    *) TARGET="$a" ;;
  esac
done

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then printf '  would run: %s\n' "$*"; else "$@"; fi; }

cd "$REPO_DIR"
command -v docker >/dev/null || die "docker not found"
[ -f "$COMPOSE" ] || die "no compose file at $COMPOSE"

# `git reset --hard` is what puts the code back, and it discards uncommitted work without
# asking. Refusing here is the difference between a rollback and a loss.
[ -n "$(git status --porcelain --untracked-files=no)" ] && die "working tree has uncommitted changes — commit or stash them first (reset --hard would discard them)"

CURRENT="$(git rev-parse HEAD)"
TARGET="${TARGET:-HEAD~1}"
git rev-parse --verify --quiet "$TARGET^{commit}" >/dev/null || die "no such commit: $TARGET"
TARGET_SHA="$(git rev-parse "$TARGET")"

[ "$CURRENT" = "$TARGET_SHA" ] && die "already at $(git rev-parse --short "$TARGET_SHA") — nothing to roll back"

say "Rolling back $(git rev-parse --short "$CURRENT") → $(git rev-parse --short "$TARGET_SHA")"
git --no-pager log --oneline "$TARGET_SHA".."$CURRENT" | sed 's/^/  undoing: /'

# Say it BEFORE doing it, while it can still be cancelled — a warning printed afterwards is
# just an explanation.
if git diff --name-only "$TARGET_SHA" "$CURRENT" | grep -q 'packages/db/migrations/'; then
  echo
  warn "THIS RANGE CONTAINS A MIGRATION."
  git diff --name-only "$TARGET_SHA" "$CURRENT" | grep 'packages/db/migrations/' | sed 's/^/    /'
  echo "  The schema stays as it is now. The old code will run against the new schema, which is"
  echo "  usually fine and occasionally is not. If it is not, restore a dump from before that"
  echo "  migration — see guides/run/BACKUP_EN.md."
fi

if [ "$DRY" = 1 ]; then
  echo
  run git reset --hard "$TARGET_SHA"
  run docker compose -f "$COMPOSE" build
  run docker compose -f "$COMPOSE" up -d
  echo "  would wait up to ${READY_TIMEOUT}s for $READY_URL"
  say "Dry run — nothing changed."
  exit 0
fi

# The commit being left behind, printed so it can be found again. `reset --hard` moves the
# branch; without this the only trace is the reflog, which is not where anybody looks first.
echo
echo "  to undo THIS rollback:  git reset --hard $CURRENT && infra/deploy.sh --no-backup"
echo

git reset --hard "$TARGET_SHA"
docker compose -f "$COMPOSE" build || die "build failed at the OLD commit — that is unexpected; the running containers are untouched"
docker compose -f "$COMPOSE" up -d

say "Waiting for $READY_URL (up to ${READY_TIMEOUT}s)"
deadline=$(( $(date +%s) + READY_TIMEOUT ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl -fsS --max-time 5 "$READY_URL" >/dev/null 2>&1; then
    printf '\033[1;32m✓ rolled back and ready\033[0m\n'
    exit 0
  fi
  sleep 3
done

warn "the OLD version is not answering either"
echo; echo "Last 40 lines from the API:"
docker compose -f "$COMPOSE" logs --tail=40 api || true
echo
die "if the previous version does not come up, the fault is probably not the code — check the
   database and the disk before rolling back any further."
