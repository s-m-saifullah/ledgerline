# ADR 0051: The exchange-rate fetch is an outside call, and it can be switched off

Date: 2026-11-12. Status: accepted by the owner in chat. Amends the Privacy rule in [CLAUDE.md](../../CLAUDE.md) and [PLAN.md](../PLAN.md); amends [0020](0020-exact-exchange-rates.md) and [0043](0043-android-app.md), which said the Android update check is the only outside call.

## Context

The Privacy rule said the Android app's update check is the one outside call, and the README said there are no third-party calls from the app. That was not true of the server. Since the currencies work (ADR 0020), the server fetches exchange rates once a day for every ledger that pinned another currency: first from Frankfurter, then, if that fails, from a public package CDN. Only a currency code, the base currency and a date leave, never an amount, a payee or a note, but the request does show the server's address to those hosts. A rule that is wrong in its words stops being a rule the owner can rely on.

## Decision

- The rule now names both calls: the server's daily rate fetch and the Android app's update check. It says what each sends (nothing about the owner's money) and when each runs.
- `RATES_ENABLED` (default `true`) in `.env` switches the fetch off for an installation that wants nothing to leave the server. With `false` no rate is fetched by the daily job or by the manual refresh (which lists every currency as not fetched, as an outage does), rates are set by hand, and nothing else changes. The API contract is the same.
- The wording is in `CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `docs/PLAN.md` and `docs/SELF_HOSTING.md`; `.env.example` has the switch.

## Consequences

- The default is unchanged, so an existing installation behaves as before.
- Anyone adding a third outside call needs a new ADR and a new line in the rule.
- The switch does not touch the Android update check.
