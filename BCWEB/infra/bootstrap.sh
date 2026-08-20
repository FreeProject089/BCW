#!/usr/bin/env bash
# BCWEB first install — a fresh machine to a working site, once.
#
# This is NOT deploy.sh. deploy.sh updates an install that already exists: it backs up, pulls,
# rebuilds and can roll back. None of that applies the first time — there is nothing to back
# up, nothing to pull, and nothing to roll back to. What the first time needs instead is the
# part people get wrong: real secrets, before anything starts.
#
# WHY THAT ORDER MATTERS
#   .env.example is committed to a public repo, placeholders and all. Copy it, start the stack,
#   and JWT_SECRET is a value anyone reading the repo already knows — which means anyone can
#   forge an admin session the moment the site is reachable. The API's boot-guard refuses to
#   start in production with those placeholders, so the usual first experience is a container
#   that will not boot and an error nobody expects during a first install.
#
#   POSTGRES_PASSWORD has a second reason. Postgres reads it only when it initialises its data
#   volume, on the very first start. Set it afterwards and .env and the database disagree
#   forever, and the fix is deleting the volume. So it has to be right BEFORE the first `up`,
#   which is exactly what this script is for. (infra/rotate-secrets.mjs handles the after case,
#   both sides at once — but it needs a running database, so it cannot do this one.)
#
# USAGE
#   infra/bootstrap.sh              # generate secrets, start, migrate, seed
#   infra/bootstrap.sh --dry-run    # print every step, change nothing
#   infra/bootstrap.sh --no-seed    # start it, leave the database empty
#
# It refuses to run if infra/compose/.env already exists. Overwriting it would rewrite the
# database password out from under a volume that was created with the old one.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_DIR="$SCRIPT_DIR/compose"
ENV_FILE="$COMPOSE_DIR/.env"
READY_URL="${READY_URL:-http://127.0.0.1:3000/ready}"
READY_TIMEOUT="${READY_TIMEOUT:-180}"

DRY=0; DO_SEED=1
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --no-seed) DO_SEED=0 ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then printf '  would run: %s\n' "$*"; else "$@"; fi; }

cd "$REPO_DIR"
command -v docker >/dev/null || die "docker not found — install Docker and Docker Compose v2 first"
docker compose version >/dev/null 2>&1 || die "'docker compose' not available (v2 required; the old docker-compose binary will not do)"
[ -f "$COMPOSE_DIR/docker-compose.yml" ] || die "no compose file at $COMPOSE_DIR — run this from the BCWEB checkout"
[ -f "$COMPOSE_DIR/.env.example" ] || die "no .env.example at $COMPOSE_DIR"

if [ -f "$ENV_FILE" ]; then
  die "$ENV_FILE already exists — this machine is already set up.
   To update it:            infra/deploy.sh
   To replace its secrets:  node infra/rotate-secrets.mjs
   Overwriting .env here would change POSTGRES_PASSWORD without changing the database, and
   nothing would be able to connect afterwards."
fi

# ── 1. Secrets ──────────────────────────────────────────────────────────────
# openssl is on essentially every Linux server; node is a fallback because this repo needs it
# anyway. Failing loudly beats quietly writing a weak value into a file nobody re-reads.
gen() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  elif command -v node >/dev/null 2>&1; then node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  else die "need openssl or node to generate secrets"; fi
}

# Three of these ship COMMENTED OUT in .env.example (`#BOT_SHARED_SECRET=`), so the code falls
# back to values that are in the repository. The API's boot-guard refuses to start in
# production for exactly that reason — it checks per PURPOSE, and the purposes are: session
# tokens (JWT_SECRET), Discord bot auth (BOT_SHARED_SECRET or LINK_LOOKUP_SECRET), and link
# lookup (BC_LINK_SECRET or LINK_LOOKUP_SECRET).
#
# A first version of this script only matched `^KEY=` and therefore skipped every commented
# one, leaving a .env that looked freshly secured and could not boot in production. So the
# commented form is handled too, and the result is verified below rather than assumed.
SECRETS="POSTGRES_PASSWORD JWT_SECRET BOT_SHARED_SECRET LINK_LOOKUP_SECRET AUDIT_SECRET S3_SECRET_KEY TELEMETRY_ADMIN_KEY"

say "Writing $ENV_FILE with fresh secrets"
if [ "$DRY" = 1 ]; then
  echo "  would copy .env.example → .env and set:"
  for key in $SECRETS; do echo "    $key"; done
