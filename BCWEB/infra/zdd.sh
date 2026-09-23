#!/bin/sh
# POSIX sh — same target as deploy.sh: a minimal box with no bash.
#
# BCWEB zero-downtime deploy.
#
# `infra/deploy.sh` is safe (backup, verify, roll back) and it is DOWN while it works:
# `docker compose up -d --build` stops the old api/web containers before the new ones serve.
# On a quiet site that gap is seconds; during it, every request is a Caddy 502.
#
# This script closes the gap with the oldest trick that actually works: for each user-facing
# service, START the new container BESIDE the old one, wait until Docker calls it healthy,
# and only then stop the old one. Caddy resolves both service names dynamically (10s refresh)
# and retries failed dials for 12s (see infra/caddy/Caddyfile), so the hand-over is invisible:
# during the overlap both containers serve; when the old one stops, its in-flight requests
# drain (the API handles SIGTERM by draining — server.mjs), its address leaves Docker's DNS,
# and any dial that races the DNS refresh is retried against the survivor.
#
# THE FAILURE MODE IS THE POINT. If a new container never becomes healthy, the new ones are
# removed and the OLD ONES ARE STILL SERVING — they were never touched. A failed deploy is a
# log line, not an outage. (deploy.sh fails the other way around: broken first, then rolled
# back.)
#
# WHAT THIS REQUIRES OF MIGRATIONS — read this before relying on the script:
#   The new api container runs its migrations at boot (boot-migrate.mjs), while the OLD code
#   is still serving. So between two adjacent deploys, migrations must be ADDITIVE: add the
#   column, don't drop or rename what the running code still reads. Drop it in the deploy
#   AFTER the one that stopped using it (expand → migrate code → contract). A destructive
#   migration makes the old containers throw during the overlap — which is exactly the
#   downtime this script exists to avoid, moved into the database where it is worse. If a
#   deploy MUST break the schema, use deploy.sh and accept the gap.
#
# ROLLED SERVICES:  api, web            (a visitor is looking at these)
# RECREATED PLAIN:  bot, telemetry, provisioner, and anything else `up -d` decides changed —
#                   a Discord bot reconnecting or a dashboard blinking is not an outage.
# NEVER RESTARTED:  caddy (a restart IS the outage; config changes go through `caddy reload`,
#                   which is graceful — this script does that itself when the Caddyfile hash
#                   changed), db, redis, minio (stateful; rolling them means a failover
#                   story this stack does not have and should not pretend to).
#
# USAGE
#   infra/zdd.sh                # backup, pull, build, roll api+web, refresh the rest
#   infra/zdd.sh --no-pull      # deploy the working tree as it stands
#   infra/zdd.sh --no-backup    # skip the dump (you took one minutes ago)
#   infra/zdd.sh --dry-run      # print the plan, change nothing
#
# ENV
#   HEALTH_TIMEOUT   seconds to wait for a new container to be healthy   (default 180)
#   DRAIN_GRACE      seconds docker stop waits before SIGKILL            (default 30)
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR/compose"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
DRAIN_GRACE="${DRAIN_GRACE:-30}"
DO_PULL=1; DO_BACKUP=1; DRY=0

for a in "$@"; do
  case "$a" in
    --no-pull)   DO_PULL=0 ;;
    --no-backup) DO_BACKUP=0 ;;
    --dry-run)   DRY=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

say()  { printf '%s\n' "== $*"; }
run()  { if [ "$DRY" = 1 ]; then printf 'DRY  %s\n' "$*"; else "$@"; fi; }
dc()   { docker compose --project-directory "$COMPOSE_DIR" "$@"; }

# ── 0. Preconditions ─────────────────────────────────────────────────────────
# A rolling deploy of a stack that is not running is just a deploy; refuse the confusion.
if ! dc ps -q api | grep -q .; then
  echo "api is not running — nothing to roll. Use infra/deploy.sh for a cold start." >&2
  exit 2
fi

# ── 1. Backup, pull, build ───────────────────────────────────────────────────
# The dump is for the MIGRATION, not the code: rolling back containers cannot un-run a
# migration, and the dump is the only thing that can (see deploy.sh's header).
if [ "$DO_BACKUP" = 1 ]; then say "backup"; run "$SCRIPT_DIR/backup/backup.sh"; fi
if [ "$DO_PULL"  = 1 ]; then say "pull";   run git -C "$SCRIPT_DIR/.." pull --ff-only; fi

