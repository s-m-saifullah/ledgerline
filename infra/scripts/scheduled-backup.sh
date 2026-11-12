#!/usr/bin/env bash
# Run from the ledgerline user's crontab: a backup every day, and (with "drill") a restore drill
# on the newest dump. Output goes to cron's log; no credentials are printed.
# Old backups are pruned FIRST: if the disk is full the backup fails, and a prune that only ran after
# a good backup would never free the space, so every later night would fail the same way. The prune
# always keeps the newest three. Free space is checked next and a low figure is said loudly (the
# backup is still tried: it may fit), and makes this exit 1 so the failure shows.
# The off-site copy (offsite-upload.sh, a no-op without offsite.env) runs right after the backup; a failed
# upload is recorded in backups/offsite.status, never skips the drill, and makes this exit 1.
# A failed backup skips the upload and the drill and exits 1; a failed drill exits 1.
set -euo pipefail
cd "${LEDGERLINE_DIR:-/opt/ledgerline}"
min_free_mb="${MIN_FREE_MB:-200}"
[[ "$min_free_mb" =~ ^[0-9]+$ ]] || { echo 'MIN_FREE_MB must be a number'; exit 1; }
status=0
[[ -d backups ]] || mkdir -m 700 backups
bash ./prune-backups.sh || { echo 'Warning: pruning old backups failed'; status=1; }
free_mb=$(df -Pm backups 2>/dev/null | awk 'NR == 2 { print $4 }') || free_mb=''
if [[ "$free_mb" =~ ^[0-9]+$ ]]; then
  if [[ "$free_mb" -lt "$min_free_mb" ]]; then
    echo "Low disk space: ${free_mb} MB free where backups are kept (below ${min_free_mb} MB). Free some space."
    status=1
  fi
else
  echo 'Could not read the free disk space; carrying on'
fi
bash ./backup.sh || { echo 'Backup failed; nothing was uploaded or drilled'; exit 1; }
bash ./offsite-upload.sh || status=1
if [[ "${1:-}" == drill ]]; then
  bash ./restore-drill.sh "$(ls -t backups/ledgerline-*.dump | head -n 1)" || { echo 'Restore drill failed'; status=1; }
fi
exit "$status"
