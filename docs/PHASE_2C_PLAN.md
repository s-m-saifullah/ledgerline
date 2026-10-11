# Phase 2c: Recurring entries

Approved by the owner on 2026-10-11. This expands slice 2c of [PHASE_2_PLAN.md](PHASE_2_PLAN.md). Decisions are in ADR [0021](adr/0021-recurring-entries-runner.md) and [0024](adr/0024-recurring-rules-details.md).

## Pull requests

1. **Time zone.** Migration for `ledgers.time_zone` (empty until set), a ledger settings endpoint and a Time zone row in More.
2. **pg-boss.** The dependency and its start and stop in the server, the hourly tick with the daily rate fetch as its first job, and restore-drill coverage of the `pgboss` schema (checked on a scratch database).
3. **Rules API and runner.** Tables `recurring_rules` and `recurring_runs`, the schedule calculator in `packages/shared` (month-end clamping, leap days, intervals), create, edit, pause, skip and delete endpoints, and the runner with catch-up. The runner takes a clock so tests need no real waiting; one test uses real pg-boss. Backup manifest and drill cover the new tables.
4. **Screens.** A Recurring screen under More: list with next date, amount and Paused or Needs attention badges; an editor with a preview of the next dates; a runs history per rule; pause and delete (red). A browser test, and a check at 320 px, 390 px and desktop in light and dark.

## Rules

- Rules are created and edited only by owners and editors, with version checks, idempotency keys and ledger scoping; every endpoint has a cross-ledger test.
- Money stays integer minor units with a currency; entries are priced like any entry on their occurrence date.
- The runner logs counts only, never amounts, payees or notes.
- Every PR updates `docs/openapi.json` and `docs/api-changes.md` when the API changes.
