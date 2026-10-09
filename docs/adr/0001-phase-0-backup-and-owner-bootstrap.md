# 0001: Phase 0 owner provisioning and backup gate

Date: 2026-10-06. Status: accepted with Phase 0 plan approval.

The phase gate requires a restore check, while automated encrypted off-site backups are scheduled for Phase 4. Phase 0 adds a private manual `pg_dump` and a restore drill into a throwaway container with no network or exposed ports. Nightly restic/B2 backups and attachments remain Phase 4 work. Manual dumps stay on the VPS and do not yet provide off-site protection.

Owner creation runs once at API startup from private `.env` credentials, under a database transaction and advisory lock. Public sign-up and public setup routes remain disabled. Restarting never resets an existing owner's password. Better Auth uses Argon2id and UUIDv7; its adapter retains soft-deleted authentication rows and excludes them from reads.

Release deployment uses a separate GitHub Actions job with a short-lived read-only packages token. The VPS logs out of GHCR after pulling. No permanent registry token is stored there.
