#!/usr/bin/env bash
# Run from the ledgerline user's crontab: a backup every day, and (with "drill") a restore drill
# on the newest dump, then prune old backups. Output goes to cron's log; no credentials are printed.
# The off-site copy (offsite-upload.sh, a no-op without offsite.env) runs right after the backup; a failed
# upload is recorded in backups/offsite.status, never skips the drill or the prune, and makes this exit 1.
set -euo pipefail
cd "${LEDGERLINE_DIR:-/opt/ledgerline}"
bash ./backup.sh
upload_status=0
bash ./offsite-upload.sh || upload_status=1
if [[ "${1:-}" == drill ]]; then
  bash ./restore-drill.sh "$(ls -t backups/ledgerline-*.dump | head -n 1)"
fi
bash ./prune-backups.sh
exit "$upload_status"
