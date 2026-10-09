# ADR 0004: Optional transaction time

Date: 2026-10-07
Status: accepted — requested by the owner during Quick-add review.

## Decision

Transactions may carry a nullable local clock time in canonical `HH:mm` form (00:00–23:59), alongside their calendar date. Minute precision matches the entry form; no timezone conversion occurs. This records the time of the transaction as entered, not the UTC audit timestamp or an inferred instant. Blank/unknown times remain null, including existing entries. Do not infer a time from createdAt.

Create accepts optional `time`; PATCH can set it or clear it with null. Quick-add exposes it under More details and leaves it blank by default. Exact balances, date filters and the existing date/UUID pagination order are unchanged. API and database validation reject invalid clock times. Use an additive nullable column so older releases remain compatible.

## Consequences

Users can retain a known transaction time without slowing familiar date-only entry. A local time has no associated timezone or UTC instant; future timezone-aware workflows require a separate decision. Historical idempotency requests/receipts must continue to replay after this addition.
