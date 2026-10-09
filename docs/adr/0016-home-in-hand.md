# ADR 0016: Home shows money in hand; net worth moves to Accounts

Date: 2026-10-08. Status: accepted, requested by the owner. Amends [ADR 0011](0011-home-totals.md).

## Decision

- Home's headline is **In hand**: the sum of the **positive** balances of **active** bank, cash, wallet and savings accounts. Overdrawn accounts, archived accounts, cards and loans do not count. Pending entries and money owed to you (People) are still not included.
- Home itemizes only bank, cash, wallet and savings accounts. Cards and loans never appear on Home. The "other accounts" and "archived accounts" subtotals now cover those money accounts only (archived ones are labelled "not counted in In hand").
- **Net worth keeps its ADR 0011 definition** (signed sum of every non-deleted account, archived included, excluding pending entries and owed money) but no longer appears on Home. It is shown on **More → Accounts** in a card with a one-line explanation and an "Owed on cards and loans" subtotal (negative card and loan balances, archived included, as a positive amount). Both follow privacy mode.
- The Home API (`GET /ledgers/{ledgerId}/home`, OpenAPI 0.1.17) gains `inHand` and `liabilitiesOwed`; `netWorth` stays in the response so clients (including the later Android app) can show it; `accounts`, `otherActive` and `archived` now describe money accounts only. No migration, no new endpoint.
- Account type grouping lives in `packages/shared` (`assetAccountTypes`). A loan or card account that holds a positive balance (for example flatmates who owe you) is still not "in hand".

## Consequences

- Money held for someone else inside a bank balance (for example a friend's instalment waiting to be paid on to a lender) is counted in In hand; the pass-through account's negative balance shows on Accounts and in net worth. The user guide says so.
- The Home consistency checks (browser test and the production smoke script) compare In hand, net worth and the owed-on-debts figure with the Accounts list, so Home and Accounts cannot silently disagree.
