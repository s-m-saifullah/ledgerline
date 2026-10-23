# Contributing to Ledgerline

Thank you for helping. Ledgerline is a small, focused project, so a short conversation before a large change saves everyone time: open an issue describing the problem and your idea first.

## Ground rules

- **Money** is an integer in minor units plus an ISO 4217 currency code. Never use floating point for amounts. Format only in the UI.
- **IDs** are UUIDv7. **Every table** has `created_at`, `updated_at` and `deleted_at`; deletes are soft.
- **Ledger scoping:** every financial row has `ledger_id` and every query goes through a ledger-scoped repository. Each endpoint needs an integration test proving another ledger's rows cannot be read or written.
- **API:** REST under `/api/v1`, camelCase JSON, money as `{ amount, currency }`, ISO dates, UTC timestamps, cursor pagination, an `Idempotency-Key` on writes and RFC 9457 problem details for errors. Changing the contract needs a note in `docs/api-changes.md` and a regenerated `docs/openapi.json`.
- **Privacy:** no analytics or trackers. Logs never contain amounts, payees or notes. Secrets live only in `.env`, never in Git; keep `.env.example` current.
- **UI:** calm and mobile-first, one primary action per screen, large tabular amounts, 44 px touch targets, light and dark themes, WCAG AA contrast, full keyboard use. Red is only for overspending, errors and Delete actions. Collapsible sections use `details` and `summary` and take the shared disclosure style in `styles.css` (a chevron, a border or accent label, a hover and focus state, 44 px); do not restyle a `summary` one-off (ADR 0039). Buttons follow a three-step ladder: filled (`button`) for the one primary action, bordered (`secondary-button`) for other actions, and `text-button` (accent colour, underlined on hover, optional icon) for light actions such as row actions and toggles; `quiet-button` is only for icon and toolbar controls, and plain muted text is only for labels. Red stays for Delete and errors. Spacing sits on the 4 px grid and the focus ring reaches 4 px beyond a control: a label sits at least 8 px above its field (a grid gap, or the `field-label` class), a field 16 px above the next label or field, related buttons 12 px apart and the sections of a card 24 px apart; `tests/e2e/spacing.spec.ts` checks the main forms. `tests/e2e/a11y.spec.ts` runs axe over the main screens and dialogs in both themes at a phone and a desktop width, so a new screen must pass it and be added to its list (ADR 0040). In an editor dialog the first step of delete uses `DialogDeleteButton`, which is a trash icon on a phone (ADR 0039).
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

## Testing conventions

- **API integration tests** use the shared helpers in `apps/api/src/test-support/harness.ts`: `requireTestDatabase` (refuses anything but `ledgerline_test`), `testConfig`, `signInCookie` and `seedUser`. Do not copy the database guard, config block, sign-in or user-seeding code into a new test file; import the helpers. If a new test needs setup that two or more files would share, add it to the harness instead of repeating it.
- Each endpoint still needs its own cross-ledger test (see the ledger scoping rule above).
- Code in one API module calls another module's **service**, never its repository or tables.
- **Web utilities** used by more than one feature live in `apps/web/src/lib/` (helpers, preferences) or `apps/web/src/components/` (shared React pieces); shared test helpers live in `apps/web/src/test-support/`. A feature does not import another feature's internal files just to reuse a helper: move the helper to one of those folders first.
- **Long components and route files:** when a component or function grows past roughly 400 lines, split it instead of adding to it. On the web, render each section as a plain function that reads one typed context object (see `features/clients/operations/`, `features/transactions/transfer/`, `features/recurring/editor/`, `features/categories/list/`) and keep the state, effects and saving in the component, so the DOM and state stay as they were. In the API, register routes in groups called in a fixed order (see `modules/receivables/client-routes/`), because `docs/openapi.json` lists paths in registration order. Prove a refactor changes nothing: the same screens before and after, or an unchanged `docs/openapi.json`.
- **Android** (`apps/android`, see its README): JVM unit tests only in CI (no emulator). API types live in `apps/android/api-client` and `ContractTest` compares them with `docs/openapi.json`, so an API change that breaks the app fails the pull request that makes it; add a type there in the slice that first uses a route. View-model tests use fakes (`app/src/test/.../testing/Fakes.kt`) and a mock web server with the real clients; wait for a screen to finish with `state.first { !it.submitting }`, never by reading state right after `submit()`. Lock, Keystore and fingerprint behaviour cannot run on the JVM: it is checked by hand on a real phone against a scratch server (`adb reverse`), never against production data. The mirror and sync tests run the real Room database on the JVM through Robolectric; `MirrorMatchesServerTest` compares the mirror with a live scratch server and runs only when `LEDGERLINE_COMPARE_ORIGIN` is set (see the Android README). Screens format amounts only through `money()` (`ui/privacy`), so privacy mode reaches them; a Compose test that renders a row with privacy on and off runs under Robolectric with `@Config(application = Application::class)`, because the app's own class starts syncing when an activity opens. Never log amounts, payees, notes or the token; the generated `ApiClient` logs bodies and is excluded on purpose.
- **Browser specs** that build their own synthetic ledger use the helpers in `tests/e2e/ledger-setup.ts` (`connectLocalDatabase`, `createOwnerLedger`, `prepareBrowser`) instead of repeating the database guard, ledger and owner setup, ledger-list mock and client-address header. Clean-up stays in each spec because the tables differ.

## Pull requests

- Branch from `main`, keep commits small and focused with clear messages, and open a pull request to `main`. Nobody pushes directly to `main`.
- One required `check` result is reported per pull request update; it gates parallel jobs (see [docs/CI.md](docs/CI.md)). Documentation-only changes need only content, link and whitespace review.
- Explain the change in plain language, what you tested, and anything reviewers should look at first.
- By contributing you agree your work is licensed under the [AGPL-3.0](LICENSE).

## Reporting problems

Bugs and ideas go in issues (use the templates). For security problems follow [SECURITY.md](SECURITY.md) instead.
