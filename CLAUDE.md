# Ledgerline

Self-hosted personal finance web app, deployed with Docker. A native Android app comes later and uses the same API.

- Scope, data model and design: `docs/PLAN.md`; first-phase rules: `docs/PHASE_1_PLAN.md`
- Decisions: `docs/adr/NNNN-title.md` (one short file per decision that changes the plan)
- Contribution rules: `CONTRIBUTING.md`; CI rules: `docs/CI.md`; self-hosting: `docs/SELF_HOSTING.md`

## How we work

- Explain changes in plain language, not jargon.
- Start every feature with a plan and get approval before large changes.
- Branches: `feat/<short-name>` or `fix/<short-name>`. Small, focused commits with clear messages. Open a pull request to `main`; never push directly to `main`.
- If something in `docs/PLAN.md` turns out to be wrong, propose the change, record it in an ADR and update the plan.
- Follow `docs/CI.md`: one `check` job per pull request, no duplicate feature-push and PR checks. Documentation-only changes need content, link and whitespace review; code, configuration, OpenAPI and release changes keep the full suite.
- Never commit secrets, real financial data, personal details or real hostnames. Use placeholders such as `ledgerline.example.com` and `you@example.com`.

## Stack (locked; do not swap without an ADR)

- Monorepo: pnpm workspaces + Turborepo. TypeScript strict everywhere.
- Web (`apps/web`): React 19, Vite, TanStack Router, TanStack Query, Tailwind CSS v4 with design tokens, shadcn/ui (Radix) + Lucide, Recharts, React Hook Form + Zod.
- API (`apps/api`): Node.js 24 LTS, Fastify, Zod schemas to OpenAPI 3.1, Drizzle ORM + drizzle-kit migrations, PostgreSQL 18, Better Auth, pg-boss for jobs.
- Shared (`packages/shared`): Zod schemas, types, money and date helpers. `packages/ui`: tokens and shared components. `packages/config`: tsconfig and Biome presets.
- Quality: Biome (lint and format), Vitest, Testing Library, Playwright.
- Android later (`apps/android`): Kotlin, Jetpack Compose, Material 3, Hilt, Retrofit (client generated from `openapi.json`), Room, WorkManager.

## Repository layout

```text
apps/web            React SPA
apps/api            Fastify API + background jobs
apps/android        Kotlin app (later)
packages/shared     Zod schemas, types, money/date helpers
packages/ui         design tokens + shared React components
packages/config     tsconfig and Biome presets
infra/docker        Dockerfiles, Caddyfile
infra/compose       docker-compose.yml, docker-compose.dev.yml
infra/scripts       backup, restore, deploy, smoke and CI helpers
infra/examples      generic samples (proxy site, service isolation)
docs/               plan, API contract, ADRs, guides
```

Code is grouped by feature:
- API: `apps/api/src/modules/<feature>/{routes,service,repo,schema}.ts` plus tests.
- Web: `apps/web/src/features/<feature>/` (routes, components, hooks, API calls).
- A feature may call another feature's **service**, never its tables or internal files.

## Non-negotiable rules

- **Money** is an integer in minor units (`bigint` or `number` cents) plus an ISO 4217 currency code. Never floats. Format only in the UI.
- **IDs** are UUIDv7.
- **Every table** has `created_at`, `updated_at` and `deleted_at`. Deletes are soft.
- **Ledger scoping:** every financial row has `ledger_id`; every query goes through a ledger-scoped repository. Add an integration test per endpoint proving another ledger's rows cannot be read or written.
- **Transfers** are two transactions sharing `transfer_id`. **Balances** are computed (opening balance plus sum), not stored.
- **Multi-currency:** base currency USD; each transaction stores `fx_rate` and `base_amount` at save time; manual rates (`source = manual`) are never overwritten.
- **API:** REST under `/api/v1`, camelCase JSON, money as `{ amount, currency }`, ISO dates, UTC timestamps, cursor pagination, `Idempotency-Key` on writes, RFC 9457 problem+json errors. Web and Android use the same endpoints; no private shortcuts.
- **Auth:** public sign-up is off; the owner account is created on first run. Roles (owner, editor, viewer) exist through `ledger_members`.
- **Privacy:** no analytics or trackers; logs never contain amounts, payees or notes. Secrets only in `.env` (never committed); keep `.env.example` current.

## Design rules (UI)

- Calm, clutter-free, mobile-first. One primary action per screen. Amounts in large tabular figures.
- Neutral (zinc) surfaces; one accent, teal by default, every shade derived from one seed color (OKLCH).
- Red only for overspending, errors and Delete actions.
- Light, dark and system themes. WCAG AA contrast, 44 px touch targets, full keyboard use, a Cmd/Ctrl+K command palette, a privacy mode that blurs amounts.
- Navigation: Home, Transactions, Budgets, Insights, More and a central Add button (bottom bar on phones, left sidebar on desktop). Adding a transaction should take under five seconds.
- Check new UI at 320 px, 390 px and desktop in light and dark.

## Deployment facts

- Images build for `linux/arm64` in GitHub Actions and go to a private container registry; the server pulls them over an SSH deploy on version tags.
- The web container (Caddy serving the static build and proxying `/api`) binds `127.0.0.1:8080` only; a host reverse proxy owns ports 80/443. The API and PostgreSQL have no host ports.
- The deploy takes a verified backup first, then runs the restore drill after release. Never delete the database volume or restore into the running database without written authorization.
- Domain, SSH alias, install directory and deploy user are configuration (repository variables and secrets), never hardcoded. See `docs/SELF_HOSTING.md`.

## Commands

```bash
pnpm install          # install dependencies
pnpm setup            # create a private .env
pnpm dev              # web + api locally (dev PostgreSQL via docker compose)
pnpm test             # unit + integration tests
pnpm e2e              # Playwright end-to-end tests (run alone, serially)
pnpm lint             # Biome check (read the output, not just the last line)
pnpm typecheck        # tsc across the workspace
pnpm db:migrate       # apply Drizzle migrations
pnpm openapi          # regenerate docs/openapi.json
```
