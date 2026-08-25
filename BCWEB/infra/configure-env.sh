#!/bin/sh
# Build a complete .env by answering questions, with every answer explained.
#
# POSIX sh, for the same reason as bootstrap.sh: the target can be a minimal Alpine box with
# no bash. Nothing here needs more than sh, and bootstrap.sh already failed once by assuming
# otherwise.
#
# WHAT THIS IS, AND WHAT IT IS NOT
#
#   bootstrap.sh   virgin machine: generates a .env, starts everything, migrates, seeds.
#                  Refuses to run if a .env exists.
#   prod-env.sh    an existing .env, pointed at a real domain. Never changes a set value.
#   THIS           builds the .env itself, question by question, explaining each one.
#                  Use it when you want to understand or change what you are configuring
#                  rather than accept generated defaults.
#
# It never writes over an existing .env without being told to (--force), and even then it
# writes the new file beside the old one first and only swaps at the end — so a wizard
# abandoned half way leaves the working configuration exactly where it was.
#
#   ./infra/configure-env.sh                 interactive, writes infra/compose/.env
#   ./infra/configure-env.sh --force         overwrite an existing .env (a backup is kept)
#   ./infra/configure-env.sh --out /tmp/e    write somewhere else, change nothing
#
# The questions live in infra/env-spec.txt, which configure-env.ps1 reads as well. Two
# scripts with their own question lists is two lists that drift, and the drift shows up as
# two operators with different files and no idea why.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
SPEC="$HERE/env-spec.txt"
EXAMPLE="$HERE/compose/.env.example"
OUT="$HERE/compose/.env"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1 ;;
    --out) shift; OUT="$1" ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -f "$SPEC" ] || { echo "missing $SPEC" >&2; exit 1; }
[ -f "$EXAMPLE" ] || { echo "missing $EXAMPLE" >&2; exit 1; }

if [ -f "$OUT" ] && [ "$FORCE" = 0 ]; then
  echo "A .env already exists at $OUT."
  echo
  echo "  Rewriting POSTGRES_PASSWORD against an already-initialised database locks you out"
  echo "  of your own Postgres — the volume keeps the password it was created with — so this"
  echo "  refuses rather than guessing that you meant it."
  echo
  echo "  To change a few values:      edit it, or run infra/prod-env.sh"
  echo "  To rebuild it from scratch:  $0 --force   (the old one is backed up)"
  exit 1
fi

# ── colours, only when the terminal is one ──────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$(printf '\033[1m'); DIM=$(printf '\033[2m'); CY=$(printf '\033[36m'); YE=$(printf '\033[33m'); R=$(printf '\033[0m')
else
  B=''; DIM=''; CY=''; YE=''; R=''
fi

# A secret nobody has to invent. openssl where it exists, /dev/urandom where it does not —
# an Alpine image has the second and may not have the first.
gen_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24
  else head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# Answers accumulate here as KEY=VALUE lines; the file is assembled at the end.
ANSWERS=$(mktemp)
trap 'rm -f "$ANSWERS" "$ANSWERS.tmp" 2>/dev/null || true' EXIT

get() { grep "^$1=" "$ANSWERS" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
put() { printf '%s=%s\n' "$1" "$2" >> "$ANSWERS"; }

# `\n` in the spec's help text becomes a real line break, indented so it reads as one note.
show_help() {
  printf '%s' "$1" | tr '\n' '\001' | sed 's/\\n/\n/g' | tr '\001' '\n' | while IFS= read -r line; do
    [ -n "$line" ] && printf '   %s%s%s\n' "$DIM" "$line" "$R"
  done
}

# =SOMEKEY means "default to what was answered for SOMEKEY"; =host(KEY) strips the scheme
# and port. Resolved at ask time, so it follows what the operator actually typed.
resolve_default() {
  case "$1" in
    '=host('*')')
      k=$(printf '%s' "$1" | sed 's/^=host(//; s/)$//')
      get "$k" | sed 's#^[a-z]*://##; s#[:/].*$##'
      ;;
    '='*) get "$(printf '%s' "$1" | cut -c2-)" ;;
    *) printf '%s' "$1" ;;
  esac
}

