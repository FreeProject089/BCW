#!/bin/sh
# The ONLY thing the GitHub deploy key can run on the server.
#
# The key is installed in ~/.ssh/authorized_keys with a forced command:
#
#   restrict,command="/srv/BetterCommunity/deploy-gate.sh" ssh-ed25519 AAAA… bcweb-deploy@github-actions
#
# `restrict` turns off the pty, port/agent/X11 forwarding and ~/.ssh/rc; `command=` means that
# whatever the client asks for, sshd runs THIS script instead and hands the request over in
# $SSH_ORIGINAL_COMMAND. So a stolen deploy key can do exactly what this file allows and
# nothing else: no shell, no file copy, no tunnel into the database.
#
# What it allows:
#   status                    print the deployed commit and the state of the containers
#   deploy <40-hex sha>       deploy that commit, which MUST be the current tip of origin/master
#   deploy <40-hex sha> --dry-run
#
# Why only the tip of origin/master: the key cannot be used to put an old, vulnerable commit
# back into production, nor a commit that exists only on some branch. The code that runs is
# the code the repository's master says, fetched by the server itself over HTTPS.
#
# INSTALL (once, by the server's owner; the copy runs from OUTSIDE the repository, so a commit
# cannot rewrite the gate that is about to deploy it):
#   install -m 0755 BCWEB/infra/deploy-gate.sh /srv/BetterCommunity/deploy-gate.sh
#
# KILL SWITCH: while /srv/BetterCommunity/deploy-gate.disabled exists, every deploy is refused
# (status still answers). `touch` it to stop CD at once; `rm` it to allow deploys again.
#
# POSIX sh: the server is Alpine, no bash.
set -eu

REPO_DIR="${DEPLOY_REPO_DIR:-/srv/BetterCommunity/BCW}"
STATE_DIR="${DEPLOY_STATE_DIR:-/srv/BetterCommunity}"
DISABLED="$STATE_DIR/deploy-gate.disabled"
LOG_DIR="$STATE_DIR/deploy-logs"
LOCK="$STATE_DIR/deploy-gate.lock"
BRANCH="master"

die() { printf 'deploy-gate: %s\n' "$*" >&2; exit 1; }

# sshd sets SSH_ORIGINAL_COMMAND to what the client asked for. Run by hand (no ssh) it may be
# passed as arguments instead, for a local test.
REQ="${SSH_ORIGINAL_COMMAND:-$*}"

# Split on spaces only; nothing here is ever passed to a shell as a string.
set -f
# shellcheck disable=SC2086
set -- $REQ
set +f
ACTION="${1:-}"

case "$ACTION" in
  status)
    [ "$#" -eq 1 ] || die "usage: status"
    cd "$REPO_DIR" || die "no repository at $REPO_DIR"
    echo "deployed: $(git rev-parse HEAD) ($(git rev-parse --abbrev-ref HEAD))"
    echo "dirty files: $(git status --porcelain --untracked-files=no | wc -l | tr -d ' ')"
    if [ -e "$DISABLED" ]; then echo "cd: DISABLED ($DISABLED exists)"; else echo "cd: enabled"; fi
    docker ps --filter "label=com.docker.compose.project=bcweb" --format '{{.Names}} {{.Status}}'
    exit 0
    ;;
  deploy)
    SHA="${2:-}"
    FLAG="${3:-}"
    [ "$#" -le 3 ] || die "usage: deploy <sha> [--dry-run]"
    case "$SHA" in
      *[!0-9a-f]*|"") die "the commit must be a full 40-character lowercase hex sha" ;;
    esac
    [ "${#SHA}" -eq 40 ] || die "the commit must be a full 40-character lowercase hex sha"
    case "$FLAG" in
      ""|--dry-run) ;;
      *) die "unknown option: $FLAG (only --dry-run)" ;;
    esac
    ;;
  *)
    die "refused: only 'status' and 'deploy <sha> [--dry-run]' are allowed"
    ;;
esac

[ -e "$DISABLED" ] && die "CD is disabled on this server ($DISABLED exists). Nothing was changed."

mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date -u +%Y%m%dT%H%M%SZ)-${SHA%"${SHA#????????????}"}.log"

# One deploy at a time. flock is in util-linux / busybox on Alpine.
exec 9>"$LOCK"
flock -n 9 || die "another deploy is running"

{
  echo "deploy-gate: requested $SHA ${FLAG:-} at $(date -u +%FT%TZ)"
  cd "$REPO_DIR"
  [ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || die "the server checkout is not on $BRANCH"
  git fetch --quiet origin "$BRANCH"
  TIP="$(git rev-parse "origin/$BRANCH")"
  [ "$TIP" = "$SHA" ] || die "refused: $SHA is not the tip of origin/$BRANCH ($TIP). Only the current master can be deployed."
  # deploy.sh refuses a dirty tree itself (its rollback is a reset --hard); say it first, clearly.
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "refused: the server checkout has uncommitted changes. Move local edits to docker-compose.override.yml / caddy/sites.d/ (see guides/run/DEPLOY_EN.md, section 9)."
  if [ "$FLAG" = "--dry-run" ]; then
    sh BCWEB/infra/deploy.sh --dry-run
  else
    sh BCWEB/infra/deploy.sh
    NOW="$(git rev-parse HEAD)"
    [ "$NOW" = "$SHA" ] || die "deploy.sh finished on $NOW, not $SHA (rolled back?)"
    echo "deploy-gate: $SHA is live"
  fi
} 2>&1 | tee "$LOG"
# `tee` hides the left side's exit status in POSIX sh; the log's last line says which it was.
tail -n 1 "$LOG" | grep -q "is live\|Dry run" || exit 1
