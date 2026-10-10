# ADR 0020: Exact exchange rates and conversion rounding

Date: 2026-10-10. Status: accepted by the owner when approving the Phase 2 design. Supersedes [0003](0003-phase-1-usd-only.md) when slice 2b ships.

## Decisions

- Rates are stored as an exact decimal (Postgres `numeric`) and handled in code with integer arithmetic, never floating point. The integer `fx_rate` column is replaced; existing rows become rate 1.
- `base_amount` is computed once at save time from the amount and rate, adjusted for each currency's minor-unit digits, rounded half away from zero by one shared helper, and then frozen on the row.
- USD stays the base currency; BDT is pinned; other currencies are added on demand. Manual rates are never overwritten by fetched rates.
- Daily rates come from Frankfurter with a documented fallback. The call sends currency codes only, and the app stays fully usable with manual rates if it fails.

## Consequences

The USD-only checks on accounts, transactions, receivables and received payments are removed in slice 2b, with a migration and tests for existing rows.
