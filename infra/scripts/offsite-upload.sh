#!/usr/bin/env bash
# Encrypt one local backup with the owner's age PUBLIC key and upload it to an S3-compatible bucket
# (Backblaze B2). The server holds no private key, so it can write backups but never read them, and the
# bucket key is write-only, so it cannot list or delete. Usage: offsite-upload.sh [backups/ledgerline-*.dump]
# (default: the newest dump). Without offsite.env the feature is off and this exits 0. A failure exits 1,
# records itself in backups/offsite.status and never changes or deletes a local backup. Keys never reach a
# command line or the output.
set -euo pipefail
umask 077
cd "${LEDGERLINE_DIR:-/opt/ledgerline}"
config="${OFFSITE_CONFIG:-offsite.env}"
if [[ ! -f "$config" ]]; then echo 'Off-site upload is not configured; skipping'; exit 0; fi
status=backups/offsite.status
tool_image="ledgerline-offsite:rclone1.70.3-age1.2"
work=''
cleanup() { if [[ -n "$work" ]]; then rm -rf "$work"; fi; }
trap cleanup EXIT

last_ok() { sed -n 's/^last_ok=//p' "$status" 2>/dev/null | head -n 1 || true; }
record() { # result, archive
  local previous ok
  previous=$(last_ok)
  ok=${previous:-never}
  [[ "$1" == ok ]] && ok=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  mkdir -p backups
  printf 'last_attempt=%s\nresult=%s\nlast_ok=%s\narchive=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$ok" "${2:-}" > "$status.partial"
  mv "$status.partial" "$status"
}
fail() { record failed "${archive:-}"; echo "Off-site upload failed: $1"; exit 1; }
archive=''

# Export so `docker run -e NAME` can pass values without putting them on a command line.
set -a
# shellcheck disable=SC1090
source "$config"
set +a
recipient="${OFFSITE_AGE_RECIPIENT:-}"
[[ "$recipient" =~ ^age1[0-9a-z]{58}$ ]] || fail 'OFFSITE_AGE_RECIPIENT is not an age public key'
for name in OFFSITE_S3_ENDPOINT OFFSITE_BUCKET OFFSITE_KEY_ID OFFSITE_APP_KEY; do
  [[ -n "${!name:-}" ]] || fail "$name is missing from $config"
done
prefix="${OFFSITE_PREFIX:-ledgerline/}"
[[ "$prefix" =~ ^[A-Za-z0-9._/-]*$ ]] || fail 'OFFSITE_PREFIX has unsupported characters'
export RCLONE_CONFIG_OFF_TYPE=s3 RCLONE_CONFIG_OFF_PROVIDER=Other RCLONE_CONFIG_OFF_ENDPOINT="$OFFSITE_S3_ENDPOINT" \
  RCLONE_CONFIG_OFF_REGION="${OFFSITE_S3_REGION:-}" RCLONE_CONFIG_OFF_ACCESS_KEY_ID="$OFFSITE_KEY_ID" \
  RCLONE_CONFIG_OFF_SECRET_ACCESS_KEY="$OFFSITE_APP_KEY" RCLONE_CONFIG_OFF_NO_CHECK_BUCKET=true

dump="${1:-$(ls -t backups/ledgerline-*.dump 2>/dev/null | head -n 1 || true)}"
[[ -n "$dump" && -s "$dump" && -s "$dump.manifest" && -s "$dump.sha256" ]] || fail 'no complete local backup found'
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f 1; else shasum -a 256 "$1" | cut -d ' ' -f 1; fi; }
[[ "$(cut -d ' ' -f 1 "$dump.sha256")" == "$(sha256 "$dump")" ]] || fail 'the local backup does not match its checksum'

base=$(basename "$dump")
archive="${base%.dump}.tar.age"
if ! docker image inspect "$tool_image" >/dev/null 2>&1; then
  docker build -q -t "$tool_image" - < "${OFFSITE_DOCKERFILE:-offsite.Dockerfile}" >/dev/null 2>&1 || fail 'could not build the tool image'
fi
work=$(mktemp -d backups/.offsite.XXXXXX)
tar -C "$(dirname "$dump")" -cf - "$base" "$base.manifest" "$base.sha256" \
  | docker run --rm -i --network none "$tool_image" age -r "$recipient" > "$work/$archive" || fail 'encryption step'
[[ -s "$work/$archive" ]] || fail 'encryption produced no file'
docker run --rm -v "$(pwd)/$work":/data:ro \
  -e RCLONE_CONFIG_OFF_TYPE -e RCLONE_CONFIG_OFF_PROVIDER -e RCLONE_CONFIG_OFF_ENDPOINT -e RCLONE_CONFIG_OFF_REGION \
  -e RCLONE_CONFIG_OFF_ACCESS_KEY_ID -e RCLONE_CONFIG_OFF_SECRET_ACCESS_KEY -e RCLONE_CONFIG_OFF_NO_CHECK_BUCKET \
  "$tool_image" rclone -q copyto "/data/$archive" "off:$OFFSITE_BUCKET/$prefix$archive" --no-check-dest --s3-no-head --retries 3 \
  >"$work/upload.log" 2>&1 || { [[ "${OFFSITE_DEBUG:-}" == 1 ]] && tail -n 5 "$work/upload.log" >&2; fail 'upload step'; }
record ok "$archive"
echo "Off-site copy uploaded as $archive"
