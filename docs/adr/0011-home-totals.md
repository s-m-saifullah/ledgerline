# ADR 0011: Home totals

Date: 2026-10-08. Status: accepted by the owner.

## Decisions

- Net worth is the signed sum of every non-deleted account balance, archived accounts included. Pending entries and money owed to you are **not** included; owed money is shown as its own total and enters accounts only when a payment is recorded.
- Pending entries are excluded from balances, net worth and monthly income/spending. Home shows a count of them and lists them (badged) among the latest entries.
- Monthly money in/out sum cleared income/expense rows by calendar date. Transfers, split lines and deleted rows never enter them; split parents count once; linked service payments count as income.
- The latest five rows follow the Transactions list order (date, then id) and show each transfer once, as its outgoing leg with the destination account name.
- Home itemizes the first eight active accounts (Accounts order), with "other accounts" and "archived accounts" subtotals so lines reconcile to net worth.
- One read-only `GET /ledgers/{ledgerId}/home?month=YYYY-MM` returns a single repeatable-read snapshot; totals beyond the safe-integer range return 409. No migration.

Future budgets, upcoming bills and multi-currency totals extend this endpoint rather than replace these rules.
