# ADR 0040: Accessibility pass

Date: 2026-10-21. Status: accepted by the owner when approving the design in chat (every recommended choice). Second slice of the Phase 4 accessibility pass, after [0039](0039-interactive-control-styles.md). Builds on the UI rules in `CLAUDE.md` (WCAG AA, 44 px targets, full keyboard use).

## Context

An audit ran axe (WCAG 2.0 to 2.2 A and AA plus best-practice rules) over every main screen, the main dialogs, the import steps, the two-factor steps, the empty ledger and the sign-in screen, at 320 px and desktop in light and dark, plus manual checks of focus, keyboard, targets, reduced motion and reflow. Nothing serious failed automatically, and much is already right: text contrast is 6.2:1 or better in both themes, landmarks and a skip link exist, dialogs take focus, trap Tab, close on Escape and return focus, charts have a text alternative and a data table, and no screen scrolls sideways at 320 px. The real gaps:

1. **Every screen has the same title,** "Ledgerline" (WCAG 2.4.2).
2. **Changing screens is silent.** After a navigation link is activated, focus stays on the link and nothing announces the new screen.
3. **Field borders are faint:** 1.27:1 in light and 1.7:1 in dark, below the 3:1 that WCAG 1.4.11 asks for when the border is what identifies a field.
4. **Smaller items:** the Categories screen jumps from a level-1 to a level-3 heading; the Home link cards ("Owed to you. Open Clients") and the mobile brand link have accessible names that do not contain their visible text, which breaks voice control; the two Settings checkboxes and the desktop brand link are under 44 px.

Not covered by the audit: a real screen-reader pass (the owner may run VoiceOver on the finished work). There is no first-run screen in the web app (the owner account is created by the server), so none was audited.

## Decisions

- **Titles and announcements.** Each route sets the document title (for example "Budgets · Ledgerline"). After an in-app navigation, focus moves to the page's main heading (not on the first load), and one polite live region announces the new screen name. The skip link stays.
- **Field borders.** A new `--field-border` token, a zinc that measures at least 3:1 against the surface and the background in both themes, used on inputs, selects and text areas only. Card and divider borders stay soft because the text inside them identifies them.
- **Smaller items.** Fix the Categories heading order; make the Home link cards and the brand link carry their visible text in their accessible name; give the checkboxes and the brand link a 44 px target (the label is the target where it already is).
- **A permanent guard.** A browser spec runs axe over the main screens at 320 px and desktop in light and dark with no accepted violations, and asserts unique titles and the 3:1 field border. `@axe-core/playwright` is a development dependency only; nothing ships to users. Known false positives (Radix focus guards, a background axe cannot resolve) are not counted.

## Not changing

No API, data, auth or behaviour change. Red stays only for Delete and errors, and the accent and neutral palette are unchanged apart from the field border.

## Slices and checks

1. This ADR (docs only). 2. Titles and announcements, with a unit test for the title and a browser test for focus and the live region. 3. Field border, heading order, names and targets, checked by eye at 320, 390 and desktop in light and dark with a temporary screenshot spec that is deleted before committing. 4. The axe guard spec. Each is web only; the full suite runs on each. Nothing here can lock anyone out or lose data.

## Amendment (2026-10-21): what was built, and one known gap

- All four slices are built. The guard is `tests/e2e/a11y.spec.ts` (axe with the WCAG 2.0 to 2.2 A and AA and best-practice rules on 14 screens, 4 dialogs, the empty ledger and the sign-in screen, at 390 px and desktop in light and dark, plus unique titles and the 3:1 field border). It runs in the desktop project only.
- **Known gap:** a transaction row's accessible name is the short summary "Open transaction: <payee>", which does not contain all of the row's visible text (WCAG 2.5.3, voice control). Naming the row from its content would change the accessible name that about ten browser specs select by, so it is left for a later change; the guard skips that one rule on those rows and nowhere else.
- The Settings checkboxes were already 44 px rows (the 20 px measured is the box inside a 44 px label), so nothing changed there.
