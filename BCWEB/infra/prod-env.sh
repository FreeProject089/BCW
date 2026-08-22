#!/bin/sh
# POSIX sh: the target is a minimal Alpine container, which has no bash.
#
# Point an EXISTING .env at a real domain, and fill in any secret still missing.
#
# WHAT THIS IS NOT
#
# It is not bootstrap.sh. That one CREATES a .env on a virgin machine and refuses to run if
# one exists — for the right reason: rewriting POSTGRES_PASSWORD against an already
# initialised database locks you out of your own Postgres, and no amount of editing .env
# afterwards undoes it. The volume keeps the password it was created with.
#
# So this script has one rule above all others:
#
#   IT NEVER CHANGES A VALUE THAT IS ALREADY SET.
#
# Not the database password, not a secret, not a key you pasted in by hand. It only
#   · rewrites the DOMAIN values, which are the ones that must change to go live, and
#   · fills secrets that are still empty or still say change-me-*.
#
# Running it twice does nothing the second time. That is deliberate: a script you are
# afraid to re-run is a script nobody runs.
#
# Usage:
#   infra/prod-env.sh bettercommunity.ch                 # apply
#   infra/prod-env.sh bettercommunity.ch --dry-run       # show the diff, touch nothing
#   infra/prod-env.sh bettercommunity.ch --site app      # site on app.<domain> (default)
#   infra/prod-env.sh bettercommunity.ch --site @        # site on the bare domain
#
# After it runs, the stack must be RECREATED, not restarted — `docker compose restart`
# does not re-read .env:
#   cd infra/compose && docker compose up -d --force-recreate

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/compose/.env"

say()  { printf '\n\033[1;36m> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mx %s\033[0m\n' "$*" >&2; exit 1; }

DOMAIN=""
SITE_SUB="app"
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --site)    shift; [ $# -gt 0 ] || die "--site needs a value (a sub-domain, or @ for the bare domain)"; SITE_SUB="$1" ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    -*)        die "unknown option: $1" ;;
    *)         DOMAIN="$1" ;;
  esac
  shift
done

[ -n "$DOMAIN" ] || die "usage: infra/prod-env.sh <domain> [--site <sub>|@] [--dry-run]"
[ -f "$ENV_FILE" ] || die "no .env at $ENV_FILE — run infra/bootstrap.sh first, this script only updates an existing one"

# A bare domain, not a URL. Accepting https://x here and pasting it into SITE_DOMAIN gives
# Caddy an address it cannot get a certificate for, and the failure appears as a TLS error
# nobody connects back to this file.
case "$DOMAIN" in
  *://*|*/*) die "give the bare domain, without scheme or path (bettercommunity.ch, not https://bettercommunity.ch/)" ;;
esac

if [ "$SITE_SUB" = "@" ]; then
  SITE_HOST="$DOMAIN"
else
  SITE_HOST="$SITE_SUB.$DOMAIN"
fi

# ── secret generation ────────────────────────────────────────────────────────
#
# openssl if present, /dev/urandom otherwise. Never $RANDOM or the date: both are
# predictable, and a predictable JWT_SECRET is the same as no JWT_SECRET.
gen() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif [ -r /dev/urandom ]; then
    # tr drops everything outside the class, so the count is taken AFTER filtering.
    tr -dc 'a-f0-9' < /dev/urandom | head -c 64
    echo
  else
    die "no openssl and no /dev/urandom — cannot generate a secret safely"
  fi
}

TMP="$ENV_FILE.prod-env.$$"
cp "$ENV_FILE" "$TMP"
trap 'rm -f "$TMP" "$TMP.n"' EXIT

CHANGED=""
note() { CHANGED="$CHANGED
  $1"; }

# Read a key's current value (empty when the line is absent or commented).
current() {
  sed -n "s/^$1=//p" "$TMP" | head -1
}

# Set a key. Rewrites the line in place if present (commented or not), appends otherwise.
# The value is written with a literal-safe delimiter because URLs contain slashes.
set_key() {
  k="$1"; v="$2"
  if grep -q "^#\{0,1\}$k=" "$TMP"; then
    awk -v k="$k" -v v="$v" '
      $0 ~ "^#?" k "=" && !done { print k "=" v; done = 1; next }
      { print }
    ' "$TMP" > "$TMP.n" && mv "$TMP.n" "$TMP"
  else
    printf '%s=%s\n' "$k" "$v" >> "$TMP"
  fi
}

# Only fill what is empty or still a placeholder. This is the rule the whole script exists
# for: an already-set secret is somebody's working configuration.
fill_secret() {
  k="$1"
  cur="$(current "$k")"
  case "$cur" in
    ''|change-me*|CHANGEME*|changeme*)
      set_key "$k" "$(gen)"
      note "$k  (generated)"
      ;;
    *) : ;;   # already set — untouched, on purpose
  esac
}

