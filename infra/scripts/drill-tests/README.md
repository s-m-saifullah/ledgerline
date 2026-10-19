# Backup and restore drill tests

Synthetic, local-only checks for `backup.sh`, `restore-drill.sh` and `verify-queries.sh`. They never touch production.

1. Create a scratch directory with a compose file that defines only a `db` service (`postgres:18`, user/db `ledgerline`, a published port on 127.0.0.1) and a matching `.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`). Copy `backup.sh`, `restore-drill.sh`, `verify-queries.sh`, `negative.sh` and `run-in-docker-cli.sh` into it.
2. Start the database, apply the migrations (`DATABASE_URL=... node --import tsx apps/api/src/db/migrate.ts`) and load `seed.sql` (a hand-checked ledger with ordinary, pending and deleted entries, live and tombstoned transfers, a split, a two-service receipt, a tombstoned payment and two CSV import batches, one of them undone).
3. The scripts need Bash 4+, so run them in a Linux container that can reach the Docker socket:
   `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$DIR":"$DIR" -e LEDGERLINE_DIR="$DIR" docker:cli sh "$DIR/run-in-docker-cli.sh" 'bash backup.sh && bash restore-drill.sh "$(ls -t backups/*.dump | head -n 1)"'`
4. `negative.sh` (run the same way with `'bash negative.sh'`) corrupts the scratch database on purpose and expects each failure message: tampered or missing or duplicate check lines, checksum mismatch, broken transfer leg, broken split sum, desynced linked payment, a receipt spanning two clients, an entry that outlives its undone import, a link to a deleted tag, a transfer whose legs carry different tags, plus a clean restore and a drill taken while writes continue.
5. Start pg-boss once against the scratch database (the job runner creates its `pgboss` schema) before step 3 to prove the drill still passes with the job tables in the dump; the drill then also checks that the schema restored.
