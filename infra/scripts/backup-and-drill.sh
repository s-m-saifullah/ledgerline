#!/usr/bin/env bash
# Take a backup, then prove that exact dump restores: restore-drill.sh runs on the path backup.sh
# printed, never on "the newest file", which could be an older dump if the new backup had failed.
# Used by deploy.sh (before anything is pulled) and by the release workflow (after the deploy).
# Exits 1 if the backup fails, reports no dump, or the drill fails.
set -euo pipefail
cd "${LEDGERLINE_DIR:-/opt/ledgerline}"
output=$(bash ./backup.sh) || { printf '%s\n' "$output"; echo 'Backup failed'; exit 1; }
printf '%s\n' "$output"
dump=$(printf '%s\n' "$output" | sed -n 's/^Backup saved to \(.*\) (with snapshot manifest and checksum)$/\1/p' | tail -n 1)
[[ -n "$dump" ]] || { echo 'Could not find the dump path in the backup output; nothing was drilled'; exit 1; }
bash ./restore-drill.sh "$dump" || { echo "Restore drill failed for $dump"; exit 1; }
echo "Restore drill passed for $dump"
