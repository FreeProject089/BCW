#!/usr/bin/env bash
# BCWEB fast update — pull, rebuild ONLY what changed, and check it answered.
#
# deploy.sh is the safe one: it dumps the database first and can put the previous commit back.
# That is right for anything that touches the schema, and it is also two or three minutes of
# waiting for a typo fix in a blog template.
#
# This is the same update with the slow parts removed, and it removes them by KNOWING which
# ones are safe to skip rather than by trusting you to decide:
#
#   * It reads `git diff` between the old and new commit and rebuilds only the services whose
#     sources actually moved. A web-only change never rebuilds the API image.
#   * It skips the database dump — and REFUSES to run at all if the update contains a
#     migration, because that is precisely the case where the dump is the only way back.
#   * It still waits on /ready. "Fast" is worth nothing if it hides a site that did not start.
#
# It does NOT roll back. A fast path that also has to be able to reverse itself is just
# deploy.sh with extra steps; if this fails, run `infra/rollback.sh`.
#
# USAGE
#   infra/deploy-fast.sh              # pull, rebuild what changed, verify
#   infra/deploy-fast.sh --dry-run    # say what it would rebuild, change nothing
#   infra/deploy-fast.sh --force      # go ahead even with a migration in the diff (you have a dump)
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

DRY=0; FORCE=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --force)   FORCE=1 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then printf '  would run: %s\n' "$*"; else "$@"; fi; }

cd "$REPO_DIR"
command -v docker >/dev/null || die "docker not found"
[ -f "$COMPOSE" ] || die "no compose file at $COMPOSE"
[ -n "$(git status --porcelain --untracked-files=no)" ] && die "working tree has uncommitted changes — commit or stash first"

BEFORE="$(git rev-parse HEAD)"
say "Fast update from $(git rev-parse --short HEAD)"

# ── 1. Pull ─────────────────────────────────────────────────────────────────
run git pull --ff-only || die "pull failed (not a fast-forward?) — resolve it by hand"
AFTER="$(git rev-parse HEAD)"

if [ "$BEFORE" = "$AFTER" ]; then
  say "Already at the newest commit — nothing to do."
  echo "  (deploy.sh rebuilds anyway; this one does not, because rebuilding an unchanged tree"
  echo "   is the slow thing this script exists to avoid.)"
  exit 0
fi
echo "  $(git rev-parse --short "$BEFORE") → $(git rev-parse --short "$AFTER")"

CHANGED="$(git diff --name-only "$BEFORE" "$AFTER")"

# ── 2. Refuse the one case where skipping the dump is reckless ──────────────
# A migration runs at container boot and does not run backwards. Without a dump taken before
# it, a bad one has no way back at all — not "a slow way back", none. That is deploy.sh's
# whole reason to exist, so this hands the job over rather than quietly doing half of it.
if echo "$CHANGED" | grep -q '^BCWEB/packages/db/migrations/\|^packages/db/migrations/'; then
  if [ "$FORCE" = 0 ]; then
    warn "this update contains a database migration:"
    echo "$CHANGED" | grep 'packages/db/migrations/' | sed 's/^/    /'
    die "refusing the fast path — run infra/deploy.sh instead (it dumps first, which is the only
   thing that can undo a migration). Use --force if you already have a fresh dump."
  fi
  warn "migration present, --force given — you are responsible for the dump"
fi

# ── 3. Work out what actually has to be rebuilt ─────────────────────────────
# Mapped from the build contexts in docker-compose.yml: web builds from apps/web; api and
# provisioner both build from the repo root and need packages/db; bot builds from apps/bot.
# Anything outside these (guides, infra config, the compose file itself) needs a restart at
# most, and often not even that.
SERVICES=""
add() { case " $SERVICES " in *" $1 "*) ;; *) SERVICES="$SERVICES $1" ;; esac; }

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *apps/web/*)         add web ;;
    *apps/api/*)         add api ;;
    *apps/bot/*)         add bot ;;
    *apps/provisioner/*) add provisioner ;;
    # The Prisma schema is baked into both images that talk to the database.
    *packages/db/*)      add api; add provisioner ;;
  esac
done <<EOF
$CHANGED
EOF

SERVICES="$(echo "$SERVICES" | xargs || true)"

if [ -z "$SERVICES" ]; then
  say "No service sources changed"
  echo "  Changed files were outside apps/ and packages/ — docs, guides, or infra config."
  echo "  Nothing to rebuild. If you changed infra/caddy/Caddyfile, apply it with:"
  echo "    docker compose -f $COMPOSE up -d caddy"
  exit 0
fi

say "Rebuilding: $SERVICES"
# shellcheck disable=SC2086 — deliberate word splitting: these are separate service arguments.
run docker compose -f "$COMPOSE" build $SERVICES || die "build failed — nothing was replaced, the site is still up on the old version"
# shellcheck disable=SC2086
run docker compose -f "$COMPOSE" up -d $SERVICES

# ── 4. Verify ───────────────────────────────────────────────────────────────
if [ "$DRY" = 1 ]; then
  echo "  would wait up to ${READY_TIMEOUT}s for $READY_URL"
  say "Dry run — nothing changed."
  exit 0
fi

# A web-only change never touches the API, but /ready is still the cheapest proof that the
# stack as a whole is answering — and if the site is down for an unrelated reason, finding out
# now beats finding out from a visitor.
say "Waiting for $READY_URL (up to ${READY_TIMEOUT}s)"
deadline=$(( $(date +%s) + READY_TIMEOUT ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl -fsS --max-time 5 "$READY_URL" >/dev/null 2>&1; then
    printf '\033[1;32m✓ up and ready\033[0m\n'
    exit 0
  fi
  sleep 3
done

warn "never became ready within ${READY_TIMEOUT}s"
echo; echo "Last 40 lines from the API:"
docker compose -f "$COMPOSE" logs --tail=40 api || true
echo
die "this script does not roll back. To go back to $(git rev-parse --short "$BEFORE"):
   infra/rollback.sh"
