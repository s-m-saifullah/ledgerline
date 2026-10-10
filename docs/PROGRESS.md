# Ledgerline progress

Read this at the start of every session and update it when a piece of work lands. It records the state of the project and what comes next. Scope and design live in [PLAN.md](PLAN.md); decisions in [adr/](adr/). Keep it free of personal details, real hostnames and credentials.

## Current status

- **Phase:** 1 (Core ledger) is complete. The owner ended the seven-day trial (ADR 0013) early, on day 2, and accepted the gate as passed on 2026-10-10. Phase 2 is designed and awaiting its first slice ([PHASE_2_PLAN.md](PHASE_2_PLAN.md)).
- **Latest release:** `v0.0.10` (API 0.1.18, migrations 0000 to 0010).
- **Next:** currencies (slice 2b, step 1 foundation first), then recurring entries (2c). Slice 2a, budgets with rollover, is built and awaiting release together with the version label.
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

- **2026-10-10:** Slice 2b (currencies) designed and approved: [PHASE_2B_PLAN.md](PHASE_2B_PLAN.md), ADR 0022 (valuation and rate rules) and ADR 0023 (transfer bonus on incoming transfers). Five steps: foundation, read side, enable currencies, transfer bonus, money owed in other currencies.
- **2026-10-10:** Slice 2a, budgets: a Budgets screen (month switcher, left-this-month summary, per-category progress, set, remove and copy-from-last-month) and the `/budgets` API (0.1.19). Rollover is computed from earlier months (ADR 0019). Migration 0011 adds the `budgets` table, and the backup manifest and restore drill cover it. Not released yet; it ships with the version label in the next release. Known gap: merging a category leaves its budget on the archived source category.
- **2026-10-10:** Phase 2 design approved: [PHASE_2_PLAN.md](PHASE_2_PLAN.md) and ADRs 0019 (computed budget rollover), 0020 (exact exchange rates) and 0021 (recurring entries on pg-boss).
- **2026-10-10:** Released `v0.0.10`: the "Go to" command palette now fits short windows, keeping its header fixed while only the list scrolls, and its focus rings are no longer clipped (PR #12).
- **2026-10-10:** Added this progress file. Earlier work, summarized: the starter categories are a neutral default set plus optional add-ons (ADR 0017); deployment values come from configuration, not hardcoded values (README and [SELF_HOSTING.md](SELF_HOSTING.md)); the public repository was created from an allowlist export (ADR 0018) and production was redeployed from it as `v0.0.9`; request IDs no longer need `crypto.randomUUID`, and `pnpm dev:lan` opens the dev server from a phone on the same network (plain HTTP, test data only).
