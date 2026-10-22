# ADR 0044: Live updates in the web app

Date: 2026-10-22. Status: accepted by the owner in chat (option A of three). Builds on [0042](0042-sync-and-bearer-tokens.md) (sync) and [0043](0043-android-app.md) (the Android app).

## Context

With the Android app saving entries (online or later from its outbox), an open web page shows stale data until the owner acts in it or comes back to its tab after 30 seconds (TanStack Query refetches stale queries on focus). The owner asked for the web app to follow changes made on the phone without a reload. Three ways were offered: (A) the page polls a small "has anything changed?" marker while visible and reloads only when it moves (up to about 15 seconds' delay, one small read-only endpoint); (B) the server pushes a notice over a long-lived connection (instant, but a new kind of connection through Caddy and the host's reverse proxy, with reconnects and per-ledger isolation to get right); (C) the page reloads everything every 30 seconds (no server change, but wasteful and able to disturb an open form). The owner chose A.

## Decisions

- **Marker endpoint.** `GET /api/v1/ledgers/{ledgerId}/changes` returns `{ marker }`: a short hash over, for every ledger table (accounts, categories, tags, currencies, exchange rates, entries, split lines, entry tags, import batches, budgets, recurring rules and runs, contacts, receivables with their payments and events, the ledger row and its members), the row count and the newest `updated_at` to the microsecond, read in one repeatable-read, read-only snapshot. An insert raises a count, every update and soft delete moves `updated_at` (the ORM sets it on every write, as the sync pull already relies on), and a hard delete lowers a count, so any change moves the marker; it reveals nothing about what changed. Each feature reports its own tables through a shared helper (`lib/change-stamp.ts`), so no feature reads another's tables. Write receipts are left out (they change only with the rows they protect). `Cache-Control: no-store`; members only (viewers included); session cookie or bearer token. No migration: two aggregates per table on a personal ledger are cheap; an index can be added later if a ledger ever outgrows that.
- **Web.** The signed-in shell polls the marker every 15 seconds while the page is visible (no polling in a hidden tab; a check on focus), ignoring failed checks. When the marker moves it invalidates every query except the marker and the session, so the data on screen reloads in place. Nothing is reloaded while a dialog is open; that waits for the next check after it closes, so a form being filled in is never changed under the owner's hands. The page's own saves move the marker too; the extra reload is harmless.
- **Release.** A server and web change: API 0.1.50, released as `v0.5.4` (no migration, so no upgrade check). The phone does not use the marker; it keeps its sync.

## Not changing

The sync pull and push, the Android app, the backup manifest and restore drill (no new table), ledger scoping (members only, another ledger is a 404), the rule that logs never contain amounts, payees or notes (the marker carries none).

## Checks

API integration tests: the marker is stable while nothing changes and the same for every member; it moves on creating, editing, tagging and deleting an entry, on a budget (a table the phone does not mirror) and on a hard delete; it does not move for another ledger's changes; another ledger is 404 and no session 401; `no-store` on every reply. Web unit tests of the poller (reloads only when the marker moves, waits while a dialog is open and reloads after, never asks while hidden). A browser spec: an entry written through the API, as the phone does, appears on an open Transactions page without a reload, and so does its edit. Reloading on every check, ignoring open dialogs, or removing the poller from the shell each fails the matching test.
