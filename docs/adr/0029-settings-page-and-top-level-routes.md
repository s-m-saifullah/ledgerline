# ADR 0029: A Settings page, and top-level routes

Date: 2026-10-17. Status: accepted by the owner when approving the design.

## Context

More held the links to Accounts, Categories, Currencies, Recurring and Clients plus the theme, cents-first and time zone controls inline. The controls will keep growing, and the paths under `/more/` made data screens look like part of a menu.

## Decisions

- **Settings page.** `/settings` holds Appearance (theme), Privacy and entry (hide amounts, type amounts from the cents) and the Ledger card (time zone). Cards say whether a setting is saved on this device or belongs to the ledger. More keeps the links and gains a Settings row; the command palette gains a Settings entry.
- **Top-level routes.** `/accounts`, `/categories`, `/currencies`, `/recurring`, `/clients` and `/settings` replace the `/more/...` paths. `/more` stays as the page listing them. The old `/more/...` paths are removed with no redirect (single owner, no published links); they show the not-found page.
- **Navigation.** The More tab stays highlighted on `/more` and on every page reached from it.
- **Web only.** No API, data or migration change. Earlier ADRs keep their original wording as history (0026 names `/more/clients`).
