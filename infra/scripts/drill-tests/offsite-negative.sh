#!/usr/bin/env bash
# Negative checks for offsite-upload.sh and offsite-restore.sh, run from the scratch directory described in
# README.md (a seeded database, one local backup, an S3 stand-in, offsite.env with the WRITE-ONLY key,
# restore.env with the READ-ONLY key and test.key, a throwaway age key). Run on the host (macOS or Linux):
#   ADMIN_ENV=admin.env bash offsite-negative.sh
# admin.env holds OFFSITE_S3_ENDPOINT, OFFSITE_BUCKET, OFFSITE_KEY_ID and OFFSITE_APP_KEY of an admin key.
set -u
export LEDGERLINE_DIR="$PWD"
dump=$(ls -t backups/ledgerline-*.dump | head -n 1)
expect() { # name, expected text, command...
  local name=$1 want=$2; shift 2
  out=$("$@" 2>&1); code=$?
  if [[ $code -ne 0 && "$out" == *"$want"* ]]; then echo "PASS  $name -> $want"; else echo "FAIL  $name (exit $code): $(printf '%s' "$out" | tail -2)"; fi
}
admin_put() { # local file, remote name
  ( set -a; source "${ADMIN_ENV:?}"; set +a
    docker run --rm -v "$PWD":/data:ro -e RCLONE_CONFIG_A_TYPE=s3 -e RCLONE_CONFIG_A_PROVIDER=Other \
      -e RCLONE_CONFIG_A_ENDPOINT="$OFFSITE_S3_ENDPOINT" -e RCLONE_CONFIG_A_ACCESS_KEY_ID="$OFFSITE_KEY_ID" \
      -e RCLONE_CONFIG_A_SECRET_ACCESS_KEY="$OFFSITE_APP_KEY" ledgerline-offsite:rclone1.70.3-age1.2 \
      rclone -q copyto "/data/$1" "a:$OFFSITE_BUCKET/ledgerline/$2" )
}
recipient=$(sed -n 's/^OFFSITE_AGE_RECIPIENT=//p' offsite.env)
status_before=$(cat backups/offsite.status 2>/dev/null || true)

# 1. feature off: no offsite.env means exit 0 and no status change
mv offsite.env offsite.env.off
out=$(bash offsite-upload.sh 2>&1); [[ $? -eq 0 && "$out" == *"not configured"* ]] && echo "PASS  not configured -> skipped" || echo "FAIL  not configured: $out"
mv offsite.env.off offsite.env
# 2. remote down
sed 's#^OFFSITE_S3_ENDPOINT=.*#OFFSITE_S3_ENDPOINT=http://host.docker.internal:1#' offsite.env > down.env
expect "remote unreachable" "Off-site upload failed: upload step" env OFFSITE_CONFIG=down.env bash offsite-upload.sh
grep -q '^result=failed' backups/offsite.status && grep -q "^last_ok=" backups/offsite.status && echo "PASS  failure recorded in status" || echo "FAIL  status not recorded"
# 3. bad recipient, bad key, checksum mismatch
sed 's#^OFFSITE_AGE_RECIPIENT=.*#OFFSITE_AGE_RECIPIENT=not-a-key#' offsite.env > badrecipient.env
expect "bad recipient" "not an age public key" env OFFSITE_CONFIG=badrecipient.env bash offsite-upload.sh
cp "$dump" t.dump; cp "$dump.manifest" t.dump.manifest; echo 'deadbeef  t.dump' > t.dump.sha256
expect "local checksum mismatch" "does not match its checksum" bash offsite-upload.sh t.dump
# 4. read-only key cannot upload
sed 's#^OFFSITE_KEY_ID=.*#OFFSITE_KEY_ID=READKEY#; s#^OFFSITE_APP_KEY=.*#OFFSITE_APP_KEY=readsecret123#' offsite.env > readonly.env
expect "read-only key cannot upload" "Off-site upload failed: upload step" env OFFSITE_CONFIG=readonly.env bash offsite-upload.sh
# 5. restore: wrong private key, truncated archive, tampered dump under the original checksum
newest=$(sed -n 's/^archive=//p' backups/offsite.status | head -n 1)
age-keygen -o wrong.key >/dev/null 2>&1
expect "wrong private key" "Decryption failed" bash offsite-restore.sh --config restore.env --identity wrong.key
bash offsite-upload.sh >/dev/null 2>&1
good=$(sed -n 's/^archive=//p' backups/offsite.status)
mkdir -p dl && docker run --rm -v "$PWD/dl":/data -e RCLONE_CONFIG_A_TYPE=s3 -e RCLONE_CONFIG_A_PROVIDER=Other \
  -e RCLONE_CONFIG_A_ENDPOINT=http://host.docker.internal:8333 -e RCLONE_CONFIG_A_ACCESS_KEY_ID=READKEY \
  -e RCLONE_CONFIG_A_SECRET_ACCESS_KEY=readsecret123 ledgerline-offsite:rclone1.70.3-age1.2 \
  rclone -q copyto "a:scratch-bucket/ledgerline/$good" "/data/$good" >/dev/null 2>&1
head -c 1000 "dl/$good" > dl/trunc.tar.age
admin_put dl/trunc.tar.age ledgerline-20261020T235959Z-8.tar.age 2>/dev/null
expect "truncated archive" "Decryption failed" bash offsite-restore.sh --config restore.env --identity test.key --name ledgerline-20261020T235959Z-8.tar.age
mkdir -p tamper && cp "$dump" tamper/x.dump && cp "$dump.manifest" tamper/x.dump.manifest && cp "$dump.sha256" tamper/x.dump.sha256
base=$(basename "$dump"); cp "$dump.manifest" "tamper/$base.manifest"; cp "$dump.sha256" "tamper/$base.sha256"
printf 'tampered' >> "tamper/x.dump"; mv tamper/x.dump "tamper/$base"; rm -f tamper/x.dump.*
tar -C tamper -cf - "$base" "$base.manifest" "$base.sha256" | age -r "$recipient" > dl/tampered.tar.age
admin_put dl/tampered.tar.age ledgerline-20261020T235959Z-7.tar.age 2>/dev/null
expect "tampered dump" "Backup checksum mismatch" bash offsite-restore.sh --config restore.env --identity test.key --name ledgerline-20261020T235959Z-7.tar.age
expect "not a ledgerline archive name" "not a Ledgerline backup" bash offsite-restore.sh --config restore.env --identity test.key --name ../etc/passwd
# 6. local files untouched by every failure above
[[ -s "$dump" && -s "$dump.manifest" && -s "$dump.sha256" ]] && echo "PASS  local backup untouched" || echo "FAIL  local backup damaged"
