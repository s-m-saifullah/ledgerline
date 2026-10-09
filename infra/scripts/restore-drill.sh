#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "${LEDGERLINE_DIR:-/opt/ledgerline}"
dump="${1:?Usage: restore-drill.sh path/to/backup.dump}"
test -s "$dump"
test -s "$dump.manifest"
test -s "$dump.sha256"
expected_checksum=$(cut -d ' ' -f 1 "$dump.sha256")
actual_checksum=$(sha256sum "$dump" | cut -d ' ' -f 1)
test "$expected_checksum" = "$actual_checksum" || { echo 'Backup checksum mismatch'; exit 1; }
name="ledgerline-restore-$(date +%s)-$$"
cleanup() { docker rm -f "$name" >/dev/null; }
trap cleanup EXIT
# No network or host ports; this can never restore into the running app database.
docker run -d --name "$name" --network none -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore postgres:18 >/dev/null
ready=false
for attempt in $(seq 1 60); do
  if docker exec "$name" pg_isready -U postgres -d restore >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Restore database did not become ready'; exit 1; }
docker exec -i "$name" pg_restore -U postgres -d restore --no-owner --exit-on-error < "$dump"
declare -A seen_tables=()
checked=0
financial=false
declare -A seen_checks=()
while IFS='|' read -r table count fingerprint; do
  if [[ "$table" == check ]]; then
    # check|name|value, recorded in the same snapshot as the dump. read leaves any '|' inside the value in $fingerprint.
    [[ "$count" =~ ^[a-z_]+$ && "$fingerprint" =~ ^[0-9a-f|:-]+$ ]] || { echo 'Invalid snapshot manifest'; exit 1; }
    [[ -z "${seen_checks[$count]:-}" ]] || { echo 'Duplicate manifest check'; exit 1; }
    seen_checks[$count]=$fingerprint
    continue
  fi
  case "$table" in users|ledgers|ledger_members|accounts|categories|transactions|transaction_splits|contacts|receivables|receivable_payments|receivable_events|write_receipts) ;; *) echo 'Invalid manifest table'; exit 1 ;; esac
  [[ "$count" =~ ^[0-9]+$ && "$fingerprint" =~ ^[0-9a-f]{32}$ ]] || { echo 'Invalid snapshot manifest'; exit 1; }
  [[ -z "${seen_tables[$table]:-}" ]] || { echo "Duplicate manifest table"; exit 1; }
  seen_tables[$table]=1
  actual=$(docker exec "$name" psql -XqAtv ON_ERROR_STOP=1 -U postgres -d restore -c "SET TIME ZONE 'UTC'; SELECT count(*) || '|' || md5(coalesce(string_agg(md5(row_to_json(t)::text), '' ORDER BY id), '')) FROM public.$table t")
  test "$actual" = "$count|$fingerprint" || { printf 'Snapshot content mismatch for %s\n' "$table"; exit 1; }
  [[ "$table" != categories ]] || financial=true
  checked=$((checked + 1))
done < "$dump.manifest"
# Require every supported table present in this restored schema, including new additions.
for table in users ledgers ledger_members accounts categories transactions transaction_splits contacts receivables receivable_payments receivable_events write_receipts; do
  exists=$(docker exec "$name" psql -XqAtv ON_ERROR_STOP=1 -U postgres -d restore -c "SELECT to_regclass('public.$table') IS NOT NULL")
  if [[ "$exists" == t && -z "${seen_tables[$table]:-}" ]]; then echo 'Incomplete snapshot manifest'; exit 1; fi
done
[[ "$checked" -ge 3 ]] || { echo 'Incomplete snapshot manifest'; exit 1; }

# Derived checks: balances, owed money, transfers, splits, linked payments and receipts must match the
# values recorded in the backup snapshot. Dumps made before these checks existed carry none.
source ./verify-queries.sh
psql_restore() { docker exec "$name" psql -XqAtv ON_ERROR_STOP=1 -U postgres -d restore -c "$1"; }
verified=0
for check in "${VERIFY_CHECKS[@]}"; do
  [[ "$(psql_restore "$(verify_requires "$check")")" == t ]] || continue
  if [[ "${#seen_checks[@]}" -gt 0 && -z "${seen_checks[$check]:-}" ]]; then echo 'Incomplete snapshot manifest'; exit 1; fi
  [[ -n "${seen_checks[$check]:-}" ]] || continue
  actual=$(psql_restore "SET TIME ZONE 'UTC'; $(verify_sql "$check")")
  test "$actual" = "${seen_checks[$check]}" || { printf 'Snapshot check mismatch for %s\n' "$check"; exit 1; }
  verified=$((verified + 1))
