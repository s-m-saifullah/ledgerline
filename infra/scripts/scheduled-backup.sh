#!/usr/bin/env bash
# Run from the ledgerline user's crontab: a backup every day, and (with "drill") a restore drill
# on the newest dump, then prune old backups. Output goes to cron's log; no credentials are printed.
set -euo pipefail
cd "${LEDGERLINE_DIR:-/opt/ledgerline}"
bash ./backup.sh
if [[ "${1:-}" == drill ]]; then
  bash ./restore-drill.sh "$(ls -t backups/ledgerline-*.dump | head -n 1)"
fi
bash ./prune-backups.sh
