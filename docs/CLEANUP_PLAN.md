# Codebase audit and cleanup plan

Approved by the owner on 2026-10-17. Each step is its own small pull request that changes no behavior and no screen: reviewers should see the same app before and after. Follow [CI.md](CI.md) for every pull request. Record each finished step in [PROGRESS.md](PROGRESS.md).

## What the audit measured (2026-10-17, `main` at `f9e3df3`)

Tools: `knip` (dead code) and `jscpd` (duplication), both run once through `pnpm dlx` so nothing is added to the repository, plus a function-length scan (TypeScript compiler API) and targeted `git grep` checks.

Already in good shape:

- No `any`, `@ts-ignore`, `eslint-disable` or TODO comments. `console.log` appears only in command-line scripts.
- Logs carry counts and IDs only, never amounts, payees or notes.
- `pnpm audit --prod` reports no known vulnerabilities.
- 3 of 237 CSS classes are unused. Duplication in non-test code is 0.57%.
- No stale route or naming references in the docs.

Findings:

1. **Very long components and functions.** `ClientsWorkspace` (1,331 lines in one function), `TransferForm` (715), `RuleEditor` (588), `LedgerCategories` (547), `QuickAddForm` (530) and the API's `clientRoutes` (542).
2. **API tests repeat one bootstrap.** 20 of 21 API test files re-implement the same sign-in and setup block (about 1,500 duplicated lines). Three browser specs repeat the same ledger setup.
3. **API feature boundaries.** `contacts` and `loans` import the accounts repository, `loans` reads the `contacts` table, and `transactions` imports the `recurring` repository. CLAUDE.md allows calling another feature's service only.
4. **Web utilities inside feature folders.** 82 cross-feature imports of internal files (`formatMoney` in `accounts/money`, `localToday` in `transactions/form`, `currencies/base-value`, `home/amount`, `shell/preferences`). The same local-date helper is copied between the API and the web app.
5. **API route boilerplate.** `actor()`, `errors` and `writeHeaders` are copied across 8 route files.
6. **Small items.** 24 unused exports (14 values, 10 types; some exist only for tests); 4 unused `@ledgerline/config` devDependencies (the configs are extended by relative path); unused CSS classes `page-footer`, `status-dot` and `welcome-detail`; a stray "Newest first" line in the middle of the PROGRESS log. `knip` also lists `infra/scripts/production-smoke.mjs` and `tests/e2e/auth.setup.ts` as unused; they are not (a script and Playwright use them).
7. **Git housekeeping.** 35 merged local branches and 49 merged remote branches. Keep the four unmerged local branches (`archive-main`, `archive/original-planning-main`, `docs/public-repo-live`, `docs/public-repo-plan`).

## Steps, in order

| # | Step | Risk | Notes |
| --- | --- | --- | --- |
| 1 | **Tidy:** remove or un-export the unused exports, drop or wire the `@ledgerline/config` devDependencies, remove the 3 unused CSS classes, move the stray PROGRESS line, share the route boilerplate (finding 5), delete merged local branches | Low | Run the full local suite; one PR |
| 2 | **Feature boundaries (API):** add service functions so `contacts`, `loans` and `transactions` stop reaching into other modules' repositories and tables | Low | Covered by the API tests |
| 3 | **Shared API test helper** and a shared browser-spec ledger setup | Low (tests only) | Convert files in batches; the suite must pass after each batch |
| 4 | **Shared web utilities:** move money, date, base-value, amount and preference helpers to `lib/` or `components/`; put the one date helper in `packages/shared` | Low to medium | Mechanical moves; typecheck and the browser specs prove them |
| 5 | **Split the long components,** one per PR, starting with `ClientsWorkspace`, then `TransferForm`, `RuleEditor`, `LedgerCategories`, `QuickAddForm` and `clientRoutes` | Medium | Keep every browser spec green and check by eye at 320, 390 and desktop in light and dark |
| 6 | **Remote branch cleanup** | Outward-facing | Only with the owner's explicit say-so; merged branches only |

Steps 1 to 4 are quick and may land before the next release. Step 5 waits until after the release so the release does not carry refactors.

## Rules for every step

- No behavior, API contract or visible change. If a step would need one, stop and ask.
- Run lint, typecheck, shared, web and API tests, the script tests and the relevant browser specs (one worker, run alone) before pushing.
- Never delete or rename anything a restore, migration or release depends on.
