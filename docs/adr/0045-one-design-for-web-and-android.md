# ADR 0045: One design for the web and Android

> Amended by [0046](0046-clutter-free-redesign.md): during the clutter-free redesign the phone leads and the web follows later, and the type, shape, navigation and shared pieces below are replaced as that ADR says.

Date: 2026-10-23. Status: accepted by the owner in chat ("I want consistency of design: on the web app and the android app"). Builds on [PLAN.md](../PLAN.md) (design system), [0039](0039-interactive-control-styles.md) and [0040](0040-accessibility-pass.md) (the button ladder, spacing and accessibility rules) and [0043](0043-android-app.md) (the Android app).

## Context

After slice 5 PR 3 the owner found the Android app too plain next to the web app. The Android theme took only the colours from the shared tokens: it used the system font, Material's default type sizes and corners, and plain rows with dividers, while the web uses Inter, a light background with bordered surface cards, a tinted hero card for In hand, stat cards, list cards with a header row, transactions grouped by day, and navigation cards on More. The web already self-hosts Inter (`@fontsource/inter`, weights 400 to 700, no outside font service; the content security policy allows fonts from the app's own address only).

A short look at how finance apps are usually laid out found nothing that argues against the web's choices (the balance first and largest, then cards and recent entries), so the web is the reference and the phone follows it rather than another app's look.

## Decisions

- **The web is the reference.** A screen that exists on both looks the same on both: the same words, figures, order, card shapes and colours. The phone keeps what is native to it: Material components underneath, the system back gesture, the Add button at the bottom right ([0043](0043-android-app.md)) and its bottom bar.
- **Inter on Android too.** The official Inter 4.1 variable font (`InterVariable.ttf` from the upstream release, with its OFL 1.1 licence shipped in the app's assets) is bundled, used at the web's weights (400, 500, 600 and 700) and its default text optical size; amounts use tabular figures as on the web.
- **Type from the web's numbers.** Page title 28 sp, weight 600, letter spacing -0.045 em; the eyebrow above it 11 sp, weight 600, uppercase with 0.14 em spacing; section titles 20 sp, 600; body 16 sp; muted text 14 sp; card labels 12 sp; amounts 32 sp and the In hand amount 36 sp, tabular. Sizes are in sp, so the phone's font size setting still applies.
- **Shapes and surfaces.** Corners 8 dp for fields and buttons, 12 dp for cards and 16 dp for dialogs; the background is the zinc background token and cards are the surface token with a 1 dp border in the border token (borders, not shadows); spacing on the 4 dp grid (cards padded 20 dp, 12 dp between cards, 24 dp between sections, 16 dp side margins).
- **Shared pieces** in `ui/design`, each named after its web counterpart: a page header (eyebrow, title, optional subtitle) that scrolls with the content instead of a fixed top bar; a card; the hero card (accent-soft fill, accent border); a stat card (label and muted detail, amount); a list card (header row with an optional text action, divided rows); a day header; and the button ladder (filled for the one primary action, bordered, text, all with 8 dp corners; Material's pill shape is never used). The web's navigation card (icon on an accent-soft tile, title, description, chevron) is added with Clients, the first screen that needs it.
- **Restyled screens.** Home (header with the month, In hand hero, stat cards, an Accounts list card with each account's type and Overdrawn as on the web), Transactions (grouped by day in cards, the kind under each amount, Pending and Not sent yet in the accent, tags as pills), More (the web's settings cards: Privacy, Sync, Sign-in, About; the switch is called Hide amounts, as on the web), the placeholders for Budgets and Insights, and the buttons of sign-in, the address screen, the lock screen, the editor and the attention list. Screens still to come (Budgets, Insights, Clients) are built with these pieces.
- **One accent, as on the web.** Material's secondary and tertiary colour roles take the teal family, so its default purple never appears. The bottom bar marks the selected tab in the accent with no pill behind it, and the Add button is filled with the accent. The five bar labels share one size, the theme's or smaller when the longest ("Transactions") would not fit a tab, down to about 9 dp of height, so no label is cut off at 320 dp or with the largest text. Stat cards put the amount under their words when the card is narrow or the text enlarged.
- **Screenshots for review.** Roborazzi (test-only, 1.76.0; Android lint's NewerVersionAvailable check is turned off because Dependabot watches the Gradle build and that check's answer changes with whatever was published that day) renders each screen on the JVM at 320 and 390 dp in light and dark and with the largest font scale, so the design can be reviewed before the owner's phone check. The images are generated locally on demand (`-Pledgerline.screenshots`) and not committed or compared in CI, because pixel output differs between machines; CI keeps the behaviour and privacy tests.

## Not changing

The web app's look (it is the reference), the colour tokens and their generated Kotlin palette, the API, privacy mode (every amount still goes through `money()`), FLAG_SECURE, and the rules for touch targets (48 dp on Android), contrast and screen readers.

## Checks

The existing tests keep passing on the restyled screens (the privacy tests render the real rows). Screenshots of every restyled screen at 320 and 390 dp, light and dark, and at the largest font scale are reviewed for clipping, overlap and contrast against the web's screens at 390 px. The owner then checks the app on the phone next to the web app.
