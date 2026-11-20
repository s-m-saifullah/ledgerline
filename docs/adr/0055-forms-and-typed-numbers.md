# ADR 0055: A form may hold its own state, and a typed number is read by one rule

Date: 2026-11-20. Status: accepted by the owner in chat ("Go as recommended", after the pros and cons of moving every form to React Hook Form). Settles decision 9 of the review's fix plan (WP-15).

## Context

The web has two ways to build a form. Six forms use React Hook Form with Zod (sign-in, quick add, the transaction editor, the transfer form, the account editor, the category editor). About fifteen small sheets keep their fields in `useState` with hand-written checks (the loan sheet, the Clients operations, the recurring rule, budget limits, tags, the rate sheet, Users, Profile). The sheets carry the write rules of the app (one idempotency key per action, a retry that reuses it, a person created once), and their tests are written around them.

The real fault was not the style. Typed numbers were read by different functions, so some boxes accepted ".8" and "8." and others did not: the rate fields, the account's bonus rate, the hours box and the loan sheet's amount refused them, while most amount boxes took them. The owner's rule is that a typed decimal is read as meant. The phone already did this for rates and hours.

## Decision

- **Both styles stay.** A small sheet may hold its own state; React Hook Form with Zod stays where it is. A form moves to the other style only when it is being changed for another reason. Moving every sheet would be a large change to code that moves money, with nothing visible to the owner.
- **A typed number is read by one rule.** A point with nothing before or after it is a decimal being typed: ".8" is 0.8 and "8." is 8. `typedDecimal` in `packages/shared` does this; `rateFromTyped` and `hoursFromTyped` there read a typed rate and typed hours through it, and `percentToBps` in `apps/web/src/lib/money.ts` does too. Money typed in a box goes through `typedMinor` in `apps/web/src/lib/amount-input.ts`, which also takes a "$", spaces and "1,000". The strict readers (`parseMinorUnits`, `rateFromInverse`, `hoursToHundredths`) stay for numbers that come from the server and for the phone's ports.
- **A test keeps it that way.** `typed-numbers-contract.test.ts` fails when a web source other than `lib/amount-input.ts` calls `parseMinorUnits`, or any web source calls `rateFromInverse` or `hoursToHundredths`.
- **The phone is checked against the web.** `rate-parity.json` and `hourly-parity.json` gained `fromTyped` and `hoursTyped` cases, made by the shared functions; the phone's `rateFromTyped` and `hoursFromTyped` must give the same answers. A comma as the point ("1,5" hours) stays a phone-only reading and is not in the fixture.

## Consequences

- A new sheet in either style gets the same reading of typed numbers if it uses the helpers; the contract test says so when it does not.
- Error wording and when a form validates can still differ between the two styles. That is accepted for small sheets; a screen that is rebuilt for other reasons should pick the nearest existing example.
- The phone's app code is unchanged; only its tests and fixtures grew, so no Android release is needed for this.
