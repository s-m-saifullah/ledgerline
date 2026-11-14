# Ledgerline style guide (web)

How the web app looks and how to build it so it stays one app. Read it before you write any web UI, and **update it in the same pull request as any UI change the owner has approved** (a new shared piece, a retired class, a changed rule, a new entry in the change log at the bottom). The phone app has its own twin in `apps/android/.../ui/design`; the rules of ADR 0046 and ADR 0047 are the source, this file is the working summary.

## Before you build

1. Look here and in the gallery (`/gallery.html` while `pnpm dev` runs) for a piece that already does it. Reuse it.
2. If nothing fits, extend the shared piece (in `packages/ui` or `apps/web/src/components`), do not copy its CSS into a feature file. The four search boxes and the ten page-title rules that had to be merged later were all copies.
3. A new class in a feature stylesheet is for that screen's own layout only (prefix it with the feature's short name, like `tg-` for tags). Colours, radii, type sizes and shadows are never new decisions: use the tokens below.
4. Two tests guard this: `apps/web/src/css-contract.test.ts` (layout widths, type scale, shapes, no shadows) and `apps/web/src/css-hygiene.test.ts` (no class that nothing uses, no token that is undefined or unused). If a class is built at run time (`` `ui-pill-${tone}` ``), add its start and the names it can make to `runtimeNames` in the hygiene test.
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
- `layout.css`: `ui-page` (page frame, 1160 px), `ui-stack` (vertical rhythm), `ui-cols` with `ui-cols-2` or `ui-cols-21` (columns: one on a phone, two from 700, lopsided from 1100; every column starts on one line), `ui-split` (a list beside what it opens, from 1100). Add a new layout class there, with the same two widths.
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
| Nothing here yet | `EmptyState` |
| Buttons | `ui-btn` plus one of `ui-btn-primary` (the one filled action of a screen), `ui-btn-secondary` (bordered), `ui-btn-text` (light actions), `ui-btn-danger`, `ui-btn-danger-filled`; `ui-icon-btn` for an icon-only control with an `aria-label` |

From `apps/web/src/components`:

| Need | Use |
| --- | --- |
| A sheet, drawer or dialog | `Overlay` (a bottom sheet under 700 px, a right-hand drawer from 700, a centred dialog for `kind="question"`); give it a title, a pinned `footer` button and `returnFocusId` |
| A question before something that cannot be undone | `Question` (Cancel beside one confirming button), `TypedConfirm` when the person must type a name |
| A confirmation that goes away | `Toast` (a progress bar; `durationMs` null while an action runs or failed so Retry is never lost); `UndoPill` for Undo |
| Collapsible detail | `Fold` |
| A search box | `SearchField` (icon, tinted field, hidden label, the same words as its placeholder; beside a button, put it in a form with a `ui-btn`, as Transactions does with Filters). Keep a placeholder short enough for 320 px beside the button. Its tint is 3%, not the 5% `--tint`, so the outline stays 3:1 against its fill (`a11y.spec.ts` measures it) |
| Choosing from a short list | `PickRow` (opens a sheet); `NativeSelect` for a plain select; `ComboField` for a list that can create |
| Typing money | `EntryAmount`, `AmountInput`; parse with the helpers in `amount-entry.ts` (a leading dot and a trailing dot are valid) |
| Showing money | `Amount` (privacy mode), `BaseNote` ("About $12.00" under a foreign amount); `formatMoney` in `lib/money.ts` |
| Dates and times | `DateTimeInput`; `lib/time.ts` for formatting |
| A month | `MonthHead`, `MonthControl` |
| A failed load | `LoadError` (message and a Retry button) |
| A delete control in an editor | `DeleteTrigger` (a trash icon on a phone) |
| The top bar | `TopBar` (a page's title shows there on a phone) |

## Words

Few words (ADR 0046): a row has a title and at most one short hint, never a paragraph; no page subtitles, eyebrows or repeated labels. Generic copy: nothing about a personal situation. Sentence case. A destructive action says Delete.

## Do not copy (legacy, being replaced)

These still exist in `apps/web/src/styles.css` and in older screens. Do not use them in new work; use the piece in the second column. When the last use goes, delete the class and strike it here.

| Legacy | Use instead |
| --- | --- |
| `.main-content` and a bare `.page-heading` | the page frame in `layout.css`; the title is a plain `h1` (27 px from one global rule: never set an `h1` size in a feature) |
| `.eyebrow`, a page subtitle | nothing (few words) |
| `.combobox`, `.date-time-picker` and friends (old-style overlays) | `Overlay` and `PickRow` where possible |
| A pixel radius, a shadow, a hex colour, an off-scale font size | tokens above |

## Change log

Newest first; one line per approved UI change, with the pull request.

- 2026-11-13: dead styles and the old `Amount` component removed; the guard `css-hygiene.test.ts` added (#284).
- 2026-11-13: every width query in `styles.css` is a container query at 700 or 1100 px (the frame's 1000 px step moved to 1100 px; the date picker's 400 px rule became a 6 px `clamp()` padding, which also stops it cutting "November" to "Novemb" at 401 px and wider), and the contract refuses any viewport `@media` width anywhere (#PR).
- 2026-11-13: the old button family (`button`, `secondary-button`, `text-button`, `icon-button`, `danger-action`) is gone in favour of `ui-btn` and `ui-icon-btn`, and the five search boxes are one `SearchField`; Transactions' search gets the icon and tinted fill, and its placeholder is "Payee or note" (#290).
- 2026-11-13: the bottom bar's labels are 12 px from a 380 px wide screen and 10 px below it, and its tabs have no side padding (ADR 0053; #288).
- 2026-11-13: the page is 14 px and every `h1` is 27 px from one rule (thirteen per-feature copies removed); the remaining off-scale sizes (13, 18, 20, 24, 26, 28, 32 px) moved onto the scale; form fields keep 16 px as `--field-text` (ADR 0052); the contract refuses off-scale sizes and `font:` shorthands in `styles.css` too (#288).
- 2026-11-13: no shadows and radii from the shape scale in `styles.css`; `--radius-input` removed; `styles.css` joins the contract for shadows and shapes (#286).