done
for check in "${!seen_checks[@]}"; do
  found=false
  for known in "${VERIFY_CHECKS[@]}"; do [[ "$known" == "$check" ]] && found=true; done
  [[ "$found" == true ]] || { echo 'Unknown manifest check'; exit 1; }
done
# Deferred integrity triggers do not run during pg_restore, so validate the invariants explicitly.
for invariant in "${VERIFY_INVARIANTS[@]}"; do
  [[ "$(psql_restore "$(verify_requires "$invariant")")" == t ]] || continue
  invalid=$(psql_restore "$(verify_sql "$invariant")")
  test "$invalid" = 0 || { printf 'Restored %s failed validation\n' "${invariant//_/ }"; exit 1; }
done
if [[ "$financial" == true ]]; then
  invalid=$(docker exec "$name" psql -XqAtv ON_ERROR_STOP=1 -U postgres -d restore -c 'SELECT count(*) FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.deleted_at IS NULL AND c.parent_id IS NOT NULL AND (p.id IS NULL OR p.ledger_id <> c.ledger_id OR p.kind <> c.kind OR p.parent_id IS NOT NULL OR (c.archived_at IS NULL AND (p.archived_at IS NOT NULL OR p.deleted_at IS NOT NULL)))')
  test "$invalid" = 0 || { echo 'Restored category hierarchy failed validation'; exit 1; }
fi

if [[ -n "${seen_tables[receivables]:-}" ]]; then
  # Deferred constraints do not validate historical rows during pg_restore; check every service explicitly.
  docker exec "$name" psql -XqAtv ON_ERROR_STOP=1 -U postgres -d restore -c 'SELECT ledgerline_check_receivable(ledger_id,id) FROM receivables' >/dev/null
  invalid=$(docker exec "$name" psql -XqAtv ON_ERROR_STOP=1 -U postgres -d restore -c "SELECT count(*) FROM (SELECT ledger_id,sum(amount-coalesce((SELECT sum(p.amount) FROM receivable_payments p WHERE p.ledger_id=r.ledger_id AND p.receivable_id=r.id AND p.deleted_at IS NULL),0)) total FROM receivables r WHERE deleted_at IS NULL AND written_off_at IS NULL GROUP BY ledger_id HAVING sum(amount-coalesce((SELECT sum(p.amount) FROM receivable_payments p WHERE p.ledger_id=r.ledger_id AND p.receivable_id=r.id AND p.deleted_at IS NULL),0)) > 9007199254740991) bad")
  test "$invalid" = 0 || { echo 'Restored owed totals failed validation'; exit 1; }
fi
if [[ -n "${seen_tables[receivable_payments]:-}" ]]; then
  # Person-level receipts live or die together; older dumps predate receipt_id.
  has_receipts=$(docker exec "$name" psql -XqAtv ON_ERROR_STOP=1 -U postgres -d restore -c "SELECT count(*) FROM information_schema.columns WHERE table_name='receivable_payments' AND column_name='receipt_id'")
  if [[ "$has_receipts" = 1 ]]; then
    invalid=$(docker exec "$name" psql -XqAtv ON_ERROR_STOP=1 -U postgres -d restore -c "SELECT count(*) FROM (SELECT 1 FROM receivable_payments WHERE receipt_id IS NOT NULL GROUP BY ledger_id,receipt_id HAVING bool_or(deleted_at IS NULL) AND bool_or(deleted_at IS NOT NULL)) bad")
    test "$invalid" = 0 || { echo 'Restored receipts failed validation'; exit 1; }
  fi
fi
if [[ -n "${seen_tables[transactions]:-}" ]]; then
  invalid=$(docker exec "$name" psql -XqAtv ON_ERROR_STOP=1 -U postgres -d restore -c "SELECT count(*) FROM accounts a WHERE a.deleted_at IS NULL AND abs(a.opening_balance::numeric+coalesce((SELECT sum(t.amount) FROM transactions t WHERE t.ledger_id=a.ledger_id AND t.account_id=a.id AND t.deleted_at IS NULL AND t.status='cleared'),0)) > 9007199254740991")
  test "$invalid" = 0 || { echo 'Restored account balances failed validation'; exit 1; }
fi

printf 'Restore drill passed: %s tables and %s derived checks match the backup snapshot, including IDs, balances, transfers, splits, linked payments, tombstones and receipts where present.\n' "$checked" "$verified"
