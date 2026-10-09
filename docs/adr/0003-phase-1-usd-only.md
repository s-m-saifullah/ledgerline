# 0003: USD-only entry in Phase 1

Date: 2026-10-06. Status: accepted by explicit owner decision during Phase 1 planning.

The owner chose USD-only entry until Phase 2 adds currency tools. Phase 1 account and transaction APIs therefore accept USD only; the UI does not offer foreign currencies or manual exchange-rate entry.

Transactions still save their currency, exchange rate and base amount. For USD, the rate is exactly 1 and the base amount equals the signed amount in cents. Shared currency validation remains general, ready for the existing Phase 2 plan: USD base, BDT pinned, other currencies on demand, saved rates and manual overrides.

This decision approves the currency boundary only. The full Phase 1 implementation proposal remains subject to separate approval.
