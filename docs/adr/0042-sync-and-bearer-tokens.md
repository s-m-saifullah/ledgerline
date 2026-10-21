# ADR 0042: Android sync and bearer tokens

Date: 2026-10-21. Status: accepted by the owner when approving the design in chat (every recommended choice). Phase 4 slice 5. Builds on [0001](0001-phase-0-backup-and-owner-bootstrap.md) (owner sign-in), [0038](0038-two-factor-totp.md) (two-factor), the financial write rules in `apps/api/src/modules/writes/README.md` and the Android path in `docs/PLAN.md`.

## Context

The Android app (Phase 5) is another client of the same API with a Room mirror that works offline. Today the API accepts only browser sessions: writes require an `Origin` header equal to the app address, which a phone app does not send, and the auth allowlist has no bearer support. The app needs a way to sign in, to pull what changed, and to push what was entered offline, without weakening the web app's sign-in and without losing or double-applying money.

Rows already carry `version`, `updated_at` and `deleted_at`, deletes are soft, and every financial write goes through `runFinancialWrite` (per-key receipts, scoped repositories), so a sync push can reuse the write path as it is.

## Decisions

- **Bearer tokens.** Better Auth's `bearer` plugin. The phone signs in with the existing `POST /auth/sign-in/email` and, when two-factor is on, the two-factor verify routes; it receives its token in a response header only after two-factor completes (a password alone gives a two-factor user no token). The token is an ordinary session: same 7-day lifetime, extended on use, so background sync keeps it alive. No new auth routes are opened for tokens.
- **Origin rule.** A request that carries an `Origin` header must still match the app address. A request with no `Origin` is accepted only with `Authorization: Bearer` (never together with an ambient cookie), or on the sign-in and two-factor verify routes, which are protected by credentials. Browser cookie sessions behave exactly as before.
- **Pull: `GET /api/v1/ledgers/{ledgerId}/sync?cursor=&limit=`.** Changed rows since the cursor, deleted rows included as tombstones (`deletedAt` set), read in one repeatable-read snapshot per page with `hasMore` and a new cursor. Rows are normalized (a transaction carries `accountId`, `categoryId`, `tagIds`, its split lines and its transfer link; names are joined on the phone from the mirrored accounts, categories and tags), so a rename needs no refresh of the entries. The cursor is built from `updated_at` and the row id with a two-minute overlap, so a transaction that commits late is not missed; the phone applies rows by id and ignores any whose `version` is not newer, which makes repeats harmless. No migration and no new table.
- **Push: `POST /api/v1/ledgers/{ledgerId}/sync`.** Up to 50 mutations, each with a client-made UUIDv7 `id` that is also its idempotency key, a type (create, update or delete), the payload, `baseVersion` and `editedAt`. Each mutation runs on its own through the existing write path, so a retry is safe and one failure does not block the others. The response gives one result per mutation: `applied` (with the new version), `replayed`, `rejected` (with a problem) or `superseded` (with the current server row). Viewers cannot push; another ledger's rows are 404.
- **Conflicts: last write wins per row.** If the row is still at `baseVersion`, the change applies. If it has changed, the later edit wins, comparing `editedAt` capped at the time the server received the mutation (so a wrong phone clock cannot win for ever; a tie goes to the server). A losing change comes back as `superseded` with the winning row so the app can say "changed on another device" and keep the user's copy. An edit to a row that has since been deleted is `superseded` too.
- **Scope for Android version 1.** Pull (a read-only mirror): accounts, categories, tags, transactions with splits and tags, currencies and rates. Push (offline): create, edit and delete of entries and transfers. Online only, through the normal REST API: budgets, insights, clients, loans, recurring rules, imports and settings.
- **Signed-in devices.** `GET /api/v1/sessions` and `DELETE /api/v1/sessions/{sessionId}` and a Settings card list the sessions (device name, last used) with a Sign out button each, so a lost phone can be cut off. A session is soft-deleted like every other row.
- **Phone-side lock (Phase 5, no server work).** The app keeps the token in the Android Keystore under a key that needs the fingerprint (BiometricPrompt), so the token cannot be used until the owner unlocks the app. The server only sees an ordinary bearer token; losing the fingerprint lock never locks the owner out because password and two-factor sign-in still work.

## Not changing

Web sign-in, the cookie session, two-factor and the recovery command; the allowlist of auth routes the browser may call; the rule that logs never contain amounts, payees or notes (sync bodies are never logged and the token is never in a URL); money as integer minor units; ledger scoping on every query; the backup manifest (no new tables are expected; write receipts are already in backups). If a migration turns out to be needed (for example an index on `ledger_id, updated_at`), it will be additive and flagged before it is built.

## Slices and checks

1. This ADR (docs only).
2. Bearer tokens and the origin rule (API only). Tests: cookie sign-in, sign-out and two-factor are unchanged; a two-factor user gets no token from the password alone and one after the code; an `Origin` from another site is refused; no-`Origin` requests are accepted only as described; a revoked session stops working.
3. Pull. Tests: tombstones, paging, cross-ledger and viewer access, a transaction that commits late (two connections) is returned, and a per-table check that every change visible in a row also changes its `updated_at` and `version`.
4. Push, with a Node script that simulates an offline phone against a changed server and checks that both converge. Tests: replay of every mutation, an interrupted batch replayed in full, stale edit, delete then edit, tie, cross-ledger and viewer, transfers and splits.
5. Signed-in devices (API and Settings card).

Each slice is released with the next release (v0.5.3 also carries the net worth history fix). Slice 2 touches sign-in, so it gets a scratch check that the owner can still sign in, with and without two-factor, before it is released.
