# ADR 0053: The web's bottom bar labels are 12 px from 380 px wide

Date: 2026-11-13. Status: accepted by the owner in chat ("go with 2"). Amends the bottom bar's 10 px labels in [0046](0046-clutter-free-redesign.md) and [0047](0047-web-redesign.md) for the web only, and the two-widths rule in [0047](0047-web-redesign.md) for this one type step.

## Context

The bottom bar's labels were 10 px, the floor of the type scale, and the owner found them too small on a phone. The next step of the scale is 12 px, but "Transactions" is 75 px wide in 12 px semibold and five tabs are 64 px wide at 320 px, 75 px at 375 px and 78 px at 390 px.

## Decision

- From a 380 px wide screen the labels are 12 px; below it they stay 10 px. A tab has no side padding, so 78 px at 390 px holds the label.
- 380 px is the only width in the stylesheets that is neither 700 nor 1100. It changes a type size, not the layout: the same controls are drawn at every width. `css-contract.test.ts` allows it in `shell.css` only.
- A browser spec measures the labels at 320, 375, 379, 380, 390 and 412 px, and fails if any is clipped.
- The Android bottom bar is not changed here (its labels are 10 sp, ADR 0046).

## Consequences

- A phone from 380 px up (most phones today) has larger labels; 360 and 375 px phones keep 10 px.
- A longer tab label, or a sixth tab, needs the width worked out again.
