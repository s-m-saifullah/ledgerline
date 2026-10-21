# ADR 0036: Net worth over time

Date: 2026-10-19. Status: accepted by the owner when approving the design in chat (every recommended choice). API built in 0.1.42 (the screen follows). Builds on [0022](0022-currency-valuation-and-rate-rules.md) and [0032](0032-report-definitions.md); answers the question ADR 0022 and ADR 0032 left open, how to value old balances.

## Context

Home shows net worth now, valuing each account balance at the newest stored rate (ADR 0022). Insights needs the same figure month by month. Old balances need a rule for which exchange rate to use, and ADR 0022 only covers the present.

## Decisions

- **Valued at the time.** Each month's point values every account balance at the newest stored rate on or before that month's end date, the same lookup rule ADR 0022 uses for entries. History shows what the owner was worth then, exchange-rate swings included. Values at today's rates are not shown.
- **No guessing.** When a currency has no stored rate on or before a month's end, the accounts in that currency are left out of that month's total and the month is flagged incomplete with the currencies named. This is how Home treats a currency with no rate. A later rate is never borrowed.
- **Balance at a month's end.** The account's opening balance plus every cleared, live entry dated on or before that day. Pending and deleted entries do not count; a transfer counts as an entry on each account. Opening balances count from the start of history (an opening balance is what the account held before its first entry), so an account added later still appears in earlier months. The current month's point is as of today.
- **Same accounts as Home.** Exactly the accounts Home's net worth counts, archived accounts and client loan accounts included, so the latest point equals Home's figure (a test checks it).
- **Endpoint.** `GET /reports/net-worth?to=YYYY-MM&months=` (1 to 24 months, default 12, oldest first), read-only and computed live in one repeatable-read transaction, like the other reports (ADR 0032). Each point has the month, the base-currency net worth, and a list of currencies left out. Viewers may read; another ledger returns 404. A total beyond the exact integer range returns 409.
- **No storage.** No table, no migration, no cached figures, so nothing new for the backup manifest or restore drill.
- **Screen.** A "Net worth over time" section on Insights in plain markup (Recharts is not installed), with the figures listed under the chart, tabular figures, privacy mode and a note on incomplete months.
- **Privacy.** Report requests log like any other read: no amounts or account names.

## Details settled while building the API

- Each point carries `asOf`, the day it is valued: the month's last day, or today for the current month and any later one. Entries and rates dated after today are not used, so the latest point equals Home's figure unless something is dated in the future (Home counts those at once).
- A currency counts as left out only when an account in it has a non-zero balance at that point and no rate on or before it. A zero balance adds nothing, so it never makes a month incomplete (Home lists such a currency; the report does not).

## Amendment (2026-10-21): history starts at the first data

Counting opening balances from the start of history made a new ledger show a year of identical bars (the owner had entered only October's data), which reads as "worth this a year ago". The report (API 0.1.45) now leaves out the months before the ledger's first account or oldest entry and says where history starts (`historyStart`); the screen shows only those months and a short note ("History starts in October 2026"). Valuation, missing-rate flags and the equality with Home's figure are unchanged. Importing older entries moves the start back, and the older months then appear.