# `when:KEY=value` — value `*` means "any non-empty answer".
should_ask() {
  cond=$1
  [ -z "$cond" ] && return 0
  k=$(printf '%s' "$cond" | cut -d= -f1)
  want=$(printf '%s' "$cond" | cut -d= -f2-)
  have=$(get "$k")
  if [ "$want" = '*' ]; then [ -n "$have" ]; else [ "$have" = "$want" ]; fi
}

echo
printf '%s  BCWEB — build a .env%s\n' "$B" "$R"
echo
echo "  Every question explains what the value does and what happens if you skip it."
echo "  Press Enter to take the [default]. Nothing is written until the very end."
echo

section=''
# The spec is read on FD 3, NOT on stdin.
#
# `while read … done < file` redirects the loop body's stdin as well, so the `read ans` that
# asks the operator a question silently consumes the next line of the SPEC instead. Every
# answer then becomes the following variable's definition line and the wizard writes a file
# full of garbage while exiting 0. Found by running it, not by reading it.
#
# `IFS=|` splits the six fields; `read -r` keeps backslashes, which the help text needs.
while IFS='|' read -r key sect kind def prompt help <&3; do
  case "$key" in ''|'#'*) continue ;; esac

  # A leading `when:` on the HELP field gates the question and is stripped from the note.
  cond=''
  case "$help" in
    'when:'*)
      cond=$(printf '%s' "$help" | sed 's/^when:\([^ ]*\).*/\1/')
      help=$(printf '%s' "$help" | sed 's/^when:[^ ]*  \{0,1\}//')
      ;;
  esac
  should_ask "$cond" || continue

  if [ "$sect" != "$section" ]; then
    section=$sect
    printf '\n%s── %s %s%s\n' "$CY" "$section" "$(printf '─%.0s' 1 2 3 4 5 6 7 8 9 10)" "$R"
  fi

  if [ "$kind" = info ]; then
    show_help "$help"
    continue
  fi

  d=$(resolve_default "$def")
  show_help "$help"

  case "$kind" in
    choice)
      opts=$(printf '%s' "$d" | tr ',' ' ')
      first=$(printf '%s' "$opts" | cut -d' ' -f1)
      printf '   %soptions:%s %s\n' "$DIM" "$R" "$(printf '%s' "$d" | sed 's/,/ · /g; s/^ · /(empty) · /')"
      printf '%s?%s %s [%s]: ' "$B" "$R" "$prompt" "$first"
      read -r ans || ans=''
      [ -z "$ans" ] && ans=$first
      ;;
    bool)
      printf '%s?%s %s [%s]: ' "$B" "$R" "$prompt" "$d"
      read -r ans || ans=''
      [ -z "$ans" ] && ans=$d
      case "$ans" in y|Y|yes|true|1) ans=true ;; *) ans=false ;; esac
      ;;
    secret)
      # Offered, not imposed: an operator pasting a key they already have must not have to
      # fight a generator for the field.
      g=$(gen_secret)
      [ -n "$d" ] && g=$d
      printf '%s?%s %s %s[Enter = generate]%s: ' "$B" "$R" "$prompt" "$DIM" "$R"
      if [ -t 0 ]; then stty -echo 2>/dev/null || true; fi
      read -r ans || ans=''
      if [ -t 0 ]; then stty echo 2>/dev/null || true; echo; fi
      [ -z "$ans" ] && ans=$g
      ;;
    url)
      printf '%s?%s %s [%s]: ' "$B" "$R" "$prompt" "$d"
      read -r ans || ans=''
      [ -z "$ans" ] && ans=$d
      ans=$(printf '%s' "$ans" | sed 's#/*$##')
      ;;
    *)
      printf '%s?%s %s [%s]: ' "$B" "$R" "$prompt" "$d"
      read -r ans || ans=''
      [ -z "$ans" ] && ans=$d
      ;;
  esac

  put "$key" "$ans"
  echo
done 3< "$SPEC"

# ── derived values ──────────────────────────────────────────────────────────
#
# Answers the operator should not have to give because they follow from one they already did.
# Each is announced rather than applied silently: a value in the file that nobody typed and
# nobody was told about is the hardest kind to debug.
echo
printf '%s── Derived %s%s\n' "$CY" "$(printf '─%.0s' 1 2 3 4 5 6 7 8 9 10)" "$R"

