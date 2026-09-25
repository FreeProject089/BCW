#!/usr/bin/env bash
# Can this run upload SARIF to GitHub code scanning? Writes `available=true|false` to
# $GITHUB_OUTPUT and says why in the log.
#
#   code-scanning-available.sh
#
# Environment: GH_TOKEN (security-events: write), GITHUB_REPOSITORY, GITHUB_EVENT_NAME,
# PR_HEAD_REPO (set on pull_request).
#
# Asked, not assumed. A private repository without GitHub Advanced Security answers 403
# "Advanced Security must be enabled"; uploading anyway would fail the job for a reason that has
# nothing to do with security, and `continue-on-error` would hide a real upload failure too. So:
#   · answered 200, or 404 "no analysis found" (enabled, nothing uploaded yet)  → upload; if the
#     upload then fails, the job fails — that is a broken SARIF or a broken step;
#   · 403 / "not enabled" / "Advanced Security"                                  → notice, no upload;
#   · a fork's pull request (its token cannot write security events)            → notice, no upload;
#   · anything else (rate limit, outage)                                         → warning, no upload.
# In every "no" case the SARIF stays in the job's artifact.
set -uo pipefail
: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}"
out="${GITHUB_OUTPUT:-/dev/stdout}"

if [ "${GITHUB_EVENT_NAME:-}" = pull_request ] && [ "${PR_HEAD_REPO:-}" != "$GITHUB_REPOSITORY" ]; then
  echo "::notice::pull request from a fork: its token cannot write code-scanning results. The SARIF is in the artifacts."
  echo "available=false" >> "$out"
  exit 0
fi

resp="$(gh api -i "repos/$GITHUB_REPOSITORY/code-scanning/alerts?per_page=1" 2>&1)"
status="$(printf '%s\n' "$resp" | awk '/^HTTP\/[0-9.]+ [0-9]+/ {print $2; exit}')"

if [ "$status" = 200 ] || { [ "$status" = 404 ] && printf '%s' "$resp" | grep -qi 'no analysis found'; }; then
  echo "code scanning is available on $GITHUB_REPOSITORY (HTTP $status)"
  echo "available=true" >> "$out"
elif [ "$status" = 403 ] || printf '%s' "$resp" | grep -qiE 'advanced security|code scanning is not enabled'; then
  echo "::notice::code scanning is not available on $GITHUB_REPOSITORY (HTTP ${status:-?}: a private repository needs GitHub Advanced Security). SARIF not uploaded; it is in the artifacts."
  echo "available=false" >> "$out"
else
  echo "::warning::could not tell whether code scanning is available (HTTP ${status:-no answer}). SARIF not uploaded this run; it is in the artifacts."
  printf '%s\n' "$resp" | tail -5
  echo "available=false" >> "$out"
fi
