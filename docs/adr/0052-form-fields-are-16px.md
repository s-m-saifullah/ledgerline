# ADR 0052: Form fields are 16 px, and the page is 14 px

Date: 2026-11-13. Status: accepted by the owner in chat. Clarifies the type scale in [0046](0046-clutter-free-redesign.md) and [0047](0047-web-redesign.md) (10 as the floor, then 12, 14, 19, 27, 31 and 35).

## Context

The web had no base text size, so anything without its own rule drew at the browser's 16 px, and the stylesheets set 13, 18, 20, 24, 26 and 32 px in places. Setting a base size on the page would also have shrunk every form field, and a field under 16 px makes iOS zoom the page when it is focused.

## Decision

- The page text is 14 px (`body`). Every page title is 27 px and every card or sheet title 19 px, each from one rule.
- The text inside a form field is 16 px, named once as `--field-text` in `packages/ui/src/tokens.css`. It is the only size outside the scale, and it is used only for fields (the bare input and textarea rule, the combo input, the category select, the pick row's hidden select).
- `css-contract.test.ts` allows the scale and `var(--field-text)` and nothing else, and refuses a `font:` shorthand that sets a size (it would hide a size from the check). A browser spec checks the computed sizes of the page, a title and a field.

## Consequences

- Empty states, question text and loading lines are 14 px instead of 16.
- Fields look the same as before. A different field size means changing this ADR.
- The phone app keeps its own scale (`TEXT_FLOOR_SP`, ADR 0046).