if [ "$(get DB_MODE)" = managed ]; then
  printf '   %s· the bundled Postgres container is not started (COMPOSE_PROFILES has no `db`)%s\n' "$DIM" "$R"
  printf '   %s· DATABASE_URL is used as given, so the parts below are ignored%s\n' "$DIM" "$R"
fi

replicas=$(get API_REPLICAS)
if [ "${replicas:-1}" != "1" ] && [ "$(get REDIS_ENABLED)" != "true" ]; then
  printf '   %s! API_REPLICAS=%s with Redis off. Turning Redis ON — without it every replica%s\n' "$YE" "$replicas" "$R"
  printf '   %s  runs the background sweeper, and expiry e-mails go out once per replica.%s\n' "$YE" "$R"
  # Corrected rather than refused: the operator asked for replicas, and replicas without
  # Redis is not a configuration anybody wants — it is a mistake with a known fix.
  put REDIS_ENABLED true
fi
if [ "${replicas:-1}" != "1" ] && [ -z "$(get COMPOSE_PROFILES)" ] && [ "$(get DB_MODE)" = bundled ]; then
  printf '   %s· consider COMPOSE_PROFILES=pgbouncer: %s replicas open %s sets of connections%s\n' "$DIM" "$replicas" "$replicas" "$R"
fi

# ── write ───────────────────────────────────────────────────────────────────
#
# Built FROM .env.example, so every comment in it survives and any variable this wizard does
# not ask about still lands with its documented default. A generated .env that drops the
# explanations is a file nobody can edit six months later.
TMP="$OUT.new.$$"
: > "$TMP"
while IFS= read -r line; do
  case "$line" in
    [A-Z]*=*)
      k=${line%%=*}
      v=$(get "$k")
      if grep -q "^$k=" "$ANSWERS" 2>/dev/null; then printf '%s=%s\n' "$k" "$v" >> "$TMP"
      else printf '%s\n' "$line" >> "$TMP"; fi
      ;;
    '#'[A-Z]*=*)
      # A commented-out variable the wizard asked about becomes a real line; the rest stay
      # commented, which is what keeps the example's "here is what you could set" intact.
      k=${line#\#}; k=${k%%=*}
      if grep -q "^$k=" "$ANSWERS" 2>/dev/null; then
        v=$(get "$k")
        [ -n "$v" ] && printf '%s=%s\n' "$k" "$v" >> "$TMP" || printf '%s\n' "$line" >> "$TMP"
      else printf '%s\n' "$line" >> "$TMP"; fi
      ;;
    *) printf '%s\n' "$line" >> "$TMP" ;;
  esac
done < "$EXAMPLE"

# Anything answered that the example has no line for (REDIS_ENABLED, DB_MODE) is appended
# with a heading, so it is visible rather than buried.
{
  echo
  echo "# ── Written by infra/configure-env.sh ────────────────────────────────────────"
} >> "$TMP"
# Unique keys, and the value read back through get() — which takes the LAST answer.
#
# Reading `$v` straight off the line took the FIRST, so a value the derived section corrected
# (`put REDIS_ENABLED true` after the operator said no) announced itself on screen and then
# wrote the original anyway. Two rules for "what is the answer", and the quieter one won.
for k in $(cut -d= -f1 "$ANSWERS" | sort -u); do
  [ -z "$k" ] && continue
  grep -q "^$k=" "$TMP" || printf '%s=%s\n' "$k" "$(get "$k")" >> "$TMP"
done

if [ -f "$OUT" ]; then
  cp "$OUT" "$OUT.bak.$(date +%Y%m%d%H%M%S)"
  printf '   %s· previous .env kept as %s.bak.*%s\n' "$DIM" "$OUT" "$R"
fi
mv "$TMP" "$OUT"
chmod 600 "$OUT" 2>/dev/null || true

echo
printf '%s  Written: %s%s\n' "$B" "$OUT" "$R"
echo
echo "  Next:"
echo "    docker compose -f infra/compose/docker-compose.yml up -d --build"
echo "    docker compose -f infra/compose/docker-compose.yml exec api npm run setup"
echo
echo '  setup migrates and seeds projects, the admin account, plans, docs and the FAQ.'
echo "  It is idempotent, so re-running it later is how you pick up new docs and FAQ entries."
echo
