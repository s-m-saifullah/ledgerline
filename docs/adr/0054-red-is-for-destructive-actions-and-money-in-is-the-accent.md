# ADR 0054: Red is for destructive actions, and money in is the accent

Date: 2026-11-16. Status: accepted by the owner in chat (decisions 4 and 7 of the web consistency work, taken at their defaults and confirmed on 2026-11-16). Amends the design rules in [0046](0046-clutter-free-redesign.md) and [0047](0047-web-redesign.md) for the web, and the line "Red only for overspending, errors and Delete actions" in `CLAUDE.md`.

## Context

A review of the web (2026-11-11) found places where the screens and the written rules disagreed:

- A loan's Delete on the balance card was a teal word, while every other Delete was red.
- Red appeared on actions that were destructive but not named Delete ("Clear ledger", "Turn off two-factor", "Undo import", "Remove currency"), so the rule and the screens did not match.
- Money in was green on Home and Transactions and teal on Insights, so one figure ("Net") had two colors.

## Decision

- **Red is for overspending, overdue, errors and destructive actions.** A destructive action deletes, clears, ends or turns off something the person set up ("Delete", "Clear ledger", "Turn off two-factor", "Undo import"). Overdue stays red. Signing out of this device stays as ADR 0047 left it.
- **Money in is the accent.** Home's money in and net, and Transactions' money in, use the accent like Insights; there is no green. The `--positive` token is deleted. `--warning` stays for "almost at the limit" and nothing else, so the sync dot is the accent while updating (the word "Updating" carries the state; it lasts seconds) and muted when offline.
- No button changes in this decision. Which text actions should become buttons is decided screen by screen, not by one rule (the owner rejected outlining every text action).

## Consequences

- `color-contract.test.ts` fails a pull request that brings `--positive` back, draws money in in another color, or makes the sync dot amber. Browser specs read the color the browser drew for money in on Home and Transactions at 320, 390 and 1280 px in light and dark.
- The accent text pairs are 6.7 to 7.0:1 (light) and 9.3 to 10.5:1 (dark) on the surfaces, above AA; the old green was 7.1 and 12.6.
- The phone app keeps its own colors until WP-22 carries the same rules over.
