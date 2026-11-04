# ADR 0049: Deleted people, cleared ledgers and the 30-day purge (web and API)

Date: 2026-11-04. Status: accepted by the owner in chat on 2026-11-04, with the design shown in the local prototype. Continues [0048](0048-profile-and-managed-users.md) (users the admin adds), which left a deleted person's data in place and their email taken, and builds on [0037](0037-offsite-encrypted-backups.md) (backup retention). Amends one rule of the plan: "Deletes are soft" gets one exception, the purge below.

## Context

Deleting a person today soft-deletes them, their sign-in, their ledger and their memberships with one timestamp and ends their sessions (ADR 0048). Nothing brings them back, nothing ever removes their data, and their email stays taken. People also have no way to start fresh with an empty ledger. **Production has a real user. Nothing here may change what they use today.**

## Decisions

- **Deleting a person is the first of two stages.** The person moves to a **Recently deleted** list. The admin can **restore** them with all their data, exactly as before (same password, same sign-in settings, sign-in allowed; they sign in again). **After 30 days** they and all their data are **removed for good** and their email is free again. The admin can also **Delete now** for a person who is in that list. The 30 days count from the person's `deleted_at`.
- **Restore brings back only what that delete removed.** It revives the person, their sign-in rows, their ledgers and their memberships whose `deleted_at` equals the person's own, never anything deleted earlier or separately, and sets `updated_at` to now so a phone's next pull sees them.
- **The purge is a hard delete, in one transaction.** It removes the person's sole-owner ledgers with every row that holds their `ledger_id`, the memberships, then the person's sessions, tokens, sign-in rows, two-factor and verification rows and the person. The person row is locked first, so a restore and a purge cannot both win. A test walks the database's own table list and fails when the purge misses a table that points at a ledger or a user.
- **The hourly job does it.** The existing hourly tick purges everyone past 30 days and every cleared ledger past 30 days; what is due is worked out from the tables, nothing new is scheduled. The log carries counts only, never a name or an email.
- **The admin's own account can never be deleted, restored or purged** (`409`, as for every other action on it).
- **A person can clear their ledger** (Settings, "Clear ledger", typing `CLEAR`), and **the admin can clear a person's ledger** from the person's sheet (typing their email). Clearing soft-deletes every live row of the ledger's money tables with one timestamp and records it in `ledgers.cleared_at`. The ledger, its name, its base currency and its memberships stay, so the person signs in to an empty ledger.
- **Clearing can be undone for 30 days.** "Restore cleared ledger" revives the rows whose `deleted_at` equals `cleared_at`. There is **one undo slot per ledger**: clearing again removes the older batch at once. Restore works **only while the ledger has no live money rows** (`409`, "Clear what is there now first"), so it never mixes two sets of data. After 30 days the job removes the batch.
- **The admin may clear or restore a ledger and still never sees what is in it.** The admin routes return account facts and dates only, never a balance, entry or report. This amends 0048's "never sees anyone's money" by allowing those two actions, not by showing anything.
- **Email.** A deleted person's email stays taken for the 30 days (it is unique); the message the admin gets says so ("That person was deleted. Restore them from Recently deleted, N days left, or use another email."), and the purge frees it. This replaces 0048's "an email of a deleted user cannot be reused".
- **Backups.** A purge cannot reach dumps already taken: the server keeps seven days and the off-site copy 90 days ([0037](0037-offsite-encrypted-backups.md)). The Delete now question and `SELF_HOSTING.md` say so, and the user guide tells people who runs the server.

## Data (migration 0029, additive)

`ledgers.cleared_at timestamptz` null by default (metadata-only on PostgreSQL 18); nobody has a value until someone clears a ledger. People need no column: the stage is `users.deleted_at`. Old code ignores `cleared_at`.

## API (new routes only; names settle in the build)

Admin only: list the deleted people (name, email, `deletedAt`, `purgeAt`; account facts only), restore a person, purge a person now, clear a person's ledger, restore a person's cleared ledger. A person with an owner role on their own ledger: clear it (the word `CLEAR` in the body) and restore it. `ManagedUser` gains `ledgerClearedAt`; the ledger schema gains `clearedAt` (the Android contract test and `docs/openapi.json` are checked). REST, camelCase, problem+json, `Idempotency-Key` on the ledger writes, the app's `Origin` on writes.

## Screens (web only; from the approved prototype)

Users gets a shut fold, "N recently deleted" (like the Tags archived fold, shown only when someone waits); each row shows the days left, amber at three or fewer, and opens a sheet with Restore and Delete now in red (a centred question, type the email). A person's sheet gets "Clear their ledger" in red (type their email) and, while an undo waits, "Restore cleared ledger" with the days left. The Delete question now says the person can be restored for 30 days. Settings, Your data, gets "Clear ledger" in red (type `CLEAR`) and, while an undo waits, "Restore cleared ledger" with the days left. Few words, one hint per row, the shared pieces. The Android app is unchanged; its sync shows a clear as deleted rows and a restore as newer live rows.

## Keeping production safe

- Nothing existing changes: no existing route or response, an additive column, and the existing API and browser suites pass unchanged.
- **Isolation is re-proved.** A purge of one person leaves another's ledger byte for byte the same (a fingerprint of every table that holds a ledger id); the cross-user walk of ADR 0048 still passes and covers the new ledger routes; the admin routes return no ledger data.
- **Boundary and race tests:** a person deleted 29 days ago is untouched and one deleted 30 days ago is purged (an injectable clock), a restore and a purge at once leave one winner, and a restore revives only what that delete removed.
- The restore drill gets an invariant (a deleted person has nothing live left: no sign-in, no membership, no ledger only they were in) and a purge of an aged person on the scratch copy.
- The purge is irreversible, so it is tried on the drill dump first and never by hand on production.
- Rollback to the release before this one is safe for data: old code ignores `cleared_at`, shows a cleared ledger as empty, and never purges.

## Amendments

- **2026-11-04, slice B (deleted people).** A person is in Recently deleted, and can be restored, while fewer than 30 days have passed since the delete (to the millisecond); the hourly job removes them in the first run after that, so "Delete now" also works on someone whose 30 days are over and whom the job has not reached yet. The days left count a part of a day as a whole one ("1 day left" on the last day, never "0"). Restore revives only the rows the delete stamped with the person's own moment (the person, their sign-in, their ledger and memberships); sessions are not revived, so the person signs in again. The drill invariant is "a deleted person has nothing live left", because the first draft ("no live row under a deleted ledger") is false after a delete: deleting a person soft-deletes the ledger but leaves its money rows as they are. A ledger another live person is a member of stays; if something in it still points at the person, the database refuses: "Delete now" answers `409` and the hourly job counts a failure (counts only in its log) and tries again next hour, and nothing is removed either way. The `409` text for a new person's email changes only when the email belongs to a deleted person; the web app shows its own text for a taken email until slice D.

## Not in this change

Deleting your own account, a different retention time, a per-item undo, showing the admin what a cleared or deleted ledger held, purging backups, an audit log, Android screens.

## Slices (each its own pull request; the owner tags the release)

A. This ADR, the rule lines in `CLAUDE.md` and `PLAN.md`, `SELF_HOSTING.md` and the progress entry (the prototype stays local).
B. API: deleted people (list, restore, purge now, the hourly purge, the new email message, drill invariants).
C. API: migration 0029, clear and restore a ledger, the batch purge, sync tests.
D. Web: the Users fold and sheets, the person-sheet actions, the Settings rows and the texts.
E. A server release (scratch drill from schema 0027 with two users through 0029, an aged purge, notes, the owner's approval).
