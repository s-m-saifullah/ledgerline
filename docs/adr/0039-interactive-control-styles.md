# ADR 0039: Interactive control styles

Date: 2026-10-20. Status: accepted by the owner when approving the design in chat (every recommended choice). First slice of the Phase 4 accessibility pass. Builds on the UI rules in `CLAUDE.md` and [0014](0014-red-delete-actions.md).

## Context

Several controls look like plain text, so people cannot tell they can be pressed. An audit of the web app found three groups:

- **Twelve collapsible sections** (native `details` and `summary`) with the browser's marker hidden and nothing in its place: Filter entries and Import and export (Transactions), More details (Add transaction), More (transfer fee and bonus), More default categories (account editor), More fee and bonus categories (recurring rules), More details: date, time and note and the hourly helper (Clients), Show the figures (two Insights charts), Manage (two-factor) and the ready-rows list in the import review. They carry eight one-off styles, and a few have none.
- **About twenty-five muted text buttons** (`quiet-button`), several of which are the only way to reach a feature: Set the rate yourself, Use a backup code instead, Back to sign in, Download CSV template, the add-category toggles, split-line Remove and some row actions.
- **Nine bare inline "Try again" and "Reload choices" buttons** in error messages.

## Decisions

- **One disclosure style for every `summary`,** set once on `details > summary` instead of per place. It shows a chevron that turns when open, a border and subtle background, an accent hover, a visible focus ring and a 44 px height. Native `details` stays, so Enter, Space and screen readers keep working. Two variants: a **section** row (full width, bordered) for page-level disclosures such as Filter entries, Import and export, Manage and Show the figures, and an **inline** variant (chevron and accent text, no border) inside forms such as the More details groups. The one-off summary styles go.
- **A three-step button ladder:** primary (the filled button), secondary (the bordered button) and a new **text button** (accent-coloured, underlined on hover and focus, optional small icon). `quiet-button` stays only for icon and toolbar controls such as the header search. Red stays only for Delete and errors.
- **Row actions** (Accounts, Tags, Budgets and similar) become text buttons with an icon; Delete stays red. Controls that open a feature (Set the rate yourself, Use a backup code instead, Download CSV template, the add-category toggles) become text buttons.
- **One shared retry control,** styled as a secondary button, replaces the nine bare ones.
- **Rule for new work:** any control the user presses must show a button, a bordered row or an underlined accent label plus a hover and focus state; plain muted text is for labels only. This is added to the UI rules in `CONTRIBUTING.md`.

## Not changing

No API, data or behaviour change; labels and roles stay the same, so existing tests keep their selectors. Light and dark themes, WCAG AA contrast and 44 px targets stay the rule.

## Slices and checks

1. The disclosure style (the twelve cases). 2. The text-button tier and the conversions. 3. The shared retry control. Each is web only. Checked by eye at 320, 390 and desktop in light and dark with a temporary screenshot spec that is deleted before committing, by keyboard (Enter and Space on every disclosure, visible focus), and with the existing unit and browser specs plus one new test that disclosures respond to the keyboard.

## Amendment (2026-10-20): spacing and the editor footer

- **Spacing rule, on the 4 px grid.** The focus ring stays 2 px wide but its offset drops from 4 px to 2 px, so it reaches 4 px beyond a control. A label sits at least 8 px above its field (a grid gap, or the `field-label` class where a form has none), a field 16 px above the next label or field, related buttons 12 px apart and the sections of a card 24 px apart. A browser spec opens the main forms at 320, 390 and desktop widths and fails when text sits closer than 8 px above a field.
- **Editor footers on a phone.** The first step of delete in the five editor dialogs that have one (transaction, transfer, recurring rule, budget, currency rate) is a shared `DialogDeleteButton`: a 48 px trash icon on a phone, the text button on wider screens, with the label kept in the page for screen readers and tests. With a third button the footer is Close, the icon and the primary button on one row; with two it is the icon and the primary button. The icon only asks for confirmation; deleting still takes a second, confirming button, and entries can be undone afterwards.
- **Charts.** The "Show the figures" row has 16 px above it under both Insights charts.
