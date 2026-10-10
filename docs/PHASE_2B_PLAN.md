# Phase 2b: Currencies

Approved by the owner on 2026-10-10. This expands slice 2b of [PHASE_2_PLAN.md](PHASE_2_PLAN.md). Decisions are in ADR 0020 (exact rates), [0022](adr/0022-currency-valuation-and-rate-rules.md) (valuation and rate rules) and [0023](adr/0023-transfer-bonus.md) (transfer bonus).

## Steps, each its own pull request and release candidate

Production data stays USD-only until step 3, so nothing visible changes before it.

1. **Foundation.** `currencies` (pinned per ledger) and `exchange_rates` (date, quote, rate, source `api` or `manual`; manual is never overwritten). A shared conversion helper: exact decimal rate, rounding half away from zero, minor-unit digits from `Intl`. A rate client for Frankfurter with the documented fallback. A Settings, Currencies screen: pinned currencies, stored rates, edit a rate, "Refresh now". Entry flows unchanged.
2. **Read side.** Home money in and out, spending and budgets read the frozen `base_amount`. Add `base_amount` to split lines, allocated so the lines sum exactly to the parent's base amount. Convert `fx_rate` to an exact decimal. Results are identical while all data is USD, and parity tests prove it.
3. **Enable currencies.** Drop the USD-only checks on accounts and transactions. Amount entry with a currency, the base equivalent beneath it, a pencil to set a manual rate, cross-currency transfers (the received amount is entered, the rate is derived), currency-aware formatting. Closes ADR 0003.
4. **Transfer bonus** (ADR 0023).
5. **People and money owed in other currencies.** Each item has a currency, USD by default and fixed once a payment exists. Balances show in the item's currency. A payment into an account of another currency asks for the received amount. Home "Owed to you" sums at the latest rates and says so.

## Rules

- Rates are exact decimals; `base_amount` is computed once at save time and frozen. Missing rate: saving is blocked with a clear message so a rate can be entered.
- Net worth and in-hand convert balances at the latest stored rate; spending, money in and out, and budgets use each transaction's frozen `base_amount`.
- Rate lookup uses the entry date, else the nearest earlier date. Editing a transaction keeps its rate unless the rate itself is edited.
- A cross-currency transfer's two legs have base amounts that sum to zero.
- Rates are fetched on demand (Refresh now, on pinning a currency, and when a needed rate is missing); the daily schedule arrives with pg-boss in slice 2c.
- Base currency stays USD. Any ISO currency is allowed; currencies the rate source lacks need manual rates.
- The only new outbound call sends currency codes and dates, never amounts, payees or notes.

## Checks every step

Cross-ledger test per endpoint, idempotency keys, an upgrade test over rows shaped like production, the backup and restore drill (including any new tables), parity tests, `docs/openapi.json` and `docs/api-changes.md`, and a check of the UI at 320 px, 390 px and desktop in light and dark.
