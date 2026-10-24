# ADR 0046: Clutter-free redesign, phone first

Date: 2026-10-24. Status: accepted by the owner in chat ("Approved"). Amends [0045](0045-one-design-for-web-and-android.md) (one design for web and Android) and the design rules in [CLAUDE.md](../../CLAUDE.md). Builds on [0039](0039-interactive-control-styles.md), [0040](0040-accessibility-pass.md) and [0043](0043-android-app.md).

## Context

The owner finds the app cluttered and wants it clearer, more appealing and more modern, the Android app first and then the web app. The owner supplied an interactive concept of eleven phone screens (Home, Transactions, Budgets, Insights, More, Clients and a client, Loans and a person, Categories, Settings) plus the entry editor and two bottom sheets. The concept is kept locally and is not in the repository: it holds real names.

An audit of the concept against the app found what to adopt and what to change:

- It removes real clutter: five stacked stat cards, a wall of seven filter boxes, a row of "..." buttons on every category, repeated page headers, "service version 1" wording, and a full page to add a category.
- It breaks rules the app keeps: several accent colours and a dark gradient (one teal accent only), text of 8 to 11 px (our minimum is 12 sp), grey and green text under 4.5:1 contrast, touch targets under 44 dp, amounts that would not all be masked in privacy mode, shadows (we use borders), and new names ("Clients & Invoices", "Available Liquid Cash") for things the web already names.
- It shows features the app does not have: editing budget limits, receiving a payment, recording a repayment, lending more, logging a service, a send-reminder action, an in-app keypad and a reset-filters setting. It has no dark mode and no empty, offline, unsent or update states.

## Decisions

- **The phone leads for now.** ADR 0045's rule that the web is the reference is suspended for this redesign. The web follows in a later piece of work with its own plan (and an ADR 0047 if it needs one), reusing the same tokens, which live in `packages/ui/src/tokens.css` and are generated into the Android palette. Until then the web and the phone may differ.
- **Same app, calmer.** Same words for the same things (In hand, Owed to you, Lent out, Clients, Loans), same data, same behaviour. Nothing is added to the API, the outbox or the mirror by the redesign. Phone writes the concept shows are separate follow-up pieces (below).
- **One accent.** Teal from one seed stays the only accent. Charts use a ramp of tints of it plus a neutral for "other"; every segment also carries its name and percentage, so colour is never the only cue. The hero card is a solid deep tint of the accent, not a gradient. Red stays for overspending, errors and Delete. The existing `warning` token marks "almost at the limit".
- **Type.** Inter stays. Nothing is smaller than 12 sp (the 11 sp capitals eyebrow goes). Top bar title 20 sp; section labels 12 sp, weight 600; body 16 and 14; row amounts 16 sp, 600, tabular; hero amount 36 sp. The bottom bar labels are 12 sp, and may shrink to 11 sp only where "Transactions" would not fit one line (320 dp or the largest text).
- **Shape and surface.** Cards 16 dp, the hero 20 dp, sheets 24 dp at the top, fields and buttons 12 dp. Borders, never shadows. A group of rows is one card with hairline dividers; rows are at least 56 dp tall; every touch target is at least 48 dp (the Android rule, above 44).
- **Contrast is tested.** A unit test computes the contrast of every text and background pair of the light and dark palettes and fails under 4.5:1 (3:1 for large text and icons). Muted text uses the `muted` token, never a lighter grey.
- **Dark mode is designed here**, from the existing dark palette: a dark surface, the hero as a darker accent tint with light text, the same ramp lifted for dark. It is reviewed in the same screenshots as light.
- **Navigation.** Five tabs and Add at the bottom right, as now. Add is hidden on More and the screens opened from it (Clients, Loans, Categories, Settings). A fixed top bar replaces the scrolling page header: the title, a back arrow where there is one, at most one action. Sub-screens drop the eyebrow and repeated headers.
- **Privacy.** Every amount, including those in badges, buttons and sentences, goes through `money()`. Proportion bars show shares and stay visible in privacy mode (they show no amounts); this is checked with the owner on the phone.

### New shared pieces (`apps/android/.../ui/design`, later `packages/ui`)

Top bar; segmented control (two to four options); grouped list card (leading avatar, title, subtitle, trailing value); avatar with initials from the name (no emoji, no stored icon needed); proportion bar (accent, `warning` near the limit, red over it); filter chip; section label; empty state (a sentence and at most one action); bottom sheet (handle, title, Cancel, content, one primary button); and the existing `SearchField`, `narrowingRoom`, `MonthSwitcher`, `RetryNote` and buttons restyled. `PageHeader`, `ListCard`, `NavCard`, `StatCard` and `ShareBar` are replaced screen by screen and deleted when unused.

### Screens

