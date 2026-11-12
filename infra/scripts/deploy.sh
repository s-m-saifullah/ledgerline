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
# A migration runs when the new API starts, so take a backup first and prove it restores (a drill of
# that exact dump) before anything is pulled. Only a missing database volume is a fresh install: a
# stopped or crashed database still has its volume and still needs the backup, and a Docker error stops
# the deploy here instead of being read as "fresh".
project="${COMPOSE_PROJECT_NAME:-ledgerline}"
volume=$(docker volume ls --quiet --filter "name=^${project}_db\$") || { echo 'Could not ask Docker for the database volume; nothing was deployed'; exit 1; }
if [[ -n "$volume" ]]; then
  docker compose --env-file .env -f docker-compose.yml up -d --wait --wait-timeout 120 db || { echo 'Could not start the database; nothing was deployed'; exit 1; }
  bash ./backup-and-drill.sh || { echo 'Pre-deploy backup failed or did not restore cleanly; nothing was deployed'; exit 1; }
  # The off-site copy is best effort here: a failure is recorded in backups/offsite.status and never blocks a deploy.
  bash ./offsite-upload.sh || echo 'Warning: the off-site copy of the pre-deploy backup failed; continuing'
elif [[ -n "$(docker compose --env-file .env -f docker-compose.yml ps -a -q db)" ]]; then
  echo "A database container exists but the volume ${project}_db was not found; nothing was deployed, so no backup is skipped"
  exit 1
else
  echo 'No database volume or container; skipping the pre-deploy backup (fresh install)'
fi
# Keep the running release as the rollback target, unless this is the same version again.
printf 'API_IMAGE=%s-api:%s\nWEB_IMAGE=%s-web:%s\n' "$repository" "$version" "$repository" "$version" > release.env.new
if [[ -f release.env ]] && ! cmp -s release.env release.env.new; then cp release.env previous.env; fi
mv release.env.new release.env
compose() { docker compose --env-file .env --env-file release.env -f docker-compose.yml "$@"; }
rollback() {
  if [[ -f previous.env ]]; then cp previous.env release.env; compose up -d --wait --wait-timeout 180; echo 'Previous release restored'; fi
}
if ! compose pull || ! compose up -d --wait --wait-timeout 180; then rollback; exit 1; fi
if ! curl --fail --silent --retry 5 --retry-connrefused --retry-delay 2 http://127.0.0.1:8080/api/health >/dev/null; then rollback; exit 1; fi
echo "Deployed $version"
