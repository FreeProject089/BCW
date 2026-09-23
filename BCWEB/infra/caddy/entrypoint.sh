#!/bin/sh
# How the caddy container picks its config at START — the one moment a bad file used to take
# every site down.
#
# Caddy refuses a whole config over one bad directive and exits 1. The container restarts,
# refuses again, and while every other container reports healthy there is nothing in front of
# them. `infra/caddy/site.mjs` never installs a config that does not validate, but a file can
# still be edited by hand, and this script is what stands between that edit and an outage at
# the next reboot.
#
# So it tries, in order, and runs the FIRST config that validates:
#   1. live/Caddyfile   the generated file `site.mjs apply` installs (absent until the first
#                       apply — a fresh checkout has none, and that is fine)
#   2. Caddyfile        the BetterCommunity base, which imports sites.d/ and paths.d/
#   3. the base WITHOUT those two imports — BetterCommunity alone. If an extra site is what
#                       broke, the platform still comes up and only that site is missing.
# If none validates, it runs the base anyway so the log shows Caddy's own error.
#
# Every choice is logged with a `[bcweb-caddy]` prefix: `docker compose logs caddy | grep
# bcweb-caddy` says which config is serving and why.
#
# Wired in docker-compose.yml as   command: ["sh", "/etc/caddy/entrypoint.sh"]
# with the whole folder mounted:   - ../caddy:/etc/caddy:ro
set -u

LIVE=/etc/caddy/live/Caddyfile
BASE=/etc/caddy/Caddyfile
CORE=/tmp/Caddyfile.core

log() { echo "[bcweb-caddy] $*" >&2; }

valid() { caddy validate --config "$1" --adapter caddyfile >/tmp/validate.log 2>&1; }

pick() {
  if [ -f "$LIVE" ]; then
    if valid "$LIVE"; then log "serving $LIVE"; echo "$LIVE"; return; fi
    log "WARNING: $LIVE does not validate — falling back. Caddy said:"
    tail -n 3 /tmp/validate.log >&2
  fi
  if valid "$BASE"; then log "serving $BASE (base + sites.d + paths.d)"; echo "$BASE"; return; fi
  log "WARNING: $BASE with its drop-ins does not validate — trying BetterCommunity alone. Caddy said:"
  tail -n 3 /tmp/validate.log >&2
  # The base's own imports resolve next to it; the core copy lives in /tmp, so only the two
  # drop-in globs may be removed — nothing else in the base imports a FILE.
  grep -v -E '^[[:space:]]*import[[:space:]]+(sites|paths)\.d/' "$BASE" > "$CORE"
  if valid "$CORE"; then log "WARNING: serving BetterCommunity ONLY ($CORE) — fix the drop-in and run site.mjs apply"; echo "$CORE"; return; fi
  log "ERROR: nothing validates; starting $BASE so Caddy prints its own error"
  echo "$BASE"
}

CFG="$(pick)"
exec caddy run --config "$CFG" --adapter caddyfile
