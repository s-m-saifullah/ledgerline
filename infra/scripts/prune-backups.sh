#!/usr/bin/env bash
# Delete backups (dump, manifest and checksum together) older than KEEP_DAYS (default 7),
# but always keep the newest KEEP_MIN (default 3) so a long outage never empties the folder.
set -euo pipefail
cd "${LEDGERLINE_DIR:-/opt/ledgerline}/backups"
days="${KEEP_DAYS:-7}"
minimum="${KEEP_MIN:-3}"
[[ "$days" =~ ^[0-9]+$ && "$minimum" =~ ^[0-9]+$ ]] || { echo 'KEEP_DAYS and KEEP_MIN must be numbers'; exit 1; }
index=0
# Newest first; the dump name carries a UTC timestamp so name order is age order.
while IFS= read -r dump; do
  index=$((index + 1))
  [[ "$index" -le "$minimum" ]] && continue
  if [[ -n "$(find "$dump" -mtime +"$days" -print)" ]]; then
    rm -f -- "$dump" "$dump.manifest" "$dump.sha256"
    echo "Pruned $dump"
  fi
done < <(ls -1 ledgerline-*.dump 2>/dev/null | sort -r)
