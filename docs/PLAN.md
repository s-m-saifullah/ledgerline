# Ledgerline plan: scope, design and roadmap

This is the source of truth for what Ledgerline does and how it is built. Change it through a pull request, and add an ADR in `docs/adr/` for decisions that alter it.

## Vision and scope

Ledgerline is a self-hosted personal finance tracker: one place to record money in and out, see where it goes and stay inside a budget. It runs as Docker containers on a small server, and its API is built from day one so a native Android app can use the same endpoints.

**v1 does**

- Accounts (bank, cash, card, wallet, loan, savings) with computed balances.
- Transactions, transfers between accounts and split transactions.
- Your own categories and subcategories (create, rename, recolor, reorder, merge, archive, unarchive, delete), plus free-form tags.
- Money owed to you: log unpaid services per client, record full or partial payments, see who owes what. Money lent to or borrowed from a client is tracked as a running balance with transfers (ADR 0030).
- Monthly budgets per category, with rollover.
- Recurring transactions (rent, salary, subscriptions).
- Dashboard and reports: spending by category, cash flow, net worth over time.
- CSV import and export.
- Multi-currency: daily rates from a free API, a manual override on any rate, totals in one base currency.

**v1 does not do** (kept out on purpose): automatic bank syncing, investment tracking, shared household budgets, receipt OCR and storing receipt images or other attached files (ADR 0031). The data model leaves room for the others.

**Working assumptions:** one owner, with roles ready for an invited user later; data entered manually or by CSV.

## Technology stack (locked; changing it needs an ADR)

| Layer | Choice |
| --- | --- |
| Repository | pnpm workspaces + Turborepo, TypeScript strict everywhere |
| Web app | React 19, Vite, TanStack Router and Query, Tailwind CSS v4 with design tokens, shadcn/ui (Radix) + Lucide, Recharts, React Hook Form + Zod |
| API | Node.js 24 LTS, Fastify, Zod schemas to OpenAPI 3.1, Drizzle ORM + drizzle-kit migrations, PostgreSQL 18, Better Auth, pg-boss for jobs |
| Quality | Biome (lint and format), Vitest, Testing Library, Playwright |
| Deploy | Docker Compose, Caddy, GitHub Actions, GitHub Container Registry |
| Android (later) | Kotlin, Jetpack Compose, Material 3, Hilt, Retrofit (client generated from `openapi.json`), Room, WorkManager |

Redis, Kubernetes and microservices are left out: one person's finance data fits comfortably in one PostgreSQL instance.

## Architecture

A modular monolith: one API process split into feature modules with clear boundaries.

```text
 Web app (React SPA)              Android app (later)
            │ HTTPS                        │ HTTPS
            ▼                              ▼
 ┌──────────── Linux server · Docker ──────────────────────────┐
 │  Host reverse proxy (80/443) → web container 127.0.0.1:8080  │
 │       serves the web build, proxies /api/*                   │
 │  API · Fastify on Node 24 (internal network only)            │
 │  PostgreSQL 18 (named volume, internal network only)         │
 └──────────────────────────────────────────────────────────────┘
```

```text
apps/web            React SPA
apps/api            Fastify API + background jobs
apps/android        Kotlin app (later)
packages/shared     Zod schemas, types, money and date helpers
packages/ui         design tokens + shared React components
packages/config     tsconfig and Biome presets
infra/              Dockerfiles, Compose, deploy/backup/restore scripts, examples
docs/               plan, decisions, API contract
```

Code is grouped by feature. API: `apps/api/src/modules/<feature>/{routes,service,repo,schema}.ts` plus tests. Web: `apps/web/src/features/<feature>/`. A feature may call another feature's service, never its tables or internal files.

## Data model

Every financial row belongs to a ledger, and users reach data only through ledgers they are a member of.