else
  cp "$COMPOSE_DIR/.env.example" "$ENV_FILE"
  for key in $SECRETS; do
    value="$(gen)"
    # `|` as the sed delimiter: a hex secret cannot contain one, where `/` could appear in a
    # value and break the expression. Anchored so a key name appearing inside some other
    # variable's value is never rewritten.
    if grep -qE "^${key}=" "$ENV_FILE"; then
      sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"; echo "  ${key} ✓"
    elif grep -qE "^#${key}=" "$ENV_FILE"; then
      sed -i "s|^#${key}=.*|${key}=${value}|" "$ENV_FILE"; echo "  ${key} ✓ (was commented out)"
    else
      printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"; echo "  ${key} ✓ (appended)"
    fi
  done
  chmod 600 "$ENV_FILE" 2>/dev/null || true

  # Prove it, rather than trust the loop. Each of these must now be a live line with a value.
  for key in JWT_SECRET BOT_SHARED_SECRET LINK_LOOKUP_SECRET POSTGRES_PASSWORD; do
    grep -qE "^${key}=.+" "$ENV_FILE" || die "$key did not get set — refusing to start with a secret from the repo. Delete $ENV_FILE and re-run."
  done
  if grep -q 'change-me' "$ENV_FILE"; then
    warn "some placeholders are still in .env (deliberate — they are not secrets the guard checks):"
    grep -n 'change-me' "$ENV_FILE" | sed 's/^/    /'
    warn "SEED_ADMIN_PASSWORD in particular: set it BEFORE the seed step below, or the admin account is created with it."
  fi
fi

# ── 2. Start ────────────────────────────────────────────────────────────────
say "Building and starting (first run pulls images — this takes a while)"
run docker compose -f "$COMPOSE_DIR/docker-compose.yml" up -d --build

# ── 3. Wait for it to actually answer ───────────────────────────────────────
# /ready is 503 until the API can query the database. Migrations run at container boot, so
# this window covers them too — on a first install that is the whole schema being created.
wait_ready() {
  local deadline=$(( $(date +%s) + READY_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    curl -fsS --max-time 5 "$READY_URL" >/dev/null 2>&1 && return 0
    sleep 3
  done
  return 1
}

if [ "$DRY" = 1 ]; then
  echo "  would wait up to ${READY_TIMEOUT}s for $READY_URL"
  [ "$DO_SEED" = 1 ] && echo "  would run: docker compose exec api npm run setup"
  say "Dry run — nothing changed."
  exit 0
fi

say "Waiting for $READY_URL (up to ${READY_TIMEOUT}s)"
if ! wait_ready; then
  warn "never became ready within ${READY_TIMEOUT}s"
  echo; echo "Last 40 lines from the API:"
  docker compose -f "$COMPOSE_DIR/docker-compose.yml" logs --tail=40 api || true
  die "stopped before seeding — fix the above, then re-run with the .env that now exists:
   docker compose -f $COMPOSE_DIR/docker-compose.yml up -d"
fi
printf '\033[1;32m✓ the API is up and can reach the database\033[0m\n'

# ── 4. Seed ─────────────────────────────────────────────────────────────────
# Idempotent, so a re-run is safe. It creates the admin account only if one does not exist —
# which is why SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD have to be set BEFORE this, and why
# re-running never resets a password that has since been changed.
if [ "$DO_SEED" = 1 ]; then
  say "Seeding (projects, admin account, plans, docs, FAQ)"
  docker compose -f "$COMPOSE_DIR/docker-compose.yml" exec -T api npm run setup \
    || warn "seed failed — the site is up but empty. Re-run: docker compose exec api npm run setup"
fi

# ── 5. What is left for a human ─────────────────────────────────────────────
say "Done — and here is what this script could NOT do for you"
cat <<'TXT'

  1. THE DOMAIN. .env still says localhost in six places, and it is not one value. Leaving
     COOKIE_DOMAIN on localhost is the one that hurts: sign-in answers "welcome" and the next
     request arrives anonymous, because the browser silently drops a cookie scoped to a host
     it is not on. → guides/run/DOMAIN_SETUP_EN.md

  2. THE ADMIN ACCOUNT. If you did not set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD before this
     ran, it is admin@bettercommunity.local / change-me-now. Change it now, not later.

  3. BACKUPS. There is nothing to restore yet, which is the easiest moment to set them up and
     the one everybody skips. → guides/run/BACKUP_EN.md

  From here on, updates are:  infra/deploy.sh

TXT
