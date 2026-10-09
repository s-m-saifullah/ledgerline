# Backup and restore drill tests

Synthetic, local-only checks for `backup.sh`, `restore-drill.sh` and `verify-queries.sh`. They never touch production.

1. Create a scratch directory with a compose file that defines only a `db` service (`postgres:18`, user/db `ledgerline`, a published port on 127.0.0.1) and a matching `.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`). Copy `backup.sh`, `restore-drill.sh`, `verify-queries.sh`, `negative.sh` and `run-in-docker-cli.sh` into it.
2. Start the database, apply the migrations (`DATABASE_URL=... node --import tsx apps/api/src/db/migrate.ts`) and load `seed.sql` (a hand-checked ledger with ordinary, pending and deleted entries, live and tombstoned transfers, a split, a two-service receipt and a tombstoned payment).
3. The scripts need Bash 4+, so run them in a Linux container that can reach the Docker socket:
   `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$DIR":"$DIR" -e LEDGERLINE_DIR="$DIR" docker:cli sh "$DIR/run-in-docker-cli.sh" 'bash backup.sh && bash restore-drill.sh "$(ls -t backups/*.dump | head -n 1)"'`
4. `negative.sh` (run the same way with `'bash negative.sh'`) corrupts the scratch database on purpose and expects each failure message: tampered or missing or duplicate check lines, checksum mismatch, broken transfer leg, broken split sum, desynced linked payment, a receipt spanning two people, plus a clean restore and a drill taken while writes continue.
