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

## Money owed in other currencies: details settled when it was built

- An item owed has a currency (the base currency or one the ledger has added). It can change until a payment exists, then it is fixed.
- A payment settles the item in the item's currency. Into an account of another currency it also takes the amount received; the two amounts are independent and the implied rate is only shown. The income entry is in the account's currency and is priced like any entry: the base-currency side fixes its base value exactly, otherwise the stored rate or one set by hand.
- A person-level receipt settles one currency at a time. A received amount for a different-currency account is shared across its payments in proportion to what each settles, exactly, and every payment must get something.
- A person's open balance is listed per currency with a base-currency value at the newest stored rates; Home's "Owed to you" is valued the same way. Currencies with no stored rate are named and left out of the total. Paid amounts keep their frozen entry values.
- The linked-income database rule requires equal amounts only when the payment and its income entry share a currency.
