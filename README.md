# Ledgerline

A private, self-hosted personal finance app. Record income, expenses and transfers, keep several accounts, track money people owe you, and see an honest picture of your money on one calm Home screen. Your data stays on your own server.

- **Self-hosted:** runs as Docker containers on a small Linux server (ARM64 or x86-64 with your own image builds).
- **Private by design:** no analytics, no trackers, no third-party calls from the app. Logs never contain amounts, payees or notes.
- **Exact money:** amounts are stored as integers in minor units (cents) with a currency code, never floating point.
- **One API:** the web app uses the same documented REST API (`docs/openapi.json`) that a native app can use.
- **Calm interface:** mobile-first, light and dark themes, keyboard friendly, a privacy mode that blurs amounts.

## What it does today

Accounts (bank, cash, card, wallet, loan, savings) with computed balances · income and expense transactions with optional time · paired transfers · split transactions · two-level categories with optional starter sets · money owed to you (people, services, payments, write-offs) · category merge · Home with money in hand, net worth, this month and latest entries · soft deletes with Undo · a command palette (Cmd/Ctrl+K).

Planned: budgets, recurring entries, multi-currency rates, reports, CSV import/export, two-factor sign-in, off-site backups and a native Android app. See [docs/PLAN.md](docs/PLAN.md).

## Documentation

- [User guide](docs/USER_GUIDE.md): first run, accounts, categories and everyday money flows.
- [Self-hosting guide](docs/SELF_HOSTING.md): installing, releasing, backing up and restoring.
- [Plan](docs/PLAN.md) and [Phase 1 scope](docs/PHASE_1_PLAN.md): scope, data model and design.
- [Decisions](docs/adr/): one short file per decision that changed the plan.
- [API contract](docs/openapi.json) and [API change notes](docs/api-changes.md).
- [CI rules](docs/CI.md), [contributing](CONTRIBUTING.md) and [security policy](SECURITY.md).

## Local development

Requires Git, Node 24, pnpm, and Docker with Compose.

```bash
pnpm install --frozen-lockfile
pnpm setup      # creates a private .env with generated credentials
pnpm dev        # web on http://localhost:5173, API on :3001, PostgreSQL in Docker
```

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, then `pnpm e2e` on its own (browser tests run serially). `pnpm db:migrate` applies migrations and `pnpm openapi` regenerates the API contract.

## Stack

TypeScript everywhere. Web: React 19, Vite, TanStack Router and Query, Tailwind CSS v4, Radix-based components. API: Node.js 24, Fastify, Zod to OpenAPI 3.1, Drizzle ORM, PostgreSQL 18, Better Auth. Tests: Vitest, Testing Library, Playwright. Lint and format: Biome. Monorepo: pnpm workspaces and Turborepo.

## License

Ledgerline is free software under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version for others over a network, you must offer them its source. Copyright (C) 2026 Ledgerline contributors.
