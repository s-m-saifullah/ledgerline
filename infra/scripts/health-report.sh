#!/usr/bin/env bash
# A read-only health report, run by the daily "Health watch" workflow over a locked-down SSH key (see
# docs/SELF_HOSTING.md). It changes nothing on the server. One line per check ("ok", "skip" or "FAIL");
# exit 0 when nothing failed, 1 when a check failed, 2 for a bad request. The lines carry ages and
# percentages only: no paths, file names, hosts, amounts or notes.
#   - the newest finished backup (a dump with a non-empty checksum) is under MAX_DUMP_HOURS old (26)
#   - the off-site copy, when it is turned on (offsite.env exists), last said result=ok under
#     MAX_OFFSITE_HOURS ago (48): backups/offsite.status is rewritten on every attempt
#   - disk use where backups are kept is under MAX_DISK_PCT (85)
# Over SSH the only accepted command is "check HOURS PERCENT" (or none), which sets the first and third
# limit; anything else is refused before anything is read. Locally, set the variables instead.
set -uo pipefail
cd "${LEDGERLINE_DIR:-/opt/ledgerline}" 2>/dev/null || { echo 'FAIL  server folder: missing'; exit 1; }

max_dump_hours="${MAX_DUMP_HOURS-26}"
max_offsite_hours="${MAX_OFFSITE_HOURS-48}"
max_disk_pct="${MAX_DISK_PCT-85}"

if [[ -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  if [[ "$SSH_ORIGINAL_COMMAND" =~ ^check\ ([0-9]+)\ ([0-9]+)$ ]]; then
    max_dump_hours="${BASH_REMATCH[1]}"
    max_disk_pct="${BASH_REMATCH[2]}"
  else
    echo 'Only "check HOURS PERCENT" is accepted' >&2
    exit 2
  fi
fi
for value in "$max_dump_hours" "$max_offsite_hours" "$max_disk_pct"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { echo 'The limits must be whole numbers' >&2; exit 2; }
done

failed=0
report() { # ok|skip|FAIL, label, detail
  printf '%-5s %s: %s\n' "$1" "$2" "$3"
  [[ "$1" == FAIL ]] && failed=1
  return 0
}

# Whole hours since a file was last written; the file must exist.
hours_old() {
  local seconds now modified
  now=$(date +%s)
  modified=$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null) || return 1
  seconds=$((now - modified))
  [[ "$seconds" -lt 0 ]] && seconds=0
  echo $((seconds / 3600))
}

# 1. The newest finished backup.
newest=''
while IFS= read -r dump; do
  if [[ -s "$dump" && -s "$dump.sha256" ]]; then newest="$dump"; break; fi
done < <(ls -1 backups/ledgerline-*.dump 2>/dev/null | sort -r)
if [[ -z "$newest" ]]; then
  report FAIL 'newest backup' 'none found'
elif ! hours=$(hours_old "$newest"); then
  report FAIL 'newest backup' 'its age could not be read'
elif [[ "$hours" -ge "$max_dump_hours" ]]; then
  report FAIL 'newest backup' "${hours} h old (limit ${max_dump_hours} h)"
else
  report ok 'newest backup' "${hours} h old (limit ${max_dump_hours} h)"
fi

# 2. The off-site copy, only when it is turned on.
if [[ ! -f "${OFFSITE_CONFIG:-offsite.env}" ]]; then
  report skip 'off-site copy' 'not turned on'
elif [[ ! -f backups/offsite.status ]]; then
  report FAIL 'off-site copy' 'configured but never ran'
elif ! grep -qx 'result=ok' backups/offsite.status; then
  report FAIL 'off-site copy' 'the last upload failed'
elif ! hours=$(hours_old backups/offsite.status); then
  report FAIL 'off-site copy' 'its age could not be read'
elif [[ "$hours" -ge "$max_offsite_hours" ]]; then
  report FAIL 'off-site copy' "last upload ${hours} h ago (limit ${max_offsite_hours} h)"
else
  report ok 'off-site copy' "last upload ${hours} h ago (limit ${max_offsite_hours} h)"
fi

# 3. Disk use where the backups are kept.
used=$(df -Pk backups 2>/dev/null | awk 'NR == 2 { gsub("%", "", $5); print $5 }')
if [[ ! "$used" =~ ^[0-9]+$ ]]; then
  report FAIL disk 'use could not be read'
elif [[ "$used" -ge "$max_disk_pct" ]]; then
  report FAIL disk "${used}% used (limit ${max_disk_pct}%)"
else
  report ok disk "${used}% used (limit ${max_disk_pct}%)"
fi

exit "$failed"
