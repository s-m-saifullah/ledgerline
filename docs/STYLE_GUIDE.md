# Ledgerline style guide (web)

How the web app looks and how to build it so it stays one app. Read it before you write any web UI, and **update it in the same pull request as any UI change the owner has approved** (a new shared piece, a retired class, a changed rule, a new entry in the change log at the bottom). The phone app has its own twin in `apps/android/.../ui/design`; the rules of ADR 0046 and ADR 0047 are the source, this file is the working summary.

## Before you build

1. Look here and in the gallery (`/gallery.html` while `pnpm dev` runs) for a piece that already does it. Reuse it.
2. If nothing fits, extend the shared piece (in `packages/ui` or `apps/web/src/components`), do not copy its CSS into a feature file. The four search boxes and the ten page-title rules that had to be merged later were all copies.
3. A new class in a feature stylesheet is for that screen's own layout only (prefix it with the feature's short name, like `tg-` for tags). Colours, radii, type sizes and shadows are never new decisions: use the tokens below.
4. Four tests guard this: `apps/web/src/css-contract.test.ts` (layout widths, type scale, shapes, no shadows), `apps/web/src/css-hygiene.test.ts` (no class that nothing uses, no token that is undefined or unused) and `apps/web/src/overlay-contract.test.ts` (only `Overlay` and the command palette import the Radix dialog: every sheet, drawer, picker and question is an `Overlay`) and `apps/web/src/toast-states-contract.test.ts` (every toast is the shared `Toast`, every loading line the shared `Loading`, and so on; see Shared pieces). If a class is built at run time (`` `ui-pill-${tone}` ``), add its start and the names it can make to `runtimeNames` in the hygiene test.
5. Look at the screen at 320, 390 and desktop, in light and dark, before asking for the owner's browser check.

## Foundations

**Colour.** Only the custom properties in `packages/ui/src/tokens.css`: `--background`, `--surface`, `--border`, `--field-border` (input outlines, 3:1), `--text`, `--muted`, `--accent` (one seed, teal, every shade derived), `--accent-soft`, `--accent-foreground`, `--accent-deep` (hero fill), `--danger`, `--positive`, `--warning`, `--chart-1` to `--chart-5`, `--scrim`. No hex or `rgb()` in a component or feature stylesheet. Red (`--danger`) is only for overspending, errors and Delete.

**Shapes** (`pieces.css`): `--shape-field` 12 (inputs, selects, buttons, tiles, search boxes), `--shape-card` 16 (cards, toasts, floating notices), `--shape-hero` 20 (hero cards), `--shape-sheet` 24 (sheets and dialogs). Pills and chips are `999px`, dots `50%`; inside a rounded group use `calc(var(--shape-field) - 3px)`. No other number.

**Type scale** (px): 10 (floor), 12 (hints, labels), 14 (the page, body, rows, buttons), 19 (card and sheet titles, `h2`), 27 (page titles, `h1`), 31 (amounts), 35 (hero figure). The page itself is 14 px, so unstyled text is 14. The text inside a form field is `var(--field-text)` (16 px, so iOS does not zoom; ADR 0052): that is the only other size, and only for fields. Never write a `font:` shorthand with a size. The bottom bar's labels are 10 px, and 12 px from a 380 px wide screen (ADR 0053): the only width other than 700 and 1100, allowed for that type step and nothing else. Amounts use tabular figures.

**Borders, never shadows.** Depth comes from a 1 px `--border` and the scrim behind an overlay.

**Spacing** is on a 4 px grid. A label sits at least 8 px above its field, a field 16 px above the next, related buttons 12 px apart, the sections of a card 24 px apart (the focus ring reaches 4 px beyond a control). `tests/e2e/spacing.spec.ts` checks the main forms.

**Touch and keyboard.** Controls are at least 44 px to touch (a chip or segment may draw smaller and reach 44 px with `::after`). Everything works from the keyboard; the focus ring is the global `:focus-visible` outline. Motion respects `prefers-reduced-motion`.

**Privacy mode.** Every amount goes through the shared `Amount` (`components/amount-text.tsx`) so digits are removed from the page, not just blurred. Hand-masking is allowed only where the component cannot be used (`"••••"`).

**Light, dark, system.** Never branch on the theme in a component; use the tokens, which switch.

## Layout