| Entity | Key fields |
| --- | --- |
| users, ledgers, ledger_members | owner/editor/viewer roles; v1 creates one ledger per owner |
| accounts | ledger_id, name, type, currency, opening_balance, archived_at |
| categories | ledger_id, parent_id, name, kind (income/expense), icon, color; two levels deep |
| transactions | account_id, date, optional local time, signed amount, currency, payee, category_id, note, transfer_id, status (cleared/pending), fx_rate, base_amount |
| transaction_splits | transaction_id, category_id, amount, note, position |
| contacts, receivables, receivable_payments, receivable_events | clients you provide services to, what they owe, linked received payments and an append-only history |
| budgets | category_id, month, amount, rollover flag; carried-over amounts are computed, never stored |
| currencies, exchange_rates | the currencies a ledger has added, and exact stored rates (fetched or set by hand) |
| recurring_rules, recurring_runs | what to create and when, and what happened to each occurrence |
| import_batches | one CSV import and its entries (`transactions.import_batch_id`, ADR 0034) |
| tags, transaction_tags | free-form labels and their links to entries (ADR 0035) |
| goals | a later phase (no attachments, ADR 0031) |

**Rules every table follows**

- **Money** is an integer in minor units plus an ISO 4217 currency code. Never floating point. Format only in the UI.
- **IDs** are UUIDv7.
- **Every row** has `created_at`, `updated_at` and `deleted_at`. Deletes are soft.
- **A transfer is two transactions** sharing one `transfer_id`, so every balance is a sum. Both legs change together.
- **Balances are computed**: opening balance plus the sum of cleared transactions.
- **Ledger scoping:** every query goes through a ledger-scoped repository, and each endpoint has a test proving another ledger's rows cannot be read or written.

## Design system

Calm and quiet: neutral surfaces, one accent color, and numbers as the loudest thing on each screen.

1. **One job per screen,** with one primary action.
2. **Numbers first:** large tabular figures.
3. **Adding a transaction takes under five seconds:** amount, category, done; sensible defaults for account and date.
4. **Color means something:** red only for overspending, errors and Delete actions.
5. **Show less, reveal on demand.**
6. **Mobile first.**

Tokens: zinc neutrals; a teal accent by default with every shade derived from one seed color (OKLCH) so an accent picker can be added later with automatic contrast; semantic positive, warning and danger colors; Inter with tabular figures; a 4 px spacing grid; radii 8/12/16; borders over shadows; 150 to 200 ms motion that respects reduced motion.

Access: light, dark and system themes; WCAG AA contrast; 44 px touch targets; full keyboard use with a Cmd/Ctrl+K command palette; a privacy mode that blurs amounts.

## Navigation and key flows

Home, Transactions, Budgets, Insights and More, plus a central Add button (bottom bar on phones, left sidebar on desktop).

1. **Quick add:** Add, amount, category, Save, with Undo.
2. **Transfer:** switch Add to Transfer and pick the two accounts.
3. **Monthly review:** Budgets, open an over-budget category, recategorize or move budget.
4. **CSV import:** choose a file (it is read in the browser and never stored; ADR 0034), map columns (saved on the device) or use the template, preview with duplicates flagged, confirm; the batch can be undone.
5. **First run:** create the owner account, add accounts with their balances, pick a starter category set, land on Home.

## Feature notes

- **Categories** are fully editable. The starter set is optional, previewed before anything is created, and ships as a neutral default plus optional add-on groups (ADR 0017). Archiving hides a category from pickers but keeps history; merging moves its transactions into another category.
- **Money owed to you:** logging a service creates no income; a payment creates linked income in the receiving account and lowers the open balance; write-offs leave totals but stay in history.
- **Currency:** base currency USD; the owner pins other currencies and more are added on demand. Rates come from the Frankfurter API with a free fallback; each transaction stores its `fx_rate` and `base_amount`; manual rates are never overwritten.
- **CSV:** every upload button has a template download; amounts are positive and `type` sets direction.

## API design

