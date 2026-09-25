#!/usr/bin/env bash
# Create, or update in place, ONE sticky comment on the pull request.
#
#   pr-comment.sh <marker> <body.md>
#
# The body must contain `<!-- <marker> -->` (security-gate.mjs --markdown --marker writes it).
# The comment to update is the one written by github-actions[bot] that carries the marker, so
# every run edits the same comment instead of piling up new ones, and a person quoting the
# marker is never overwritten.
#
# Environment: GH_TOKEN (the job's token, pull-requests: write), GITHUB_REPOSITORY, PR_NUMBER,
# PR_HEAD_REPO (owner/name the PR comes from).
#
# A pull request from a fork gets a read-only token: no comment, a notice, exit 0. The same for
# any other read-only token (e.g. Dependabot): GitHub answers "Resource not accessible by
# integration", which is reported as a notice, not as a failed security check. Any other error
# fails, because it is a broken step, not a missing permission.
set -euo pipefail

marker="${1:?usage: pr-comment.sh <marker> <body.md>}"
body="${2:?usage: pr-comment.sh <marker> <body.md>}"
: "${GH_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${PR_NUMBER:?}"

if [ "${PR_HEAD_REPO:-}" != "$GITHUB_REPOSITORY" ]; then
  echo "::notice::pull request from ${PR_HEAD_REPO:-a fork}: its token is read-only, so the gate table is not posted as a comment. It is in this run's summary and artifacts."
  exit 0
fi
if ! grep -qF "<!-- $marker -->" "$body"; then
  echo "::error::$body does not carry the <!-- $marker --> marker; the comment could never be found again to update"
  exit 2
fi

read_only() {
  if grep -q 'Resource not accessible by integration' "$1"; then
    echo "::notice::this run's token cannot write pull-request comments; the gate table is in the run summary instead"
    exit 0
  fi
}

err="$(mktemp)"
id="$(gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \
  --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | contains(\"<!-- $marker -->\"))) | .id" 2> "$err" | head -1)" \
  || { read_only "$err"; cat "$err"; exit 1; }

if [ -n "$id" ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -F "body=@$body" > /dev/null 2> "$err" \
    || { read_only "$err"; cat "$err"; exit 1; }
  echo "updated comment $id on #$PR_NUMBER"
else
  gh api -X POST "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" -F "body=@$body" > /dev/null 2> "$err" \
    || { read_only "$err"; cat "$err"; exit 1; }
  echo "created the gate comment on #$PR_NUMBER"
fi
