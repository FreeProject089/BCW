#!/usr/bin/env bash
# Render the pull-request comment from the gate verdicts the scan jobs saved.
#
#   gate-comment.sh <results-dir> <marker> <out.md>
#
# Every scan job runs security-gate.mjs with `--json gate-<name>.json` and uploads it in its
# artifact; the comment job downloads them all into <results-dir>. The table itself is
# `security-gate.mjs --markdown` (one row per verdict), so the comment and the job logs can
# never disagree on a count. Environment: RUN_URL (the run, for the link), optional.
#
# If no verdict exists at all (every scan job died before its gate), the comment says so
# instead of showing an empty, reassuring table.
set -euo pipefail

dir="${1:?usage: gate-comment.sh <results-dir> <marker> <out.md>}"
marker="${2:?}"
out="${3:?}"

args=()
while IFS= read -r f; do args+=(--results "$f"); done < <(find "$dir" -name 'gate-*.json' 2>/dev/null | sort)

if [ "${#args[@]}" -eq 0 ]; then
  {
    echo "<!-- $marker -->"
    echo "### Security gate"
    echo
    echo "**No scan reached its gate in this run** — nothing was checked, so nothing is reported as clean."
    [ -n "${RUN_URL:-}" ] && echo "See the run: ${RUN_URL}"
  } > "$out"
  echo "::warning::no gate verdict was saved by any scan job"
else
  node .github/scripts/security-gate.mjs --markdown "${args[@]}" --marker "$marker" ${RUN_URL:+--run-url "$RUN_URL"} > "$out"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$out" >> "$GITHUB_STEP_SUMMARY"; fi
cat "$out"