Versioned REST at `/api/v1`, described by an OpenAPI 3.1 file generated from the Zod schemas (`docs/openapi.json`).

- Plural nouns, camelCase JSON, money as `{ "amount": -125050, "currency": "USD" }`, ISO dates, UTC timestamps.
- Cursor pagination; filters as query parameters mirroring the web URL.
- Every write takes an `Idempotency-Key` header; editable rows carry a version and stale writes return a conflict.
- Errors are RFC 9457 problem details with field-level messages.
- Web uses an httpOnly SameSite cookie session; Android will use a bearer token.
- A change to the Zod contract regenerates the spec; CI fails if the spec changes without a note in `docs/api-changes.md`.

## Security and privacy

- Only 80/443 and SSH are open; PostgreSQL and the API are reachable only on the internal Docker network.
- HTTPS everywhere with HSTS and secure headers.
- Argon2id password hashing; public sign-up is off and the owner account is created on first run; optional TOTP two-factor sign-in with backup codes (ADR 0038); passkeys are planned.
- Secrets live only in `.env`; `.env.example` documents each one.
- Backups: a verified `pg_dump` before every release and on a schedule, with a restore drill into a throwaway container. Each backup is also encrypted on the server with a public key and copied off-site with a write-only key (ADR 0037); the restore drill can be run on the off-site copy.
- No third-party analytics or trackers; logs never contain amounts, payees or notes.

## Deployment

| Container | Role | Exposed |
| --- | --- | --- |
| web | Caddy serving the static build and proxying `/api` | 127.0.0.1:8080 only |
| api | REST API and background jobs | internal |
| db | PostgreSQL 18 on a named volume | internal |

Releases: a version tag runs the full checks, builds `linux/arm64` images, pushes them to the private registry, deploys over SSH, runs migrations on API start and verifies `/api/health`, restoring the previous images if it fails. See [SELF_HOSTING.md](SELF_HOSTING.md).

## Roadmap

| Phase | Scope | Gate |
| --- | --- | --- |
| 0 Foundations | Monorepo, CI, Docker Compose, auth, design tokens, app shell, themes, first deploy | App shell live over HTTPS |
| 1 Core ledger | Accounts, categories, transactions, transfers, splits, money owed, quick add, list, Clients, Home | Daily use for seven consecutive days |
| 2 Budgets | Budgets with rollover, currencies, recurring rules (see [PHASE_2_PLAN.md](PHASE_2_PLAN.md)) | One full month budgeted and reviewed |
| 3 Insights and import | Reports, tags, CSV import and export | Imported statements match the bank |
| 4 Hardening | Two-factor, off-site backups, restore drill, PWA, sync endpoint, accessibility | Restore drill passes; v1.0 tagged |
| 5 Android | Compose app, Room offline cache, background sync, biometric lock, signed APK | |
| After v1.0 | User-selectable accent color; invite a second user | |

A phase is done only when its features have tests, it is deployed through CI, the backup still restores and any new decision is written up in `docs/adr/`.

## Android path

The native app is a new client of the same API: Kotlin, Jetpack Compose and Material 3 themed with the Ledgerline tokens; Hilt; Retrofit with API types written by hand and checked against `openapi.json` by a contract test (the generator was unusable, ADR 0043); Room as an offline mirror; WorkManager for sync (`GET/POST /api/v1/ledgers/{ledgerId}/sync`, last write wins per row; see [ADR 0042](adr/0042-sync-and-bearer-tokens.md) and [ADR 0043](adr/0043-android-app.md)); the token is stored encrypted under a Keystore key behind a fingerprint or screen-lock prompt, with a 60-second background lock (an app-level lock, ADR 0043). Built so far: skeleton and server address, sign-in with two-factor, the lock, the read-only mirror (Accounts and Transactions) and offline expenses, income and same-currency transfers through an outbox (conflicts wait for the owner); next the remaining online screens, the signed release APK with its key backup, the update path and the privacy mode.