- Layout switches by **container width** at 700 px and 1100 px, in CSS (`@container app (...)`), never by another number, never with a viewport `@media` width (the contract refuses it; `prefers-*` media are fine) and never with script that renders different controls. A phone rule is `@container app (max-width: 699.98px)`. A phone differs from a desktop in layout, not in which controls exist.
- `layout.css`: `ui-page` (the page frame: every page's `main` is one, up to 1180 px wide, padding 28/20 on a phone, 32 from 700 px and 48 from 1100 px; a page is ONE root element inside it, because the frame is a grid and a second root is spaced by its gap; the prototype's own numbers are 16/16/84, 8/32/48, 8/40/56 and 1160 px, kept for a later decision), `ui-stack` (vertical rhythm), `ui-cols` with `ui-cols-2` or `ui-cols-21` (columns: one on a phone, two from 700, lopsided from 1100; every column starts on one line), `ui-split` (a list beside what it opens, from 1100). Add a new layout class there, with the same two widths.
- Lists of simple rows are 760 px wide at most.
- Navigation: Home, Transactions, Budgets, Insights, More; on a phone one Add button bottom right (`ui-fab`) that follows the screen. `nav.ts` in `features/shell` is the one list of destinations.

## Shared pieces

From `@ledgerline/ui` (`packages/ui/src/pieces.tsx`, classes start with `ui-`):

| Need | Use |
| --- | --- |
| A grouped card of rows | `ListCard`, with `ListRow` (title, at most one short hint, trailing value, chevron when it opens something); `ListHead` for a row group's header; `SectionLabel` above a group |
| A toggle row | `SwitchRow` |
| A big number card | `Hero`, `HeroFigure`; `ui-figure` for a 31 px amount |
| Status | `StatusPill` (tones accent, danger, warning, neutral); `ProportionBar` for a limit (within, near, over) |
| Filters and modes | `FilterChip`, `SegmentedControl` |
| Leading marks | `Avatar` (initials), `IconTile` (an icon in a 36 px tile) |
| Nothing to show | `EmptyState` ("No X yet." when there is none, "No matching X." when a search or filter finds none; inside a `ui-card` unless the list is a card already) |
| Buttons | `ui-btn` plus one of `ui-btn-primary` (the one filled action of a screen), `ui-btn-secondary` (bordered), `ui-btn-text` (light actions), `ui-btn-danger`, `ui-btn-danger-filled`; `ui-icon-btn` for an icon-only control with an `aria-label` |

From `apps/web/src/components`:

