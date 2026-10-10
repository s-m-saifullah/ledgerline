# Phase 2: Budgets, currencies and recurring entries

Approved by the owner on 2026-10-10 with the recommended choices. Scope comes from [PLAN.md](PLAN.md); decisions are in ADRs 0019 to 0021. The phase gate is **one full month budgeted and reviewed**.

## Delivery order

Three slices, each its own pull request and release, with a verified backup before every release:

1. **2a Budgets with rollover.** No new infrastructure.
2. **2b Currencies.** The riskiest slice: it replaces the USD-only rules (supersedes ADR 0003) and the integer rate column.
3. **2c Recurring entries.** Adds pg-boss and a ledger time zone setting.

## 2a. Budgets

- Table `budgets`: `ledger_id`, `category_id`, `month` (first day of the month), `amount` (integer cents), `rollover` flag, plus the standard id, version and timestamp columns. One live row per category per month.
- Expense categories only, set on top-level categories; a subcategory's spending counts toward its parent.
- **Spent** is the sum of cleared expense transactions and split lines in the month, in base currency. Transfers and pending entries are excluded, as on Home.
- **Rollover is computed, not stored** (ADR 0019): from the category's first budgeted month, each month's leftover (budget plus carried amount minus spent) carries into the next while rollover is on. Overspending carries forward as a negative.
- API under `/api/v1/budgets` with month filters, version checks, idempotency keys and ledger scoping, with a cross-ledger test per endpoint.
- Budgets screen: month switcher, one progress bar per category with the amount left, red only when over budget, "copy last month", privacy mode applies. Mobile first; 44 px targets; check 320, 390 and desktop in light and dark.

## 2b. Currencies

The detailed step plan is in [PHASE_2B_PLAN.md](PHASE_2B_PLAN.md); this section is the summary.

- Replace `transactions.fx_rate` (integer) with an exact decimal and drop the USD-only checks on accounts, transactions, receivables and received payments (ADR 0020).
- Tables: `currencies` (pinned list per ledger; USD base, BDT pinned) and `exchange_rates` (date, base, quote, rate, source `api` or `manual`). Manual rates are never overwritten.
- `base_amount` is computed once at save time by one shared, tested helper that accounts for each currency's minor-unit digits and rounds half away from zero. Existing rows migrate to rate 1.
- Account balances stay in the account currency. Home, net worth and budgets sum `base_amount`.
- Entry shows the base equivalent under the amount, with a pencil to set a manual rate. A transfer between currencies asks for the received amount.
- Rates: a daily Frankfurter fetch for pinned and used currencies with the documented fallback source, and a Settings, Currencies screen with "Refresh now". The app works fully with manual rates when the network call fails. The call sends currency codes only.

## 2c. Recurring entries

- Table `recurring_rules`: template, schedule, next run date, end date, paused flag. A daily pg-boss job creates the transactions as posted (ADR 0021).
- Missed runs are caught up, one transaction per missed occurrence, using stable idempotency keys so a retry never duplicates.
- A ledger time zone setting decides what "today" means for the job. Entry dates remain calendar dates.
- Recurring screen under More: create, edit, pause and end a rule.

## Rules that stay

Money as integer minor units, UUIDv7 ids, soft deletes, ledger-scoped repositories, idempotency keys on writes, no amounts in logs, privacy mode, and the backup and restore drill invariants. Every slice updates `docs/openapi.json` and `docs/api-changes.md`.
