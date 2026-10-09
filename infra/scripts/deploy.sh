#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "${LEDGERLINE_DIR:-/opt/ledgerline}"
version="${1:?Usage: deploy.sh v0.0.1}"
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Use a release version such as v0.0.1'; exit 1; }
# Image repository without the -api/-web suffix, for example ghcr.io/<owner>/ledgerline. The release workflow passes it.
repository="${IMAGE_REPOSITORY:-}"
[[ -n "$repository" ]] || { echo 'Set IMAGE_REPOSITORY, for example ghcr.io/<owner>/ledgerline'; exit 1; }
exec 9>.deploy.lock
flock -n 9 || { echo 'Another deployment is running'; exit 1; }
# A migration runs when the new API starts, so take a verified-able backup first.
# Skip only on a fresh install, when no database container exists yet.
if [[ -n "$(docker compose --env-file .env -f docker-compose.yml ps -q db 2>/dev/null)" ]]; then
  bash ./backup.sh || { echo 'Pre-deploy backup failed; nothing was deployed'; exit 1; }
else
  echo 'No running database; skipping the pre-deploy backup (fresh install)'
fi
if [[ -f release.env ]]; then cp release.env previous.env; fi
printf 'API_IMAGE=%s-api:%s\nWEB_IMAGE=%s-web:%s\n' "$repository" "$version" "$repository" "$version" > release.env
compose() { docker compose --env-file .env --env-file release.env -f docker-compose.yml "$@"; }
rollback() {
  if [[ -f previous.env ]]; then cp previous.env release.env; compose up -d --wait --wait-timeout 180; echo 'Previous release restored'; fi
}
if ! compose pull || ! compose up -d --wait --wait-timeout 180; then rollback; exit 1; fi
if ! curl --fail --silent http://127.0.0.1:8080/api/health >/dev/null; then rollback; exit 1; fi
echo "Deployed $version"
