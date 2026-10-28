# ADR 0046: Clutter-free redesign, phone first

Date: 2026-10-24. Status: accepted by the owner in chat ("Approved"). Amends [0045](0045-one-design-for-web-and-android.md) (one design for web and Android) and the design rules in [CLAUDE.md](../../CLAUDE.md). Builds on [0039](0039-interactive-control-styles.md), [0040](0040-accessibility-pass.md) and [0043](0043-android-app.md).

## Context

The owner finds the app cluttered and wants it clearer, more appealing and more modern, the Android app first and then the web app. The owner supplied an interactive concept of eleven phone screens (Home, Transactions, Budgets, Insights, More, Clients and a client, Loans and a person, Categories, Settings) plus the entry editor and two bottom sheets. The concept is kept locally and is not in the repository: it holds real names.

An audit of the concept against the app found what to adopt and what to change:

- It removes real clutter: five stacked stat cards, a wall of seven filter boxes, a row of "..." buttons on every category, repeated page headers, "service version 1" wording, and a full page to add a category.
- It breaks rules the app keeps: several accent colours and a dark gradient (one teal accent only), text of 8 to 11 px (our minimum was 12 sp, now 10 sp, see Type), grey and green text under 4.5:1 contrast, touch targets under 44 dp, amounts that would not all be masked in privacy mode, shadows (we use borders), and new names ("Clients & Invoices", "Available Liquid Cash") for things the web already names.
- It shows features the app does not have: editing budget limits, receiving a payment, recording a repayment, lending more, logging a service, a send-reminder action, an in-app keypad and a reset-filters setting. It has no dark mode and no empty, offline, unsent or update states.

## Decisions

