# ADR 0038: Two-factor sign-in (TOTP)

Date: 2026-10-20. Status: accepted by the owner when approving the design in chat (every recommended choice). Phase 4 slice 2. Builds on [0001](0001-phase-0-backup-and-owner-bootstrap.md) (owner bootstrap and Better Auth).

## Context

Sign-in is an email and a password. Two-factor was planned for Phase 4. It must not lock the owner out of real data, so every way in has a recovery path that does not need the app.

## Decisions

- **Optional, per user.** Each user turns two-factor on for themselves in Settings; it is never forced. Owner, editor and viewer all use the same code.
- **Better Auth's two-factor plugin** (time-based one-time codes, 6 digits, 30 seconds, one step of drift either way). The plugin encrypts the secret and backup codes with `BETTER_AUTH_SECRET`.
- **Enrolment needs the password and one valid code.** The account shows a QR code (drawn in the browser with the small `qrcode` library, no network request), the text key and an "open in authenticator app" link. Two-factor switches on only after the user types one valid code, so a bad scan cannot lock anyone out. Then 10 single-use backup codes are shown once, behind an "I saved them" confirmation.
- **Sign-in:** the password step is followed by a code step; a backup code works in the same box and is spent when used.
- **Disable and "new backup codes"** need the password. New backup codes replace the old set.
- **No trusted-device cookie.** Sessions already last days, and a second long-lived cookie is one more thing to reason about. The plugin's trusted-device option stays off.
- **Brute force:** the plugin's failed-attempt counter locks code checks for a while, on top of the auth rate limit. The lock is temporary; backup codes are subject to the same lock.
- **Route allowlist.** The API exposes only the browser-session routes it needs. The two-factor routes (enable, verify code, verify backup code, new backup codes, disable) are added to that list; everything else under the auth path stays disabled. The generic problem response for failures stays.
- **Data (migration 0027, additive):** `users.two_factor_enabled` (default false) and a `two_factor` table with the plugin's columns (encrypted `secret`, encrypted `backup_codes`, `verified`, failed-attempt count, lock time) and the usual audit columns, deletes soft. Old code ignores both.
- **Backup manifest:** `two_factor` joins the manifest (row count and fingerprint only; the dump holds the encrypted values) with a derived check and an invariant: a user flagged enabled has exactly one verified live row, and a verified live row belongs to a flagged user. The scratch drill and the negative cases cover it.
- **Recovery when locked out:** (1) a backup code; (2) a `reset-two-factor` command run on the server over ssh, which turns two-factor off for the configured owner, ends their sessions and prints what it did, never a secret. The owner runs it only when needed and decides it; nothing runs it automatically. If `BETTER_AUTH_SECRET` is ever rotated, enrolled secrets become unreadable and this command is the way back.
- **Smoke check:** `production-smoke.mjs` accepts an optional `SMOKE_TOTP_SECRET` (kept in the private local file, never in the repository) and computes the code itself. Without it, a smoke run against an account with two-factor fails with a clear message.
- **Privacy:** codes, secrets and backup codes are never logged (the auth logger is already off), and the settings screen never shows the text key again after enrolment.
- **Passkeys stay planned**, as a separate later slice; they do not share this plugin.

## Risks and how they are covered

- **Lost phone:** backup codes, then the server command.
- **Wrong clock or bad scan:** the first code must verify before two-factor turns on.
- **Rollback to a release before this one:** the data is untouched, but old code ignores the flag, so two-factor is silently off. That is a security downgrade, not a lockout; it is recorded in the release notes.
- **Enrolling on production:** the owner does it deliberately, keeps the current session open until a fresh sign-in with a code works, and stores the backup codes and the text key before signing out.

## Tests

API integration tests (scratch database): enrol, wrong first code, sign-in needs a code, wrong code, backup code works once, new backup codes invalidate the old ones, disable, another user cannot touch someone else's two-factor, viewer and editor can enrol themselves, disabled auth routes still 404, rate and lock behaviour. A browser spec drives the whole flow with a test-only code generator. The restore drill gets the new check and a negative case. A release needs a scratch upgrade check from 0026 to 0027 with a backup and drill before and after.

## Slices

1. This ADR. 2. API (plugin, migration 0027, allowlist, manifest and drill, reset command, tests; API 0.1.44). 3. Web (Settings section, sign-in code step, smoke option, user guide, browser spec, by-eye check at 320, 390 and desktop). 4. Release when the owner asks.
