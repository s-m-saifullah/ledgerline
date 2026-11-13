#!/usr/bin/env bash
# Succeeds only when a commit is on main. The server release workflow runs it before anything is tested, built or
# deployed, so a version tag pushed on a side branch is refused (the Android release does the same with the same
# two git commands). It needs the whole history of the checkout (fetch-depth: 0).
#
#   tag-on-main.sh <commit sha>
set -euo pipefail

sha="${1:?usage: tag-on-main.sh <commit sha>}"

git fetch --no-tags origin main
if git merge-base --is-ancestor "$sha" origin/main; then
  echo "$sha is on main"
else
  echo "::error::$sha is not on main; tag a commit that has been merged to main"
  exit 1
fi
