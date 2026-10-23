#!/usr/bin/env bash
# Succeeds only when the `check` job of the Checks workflow passed for a commit (ADR 0043, slice 5): the Android
# release workflow uses it instead of running the whole suite again on a tag, because the tag must be on main and
# main's own check has already tested that commit (or reused the pull request's passing run of the same tree).
#
#   main-check-passed.sh <commit sha>      needs GH_TOKEN (checks: read) and GITHUB_REPOSITORY
set -euo pipefail

sha="${1:?usage: main-check-passed.sh <commit sha>}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"

# One line per check run named `check`: its conclusion, or "pending" while it has not finished.
results="$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" \
  --jq '.check_runs[] | select(.name == "check") | (.conclusion // "pending")')"

if [ -z "$results" ]; then
  echo "::error::No finished 'check' run for $sha; push the tag only after main's check has passed on that commit"
  exit 1
fi
if printf '%s\n' "$results" | grep -q -v '^success$'; then
  echo "::error::A 'check' run for $sha is not a success ($(printf '%s' "$results" | sort -u | tr '\n' ' '))"
  exit 1
fi
echo "main's check passed for $sha"
