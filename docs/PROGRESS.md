# Ledgerline progress

Read this at the start of every session and update it when a piece of work lands. It records the state of the project and what comes next. Scope and design live in [PLAN.md](PLAN.md); decisions in [adr/](adr/). Keep it free of personal details, real hostnames and credentials.

## Current status

- **Phase:** 1 (Core ledger) is feature complete and released. Its gate, the owner logging every expense for seven consecutive days (ADR 0013), is in progress; Phase 1 is complete when it passes.
- **Latest release:** `v0.0.10` (API 0.1.18, migrations 0000 to 0010).
- **Next:** finish the Phase 1 gate and batch any issues it finds; then design Phase 2 (budgets with rollover, recurring entries, currencies) for approval before building it.
- **Known follow-ups:** review Dependabot's grouped Actions updates when they appear; automated off-site backups are Phase 4.

## Phase checklist

- [x] Phase 0, foundations: monorepo, CI, Docker Compose, auth, design tokens, app shell, themes, first deploy
- [x] Phase 1, core ledger: safe writes, accounts, categories, transactions, quick add, list and editor, transfers, account and category deletion, splits, money owed (People), category merge, Home
- [ ] Phase 1 gate: seven consecutive days of daily use
- [ ] Phase 2, budgets: budgets with rollover, recurring rules, currencies
- [ ] Phase 3, insights and import: reports, tags and receipts, CSV import and export
- [ ] Phase 4, hardening: two-factor, off-site backups, restore drill, PWA, sync endpoint, accessibility
- [ ] Phase 5, Android

## Session log

Newest first. One short entry per piece of work.

- **2026-10-10:** Released `v0.0.10`: the "Go to" command palette now fits short windows, keeping its header fixed while only the list scrolls, and its focus rings are no longer clipped (PR #12).
- **2026-10-10:** Added this progress file. Earlier work, summarized: the starter categories are a neutral default set plus optional add-ons (ADR 0017); deployment values come from configuration, not hardcoded values (README and [SELF_HOSTING.md](SELF_HOSTING.md)); the public repository was created from an allowlist export (ADR 0018) and production was redeployed from it as `v0.0.9`; request IDs no longer need `crypto.randomUUID`, and `pnpm dev:lan` opens the dev server from a phone on the same network (plain HTTP, test data only).
