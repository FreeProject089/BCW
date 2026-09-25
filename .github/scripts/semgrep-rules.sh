#!/usr/bin/env bash
# Fetch the pinned Semgrep rules and keep the ones that fit this stack.
#
#   .github/scripts/semgrep-rules.sh <out-dir>
#
# Used by the "SAST (semgrep)" job in .github/workflows/security.yml, and by hand (see
# BCWEB/guides/run/SECURITY_CI_EN.md). Both must scan with the SAME rules, so the choice lives
# here and nowhere else.
#
# Why not `--config p/javascript` & co.: a registry pack is fetched from semgrep.dev at run
# time and changes whenever Semgrep edits it, so two runs of the same commit can disagree and
# nobody can say which rules a past run used. Here the rules are the semgrep/semgrep-rules
# repository at ONE commit (SEMGREP_RULES_SHA), fetched by that hash, so a run is reproducible
# and a rules bump is a reviewed one-line change. (Semgrep Rules License v1.0: used in CI, not
# redistributed — nothing from that repository is committed here.)
#
# What is kept, for this stack (Node/Fastify API, React/Vite web, discord.js bot, Rust addon,
# Dockerfiles, nginx.conf, GitHub Actions, compose):
#   javascript/**/security, typescript/react/**/security, rust/**/security,
#   dockerfile/**/security, generic/nginx/**/security, yaml/github-actions/**/security,
#   yaml/docker-compose/**/security
# minus every `audit/` folder. Audit rules are Semgrep's own "for a manual review, high false
# positive rate" tier; run once on this tree they added ~400 findings, almost all noise
# (every RegExp built from a variable, every template string holding HTML). The security
# rules left are the ones meant to gate a build. Test fixtures (*.test.yaml) and autofix
# samples (*.fixed.*) in the rules repository are not rules and are left out.
#
# The selection is checked: fewer than MIN_RULES files means the rules repository moved its
# folders and this script is silently selecting nothing, which must fail, not pass.
set -euo pipefail

OUT="${1:?usage: semgrep-rules.sh <out-dir>}"
REPO="${SEMGREP_RULES_REPO:-https://github.com/semgrep/semgrep-rules}"
SHA="${SEMGREP_RULES_SHA:?set SEMGREP_RULES_SHA (the pinned semgrep-rules commit)}"
MIN_RULES="${SEMGREP_MIN_RULES:-80}"

SRC="$(mktemp -d)"
trap 'rm -rf "$SRC"' EXIT
git init -q "$SRC"
git -C "$SRC" -c core.longpaths=true fetch -q --depth 1 "$REPO" "$SHA"
git -C "$SRC" -c core.longpaths=true checkout -q FETCH_HEAD
got="$(git -C "$SRC" rev-parse HEAD)"
if [ "$got" != "$SHA" ]; then
  echo "::error::semgrep-rules: fetched $got, expected $SHA"
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"
n=0
while IFS= read -r f; do
  mkdir -p "$OUT/$(dirname "$f")"
  cp "$SRC/$f" "$OUT/$f"
  n=$((n + 1))
done < <(cd "$SRC" && find javascript typescript/react rust dockerfile generic/nginx yaml/github-actions yaml/docker-compose \
  -path '*/security/*' -not -path '*/audit/*' \
  \( -name '*.yaml' -o -name '*.yml' \) -not -name '*.test.yaml' -not -name '*.test.yml' -not -name '*.fixed.*' | sort)

if [ "$n" -lt "$MIN_RULES" ]; then
  echo "::error::semgrep-rules: only $n rule files selected (expected at least $MIN_RULES) — the rules repository layout changed"
  exit 1
fi
echo "semgrep-rules: $n rule files from semgrep-rules@${SHA:0:12} in $OUT"
