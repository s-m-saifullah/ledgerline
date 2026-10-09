set -u
psqlx() { docker compose --env-file .env -f docker-compose.yml exec -T db psql -XqAtv ON_ERROR_STOP=1 -U ledgerline -d ledgerline -c "$1"; }
latest() { ls -t backups/*.dump | head -n 1; }
expect_fail() { # name, expected message, command...
  local name=$1 want=$2; shift 2
  out=$("$@" 2>&1); code=$?
  if [[ $code -ne 0 && "$out" == *"$want"* ]]; then echo "PASS  $name -> $want"; else echo "FAIL  $name (exit $code): $(printf '%s' "$out" | tail -2)"; fi
}
base=$(latest)
# 1. tampered manifest value
cp "$base" t1.dump; cp "$base.sha256" t1.dump.sha256; sed -i 's/^check|balances|2|.*/check|balances|2|00000000000000000000000000000000/' <(true) 2>/dev/null
sed 's/^check|balances|2|.*/check|balances|2|00000000000000000000000000000000/' "$base.manifest" > t1.dump.manifest
sed -i "s#.*#$(cut -d' ' -f1 "$base.sha256")  t1.dump#" t1.dump.sha256
expect_fail "tampered balance value" "Snapshot check mismatch for balances" bash restore-drill.sh t1.dump
# 2. a check line removed
cp "$base" t2.dump; cp "$base.sha256" t2.dump.sha256; sed -i "s#  .*#  t2.dump#" t2.dump.sha256
grep -v '^check|owed|' "$base.manifest" > t2.dump.manifest
expect_fail "missing check line" "Incomplete snapshot manifest" bash restore-drill.sh t2.dump
# 3. unknown check, 4. duplicate check
cp "$base" t3.dump; cp "$base.sha256" t3.dump.sha256; sed -i "s#  .*#  t3.dump#" t3.dump.sha256
{ cat "$base.manifest"; echo 'check|owed|1|c84d6726cdf6ead9ca366dd45c72cc1f'; } > t3.dump.manifest
expect_fail "duplicate check line" "Duplicate manifest check" bash restore-drill.sh t3.dump
# 5. checksum tamper
cp "$base" t4.dump; cp "$base.manifest" t4.dump.manifest; echo 'deadbeef  t4.dump' > t4.dump.sha256
expect_fail "checksum mismatch" "Backup checksum mismatch" bash restore-drill.sh t4.dump
# 6. broken transfer leg (bypass the deferred trigger like a corrupted source would)
psqlx "SET session_replication_role=replica; UPDATE transactions SET amount=-5001, base_amount=-5001 WHERE id='00000000-0000-7000-8000-0000000000e1'" >/dev/null
bash backup.sh >/dev/null; expect_fail "broken transfer leg" "Restored transfer pairs failed validation" bash restore-drill.sh "$(latest)"
psqlx "SET session_replication_role=replica; UPDATE transactions SET amount=-5000, base_amount=-5000 WHERE id='00000000-0000-7000-8000-0000000000e1'" >/dev/null
# 7. broken split sum
psqlx "SET session_replication_role=replica; UPDATE transaction_splits SET amount=-2999 WHERE amount=-3000" >/dev/null
bash backup.sh >/dev/null; expect_fail "broken split sum" "Restored split allocations failed validation" bash restore-drill.sh "$(latest)"
psqlx "SET session_replication_role=replica; UPDATE transaction_splits SET amount=-3000 WHERE amount=-2999" >/dev/null
# 8. desynced linked pair (payment version drifts from its income)
psqlx "SET session_replication_role=replica; UPDATE receivable_payments SET version=version+1 WHERE id='00000000-0000-7000-8000-000000000701'" >/dev/null
bash backup.sh >/dev/null; expect_fail "desynced linked pair" "Invalid linked income" bash restore-drill.sh "$(latest)"
psqlx "SET session_replication_role=replica; UPDATE receivable_payments SET version=version-1 WHERE id='00000000-0000-7000-8000-000000000701'" >/dev/null
# 9. receipt spanning two people
psqlx "INSERT INTO contacts (id,ledger_id,name) VALUES ('00000000-0000-7000-8000-000000000c0b','00000000-0000-7000-8000-0000000000a1','Other'); SET session_replication_role=replica; UPDATE receivables SET contact_id='00000000-0000-7000-8000-000000000c0b' WHERE id='00000000-0000-7000-8000-000000000502'" >/dev/null
bash backup.sh >/dev/null; expect_fail "receipt across two people" "Restored receipt contacts failed validation" bash restore-drill.sh "$(latest)"
psqlx "SET session_replication_role=replica; UPDATE receivables SET contact_id='00000000-0000-7000-8000-000000000c0a' WHERE id='00000000-0000-7000-8000-000000000502'; DELETE FROM contacts WHERE id='00000000-0000-7000-8000-000000000c0b'" >/dev/null
# 10. clean again, then concurrent writes during the backup must not break the drill
bash backup.sh >/dev/null; bash restore-drill.sh "$(latest)" >/dev/null 2>&1 && echo "PASS  clean data restores after repairs" || echo "FAIL  clean data did not restore"
( for i in $(seq 1 150); do psqlx "INSERT INTO transactions (id,ledger_id,account_id,category_id,kind,date,amount,base_amount) VALUES (gen_random_uuid(),'00000000-0000-7000-8000-0000000000a1','00000000-0000-7000-8000-0000000000b1','00000000-0000-7000-8000-0000000000c1','expense','2026-10-09',-$i,-$i)" >/dev/null; done ) &
writer=$!
sleep 1; bash backup.sh >/dev/null; wait $writer
bash restore-drill.sh "$(latest)" 2>&1 | tail -1 | sed 's/^/PASS? concurrent-write drill: /'
