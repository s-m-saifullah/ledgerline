# ADR 0037: Off-site encrypted backups

Date: 2026-10-20. Status: accepted (merged with PR #100); the owner chose off-site backups as the first Phase 4 slice and delegated the tooling. Builds on [0001](0001-phase-0-backup-and-owner-bootstrap.md), which kept dumps on the server and left off-site copies for Phase 4.

## Context

Backups and the restore drill exist, but every dump lives on the same server as the database, so one disk or account failure loses both. Nothing here may weaken the running app: the slice adds files and scripts, no migration and no API change.

## Decisions

- **Encrypt on the server with a public key (age).** Each backup (dump, manifest and checksum, bundled in one archive) is encrypted with the owner's age public key before it leaves the server. The server holds only the public key, so it can write backups but cannot read them, and a compromised server exposes no old data. The private key is generated on the owner's own computer and kept in two places (for example a notes app and a password manager or paper). It never reaches the server, the repository or a chat.
- **Store in a private Backblaze B2 bucket** (S3-compatible storage; another S3-compatible target would work the same). The server holds an application key limited to that bucket with write-only access: it can upload but not list, read or delete, so an attacker on the server cannot erase the copies. A second, read-only key stays with the owner for restores.
- **Retention is the bucket's job.** A lifecycle rule on the bucket removes files after 90 days. The server never deletes remote files. Local retention (`prune-backups.sh`) is unchanged.
- **When.** The daily scheduled backup uploads its new archive right after it succeeds. Upload is off unless the `OFFSITE_*` settings exist in `.env` (documented in `.env.example`), so self-hosters opt in. A failed upload exits non-zero, is logged to the cron log (no credentials, no amounts), and never deletes or alters the local dump.
- **Tools run in pinned containers** (age and rclone images), so the server needs no new host packages.
- **Failures are visible.** The script records the time and result of the last upload in a small status file in `backups/`; the release workflow's backup step and the host check read it. No third-party monitoring service is used (privacy rule).
- **Proving it works.** A write-only key cannot read back, so a restore from off-site is proved by a script run on the owner's computer: download the newest archive with the read-only key, decrypt, verify the checksum, then run the existing restore drill on it in a throwaway container. The owner runs it after setup and then monthly. Restoring into the running database still needs the owner's written authorization.
- **Backup manifest.** No new tables, so nothing is added to the manifest or the derived checks.

## Risks and how they are covered

- **Lost private key:** every off-site copy becomes unreadable. Two copies are kept, and the setup guide has the owner test a decrypt before relying on the backups.
- **Silent upload failure:** non-zero exit, status file, cron log, release check.
- **Leaked B2 key:** write-only and bucket-limited, so it exposes nothing and cannot delete.
- **Backup contains real financial data:** only the encrypted archive leaves the server; plaintext dumps never go to B2.

## Tests

On a scratch compose project with a local S3-compatible stand-in: encrypt, upload, download, decrypt, restore drill passes. Negative cases: wrong key, truncated archive, bad checksum, unreachable remote, missing settings (feature off, local backup unaffected), upload failure leaves local files intact and exits non-zero.

## Amendments while building

- **Settings live in `offsite.env`,** a separate private file (mode 0600) in the deploy directory, not in `.env`, so the application's own configuration stays untouched. `.env.example` documents the names.
- **One tool image** (`infra/docker/offsite.Dockerfile`: pinned rclone with age) replaces two pinned containers. It is built on the server on first use. The upload talks to the bucket through its S3-compatible interface.
- **A write-only key cannot check what it wrote,** so uploads skip rclone's HEAD requests (`--no-check-dest --s3-no-head`); the S3 upload itself still verifies the data it sends. A scratch test with a write-only stand-in key found this: rclone's default upload fails with 403 on such a key.
- **Status file** `backups/offsite.status` holds `last_attempt`, `result` (`ok` or `failed`), `last_ok` and the archive name.
