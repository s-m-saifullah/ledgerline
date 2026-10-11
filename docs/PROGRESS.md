# Ledgerline progress

Read this at the start of every session and update it when a piece of work lands. It records the state of the project and what comes next. Scope and design live in [PLAN.md](PLAN.md); decisions in [adr/](adr/). Keep it free of personal details, real hostnames and credentials.

## Current status

- **Phase:** 1 (Core ledger) is complete. The owner ended the seven-day trial (ADR 0013) early, on day 2, and accepted the gate as passed on 2026-10-10. Phase 2 is designed and awaiting its first slice ([PHASE_2_PLAN.md](PHASE_2_PLAN.md)).
- **Latest release:** `v0.0.10` (API 0.1.18, migrations 0000 to 0010).
- **Next:** currencies (slice 2b, step 4, the transfer bonus, next), then recurring entries (2c). Slice 2a, budgets with rollover, is built and awaiting release together with the version label.
- **Known follow-ups:** review Dependabot's grouped Actions updates when they appear; automated off-site backups are Phase 4.

## Phase checklist

- [x] Phase 0, foundations: monorepo, CI, Docker Compose, auth, design tokens, app shell, themes, first deploy
- [x] Phase 1, core ledger: safe writes, accounts, categories, transactions, quick add, list and editor, transfers, account and category deletion, splits, money owed (People), category merge, Home
- [x] Phase 1 gate: daily use (owner accepted it after two days of the seven-day trial)
- [ ] Phase 2, budgets: budgets with rollover, recurring rules, currencies
- [ ] Phase 3, insights and import: reports, tags and receipts, CSV import and export
- [ ] Phase 4, hardening: two-factor, off-site backups, restore drill, PWA, sync endpoint, accessibility
- [ ] Phase 5, Android

## Session log

Newest first. One short entry per piece of work.

- **2026-10-11:** Slice 2b step 3b, currency screens: amounts are formatted in their own currency, accounts take a currency when created (fixed afterwards), account cards, Home and the transaction list show foreign amounts with their dollar value, and Home and Net worth name currencies with no rate. Quick add, the editor, split lines and the transfer form follow the chosen account's currency, preview the dollar value and the rate (new rate preview endpoint, API 0.1.23), and let you set the rate by hand (read base-currency first). Cross-currency transfers ask for the amount received. A browser test covers the whole flow. Money owed stays USD-only. Not released yet.
- **2026-10-11:** Slice 2b step 3a, currencies in the API: accounts, entries and transfers can use any currency the ledger has added. Entries are priced at save time (a rate set by hand, the entry's saved rate on an edit, or the newest stored rate on or before the date; no rate blocks the save), cross-currency transfers take the received amount and net to zero in USD, split lines share the base amount exactly, and Home values balances at the newest stored rate and names currencies with no rate. `fxRate` is exact decimal text in the API. Migration 0014 and API 0.1.22; the restore drill's transfer check follows the new rule. Screens for it (step 3b) come next; money owed stays USD-only. Not released yet.
- **2026-10-10:** Slice 2b step 2, read side: Home money in and out, category totals and budget spending now add up the frozen base amounts, and split lines carry their own base amount (shared so the lines add up exactly; the database enforces it). `fx_rate` is now an exact decimal (migration 0013, existing rows stay 1). API 0.1.21. Results are identical while all data is USD; tests with foreign-currency rows prove the sums read base amounts. Not released yet.
- **2026-10-10:** Slice 2b step 1, currency foundation: exact conversion helper, `currencies` and `exchange_rates` tables (migration 0012, covered by the backup manifest and restore drill), API 0.1.20 (add and remove currencies, store, set and refresh rates with a fallback source) and a Currencies screen under More. Entry is still USD-only. Local browser tests now run with two workers, like CI. Not released yet.
- **2026-10-10:** Slice 2b (currencies) designed and approved: [PHASE_2B_PLAN.md](PHASE_2B_PLAN.md), ADR 0022 (valuation and rate rules) and ADR 0023 (transfer bonus on incoming transfers). Five steps: foundation, read side, enable currencies, transfer bonus, money owed in other currencies.
- **2026-10-10:** Slice 2a, budgets: a Budgets screen (month switcher, left-this-month summary, per-category progress, set, remove and copy-from-last-month) and the `/budgets` API (0.1.19). Rollover is computed from earlier months (ADR 0019). Migration 0011 adds the `budgets` table, and the backup manifest and restore drill cover it. Not released yet; it ships with the version label in the next release. Known gap: merging a category leaves its budget on the archived source category.
- **2026-10-10:** Phase 2 design approved: [PHASE_2_PLAN.md](PHASE_2_PLAN.md) and ADRs 0019 (computed budget rollover), 0020 (exact exchange rates) and 0021 (recurring entries on pg-boss).
- **2026-10-10:** Released `v0.0.10`: the "Go to" command palette now fits short windows, keeping its header fixed while only the list scrolls, and its focus rings are no longer clipped (PR #12).
- **2026-10-10:** Added this progress file. Earlier work, summarized: the starter categories are a neutral default set plus optional add-ons (ADR 0017); deployment values come from configuration, not hardcoded values (README and [SELF_HOSTING.md](SELF_HOSTING.md)); the public repository was created from an allowlist export (ADR 0018) and production was redeployed from it as `v0.0.9`; request IDs no longer need `crypto.randomUUID`, and `pnpm dev:lan` opens the dev server from a phone on the same network (plain HTTP, test data only).
