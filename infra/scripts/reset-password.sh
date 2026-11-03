#!/usr/bin/env bash
# Last-resort recovery if the admin has forgotten the password they chose in the app (ADR 0048): sets a new
# temporary password for the admin account and signs out every session, prints the password once, and the admin
# is asked to choose a new one at the next sign-in. Run on the server as the deploy user:
# bash /opt/ledgerline/reset-password.sh. It asks you to type RESET first, runs inside the API container and
# never touches financial data. The password is shown on your terminal only; do not paste it anywhere.
set -euo pipefail
cd "${LEDGERLINE_DIR:-/opt/ledgerline}"
printf 'This sets a new temporary password for the admin account and signs out every session.\nType RESET to continue: '
read -r answer
[[ "$answer" == RESET ]] || { echo 'Nothing changed.'; exit 1; }
docker compose --env-file .env --env-file release.env -f docker-compose.yml exec -T api node dist/cli/reset-password.js --confirm
