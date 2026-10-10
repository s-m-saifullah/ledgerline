# ADR 0022: Currency valuation and rate rules

Date: 2026-10-10. Status: accepted by the owner when approving the slice 2b design. Builds on [0020](0020-exact-exchange-rates.md).

## Decisions

- **Flows use frozen amounts, balances use current rates.** Spending, money in and out, and budgets sum each transaction's frozen `base_amount`. Net worth and in-hand convert each account balance at the latest stored rate.
- **Rate lookup:** the rate for the entry's date, otherwise the nearest earlier date. With no rate, saving is blocked and the person is asked to enter one; nothing is guessed.
- **Editing keeps the saved rate** unless the rate itself is edited. Changing a date does not re-fetch.
- **Cross-currency transfers:** the received amount is entered, the rate is derived, and the two legs' base amounts sum to exactly zero.
- **Split lines store their own `base_amount`,** allocated by largest remainder so they sum exactly to the parent's.
- **Money owed** stays USD-only until step 5, then takes a per-item currency (USD by default, fixed once a payment exists).
- **Fetching:** on demand now; a daily schedule joins with the job runner in slice 2c.

## Consequences

Balances and totals can differ slightly between "valued today" and "valued when spent"; screens say which they show. The `fx_rate` column becomes an exact decimal and split lines gain a column, both through migrations with upgrade tests.
