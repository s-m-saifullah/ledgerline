# ADR 0048: Profile, and users the admin adds (web only)

Date: 2026-11-03. Status: accepted by the owner in chat on 2026-11-03, with the recommendation below. Builds on [0001](0001-phase-0-backup-and-owner-bootstrap.md) (the first account is created on first run), [0038](0038-two-factor-totp.md) (per-user two-factor, the route allowlist, the server reset command), [0042](0042-sync-and-bearer-tokens.md) (signed-in devices) and [0047](0047-web-redesign.md) (the design). Changes one line of the plan: "public sign-up is off" stays, and the admin can now add people by hand.

## Context

Today there is one account, created from `.env` on first run, with one ledger. The data model already allows many: every financial row has a `ledger_id`, every query is ledger-scoped, idempotency keys are per user and ledger, the background jobs loop over every ledger and the web opens the signed-in user's own ledger. What is missing is a way to add an account or change a password inside the app. **Production has a real user. Nothing here may change what they use today.**

## Decisions

- **A user is a person with their own account and their own ledger**, created like the first account (user, password, a "Personal ledger" in USD, and an owner membership), by one shared function. Users never see each other's data; there is no sharing between them in this change (the editor and viewer roles stay in the table, unused by any screen).
- **The admin is the account the server was set up with.** One admin only; nobody is promoted. The admin manages accounts and **never sees anyone's money**: the admin routes return only account facts (name, email, admin, temporary password, disabled, created), never a balance, entry or report, and the admin is not a member of anyone else's ledger. Whoever runs the server can still read the database and backups; the user guide says so.
- **Temporary password.** The browser makes a strong one (three words and a number) for the admin to read out or copy; the admin may make another. It is sent once in the request and is never returned, never logged and left out of the stored request fingerprint of the idempotent write. 12 to 128 characters, enforced by the server. No expiry; the list shows "Temporary password" until it is changed, and the admin can reset it or stop the sign-in.
- **First sign-in.** A person flagged `must_change_password` can sign in, but the server refuses every request except: read my profile, change my password, the session routes, sign-out and the two-factor sign-in steps, with a 403 problem of type `password-change-required`. The web then shows one card ("Choose a new password", no shell) until it is saved. Changing it clears the flag and signs out their other devices.
- **Change password (everyone).** Current password, new one twice, refuses the same password, "Sign out my other devices" on by default (the Android app too: same sign-in). Wrong current passwords are limited.
- **Profile (everyone).** One row with name, email and an Admin pill (tap to change the name; the email is read only, because the server checks the admin's email at start and no mail exists to confirm a new one), Change password, and links to Two-factor and Signed-in devices, which stay in Settings unchanged.
- **Users (admin only).** More, the sidebar and the palette. A calm list with one pill per person (Admin, Temporary password, Disabled); Add user (name, email, temporary password); one sheet per person: Reset password (signs them out), Turn off two-factor (the lost-phone case), Sign out their devices, Stop sign-in or Allow it again (their ledger is untouched), Delete user. Delete soft-deletes the user, their ledger and memberships, ends their sessions, and asks the admin to type the person's email; old backups still hold the data. The admin cannot stop or delete themselves. An email of a deleted user cannot be reused in this change.
- **Own routes, not Better Auth's admin plugin.** The plugin adds roles, bans and routes this app does not need and would widen the route allowlist (ADR 0038).
- **Admin recovery.** Once the password can change in the app, the `.env` value is stale. A `reset-password` command, run on the server like `reset-two-factor`, sets a new temporary password for the admin and prints it once.

## Data (migration 0028, additive)

`users.is_admin boolean not null default false` (the migration sets it for the first account, and starting the API makes sure the configured owner has it), `users.must_change_password boolean not null default false`, `users.disabled_at timestamptz`. Constant defaults are metadata-only on PostgreSQL 18; the existing account reads "not temporary, not disabled", so nothing changes for them. Old code ignores the columns. The restore drill gets guarded invariants (a flagged user has a live password; every live user owns a live ledger) and negative cases, so older dumps still pass.

## API (new routes only; no existing response changes)

`GET /api/v1/me`, `PATCH /api/v1/me` (name), `POST /api/v1/me/password`; admin only: `GET` and `POST /api/v1/users`, `PATCH /api/v1/users/{id}` (disabled), `POST /api/v1/users/{id}/password`, `DELETE /api/v1/users/{id}/sessions`, `DELETE /api/v1/users/{id}/two-factor`, `DELETE /api/v1/users/{id}`. REST, camelCase, problem+json, `Idempotency-Key` on writes. One hook for every `/api/v1` path refuses a flagged, disabled or deleted person, so a route cannot forget it, and a test walks the registered route table. A disabled person is also refused at sign-in with the usual wrong-password answer, and their sessions and Android tokens end.

## Keeping production safe

- A person who is not flagged (everyone today) takes exactly the same path as before; the existing API and browser suites must pass unchanged, and a new test proves the hook lets such a person through every route.
- Sessions stay valid across the deploy. Settings, sign-in, two-factor and the Android app are untouched. A person on a temporary password cannot use the phone app until they have changed it on the web.
- **Isolation is proved, not assumed.** A test creates a second user with data and, for every ledger route, shows that the first user's ledger ids answer 404 and that no list holds the other's rows, in both directions, and that the admin routes never return ledger data.
- The release repeats the scratch drill from schema 0027 with two users: migrate, check the existing account and its sign-in, backup and restore, negative cases, and the other user's data absent from the first user's reads.
- Rollback to the release before this one is safe for data (the columns are ignored), but old code would not enforce the first-sign-in change or the stop on a disabled person: before rolling back, the admin resets or removes anyone still on a temporary password and stops the extra accounts (recorded in the release notes, as ADR 0038 did).

## Decided with the owner

Reset password, Turn off two-factor and Delete do not ask for the admin's own password for now; Delete asks the admin to type the person's email. Revisit if the admin ever shares the browser.

## Amendments

- **2026-11-03, slice 2: no `Idempotency-Key` on the account routes** (`/me` now, `/users` in slice 3). The stored replies need a ledger and these routes are not about one. A rename is safe to repeat; a lost answer to a password change is retried with the new password as the current one; a retried "add user" says the email is taken and the admin resets that person's password. A person on a temporary password may use only `GET /me` and `POST /me/password` (not `PATCH /me`). The refusal's problem type is `urn:ledgerline:problem:password-change-required`. `reset-password` is copied to the server by the release like `reset-two-factor` (a test checks that every file `release.yml` copies exists).

- **2026-11-03, slice 3: the admin's own account is refused for every action on a person.** Stop, delete, reset password, sign out and turn off two-factor all answer `409` for the admin's id: a reset would put the admin on a temporary password and lock them out. The admin's own password, devices and two-factor stay in Profile and Settings. An unknown or deleted id is `404`. A ledger is soft-deleted with its owner only when no other live person is a member of it (sharing is not built, so today it always is). The restore drill gets two invariants, "a person on a temporary password has a live sign-in" and "every live person owns a live ledger", both skipped for dumps that predate migration 0028.

- **2026-11-03, slice 5: the first-sign-in card has a first row, "Temporary password".** The server needs the current password to change a password (`POST /me/password`), and the browser cannot keep what the sign-in form held: a reload or the two-factor step forgets it. So the card asks for it, as the owner chose. Its rows are Temporary password, New password and Confirm New (the prototype's two rows, and "Repeat it" renamed). The app waits for `GET /me` before it shows anything; if `/me` cannot be read it opens as it always did, and the server refuses what it must. The app also forgets who I am (`/me` and the people list) on sign-out and at sign-in, because more than one person can now use one browser.

## Not in this change

Sharing a ledger between users, email change, photo, languages, deleting your own account, passkeys, invitation or reset emails (the server sends no mail), a second admin, an audit log, reusing a deleted person's email, Android screens.

## Slices (each its own pull request; the owner tags the release)

1. This ADR, the plan and the `PLAN.md` line (the prototype stays local).
2. API: migration 0028, the shared account creation, `/me`, change password, the hook, the `reset-password` command, tests (API 0.1.52).
3. API: the user routes, the cross-user isolation tests, the drill invariants (API 0.1.53).
4. Web: Profile and Change password.
5. Web: Users, the first sign-in card and the web's handling of the refusal.
6. A server release (scratch drill from 0027 with two users, notes, the owner's approval).
