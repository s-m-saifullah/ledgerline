# Contributing to Ledgerline

Thank you for helping. Ledgerline is a small, focused project, so a short conversation before a large change saves everyone time: open an issue describing the problem and your idea first.

## Ground rules

- **Money** is an integer in minor units plus an ISO 4217 currency code. Never use floating point for amounts. Format only in the UI.
- **IDs** are UUIDv7. **Every table** has `created_at`, `updated_at` and `deleted_at`; deletes are soft.
- **Ledger scoping:** every financial row has `ledger_id` and every query goes through a ledger-scoped repository. Each endpoint needs an integration test proving another ledger's rows cannot be read or written.
- **API:** REST under `/api/v1`, camelCase JSON, money as `{ amount, currency }`, ISO dates, UTC timestamps, cursor pagination, an `Idempotency-Key` on writes and RFC 9457 problem details for errors. Changing the contract needs a note in `docs/api-changes.md` and a regenerated `docs/openapi.json`.
- **Privacy:** no analytics or trackers. Logs never contain amounts, payees or notes. Secrets live only in `.env`, never in Git; keep `.env.example` current.
- **UI:** calm and mobile-first, one primary action per screen, large tabular amounts, 44 px touch targets, light and dark themes, WCAG AA contrast, full keyboard use. Red is only for overspending, errors and Delete actions.
- **Decisions:** if a change alters the plan, add a short ADR in `docs/adr/`.

## Setup

```bash
pnpm install --frozen-lockfile
pnpm setup
pnpm db:up
pnpm dev
```

## Before you open a pull request

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e        # run alone; browser tests use a shared local database
```

Check that `pnpm lint` really passes (read its output), and test new UI at 320 px, 390 px and desktop in light and dark.

## Pull requests

- Branch from `main`, keep commits small and focused with clear messages, and open a pull request to `main`. Nobody pushes directly to `main`.
- One `check` job runs per pull request update (see [docs/CI.md](docs/CI.md)). Documentation-only changes need only content, link and whitespace review.
- Explain the change in plain language, what you tested, and anything reviewers should look at first.
- By contributing you agree your work is licensed under the [AGPL-3.0](LICENSE).

## Reporting problems

Bugs and ideas go in issues (use the templates). For security problems follow [SECURITY.md](SECURITY.md) instead.
