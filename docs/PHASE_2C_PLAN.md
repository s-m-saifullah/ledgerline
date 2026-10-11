# Phase 2c: Recurring entries

Approved by the owner on 2026-10-11. This expands slice 2c of [PHASE_2_PLAN.md](PHASE_2_PLAN.md). Decisions are in ADR [0021](adr/0021-recurring-entries-runner.md) and [0024](adr/0024-recurring-rules-details.md).

## Pull requests

1. **Time zone.** Migration for `ledgers.time_zone` (empty until set), a ledger settings endpoint and a Time zone row in More.
2. **pg-boss.** The dependency and its start and stop in the server, the hourly tick with the daily rate fetch as its first job, and restore-drill coverage of the `pgboss` schema (checked on a scratch database).
3. **Rules API and runner.** Tables `recurring_rules` and `recurring_runs`, the schedule calculator in `packages/shared` (month-end clamping, leap days, intervals), create, edit, pause, skip and delete endpoints, and the runner with catch-up. The runner takes a clock so tests need no real waiting; one test uses real pg-boss. Backup manifest and drill cover the new tables.
4. **Screens.** A Recurring screen under More: list with next date, amount and Paused or Needs attention badges; an editor with a preview of the next dates; a runs history per rule; pause and delete (red). A browser test, and a check at 320 px, 390 px and desktop in light and dark.

## Built so far

- PR 1 (time zone) is merged. PR 2 adds the job runner: an hourly tick and one at start. The daily rate refresh checks the day's saved key before it calls the rate source, so a day that is done never reaches the network again. If every fetch fails, that day's result is kept and the Refresh now button on the Currencies screen stays the way to retry.

- PR 3 adds the rules and the runner: tables `recurring_rules` and `recurring_runs` (migration 0018), the schedule calculator in `packages/shared`, the endpoints, and the runner that catches up on every tick. Creating, resuming or editing a rule also runs it at once, so due entries appear without waiting for the hour. A rule's accounts and categories cannot be deleted while it exists. The backup manifest and drill cover both tables, and the drill checks that every created occurrence points at an entry that exists.

- PR 4 adds the Recurring screen under More: the list, the editor with a preview of the next dates and a count of entries already due, the history with Skip, pause, resume and delete, and the request for a time zone first. Slice 2c is complete and shipped in `v0.1.0` on 2026-10-11.

## Rules

- Rules are created and edited only by owners and editors, with version checks, idempotency keys and ledger scoping; every endpoint has a cross-ledger test.
- Money stays integer minor units with a currency; entries are priced like any entry on their occurrence date.
- The runner logs counts only, never amounts, payees or notes.
- Every PR updates `docs/openapi.json` and `docs/api-changes.md` when the API changes.
