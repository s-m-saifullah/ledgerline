# ADR 0028: Optional cents-first amount entry

Date: 2026-10-16. Status: accepted by the owner when approving the design.

## Context

Many banking apps let you type only digits and keep the decimal point fixed: 1, 2, 3 reads 0.01, 0.12, 1.23. The owner wants that as an option, with the ordinary box kept as the default.

## Decisions

- **A setting, not a mode change.** More, Appearance & privacy has "Type amounts from the cents", off by default. It is stored on the device (`localStorage`, like theme and privacy mode), so there is no API, migration or server setting. A synced per-account setting would need a settings endpoint and is left for later.
- **One shared box.** `AmountInput` is an ordinary input when the setting is off. When on, typed digits fill in from the right using the currency's own decimals (USD 2, JPY 0, BHD 3). In both modes the box holds the same plain decimal string, so forms, validation, minor-unit conversion and the API are unchanged.
- **Existing values are kept.** Typing into a box that already holds an amount appends to its digits (12.50 then 3 is 125.03). Backspace drops the last digit. Selecting everything and typing starts again. A pasted amount is read the ordinary way ("12.5" is 12.50, "1250" is 1250.00). Characters that are not digits are ignored and a value beyond the safe money range is refused.
- **Which fields.** Every field where a money amount is typed: quick add, the entry editor, split lines, transfer amounts and bonus, opening balances, budgets, recurring rule amounts, and a client's service, payment, received, tip and hourly-rate amounts. Not exchange rates, percentages (the fee box takes `2` or `2%`) or hours.

## Consequences

Web only. Unit tests cover the digit logic and the component; a browser test covers the setting on desktop and phone. The caret stays at the end of the box in this mode, by design.
