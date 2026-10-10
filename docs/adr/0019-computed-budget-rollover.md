# ADR 0019: Budget rollover is computed per category

Date: 2026-10-10. Status: accepted by the owner when approving the Phase 2 design.

## Decisions

- A budget row stores only the month's amount and a per-category rollover flag. Carried-over amounts are never stored.
- With rollover on, each month's leftover (budget plus carried amount minus spent) carries into the next, starting at the category's first budgeted month. Overspending carries forward as a negative.
- With rollover off, each month stands alone.

## Consequences

Editing or deleting an old transaction or budget changes later months automatically, so no stale carry-over can exist. The cost is a small recalculation per request, which stays cheap at personal-ledger size.
