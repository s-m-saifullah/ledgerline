#!/usr/bin/env bash
# Prove an off-site backup restores. Run on YOUR computer (needs Docker), never on the server:
#   offsite-restore.sh --config restore.env --identity ledgerline-backup.key [--name ledgerline-...tar.age] [--keep]
# restore.env uses the same names as the server's offsite.env but with the READ-ONLY bucket key
# (OFFSITE_S3_ENDPOINT, OFFSITE_S3_REGION, OFFSITE_BUCKET, OFFSITE_PREFIX, OFFSITE_KEY_ID, OFFSITE_APP_KEY).
# It downloads the newest archive (or --name), decrypts it with your private key, checks the checksum and
# runs restore-drill.sh in a throwaway container with no network. It never touches a running database.
# The decrypted files hold real financial data, so they are deleted afterwards unless you pass --keep.
# Works with the macOS default bash (3.2); the drill itself runs inside a Linux container.
set -euo pipefail
umask 077
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
config='' identity='' name='' keep=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) config="${2:?--config needs a file}"; shift 2 ;;
    --identity) identity="${2:?--identity needs a file}"; shift 2 ;;
    --name) name="${2:?--name needs an archive name}"; shift 2 ;;
    --keep) keep=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done
[[ -f "$config" && -f "$identity" ]] || { echo 'Usage: offsite-restore.sh --config restore.env --identity private.key [--name archive] [--keep]'; exit 1; }
identity=$(cd "$(dirname "$identity")" && pwd)/$(basename "$identity")
tool_image="ledgerline-offsite:rclone1.75.2-age1.3"
work=$(mktemp -d "${TMPDIR:-/tmp}/ledgerline-offsite-restore.XXXXXX")
cleanup() { if [[ "$keep" == true ]]; then echo "Kept the decrypted files in $work (real data; delete them when done)"; else rm -rf "$work"; fi; }
trap cleanup EXIT

set -a
# shellcheck disable=SC1090
source "$config"
set +a
for var in OFFSITE_S3_ENDPOINT OFFSITE_BUCKET OFFSITE_KEY_ID OFFSITE_APP_KEY; do
  [[ -n "${!var:-}" ]] || { echo "$var is missing from the config file"; exit 1; }
done
prefix="${OFFSITE_PREFIX:-ledgerline/}"
export RCLONE_CONFIG_OFF_TYPE=s3 RCLONE_CONFIG_OFF_PROVIDER=Other RCLONE_CONFIG_OFF_ENDPOINT="$OFFSITE_S3_ENDPOINT" \
  RCLONE_CONFIG_OFF_REGION="${OFFSITE_S3_REGION:-}" RCLONE_CONFIG_OFF_ACCESS_KEY_ID="$OFFSITE_KEY_ID" \
  RCLONE_CONFIG_OFF_SECRET_ACCESS_KEY="$OFFSITE_APP_KEY" RCLONE_CONFIG_OFF_NO_CHECK_BUCKET=true
envs=(-e RCLONE_CONFIG_OFF_TYPE -e RCLONE_CONFIG_OFF_PROVIDER -e RCLONE_CONFIG_OFF_ENDPOINT -e RCLONE_CONFIG_OFF_REGION
  -e RCLONE_CONFIG_OFF_ACCESS_KEY_ID -e RCLONE_CONFIG_OFF_SECRET_ACCESS_KEY -e RCLONE_CONFIG_OFF_NO_CHECK_BUCKET)
if ! docker image inspect "$tool_image" >/dev/null 2>&1; then
  docker build -q -t "$tool_image" - < "$here/../docker/offsite.Dockerfile" >/dev/null
fi
if [[ -z "$name" ]]; then
  name=$(docker run --rm "${envs[@]}" "$tool_image" rclone -q lsf "off:$OFFSITE_BUCKET/$prefix" --files-only | grep -E '^ledgerline-[0-9TZ-]+\.tar\.age$' | sort | tail -n 1 || true)
  [[ -n "$name" ]] || { echo 'No archive found in the bucket (or the key cannot list it)'; exit 1; }
fi
[[ "$name" =~ ^ledgerline-[0-9TZ-]+\.tar\.age$ ]] || { echo 'Archive name is not a Ledgerline backup'; exit 1; }
echo "Restoring $name"
docker run --rm -v "$work":/data "${envs[@]}" "$tool_image" rclone -q copyto "off:$OFFSITE_BUCKET/$prefix$name" "/data/$name" --retries 3 >/dev/null \
  || { echo 'Download failed'; exit 1; }
docker run --rm -i --network none -v "$identity":/key.txt:ro "$tool_image" age -d -i /key.txt < "$work/$name" > "$work/bundle.tar" \
  || { echo 'Decryption failed: wrong private key or a damaged archive'; exit 1; }
rm -f "$work/$name"
tar -C "$work" -xf "$work/bundle.tar" || { echo 'The decrypted bundle is damaged'; exit 1; }
rm -f "$work/bundle.tar"
dump=$(ls "$work"/ledgerline-*.dump 2>/dev/null | head -n 1 || true)
[[ -n "$dump" && -s "$dump.manifest" && -s "$dump.sha256" ]] || { echo 'The bundle is missing a file'; exit 1; }
cp "$here/restore-drill.sh" "$here/verify-queries.sh" "$work/"
dump_name=$(basename "$dump")
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$work":"$work" -e LEDGERLINE_DIR="$work" -e DUMP="$dump_name" \
  "${OFFSITE_DRILL_IMAGE:-docker:cli}" sh -c 'apk add --no-cache bash coreutils >/dev/null 2>&1; cd "$LEDGERLINE_DIR"; exec bash restore-drill.sh "$DUMP"'
echo "Off-site restore check passed for $name"