say "build (the old containers keep serving through all of this)"
run dc build api web bot

# ── 2. Roll one service: new beside old, wait healthy, retire old ────────────
# `--no-recreate` is the load-bearing flag: with it, `up --scale N` leaves the running
# containers ALONE and only creates the missing ones — which are created from the image just
# built. Without it, compose would recreate the old ones in place, which is the downtime.
health_of() { docker inspect --format '{{.State.Health.Status}}' "$1" 2>/dev/null || echo unknown; }

roll() {
  svc="$1"
  old_ids="$(dc ps -q "$svc")"
  old_n="$(printf '%s\n' "$old_ids" | grep -c . || true)"
  say "roll $svc ($old_n old container(s))"

  run dc up -d --no-deps --no-recreate --scale "$svc=$((old_n * 2))" "$svc"
  [ "$DRY" = 1 ] && return 0

  new_ids="$(dc ps -q "$svc" | grep -vxF "$old_ids" || true)"
  if [ -z "$new_ids" ]; then echo "no new $svc container appeared" >&2; exit 1; fi

  # Wait for EVERY new container. Health, not /ready over a port: rolled replicas land on
  # arbitrary host ports (api publishes a range), and the container-internal healthcheck is
  # port-independent and already probes the same endpoint.
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  for id in $new_ids; do
    while :; do
      st="$(health_of "$id")"
      [ "$st" = healthy ] && break
      if [ "$(date +%s)" -ge "$deadline" ] || [ "$st" = unhealthy ]; then
        echo "new $svc container $id is '$st' — removing the NEW containers; the old ones never stopped serving." >&2
        docker stop -t 5 $new_ids >/dev/null 2>&1 || true
        docker rm -f $new_ids >/dev/null 2>&1 || true
        dc up -d --no-deps --no-recreate --scale "$svc=$old_n" "$svc" >/dev/null 2>&1 || true
        exit 1
      fi
      sleep 2
    done
    say "  $svc $id healthy"
  done

  # Retire the old ones one at a time. `docker stop` is SIGTERM: the API drains its open
  # requests before exiting, and Caddy's dial-retry covers the DNS lag for new ones.
  for id in $old_ids; do
    say "  draining old $id"
    run docker stop -t "$DRAIN_GRACE" "$id"
    run docker rm "$id"
  done

  # Tell compose the intended scale again so a later plain `up -d` does not "fix" anything.
  run dc up -d --no-deps --no-recreate --scale "$svc=$old_n" "$svc"
}

# API first: it runs the migrations at boot, and web's new bundle may already call routes
# only the new API has. The other order would 404 the overlap.
roll api
roll web

# ── 3. Everything a visitor is not looking at ────────────────────────────────
say "refresh the rest (bot, telemetry, provisioner — a blip here is not an outage)"
run dc up -d --no-deps bot telemetry provisioner

# Caddy: reload, never restart. `caddy reload` applies a changed Caddyfile with no dropped
# connections; when nothing changed it is a no-op.
#
# Reload the file Caddy RUNS: live/Caddyfile once `infra/caddy/site.mjs apply` has installed
# one (entrypoint.sh starts on it), the base otherwise. Reloading the base over a live file
# would quietly swap the reviewed config for base + whatever sits in sites.d/ right now.
# A pull that changed the base itself reaches a live file only through `site.mjs apply`,
# which shows the diff first — said below rather than done here, because it asks a question.
say "caddy reload (graceful)"
run dc exec -T caddy sh -c 'c=/etc/caddy/live/Caddyfile; [ -f "$c" ] || c=/etc/caddy/Caddyfile; caddy reload --config "$c" --adapter caddyfile' 2>/dev/null || say "  caddy reload skipped (container busy or config unchanged)"
if [ -f "$SCRIPT_DIR/caddy/live/Caddyfile" ]; then
  say "  extra sites: if this pull changed infra/caddy/, run  node infra/caddy/site.mjs diff  then  apply"
fi

say "done — at no point did the site have zero serving containers"
