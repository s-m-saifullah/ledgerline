#!/usr/bin/env bash
# Last-resort recovery if you are locked out by two-factor (ADR 0038): turns it off for the owner account
# and signs out every session, then you sign in with the password and set it up again. Run on the server
# as the deploy user: bash /opt/ledgerline/reset-two-factor.sh. It asks you to type RESET first, runs inside
# the API container (nothing is printed except what it changed) and never touches financial data.
set -euo pipefail
cd "${LEDGERLINE_DIR:-/opt/ledgerline}"
printf 'This turns off two-factor for the owner account and signs out every session.\nType RESET to continue: '
read -r answer
[[ "$answer" == RESET ]] || { echo 'Nothing changed.'; exit 1; }
docker compose --env-file .env --env-file release.env -f docker-compose.yml exec -T api node dist/cli/reset-two-factor.js --confirm