set_domain() {
  k="$1"; v="$2"
  cur="$(current "$k")"
  if [ "$cur" = "$v" ]; then return 0; fi
  set_key "$k" "$v"
  note "$k = $v"
}

# ── 1. the domain ────────────────────────────────────────────────────────────
say "Domain: $SITE_HOST (cookies shared across .$DOMAIN)"

# SITE_DOMAIN is what Caddy serves and gets a certificate for: a BARE host, no scheme.
set_domain SITE_DOMAIN "$SITE_HOST"
# SITE_URL is the full public URL — Stripe and every OAuth callback are built from it.
set_domain SITE_URL "https://$SITE_HOST"
# The ROOT domain with a leading dot, so the session cookie also reaches telemetry.
# Scoping it to the site sub-domain instead would let telemetry log you in and break the
# main site, which is the sort of thing that takes a day to find.
set_domain COOKIE_DOMAIN ".$DOMAIN"
# Telemetry MUST be a sub-domain of the same root, or the cookie never reaches it.
set_domain TELEMETRY_DOMAIN "https://telemetry.$DOMAIN"
set_domain TELEMETRY_PUBLIC_URL "https://telemetry.$DOMAIN"
# S3: both of these or neither. A public endpoint without the Caddy host is a hostname that
# resolves to nothing useful; the Caddy host without the endpoint means browsers keep being
# handed :9000 URLs they cannot reach.
set_domain S3_DOMAIN "s3.$DOMAIN"
set_domain S3_PUBLIC_ENDPOINT "https://s3.$DOMAIN"

# ── 2. secrets ───────────────────────────────────────────────────────────────
say "Secrets (only the ones still empty or still change-me)"

# The API refuses to boot without these three, and .env.example ships them COMMENTED OUT.
# A generator that only matches ^KEY= leaves them commented and the stack never starts.
for k in JWT_SECRET LINK_LOOKUP_SECRET BOT_SHARED_SECRET AUDIT_SECRET \
         S3_SECRET_KEY TELEMETRY_ADMIN_KEY; do
  fill_secret "$k"
done

# POSTGRES_PASSWORD is deliberately absent from that list. The database volume was created
# with the current one; changing it here does not change the database, it only stops the
# API being able to open it.
pg="$(current POSTGRES_PASSWORD)"
case "$pg" in
  ''|change-me*) warn "POSTGRES_PASSWORD still looks like a placeholder — NOT touched. If the stack works, it is right and .env.example is what is stale." ;;
  *) : ;;
esac

# ── 3. report / write ────────────────────────────────────────────────────────
if [ -z "$CHANGED" ]; then
  say "Nothing to change — .env already matches $SITE_HOST and every secret is set."
  exit 0
fi

say "Changes"
printf '%s\n' "$CHANGED"

if [ "$DRY" = 1 ]; then
  say "Dry run — $ENV_FILE untouched."
  exit 0
fi

BACKUP="$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
cp "$ENV_FILE" "$BACKUP"
cat "$TMP" > "$ENV_FILE"
chmod 600 "$ENV_FILE" 2>/dev/null || warn "could not chmod 600 $ENV_FILE — check who can read it"

say "Written. Previous file kept at $BACKUP"
cat <<EOF

Next, and it is not optional:

  cd $SCRIPT_DIR/compose && docker compose up -d --force-recreate

\`docker compose restart\` does NOT re-read .env. Restarting instead of recreating is the
single most common way this change appears to do nothing.

Still yours to fill in, when you have them (nothing here can invent them):

  STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET   payments
  SMTP_* + EMAIL_ENABLED=true                 outgoing mail
  DISCORD_TOKEN                               the bot
  *_CLIENT_ID / *_CLIENT_SECRET               GitHub / Discord / Google sign-in

And the DNS records these values now assume:

  $SITE_HOST            A   -> this server
  telemetry.$DOMAIN     A   -> this server
  s3.$DOMAIN            A   -> this server
EOF
