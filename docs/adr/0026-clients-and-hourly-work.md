# ADR 0026: People becomes Clients; hourly work is an amount

Date: 2026-10-13. Status: accepted by the owner when approving the design.

## Context

The money-owed screen was called People. The owner also wants to track money owed for work paid by the hour, so "People" no longer fits. Earlier ADRs (0008, 0009, 0012, 0022) keep their original wording as history.

## Decisions

- **Name.** The screen, headings, buttons, messages, Home's "From N clients" line and the guide say Clients. Home's "Owed to you" label stays, because it describes the money.
- **Route.** The web route is `/more/clients`. `/more/people` is removed with no redirect.
- **API unchanged.** `/contacts` and the receivables endpoints keep their names; "contact" is already neutral and Android depends on this contract.
- **Hourly work needs no data change.** A service is a labeled amount in integer minor units plus a currency (0022). An optional "Hours × rate" helper on the Log service form fills the amount and suggests a description such as "3.5 h at 40.00/h"; both stay editable and only the total is stored. The total uses one shared integer rounding helper. If later reports need hours per client, nullable hours and rate columns are added through a new ADR.

## Consequences

Web, tests and docs change; no migration and no API change. Internal names (CSS classes, query keys, the `features/people` folder) keep their old names to keep the diff small.
