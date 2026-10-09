## What and why

<!-- A short plain-language summary of the change and the problem it solves. -->

## How I tested it

- [ ] `pnpm lint` (read the output), `pnpm typecheck`, `pnpm test`
- [ ] `pnpm e2e` (run alone), if the UI or API changed
- [ ] New UI checked at 320 px, 390 px and desktop, light and dark

## Checklist

- [ ] Money stays integer minor units; no amounts, payees or notes in logs
- [ ] New or changed endpoints have a cross-ledger test
- [ ] API contract changes have a `docs/api-changes.md` note and a regenerated `docs/openapi.json`
- [ ] Docs and, if the plan changes, an ADR are updated
