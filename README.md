# Ledgerline

A private, self-hosted personal finance app. Record income, expenses and transfers, keep several accounts, track money people owe you, and see an honest picture of your money on one calm Home screen. Your data stays on your own server.

- **Self-hosted:** runs as Docker containers on a small Linux server (ARM64 or x86-64 with your own image builds).
- **Private by design:** no analytics, no trackers, no third-party calls from the app. Logs never contain amounts, payees or notes.
- **Exact money:** amounts are stored as integers in minor units (cents) with a currency code, never floating point.
- **One API:** the web app and the Android app use the same documented REST API (`docs/openapi.json`); neither has a private shortcut.
- **Calm interface:** mobile-first, light and dark themes, keyboard friendly, a privacy mode that blurs amounts.

## What it does today

**Web app** (installable, works from the saved shell when offline, follows changes made elsewhere within about 15 seconds):

- Accounts (bank, cash, card, wallet, loan, savings) with computed balances; income and expense entries with an optional time, paired transfers and split entries; two-level categories and tags; a command palette (Cmd/Ctrl+K); soft deletes with Undo.
- Monthly budgets with rollover; other currencies with exchange rates and a transfer bonus; recurring entries.
- Money owed to you (clients, services, payments, write-offs) and lending and borrowing (loans).
- Insights: spending by category, money in and out, and net worth over time. CSV export and statement import.
- Optional two-factor sign-in, a list of signed-in devices you can sign out, and a privacy mode that blurs amounts.
- Verified backups before every release, encrypted off-site copies, and a restore drill.

**Android app** (version 1 in progress): a native app for Android 11 and later with the same design. It keeps a copy of your ledger on the phone, so you can add, edit and delete expenses, income and same-currency transfers with no connection; changes are sent when the phone is online, and a conflict is shown for you to decide. Home, Budgets, Insights, Clients and Loans are read online. It locks behind your fingerprint or screen lock, hides amounts in privacy mode, and blocks screenshots unless you allow them. Splits, fee or bonus transfers, other-currency entries and everything that changes budgets, clients or loans stay on the web app for now.

The Android app is not in an app store. The signed APK is published on the [GitHub Releases](https://github.com/s-m-saifullah/ledgerline/releases) page of this repository, together with its SHA-256; see [apps/android/README.md](apps/android/README.md) to check it against the signing certificate and to build it yourself. Releases are tagged `android-vX.Y.Z` and need no server release.

The plan and the current state are in [docs/PLAN.md](docs/PLAN.md) and [docs/PROGRESS.md](docs/PROGRESS.md); `v1.0` has not been tagged yet.

## Documentation

- [User guide](docs/USER_GUIDE.md): first run, accounts, categories and everyday money flows.
- [Self-hosting guide](docs/SELF_HOSTING.md): installing, releasing, backing up and restoring.
- [Plan](docs/PLAN.md) (scope, data model and design) and [progress](docs/PROGRESS.md) (what is built and what is next); the phase plans are linked from the plan.
- [Android app](apps/android/README.md): building, trying it on a phone and releasing it.
- [Decisions](docs/adr/): one short file per decision that changed the plan.
- [API contract](docs/openapi.json) and [API change notes](docs/api-changes.md).
- [CI rules](docs/CI.md), [contributing](CONTRIBUTING.md) and [security policy](SECURITY.md).

## Local development

Requires Git, Node 24, pnpm 12 (the exact version is pinned in `package.json`, and an older pnpm switches to it by itself) and Docker with Compose.

```bash
pnpm install --frozen-lockfile
pnpm setup      # creates a private .env with generated credentials
pnpm dev        # web on http://localhost:5173, API on :3001, PostgreSQL in Docker
```

### Opening the dev server from a phone

`pnpm dev:lan` starts the same dev servers but reachable from other devices on your Wi-Fi. It prints the address to open (its form is `http://<your-computer-address>:5173`) and sets `APP_URL` for that run only, so `.env` is never edited. Use that address on your computer too, not `localhost`, because the API only accepts requests whose origin matches `APP_URL`. Pass `--ip=<address>` to choose the address yourself.

This is plain HTTP on your local network. Use it with test data only, on a network you trust (not guest, café or campus Wi-Fi), and never with production data.

The Android app builds separately with Gradle and a JDK 17 (see its README). Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, then `pnpm e2e` on its own (browser tests run serially). `pnpm db:migrate` applies migrations and `pnpm openapi` regenerates the API contract.

## Stack

TypeScript everywhere. Web: React 19, Vite, TanStack Router and Query, Tailwind CSS v4, Radix-based components. API: Node.js 24, Fastify, Zod to OpenAPI 3.1, Drizzle ORM, PostgreSQL 18, Better Auth. Jobs: pg-boss. Tests: Vitest, Testing Library, Playwright. Lint and format: Biome. Monorepo: pnpm workspaces and Turborepo. Android (`apps/android`): Kotlin, Jetpack Compose, Material 3, Hilt, Retrofit, Room and WorkManager.

## License

Ledgerline is free software under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified version for others over a network, you must offer them its source. Copyright (C) 2026 Ledgerline contributors.
