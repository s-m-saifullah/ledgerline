# Phase 1: Core ledger

Scope and rules for the first usable version of Ledgerline: daily expense tracking, with accurate balances and totals.

## Outcome and boundaries

Create accounts and categories, enter income and expenses, move money between accounts, split purchases, find and correct entries, track unpaid services and payments per person, and see accurate Home totals. Entry is USD-only in this phase (ADR 0003). Budgets, recurring entries, foreign currencies, reports, tags, receipts, imports and Android belong to later phases.

The phase gate is **seven consecutive days of logging every expense** (ADR 0013).

## Delivered in small steps

Safe write foundation (idempotency, versions, role guards) · Accounts API and screens · Categories API and screens · Transactions API · Quick add with optional time · Transaction list and editor with Undo · Paired transfers · Account and category deletion · Splits · Money owed to you (People) · Category merge · Home.

## Money and lifecycle rules

- Store signed integer cents. Expenses are negative, income is positive, zero is rejected. USD entries save `fxRate = 1` and `baseAmount = amount`.
- Balances are computed from the opening balance and non-deleted cleared transactions. Pending entries show separately and do not affect posted balances or Home totals. Transfers are cleared.
- Liability accounts use negative balances for money owed. Net worth sums signed balances.
- Account currency cannot change once entries exist. Archiving prevents new assignments but keeps history; archived accounts still count toward net worth.
- Category unarchive restores the same ID and label at the end of its sibling group.
- Dates are calendar dates (`YYYY-MM-DD`), never shifted by UTC conversion. The optional entry time is a local `HH:mm` (ADR 0004).
- A split parent changes the account balance once; split lines allocate category totals. Transfer legs change balances but are excluded from income, spending and category totals.
- Receivables are USD-only here. Logging a service creates no income; payments create linked income and lower the open balance exactly; write-offs leave open totals but stay in history.
- Merge only categories of the same kind and level; child-name collisions must be resolved first.
- Every table has UUIDv7 IDs, audit timestamps and soft deletion. Financial tables carry `ledgerId`; scoped repositories reject cross-ledger links. Editors and owners may write; viewers may only read.

## Reliability and API shape

New resources live under `/api/v1/ledgers/:ledgerId`: accounts, categories, transactions, transfers, contacts, receivables with payments and the Home summary. Financial writes require an `Idempotency-Key`: the client creates one per user intent and reuses it for retries; the server scopes it to actor and ledger, checks the request fingerprint and commits the mutation and replay response together. Editable rows carry a version; stale updates return a conflict.

Tests cover every endpoint's isolation, roles, tombstones and invalid references, exact money arithmetic and derived totals, and real browser workflows on desktop and mobile (keyboard, privacy mode, themes, retry feedback and Undo). Logs never contain amounts, payees or notes.

## Release checkpoints

Each checkpoint uses a focused pull request, a passing check, a tagged `linux/arm64` release and read-only production verification. Migrations are additive so older rows and writes keep working. Each release is preceded by a verified backup and restore drill.