| Need | Use |
| --- | --- |
| A sheet, drawer or dialog | `Overlay` (a bottom sheet under 700 px, a right-hand drawer from 700, a centred dialog for `kind="question"`); give it a title, a pinned `footer` button (secondary buttons may sit beside the one primary) and `returnFocusId`. A drawer is as tall as the screen and its footer stays at the bottom however short the form. One opened from inside another (a question or a picker over an editor) opens one level above it, its dark layer over the sheet beneath, so that sheet is dimmed, and takes its own Escape. Never set a `z-index` on an overlay yourself |
| A question before something that cannot be undone | `Question` (Cancel beside one confirming button), `TypedConfirm` when the person must type a name |
| A confirmation that goes away | `Toast`: two lengths only, `toastDuration(withUndo)` (4 s, or 6 s with an Undo); `durationMs` null while an action runs or failed so Retry is never lost; its own Dismiss control from `onDismiss` (a cross on a phone, the word from 700 px, one button named Dismiss); a notice that must be resumed ("A client action needs confirmation.") has no length and no Dismiss. The Undo button says just Undo. `UndoPill` is the Undo that stays after the toast |
| Collapsible detail | `Fold` |
| A search box | `SearchField` (icon, tinted field, hidden label, the same words as its placeholder; beside a button, put it in a form with a `ui-btn`, as Transactions does with Filters). Keep a placeholder short enough for 320 px beside the button. Its tint is 3%, not the 5% `--tint`, so the outline stays 3:1 against its fill (`a11y.spec.ts` measures it) |
| Choosing from a short list | `PickRow` (opens a sheet); `NativeSelect` for a plain select; `ComboField` for a list that can create |
| Typing money | `EntryAmount`, `AmountInput`; parse with the helpers in `amount-entry.ts` (a leading dot and a trailing dot are valid) |
| Showing money | `Amount` (privacy mode), `BaseNote` ("About $12.00" under a foreign amount); `formatMoney` in `lib/money.ts` |
| Dates and times | `DateTimeInput` (its calendar and clock open as an `Overlay` sheet: Cancel in the head, Today or Set time as the one primary in the footer, Clear and Now secondary beside it); `lib/time.ts` for formatting |
| A month | `MonthHead`, `MonthControl` |
| A screen or part that is loading | `Loading what="tags"` ("Loading tags…", a polite status; a skeleton may follow as its children). Never "Opening your…", never a bare paragraph |
| A failed load | `LoadError` (message and a Retry button) on every screen, Home, Transactions and Budgets included |
| What a viewer sees instead of Add and Edit | `ReadOnlyNote` ("You have read-only access to this ledger.", the one sentence everywhere) |
| A delete control in an editor | `DeleteTrigger` (a trash icon on a phone) |
| The top bar | `TopBar` (a page's title shows there on a phone) |

## Words

Few words (ADR 0046): a row has a title and at most one short hint, never a paragraph; no page subtitles, eyebrows or repeated labels. Generic copy: nothing about a personal situation. Sentence case. A destructive action says Delete. A sentence (a toast, an empty list, an error) ends with a full stop; a hint or a label does not. "Client" is lower case inside a sentence.

## Do not copy (legacy, being replaced)

These still exist in `apps/web/src/styles.css` and in older screens. Do not use them in new work; use the piece in the second column. When the last use goes, delete the class and strike it here.

| Legacy | Use instead |
| --- | --- |
| a bare `.page-heading` (Loans, Clients and Settings still use it) | a plain `h1` inside the page (27 px from one global rule: never set an `h1` size in a feature) |
| `.eyebrow`, a page subtitle | nothing (few words) |
| `.combobox` and friends (the old category list) | `Overlay` and `PickRow` where possible |
| A pixel radius, a shadow, a hex colour, an off-scale font size | tokens above |

## Change log

Newest first; one line per approved UI change, with the pull request.

- 2026-11-14: an overlay opened from another dims it (#299). Every overlay used to sit on the same two layers, so a delete question or the date picker opened from a sheet put its dark layer under that sheet: the sheet looked as bright as before and the question blended into it. Each overlay now opens one level above the ones already open, and the copy that slides away keeps its layer. The date picker had this since #296.

- 2026-11-14: toasts and states are one piece each (WP-11a). Every toast is the shared `Toast` (the three hand-written copies in Clients, Transactions and Categories are gone) with its own Dismiss control (a cross on a phone, the word from 700 px) and two lengths, 4 s and 6 s with an Undo; the Undo says just Undo and "client" is lower case. Loading is the shared `Loading` (about 25 paragraphs saying Loading or Opening your), Home, Transactions and Budgets use `LoadError`, the Transactions and Budgets empty lists use `EmptyState`, empty wording is "No X yet." or "No matching X.", and the read-only sentence is one `ReadOnlyNote`. `toast-states-contract.test.ts` keeps all of it from drifting back (#298).

- 2026-11-14: the date and time picker is an `Overlay` sheet (a bottom sheet on a phone, a drawer from 700 px) instead of its own centred dialog: Cancel replaces the X, Today and Set time are the footer's one primary with Clear and Now beside them as secondary buttons, the 19 px title and the shared dark overlay come with it, and its own classes are gone. A drawer's footer now stays at the bottom when the form is short, and an overlay opened from inside another handles its own Escape. On a phone the calendar keeps its 6 px inset so a day stays 44 px wide at 320 px. The prototype has no custom picker (it uses native inputs), so the shared overlay is the design (#296).

- 2026-11-13: dead styles and the old `Amount` component removed; the guard `css-hygiene.test.ts` added (#284).
- 2026-11-13: the page frame is `ui-page` (the shell's `main`), with the numbers the app always used, and the old `.main-content` is gone; the 404 page has one root (#294).
- 2026-11-13: every width query in `styles.css` is a container query at 700 or 1100 px (the frame's 1000 px step moved to 1100 px; the date picker's 400 px rule became a 6 px `clamp()` padding, which also stops it cutting "November" to "Novemb" at 401 px and wider), and the contract refuses any viewport `@media` width anywhere (#292).
- 2026-11-13: the old button family (`button`, `secondary-button`, `text-button`, `icon-button`, `danger-action`) is gone in favour of `ui-btn` and `ui-icon-btn`, and the five search boxes are one `SearchField`; Transactions' search gets the icon and tinted fill, and its placeholder is "Payee or note" (#290).
- 2026-11-13: the bottom bar's labels are 12 px from a 380 px wide screen and 10 px below it, and its tabs have no side padding (ADR 0053; #288).
- 2026-11-13: the page is 14 px and every `h1` is 27 px from one rule (thirteen per-feature copies removed); the remaining off-scale sizes (13, 18, 20, 24, 26, 28, 32 px) moved onto the scale; form fields keep 16 px as `--field-text` (ADR 0052); the contract refuses off-scale sizes and `font:` shorthands in `styles.css` too (#288).
- 2026-11-13: no shadows and radii from the shape scale in `styles.css`; `--radius-input` removed; `styles.css` joins the contract for shadows and shapes (#286).
