# ADR 0032: Report definitions

Date: 2026-10-18. Status: accepted by the owner when approving the Phase 3 design in chat.

## Context

Insights needs reports. Home, Budgets and the transaction list already agree on what counts as spending and income, so reports must not invent a second set of rules.

## Decisions

- **Same rows as Home and Budgets.** Only cleared entries count. Pending and deleted entries and transfers never do. Linked client payments count as income, as on Home. A transfer's fee is an expense and its bonus is income, because they are ordinary entries (ADR 0023, ADR 0025), so they count like Home counts them. A report month's figures equal Home's for the same month.
- **Base currency, frozen amounts.** Totals add each entry's `base_amount` saved with it (ADR 0022), so mixed currencies add up and old months do not change when rates move.
- **Splits count by line.** A split entry is counted once, as its lines under their own categories, never as its parent.
- **Months follow the entry's own date** (the calendar date stored on the entry), as Budgets does.
- **Spending by category** (`GET /reports/spending?month=`): top-level categories, largest first, a parent's amount including its subcategories, each with its subcategories and a share of the month's total as rounded basis points (shares may not add up to exactly 10000). Archived categories keep their past spending and are marked archived. Income by category is not part of this report.
- **Cash flow** (`GET /reports/cash-flow?to=&months=`): income, spending and net for each of the last 1 to 24 months (default 12), oldest first, with empty months as zeros.
- **Read-only snapshot, no storage.** Each report is computed live in one repeatable-read transaction. No tables, no migration, no cached summaries. A total beyond the exact integer range returns 409. Viewers may read; other ledgers return 404.
- **Privacy.** Report requests log like any other read: no amounts, category names or notes.
- **Not in this slice.** Net worth over time needs a rule for valuing old balances at old rates (ADR 0022 covers current valuation only) and gets its own decision.
