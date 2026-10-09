#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "${LEDGERLINE_DIR:-/opt/ledgerline}"
mkdir -p backups
destination="backups/ledgerline-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
compose=(docker compose --env-file .env -f docker-compose.yml)
# Keep this read-only snapshot open until both the dump and manifest are complete.
# Bash 4+ is available on the deployment host; no credentials enter command output.
coproc SNAPSHOT {
  "${compose[@]}" exec -T db sh -c 'exec psql -XqAtv ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}
snapshot_read=${SNAPSHOT[0]}
snapshot_write=${SNAPSHOT[1]}
snapshot_pid=$SNAPSHOT_PID
cleanup() {
  if [[ -n "${snapshot_pid:-}" ]]; then
    kill "$snapshot_pid" 2>/dev/null || true
    wait "$snapshot_pid" 2>/dev/null || true
  fi
  rm -f "$destination.partial" "$destination.manifest.partial"
}
trap cleanup EXIT
printf "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET TIME ZONE 'UTC';\nSELECT pg_export_snapshot();\n" >&"$snapshot_write"
IFS= read -r -u "$snapshot_read" snapshot
[[ "$snapshot" =~ ^[0-9A-Fa-f-]+$ ]] || { echo 'Could not export backup snapshot'; exit 1; }
: > "$destination.manifest.partial"
for table in users ledgers ledger_members accounts categories transactions transaction_splits contacts receivables receivable_payments receivable_events write_receipts; do
  printf "SELECT to_regclass('public.%s') IS NOT NULL;\n" "$table" >&"$snapshot_write"
  IFS= read -r -u "$snapshot_read" exists
  # Older pre-migration backups intentionally contain only the tables they have.
  if [[ "$exists" == t ]]; then
    printf "SELECT '%s|' || count(*) || '|' || md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY id), '')) FROM public.%s t;\n" "$table" "$table" >&"$snapshot_write"
    IFS= read -r -u "$snapshot_read" fingerprint
    printf '%s\n' "$fingerprint" >> "$destination.manifest.partial"
  fi
done
# Derived checks (balances, owed, transfers, splits, linked payments, receipts) are computed in the
# same snapshot, so the restore drill compares against what the dump itself contains.
source ./verify-queries.sh
for check in "${VERIFY_CHECKS[@]}"; do
  printf '%s;\n' "$(verify_requires "$check")" >&"$snapshot_write"
  IFS= read -r -u "$snapshot_read" applies
  if [[ "$applies" == t ]]; then
    printf '%s;\n' "$(verify_sql "$check")" >&"$snapshot_write"
    IFS= read -r -u "$snapshot_read" value
    printf 'check|%s|%s\n' "$check" "$value" >> "$destination.manifest.partial"
  fi
done
"${compose[@]}" exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --snapshot="$1" -Fc' sh "$snapshot" > "$destination.partial"
test -s "$destination.partial"
printf 'COMMIT;\n\\q\n' >&"$snapshot_write"
wait "$snapshot_pid"
snapshot_pid=''
mv "$destination.partial" "$destination"
mv "$destination.manifest.partial" "$destination.manifest"
sha256sum "$destination" > "$destination.sha256"
printf 'Backup saved to %s (with snapshot manifest and checksum)\n' "$destination"
