#!/usr/bin/env bash
# Checks that a release APK is signed and prints its signing certificate's SHA-256 (ADR 0043, slice 5).
#
#   android-verify-apk.sh <apk> [expected SHA-256, with or without colons, any case]
#
# Uses build-tools 36.0.0 (the version the workflows install) unless APKSIGNER names another apksigner. Prints only
# the digest: the workflow log is public and the certificate's name fields are the owner's. With GITHUB_OUTPUT set,
# also writes cert=<digest> to it. Exit 1: the signature does not verify, the digest cannot be read, or it differs
# from the expected one.
set -euo pipefail

apk="${1:?usage: android-verify-apk.sh <apk> [expected SHA-256]}"
expected="${2:-}"
apksigner="${APKSIGNER:-${ANDROID_HOME:-}/build-tools/36.0.0/apksigner}"
[ -x "$apksigner" ] || { echo "::error::apksigner not found at $apksigner"; exit 1; }
[ -f "$apk" ] || { echo "::error::$apk does not exist"; exit 1; }

if ! signer_output="$("$apksigner" verify --print-certs "$apk" 2>&1)"; then
  echo "::error::The signature does not verify"
  exit 1
fi
cert="$(printf '%s\n' "$signer_output" | grep -i -m1 'certificate SHA-256 digest' | sed 's/^[^:]*: *//' | tr -d ' \r\n' | tr 'A-F' 'a-f' || true)"
if ! printf '%s' "$cert" | grep -q -E '^[0-9a-f]{64}$'; then
  echo "::error::Could not read the signing certificate's SHA-256 from apksigner; its output has these labels:"
  printf '%s\n' "$signer_output" | sed 's/:.*//' | sort -u
  exit 1
fi
echo "Signing certificate SHA-256: $cert"
if [ -n "$expected" ] && [ "$cert" != "$(printf '%s' "$expected" | tr -d ': ' | tr 'A-F' 'a-f')" ]; then
  echo "::error::The APK is signed with a different key than the expected certificate"
  exit 1
fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "cert=$cert" >> "$GITHUB_OUTPUT"; fi