- **The phone leads for now.** ADR 0045's rule that the web is the reference is suspended for this redesign. The web follows in a later piece of work with its own plan (and an ADR 0047 if it needs one), reusing the same tokens, which live in `packages/ui/src/tokens.css` and are generated into the Android palette. Until then the web and the phone may differ.
- **Same app, calmer.** Same words for the same things (In hand, Owed to you, Lent out, Clients, Loans), same data, same behaviour. Nothing is added to the API, the outbox or the mirror by the redesign. Phone writes the concept shows are separate follow-up pieces (below).
- **One accent.** Teal from one seed stays the only accent. Charts use a ramp of tints of it plus a neutral for "other"; every segment also carries its name and percentage, so colour is never the only cue. The hero card is a solid deep tint of the accent, not a gradient. Red stays for overspending, errors and Delete. The existing `warning` token marks "almost at the limit".
- **Type.** Inter stays. **Amended 2026-10-25 at the owner's request** (smaller type on the phone, then a lower floor): nothing is smaller than 10 sp, set by one constant (`TEXT_FLOOR_SP`) that a test checks against the theme's styles and every size written in the code. Top bar title 19 sp; small text, card labels and section labels 10 sp (labels weight 600); body, titles and row amounts 14 sp, secondary text 12 sp (amounts weight 600, tabular); the page title 27 sp, amounts 31 sp and the hero amount 35 sp. The bottom bar labels are 10 sp and may shrink further only for a larger phone text setting, to no less than 10 dp of height. The first accepted sizes were a 12 sp floor, 20 sp titles, body 16 and 14 and a 36 sp hero.
- **Few words.** A row has a title and at most one short hint, a line (60 characters or fewer on More and Settings, checked by a test), never a paragraph; a hint says what the row does in plain words and is left out where the title is enough. Page subtitles, eyebrows and "This phone" style repeats are not used. This holds for every screen, on the phone now and on the web later (the owner's rule while reviewing Settings).
- **Shape and surface.** Cards 16 dp, the hero 20 dp, sheets 24 dp at the top, fields and buttons 12 dp. Borders, never shadows. A group of rows is one card with hairline dividers; rows are at least 56 dp tall; every touch target is at least 48 dp (the Android rule, above 44).
- **Contrast is tested.** A unit test computes the contrast of every text and background pair of the light and dark palettes and fails under 4.5:1 (3:1 for large text and icons). Muted text uses the `muted` token, never a lighter grey.
- **Dark mode is designed here**, from the existing dark palette: a dark surface, the hero as a darker accent tint with light text, the same ramp lifted for dark. It is reviewed in the same screenshots as light.
- **Navigation.** Five tabs and Add at the bottom right, as now. Add is hidden on More and the screens opened from it (Clients, Loans, Categories, Settings). A fixed top bar replaces the scrolling page header: the title, a back arrow where there is one, at most one action. Sub-screens drop the eyebrow and repeated headers.
- **Privacy.** Every amount, including those in badges, buttons and sentences, goes through `money()`. Proportion bars show shares and stay visible in privacy mode (they show no amounts); this is checked with the owner on the phone.

### New shared pieces (`apps/android/.../ui/design`, later `packages/ui`)

Top bar; segmented control (two to four options); grouped list card (leading avatar, title, subtitle, trailing value); avatar with initials from the name (no emoji, no stored icon needed); proportion bar (accent, `warning` near the limit, red over it); filter chip; section label; empty state (a sentence and at most one action); bottom sheet (handle, title, Cancel, content, one primary button); and the existing `SearchField`, `narrowingRoom`, `MonthSwitcher`, `RetryNote` and buttons restyled. `PageHeader`, `ListCard`, `NavCard`, `StatCard` and `ShareBar` are replaced screen by screen and deleted when unused.

### Screens

- **Home.** Top bar: month, sync state (Synced, Not sent yet with a count, Offline) and the Hide amounts switch. Banners (update notice, unsent attention, pending note) in one slot above the hero. The In hand hero holds two small figures under it, Owed to you and You owe, and no explanatory text. Owed to you is money clients owe plus money lent to people, one figure although the two come from Clients and Loans (the owner's decision while reviewing Home); a figure of nothing is left out, and only a warning about a missing exchange rate can show as text. One month card: a single In and Out bar with the Net figure, opening Insights. Accounts in two cards, Cash and banking and Cards and loans, grouped by the account's real type; a currency segmented control only when there are two or more currencies; Overdrawn kept.
- **Transactions.** A search field with a Filters button beside it (with a count) that opens the account, category, tag, date and status filters in a sheet with Cancel and Apply, and kind chips (All, Expenses, Income, Transfers) under them; income and a day that came out ahead carry a plus sign. Day cards with the day's net in the header. The two legs of a transfer show as one row "From → To" when both are present. Same-day payees are not merged. Pending and Not sent yet stay as small markers.
- **More and Settings.** Grouped rows with a live figure where it is known online (the total owed on Clients, the total lent on Loans, category counts), nothing when offline. Settings in grouped sections: Appearance (Light, Dark, System as a segmented control), Privacy and input, Sync, Account (Lock now; Sign out in red), Updates and About. Every control that exists today stays.
- **Budgets.** The month switcher on a line under the title (as in the concept; beside the title it squeezed it at the largest text), a Left this month hero with a bar, how much is used and the days left, one list sorted overspent first and then by spending, each row with what is left or the overspend and how much is used, what was spent of the budget and a bar; with no budget set at all, a No monthly target yet card and each row's share of the month's spending; carried over stays; Spent without a budget stays; a budgeted category with no spending stays visible; only categories with nothing planned and nothing spent fold into one line. Read-only.
- **Insights.** Month switcher, one summary card (spent, money in, net, share kept), one category card with a proportion bar and expandable parents, the 12-month chart and its figures only when two or more months have activity (months without activity are left out of the figures), and net worth drawn honestly: a negative value hangs below the baseline in the neutral colour, never a tall green bar.
- **Clients and Loans.** Clients: a total-owed card, search and Open, Settled, All chips in one row (not a dropdown), one list sorted by amount owed. A client: balance card, the unpaid services pinned and marked Overdue, then Paid and History as a segmented control; paid services show the service amount and Paid in full; history lines lose "service version" and are not merged. Loans: one summary card (Lent out, You owe), one people list, search only when there are eight or more people in total (never because the list is narrowed), and a person's balance shown once, with "Before Ledgerline" as the opening line of the history. Both stay read-only.
- **Categories.** Top bar with Add category; Expense and Income segmented with counts; one accordion card (tap a group to expand). One edit button per group and a tap on a subcategory open a sheet with the existing actions (edit, add subcategory, archive, unarchive, delete in red). Adding is a sheet, not a page.
- **Entry editor.** Stays a full screen with the system keyboard and today's cents-first typing (the in-app keypad is not part of this). Type segmented control, a large amount with the currency, a grouped card for Payee, Account, Category, Date and time, Tags, Notes and Pending, one Save button pinned at the bottom. Transfers show From and To cards with a swap button.
- **Sign-in, address and lock.** Same tokens and top bar, one primary button each.
- **States.** Loading, empty, offline and error use the shared empty state and the restyled retry note.

### Amendment, 2026-10-25: Clients and Loans follow the concept more closely (the owner's rulings)

- **History is batched, as the concept does.** On a client, consecutive history lines of the same kind written in the same minute become one line: "3 Payments received" with what each was ("$144 + $72 + $72") and the total, or "3 Services logged" with the dates they cover. A single line keeps its own words and, where history has it, the balance after it. This replaces "history lines are not merged"; "service version" is still dropped.
- **Overdue** is shown on a service whose due date has passed, and on a client row only when the list carries a due date and it has passed. The client list does not carry one yet (only the oldest unpaid date), so the badge shows on the client's own screen first and on the list when the server sends the oldest due date (its own small change).
- **"Paid in Oct"** (money received from the client this month, on the client's screen) is not built on the phone: the API has no such figure. It is planned for the web redesign, then the phone follows.
- The two screens are built as close to the concept as the app's rules allow: its components, in the app's one design language, with writes (Settle, Receive, Mark Paid, Send Reminder, + Service, Lend, Record Repayment) left to their own follow-ups.

### Amendment, 2026-10-25: Loans (the owner's choices)

- The people list has Active, Archived and All chips, shown only while there is an archived person, and search only with eight or more people in total (the chips and the search work on the phone, over every page, like Clients). A row has the name, one hint (Owes you, You owe, Settled) and the amount.
- A person's screen has a balance card and a History list: the latest eight moves on their loan accounts (Sent or Received, from the phone's own entries, so they also show offline), then the balance from before Ledgerline as the last line. This adds the web's "latest moves" to the phone, still read-only.
- Lend / Borrow, Record Repayment and Lend More stay follow-ups.

### Amendment, 2026-10-27: Categories (the owner's choices)

- A fixed header (top bar with a plus button for Add category, Expense and Income with their counts of main categories, the search box) sits above one accordion card, so the search cannot move while typing. The Active, Archived and All chips show only while something of that kind is archived; with no chips the list is whole again.
- A group row has a tile, the name, one hint (how many subcategories, or Archived), an actions button and a chevron; a tap opens and closes it, a search opens the groups it found things in, and a text button above the card says Expand all or Collapse all (left out while searching). A new subcategory opens its group. A subcategory row is its name (and Archived); a tap opens its actions.
- Actions are a sheet: Edit, Add subcategory (a main category that is not archived), Archive or Unarchive, Delete in red. Add and Edit are one form sheet (the kind is a choice only for a new category); the archive and delete questions stay dialogs. Notices are short ("Category archived.").
- Where it differs from the concept: no "+ Sub" button on the row (it left the name a few letters wide at 320 dp; Add subcategory is in the sheet), a plus icon instead of the words "Add Category" (the title wrapped at the largest text), no "Tap group to expand" line and no "Edit ›" on each row (few words), no emoji (the phone has no category icon yet), search above the segments' row instead of beside them (320 dp).

### Amendment, 2026-10-28: the Entry editor (the owner's choices)

- The editor follows the owner's prototype: Cancel, the title and a red trash icon (for an entry that exists, asking first) in the top bar; the type pill (Expense, Income, Transfer, for a new entry only); the amount large and borderless with its currency code above it (the system keyboard and cents-first typing stay; the in-app keypad is not part of this); one card for Payee, Account, Category and When; one card for Tags, Note and Pending; one Save button pinned at the bottom. A transfer shows From and To with a swap button and leaves out Payee, Category, Tags and Pending.
- **Pending is added**, as an optional switch for an expense or income, off by default so an entry is saved as cleared, like the web. An edit sends the status only when it changed. A transfer has no status.
- Account, To, Category and tags open one picker sheet: 56 dp rows with a check on the chosen one, a search box only from eight choices (the sheet then keeps one height, 65% of the screen, so a shorter result never shrinks it and moves the box), and, for categories, "New category" pinned under the list (it opens the name box in the same sheet; making a category chooses it and closes the sheet). Tags show as chips (a tap removes one) with "+ Tag". The date and time pickers stay dialogs; the time is a pill with a cross, or "+ Add time". The editor's old dropdowns, category autocomplete, inline new-category box and tag box are gone; the autocomplete box stays for the Filters sheet.
- A segmented control with three or more options stacks its options in a column at a large text size, so a word never breaks in the middle.
- Left out against the prototype: the "Transaction Amount" label (few words) and the date picker's own button text. Sign-in, address and lock follow in their own pull request.

### Amendment, 2026-10-28: sign-in, address, lock and the update screen (the owner's choices)

- None of these has a concept screen, so they follow the app's design language: a top bar (a back arrow only where there is somewhere to go back to), fields as rows in one card, one primary button, one short hint line, a problem in words, and a link for the quiet choice. The long explanations became one sentence each; the two rare sign-out notices keep what to do next ("Remove this phone under Settings, Signed-in devices").
- **Sign-in:** Email and Password rows (Show or Hide beside the password) and one Sign in button; the server is one row ("Server", the address without https://) that opens the address screen. The code step has a back arrow, one code row, one hint, one Verify button, and "Use a backup code" as a link, not a switch.
- **Address:** the label above a full-width box (a long address would be cut off beside a label), one hint, one Continue button; a back arrow only when an address is already saved.
- **Lock and the offer to stay signed in:** a top bar, one line, one primary button and a link; the offer offers the fingerprint or screen lock only when the phone has one.
- **Update screen:** a top bar with a back arrow, an Installed row, and the same states as before. The eyebrow and subtitle are gone.
- **Retired:** `PageHeader`, `BackLink`, `SearchField` and `ChoiceField`. Settings' "Keep my filters" unit is a three-option segmented control (Minutes, Hours, Days); the Categories form's Parent is a row that opens the shared picker. The picker sheet, the pick row and the input row moved to the shared design package.

## Not changing

The API, the mirror, the outbox, sync, privacy mode through `money()`, FLAG_SECURE, integer minor-unit money, each screen's content as a function of plain data, the search-stays-put rule (`narrowingRoom` and a `SearchStaysPut` test on every list screen with a search or filter), the colour source (`tokens.css`), light, dark and system themes, and the existing tests (kept green, or changed on purpose and said so in the pull request).

## Follow-ups, each its own plan and pull request

Edit a budget limit (done 2026-10-25: Set limit on Budgets, with Remove limit; Auto-Set Limits from the concept is not decided); receive a payment (amount, account, date and tip, with a confirmation, not one tap); record a repayment; lend more; log a service; mark a service paid; the in-app keypad; the send-reminder action; reset filters on app close. Each needs the outbox or an online write, idempotency and tests, and gets its own approval. The web redesign follows the phone.

## Order of pull requests (small, each checked on the owner's phone)

1. This ADR, the CLAUDE.md design rules and the PROGRESS record (documentation only).
2. Foundation: tokens (deep accent, chart ramp, 12 sp floor, shapes), the contrast test and the shared pieces, shown in a screenshot gallery; screens change only where the floor needs it.
3. Home. 4. Transactions with the Filters sheet. 5. More and Settings. 6. Budgets. 7. Insights. 8. Clients and Loans. 9. Categories. 10. Entry editor, sign-in, address and lock.
11. A release (`android-v0.2.0`) when the owner is happy, then the web plan.

## Checks

Each pull request: tests that fail before the change; a deliberate-mutation check on each new rule (the floor, the contrast test, hiding Add, the eight-people search rule, the transfer row, folding empty budgets); screenshots at 320 and 390 dp, light and dark, and with the largest text; sheets and menus, which the screenshot tool cannot capture, checked on the phone; then the owner's phone check.
