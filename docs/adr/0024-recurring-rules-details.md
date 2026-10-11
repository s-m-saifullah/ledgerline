# ADR 0024: Recurring rules, time zone and catch-up

Date: 2026-10-11. Status: accepted by the owner when approving the slice 2c design. Builds on [0021](0021-recurring-entries-runner.md) and amends [0023](0023-transfer-bonus.md).

## Decisions

- **The rules tables are the source of truth.** pg-boss only wakes the runner (an hourly tick and once at API start). What is due is worked out from the rules, so losing the job tables loses nothing.
- **Ledger time zone:** a nullable IANA name on the ledger. It is empty until the owner sets it, and a rule cannot be created before then. "Today" for a ledger is today in that zone.
- **Schedules:** every N days, weeks, months or years, from a start date and an optional end date. Each occurrence is calculated from the start date, never from the previous occurrence, so a rule on the 31st does not drift; a day that does not exist in a month clamps to the month's last day.
- **Catch-up:** every due occurrence up to today is created, dated on the occurrence date, as a cleared entry. At most 100 occurrences per rule per tick. A start date in the past creates those entries, and the form says how many first.
- **Stable keys:** each occurrence is written through the normal financial write path as the rule's creator, with the key `recurring-<ruleId>-<date>`. Access is re-checked on every run; a creator who lost write access gets the rule paused. A retry replays the saved result, and an entry the person deleted is never recreated.
- **Runs table:** each occurrence is recorded (created, skipped, or needs attention) with a link to what it made. A missing rate, an archived account or category, or similar is never guessed: the occurrence needs attention with a fixed, non-sensitive reason, is retried each tick and can be skipped by the person.
- **Edits, pause and delete:** edits affect future occurrences only. Resuming a paused rule skips what was missed while paused. Deleting a rule keeps the entries it made.
- **Transfers:** a transfer rule creates an ordinary transfer. A cross-currency transfer rule stores a fixed received amount.
- **Bonus (amends ADR 0023):** a transfer rule may carry an explicit bonus (fixed amount and category) that the owner confirms when creating the rule. The account's bonus rate is never applied automatically, so no bonus is posted without the owner having confirmed it.
- **Daily rate fetch:** the same tick refreshes rates once per ledger-local day (key `rates-<date>`); manual rates are still never overwritten.
- **Backups:** the rules and runs tables join the backup manifest and restore drill. pg-boss keeps its tables in its own schema; they are in the dump but not fingerprinted because job state is volatile.

## Consequences

Logs carry counts only. Reference deletion (ADR 0006) must treat a rule as a reference to its accounts and categories. Splits and "last weekday of the month" schedules are out of scope for now.