- **Home.** Top bar: month, sync state (Synced, Not sent yet with a count, Offline) and the Hide amounts switch. Banners (update notice, unsent attention, pending note) in one slot above the hero. The In hand hero holds two small figures under it, Owed to you and You owe, and no explanatory text. Owed to you is money clients owe plus money lent to people, one figure although the two come from Clients and Loans (the owner's decision while reviewing Home); a figure of nothing is left out, and only a warning about a missing exchange rate can show as text. One month card: a single In and Out bar with the Net figure, opening Insights. Accounts in two cards, Cash and banking and Cards and loans, grouped by the account's real type; a currency segmented control only when there are two or more currencies; Overdrawn kept.
- **Transactions.** Search field, kind chips (All, Expenses, Income, Transfers) and one Filters chip with a count that opens the existing account, category, tag and date filters in a sheet. Day cards with the day's net in the header. The two legs of a transfer show as one row "From → To" when both are present. Same-day payees are not merged. Pending and Not sent yet stay as small markers.
- **More and Settings.** Grouped rows with a live figure where it is known online (the total owed on Clients, the total lent on Loans, category counts), nothing when offline. Settings in grouped sections: Appearance (Light, Dark, System as a segmented control), Privacy and input, Sync, Account (Lock now; Sign out in red), Updates and About. Every control that exists today stays.
- **Budgets.** Month switcher in the top bar, a Left this month hero with a bar, one list sorted overspent first and then by spending, each row with what is left or the overspend, the budget and a bar; carried over stays; Spent without a budget stays; a budgeted category with no spending stays visible; only categories with nothing planned and nothing spent fold into one line. Read-only.
- **Insights.** Month switcher, one summary card (spent, money in, net, share kept), one category card with a proportion bar and expandable parents, the 12-month chart and its figures only when two or more months have activity (months without activity are left out of the figures), and net worth drawn honestly: a negative value hangs below the baseline in the neutral colour, never a tall green bar.
- **Clients and Loans.** Clients: a total-owed card, search and Open, Settled, All chips in one row (not a dropdown), one list sorted by amount owed. A client: balance card, the unpaid services pinned and marked Overdue, then Paid and History as a segmented control; paid services show the service amount and Paid in full; history lines lose "service version" and are not merged. Loans: one summary card (Lent out, You owe), one people list, search only when there are eight or more people in total (never because the list is narrowed), and a person's balance shown once, with "Before Ledgerline" as the opening line of the history. Both stay read-only.
- **Categories.** Top bar with Add category; Expense and Income segmented with counts; one accordion card (tap a group to expand). One edit button per group and a tap on a subcategory open a sheet with the existing actions (edit, add subcategory, archive, unarchive, delete in red). Adding is a sheet, not a page.
- **Entry editor.** Stays a full screen with the system keyboard and today's cents-first typing (the in-app keypad is not part of this). Type segmented control, a large amount with the currency, a grouped card for Payee, Account, Category, Date and time, Tags, Notes and Pending, one Save button pinned at the bottom. Transfers show From and To cards with a swap button.
- **Sign-in, address and lock.** Same tokens and top bar, one primary button each.
- **States.** Loading, empty, offline and error use the shared empty state and the restyled retry note.

## Not changing

The API, the mirror, the outbox, sync, privacy mode through `money()`, FLAG_SECURE, integer minor-unit money, each screen's content as a function of plain data, the search-stays-put rule (`narrowingRoom` and a `SearchStaysPut` test on every list screen with a search or filter), the colour source (`tokens.css`), light, dark and system themes, and the existing tests (kept green, or changed on purpose and said so in the pull request).

## Follow-ups, each its own plan and pull request

Edit a budget limit; receive a payment (amount, account, date and tip, with a confirmation, not one tap); record a repayment; lend more; log a service; mark a service paid; the in-app keypad; the send-reminder action; reset filters on app close. Each needs the outbox or an online write, idempotency and tests, and gets its own approval. The web redesign follows the phone.

## Order of pull requests (small, each checked on the owner's phone)

1. This ADR, the CLAUDE.md design rules and the PROGRESS record (documentation only).
2. Foundation: tokens (deep accent, chart ramp, 12 sp floor, shapes), the contrast test and the shared pieces, shown in a screenshot gallery; screens change only where the floor needs it.
3. Home. 4. Transactions with the Filters sheet. 5. More and Settings. 6. Budgets. 7. Insights. 8. Clients and Loans. 9. Categories. 10. Entry editor, sign-in, address and lock.
11. A release (`android-v0.2.0`) when the owner is happy, then the web plan.

## Checks

Each pull request: tests that fail before the change; a deliberate-mutation check on each new rule (the floor, the contrast test, hiding Add, the eight-people search rule, the transfer row, folding empty budgets); screenshots at 320 and 390 dp, light and dark, and with the largest text; sheets and menus, which the screenshot tool cannot capture, checked on the phone; then the owner's phone check.
