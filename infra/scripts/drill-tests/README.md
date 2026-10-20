# Backup and restore drill tests

Synthetic, local-only checks for `backup.sh`, `restore-drill.sh` and `verify-queries.sh`. They never touch production.

1. Create a scratch directory with a compose file that defines only a `db` service (`postgres:18`, user/db `ledgerline`, a published port on 127.0.0.1) and a matching `.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`). Copy `backup.sh`, `restore-drill.sh`, `verify-queries.sh`, `negative.sh` and `run-in-docker-cli.sh` into it.
2. Start the database, apply the migrations (`DATABASE_URL=... node --import tsx apps/api/src/db/migrate.ts`) and load `seed.sql` (a hand-checked ledger with ordinary, pending and deleted entries, live and tombstoned transfers, a split, a two-service receipt, a tombstoned payment and two CSV import batches, one of them undone).
3. The scripts need Bash 4+, so run them in a Linux container that can reach the Docker socket:
   `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$DIR":"$DIR" -e LEDGERLINE_DIR="$DIR" docker:cli sh "$DIR/run-in-docker-cli.sh" 'bash backup.sh && bash restore-drill.sh "$(ls -t backups/*.dump | head -n 1)"'`
4. `negative.sh` (run the same way with `'bash negative.sh'`) corrupts the scratch database on purpose and expects each failure message: tampered or missing or duplicate check lines, checksum mismatch, broken transfer leg, broken split sum, desynced linked payment, a receipt spanning two clients, an entry that outlives its undone import, a link to a deleted tag, a transfer whose legs carry different tags, a rule carrying a deleted tag, plus a clean restore and a drill taken while writes continue.
5. Start pg-boss once against the scratch database (the job runner creates its `pgboss` schema) before step 3 to prove the drill still passes with the job tables in the dump; the drill then also checks that the schema restored.

## Off-site backup checks

`offsite-upload.sh` and `offsite-restore.sh` have two kinds of tests. `infra/scripts/offsite-upload.test.mjs` runs in CI with a fake `docker` (no containers). The full round trip runs by hand against an S3 stand-in:

1. In the scratch compose project add an S3-compatible service with three keys on one bucket: an admin key, a WRITE-ONLY key (put only) and a READ-ONLY key (list and get). SeaweedFS (`chrislusf/seaweedfs`, `server -s3 -s3.config=...`) does this with an identities file; any S3 server with per-key permissions works. Publish its port on 127.0.0.1.
2. Take a backup as in step 3 above. Create a throwaway age key (`age-keygen -o test.key`; never use a real key) and write `offsite.env` (the write-only key and the stand-in's endpoint, reached from containers as `host.docker.internal`) and `restore.env` (the read-only key); copy `offsite-upload.sh`, `offsite-restore.sh` and `offsite.Dockerfile` next to the backups.
3. `LEDGERLINE_DIR=$PWD bash offsite-upload.sh` uploads; `bash offsite-restore.sh --config restore.env --identity test.key` downloads, decrypts, checks the checksum and runs the restore drill.
4. `ADMIN_ENV=admin.env bash offsite-negative.sh` covers the feature being off, an unreachable remote, a bad recipient, a local checksum mismatch, a read-only key trying to upload, a wrong private key, a truncated archive, a tampered dump and a bad archive name, and checks the local backup is untouched.
5. Confirm the write-only key can neither list nor read the bucket. Remove the scratch project afterwards (its own `docker compose down -v`, never the dev project's).
