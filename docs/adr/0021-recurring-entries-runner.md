# ADR 0021: Recurring entries run on pg-boss and post automatically

Date: 2026-10-10. Status: accepted by the owner when approving the Phase 2 design.

## Decisions

- A daily pg-boss job (already in the locked stack, backed by the existing PostgreSQL) creates transactions from recurring rules. Redis is not added.
- Generated transactions are posted (cleared), not pending.
- Missed runs are caught up, one transaction per missed occurrence, with stable idempotency keys so retries never duplicate.
- The ledger gets a time zone setting so the job knows what "today" is. Entry dates remain calendar dates.

## Consequences

Slice 2c adds the pg-boss dependency and its schema migration. The restore drill must still pass with the job tables present.
