# ADR 0023: Transfer bonus on incoming transfers

Date: 2026-10-10. Status: accepted by the owner when approving the slice 2b design.

## Context

Some countries add a percentage to incoming remittances. The app should handle that in a generic way, with no personal or country-specific rules in the code or docs.

## Decisions

- An account may have an optional **inbound bonus rate** (whole basis points, so 2.5% is 250) and a default income category. It is off by default.
- When a transfer's destination has a rate, the transfer form shows the bonus worked out on the **received** amount, rounded to the smallest unit of the destination currency, prefilled and editable, with an off switch. A one-off bonus can be typed for an account with no rate set (a per-transfer override).
- Saving creates the transfer (two legs, unchanged) and, when confirmed, **one ordinary income entry** in the destination account in the same atomic write, linked by a new optional `related_transfer_id`. A retry cannot create it twice.
- The bonus is **never posted silently**: the person always sees and confirms it.
- Deleting a transfer offers to delete its linked bonus as well.
- The bonus is real income: it counts in the account balance and in income totals, with its base value taken at that day's rate.

## Consequences

Transfers keep their two-leg invariants. A new nullable column links the income entry to its transfer, and account settings gain two optional fields. Rates and categories are data the person owns, so nothing country-specific lives in the repository.
