# API version notes

## 0.1.23 — Rate preview for entries

New `GET /ledgers/{ledgerId}/exchange-rates/lookup?code=&date=` returns the rate an entry in a currency on a date would be saved with: the newest stored rate on or before the date (`rateDate` says which day it came from), exactly 1 for the base currency (`source: "base"`), or `rate: null` when none exists yet. It uses the same lookup as saving and fails nowhere; it lets screens show the base-currency value before an entry is saved. Read-only and ledger-scoped; nothing else changes.

## 0.1.22 — Accounts and entries in other currencies

Accounts, entries and transfers can now use any currency the ledger has added; USD stays the base currency. Request and response changes:

- `POST /accounts`: the opening balance's currency is the account's currency. It must be USD or a currency added under Currencies (otherwise 409). An account's currency cannot change.
- Entries (`POST` and `PATCH /transactions`): `amount` must be in the account's currency (409 otherwise). The new optional `fxRate` sets the rate by hand: exact decimal text, the base-currency value of one unit of the entry's currency. Without it the newest stored rate on or before the entry's date is used, and with none the request returns 409 asking for a rate. USD entries always have rate 1. The response `fxRate` is now exact decimal text (it was the number 1), `baseAmount` is the frozen USD value, and split lines are in the entry's currency. An edit keeps the saved rate unless `fxRate` is set or the currency changes.
- Transfers: `amount` is what leaves the sending account. `receivedAmount` (the receiving account's currency) is required when the currencies differ. `fxRate` is only accepted when neither account uses USD. Responses gain `receivedAmount` and `baseAmount`. Whichever account uses USD fixes the transfer's value; otherwise the sent currency's rate does, and the two legs always net to zero in USD.
- Home: `accounts[].balance` is in the account's own currency and `baseBalance` is its USD value at the newest stored rate (null when there is none). `inHand`, `netWorth` and `liabilitiesOwed` are USD totals that leave out currencies with no rate, listed in the new `unconvertedCurrencies`.
- Payments from money owed can only be received into USD accounts for now (409 otherwise).

Migration 0014 drops the USD-only checks, ties each entry's currency to its account's currency, and updates the transfer-pair rule to opposite base amounts (and opposite amounts within one currency). The restore drill's transfer check uses the same rule.

## 0.1.21 — Totals use each entry's frozen base-currency amount

No request or response shape changes. Home money in and money out, category totals and budget spending now add up each entry's saved `baseAmount` (and, for split entries, each line's share of it) instead of its raw `amount`, so totals stay correct once entries in several currencies exist. While every entry is USD at rate 1 the results are identical to before. Split lines now store their own base amount, shared across the lines so they add up exactly to the parent's `baseAmount` (largest remainder); the database rejects a split whose base amounts do not add up. Migration 0013 converts `fx_rate` to an exact decimal (existing rows stay 1) and backfills each split line's base amount from its amount. Account balances still use the entry `amount` in the account's own currency.

## 0.1.20 — Currencies and exchange rates

New `Currencies` endpoints, all additive; nothing existing changes and entry is still USD-only. `GET /ledgers/{ledgerId}/currencies` lists the currencies a ledger has added besides its base currency, each with its newest stored rate. `POST /ledgers/{ledgerId}/currencies` adds one and `DELETE /ledgers/{ledgerId}/currencies/{currencyId}` removes it (requires `expectedVersion`; stored rates are kept). `GET /ledgers/{ledgerId}/exchange-rates?code=` lists stored rates newest first. `PUT /ledgers/{ledgerId}/exchange-rates` sets a rate by hand (201 to create, 200 with `expectedVersion` to edit) and marks it manual. `DELETE /ledgers/{ledgerId}/exchange-rates/{rateId}` removes a stored rate. `POST /ledgers/{ledgerId}/exchange-rates/refresh` fetches the newest rate for each added currency (or one) from the public rate source with a fallback source; currencies that could not be fetched come back in `failed`, and manual rates are kept (`keptManual`).

A rate is exact decimal text (up to 10 digits after the point): the base-currency value of one unit of the currency. Only currency codes and a date leave the server when fetching. Writes require a trusted Origin, owner/editor permission and `Idempotency-Key`. Migration 0012 adds the `currencies` and `exchange_rates` tables.

## 0.1.19 — Monthly budgets

New `Budgets` endpoints, all additive; nothing existing changes. `GET /ledgers/{ledgerId}/budgets?month=YYYY-MM` returns one line per top-level expense category with its budget, the leftover carried in from earlier months, cleared spending this month (subcategories and split lines included) and the amount left, plus totals and spending in unbudgeted categories. `PUT /ledgers/{ledgerId}/budgets` creates a category's budget for a month (201) or, with `expectedVersion`, edits it (200). `POST /ledgers/{ledgerId}/budgets/copy` copies one month's budgets into another, skipping categories that already have one. `DELETE /ledgers/{ledgerId}/budgets/{budgetId}` removes a budget and requires `expectedVersion`.

Amounts are USD integer cents in the ledger's base currency. Rollover is computed from earlier months, never stored (ADR 0019): a month with rollover on carries in the previous month's leftover, overspending as a negative, only when the previous month has a budget. Writes require a trusted Origin, owner/editor permission and `Idempotency-Key`. Migration 0011 adds the `budgets` table.

## 0.1.18 — Default starter categories and optional add-ons

`POST /ledgers/{ledgerId}/categories/starter-set` accepts `starterSet: "basic" | "default" | "personal"`. `default` creates 37 neutral categories in two levels (18 groups) and replaces the earlier personal set; `personal` is now only the original name of `default` and behaves identically, so replayed requests keep working. `groups` lists the groups to create: the default group keys (`salary`, `business`, `investments`, `gifts-received`, `refunds`, `other-income`, `housing`, `food`, `transport`, `utilities`, `subscriptions`, `health`, `shopping`, `entertainment`, `education`, `family-gifts`, `fees-interest`, `other-expenses`) and the optional add-on keys (`student-income`, `gig-income`, `students`, `shared-household`, `gig-costs`, `support-abroad`). Omitting `groups` creates every default group and no add-on; add-ons are created only when named. The earlier personal group keys (`wages`, `university`, `rides`, `cashback`, `social`, `interest`, `family`, `personal`) are no longer accepted, and `groups` is still refused with `basic`. Still categories only, never accounts; the list must be empty; no migration. Clients preview the shared `defaultCategoryStarterSet` and `categoryStarterAddOns`.

## 0.1.17 — Home shows money in hand

`GET /ledgers/{ledgerId}/home` gains `inHand` (positive balances of active bank, cash, wallet and savings accounts) and `liabilitiesOwed` (negative card and loan balances, archived included, as a non-negative amount). `netWorth` is unchanged and still returned. `accounts`, `otherActive` and `archived` now describe bank, cash, wallet and savings accounts only: cards and loans no longer appear in them. See ADR 0016. No migration.

## 0.1.16 — Personal starter categories

`POST /ledgers/{ledgerId}/categories/starter-set` now accepts `{ "starterSet": "basic" | "personal", "groups"?: [...] }`. `personal` creates 38 categories in two levels (16 groups; income: Wages, University, Ride service, Cashback & rewards, Gifts received, Other income; expenses: Housing, Food, Gifts & social, Transport, Subscriptions & phone, Interest & fees, Family, University fees & supplies, Personal, Other expenses). `groups` (personal only, 1-16 unique keys, default all) limits which groups are created; children follow their group. The empty-category-list rule, atomic creation, idempotent replay and role guards are unchanged, and the `basic` set still works. Categories only: no starter ever creates accounts. No migration.

## 0.1.15 — Account unarchive

Add `POST /ledgers/{ledgerId}/accounts/{accountId}/unarchive` (owner/editor, trusted Origin, Idempotency-Key, strict `{ expectedVersion }`). It clears `archivedAt` and advances the version; identity, opening balance, computed balance and history are unchanged, and the account returns to active lists and new-entry pickers. An account that is not archived, or a stale version, returns 409; same-key retries replay the original response; absent, foreign and deleted accounts are indistinguishable 404s. No migration.

## 0.1.14 — Optional service time

Services gain an optional local `serviceTime` (`HH:mm`, nullable, no timezone conversion), like transaction and payment times (migration 0010: nullable `receivables.service_time` with a format check; existing services read back `null`). Create may omit it (kept out of the write fingerprint, so pre-upgrade retries replay); PATCH omitted keeps the saved time and `null` clears it. Service DTOs and history snapshots add `serviceTime` (default null for history written earlier). Oldest-first receipt allocation still orders by service date then ID, not time.

## 0.1.13 — Person-level receipts

Add `GET /contacts/{contactId}/receipt-preview?amount=` (read-only exact serial allocation over open services, oldest service date first then ID, with each service version, open total and over-balance/too-many flags), `POST /contacts/{contactId}/receipts` (one payment applied across services; sends back the previewed allocation and versions, 409 if anything changed, overpayment or more than 100 services), `GET|PATCH|DELETE /receipts/{receiptId}` and `POST /receipts/{receiptId}/restore`. Each touched service gets its own ordinary payment and cleared income entry, grouped by a new nullable `receiptId` (migration 0009); everything commits in one transaction under one idempotency receipt. PATCH corrects account, income category, date, time and note for every member, never amounts. Delete/restore/edit require every member's expected payment and service versions. Ordinary per-payment edit, delete and restore return 409 for receipt members. Payment DTOs add `receiptId` (default null).

## 0.1.12 — Home summary (Phase 1 step 12)

Add read-only `GET /ledgers/{ledgerId}/home?month=YYYY-MM` (any ledger member; non-members 404, anonymous 401, bad month 400). One repeatable-read snapshot returns signed USD net worth over every non-deleted account (archived included; pending entries and owed money excluded), up to eight itemized active accounts with "other active" and "archived" subtotals, cleared income and spending for the calendar month (transfers, split lines, pending and deleted rows excluded; linked service payments count as income), the open owed total and number of people owing, the pending count, up to five latest rows in Transactions-list order with each transfer shown once (outgoing leg plus destination account name), and setup flags. Totals beyond the safe integer range return a 409 problem instead of an inexact number. No migration and no write endpoints.

## 0.1.11 — Category merge (Phase 1 step 11)

Add ledger-scoped category `GET /categories/{categoryId}/merge-preview?destinationCategoryId=<UUID>` and `POST /categories/{categoryId}/merge`. Preview returns eligibility, blockers, affected/excluded counts, children, expected category versions and an actor-bound state fingerprint. Confirmation requires the strict destination/version/token body, trusted Origin and Idempotency-Key. Relevant financial or hierarchy changes invalidate the preview even when category versions are unchanged; same-key replay returns the committed response after current access checks.

Merge compatible root/root or child/child pairs into an active destination. Reparent all non-deleted children, including archived children, in stable appended order; case/whitespace child-name collisions block atomically. Preserve destination identity and archive the source. Deleted history and prior receipts/events stay unchanged. Source unarchive remains available but does not reverse a merge; there is no bulk Undo.

Only category references, versions and audit timestamps change. Split parents advance once and all live sibling lines share their resulting version/timestamp. Linked income/payment pairs advance together, with one parent version and immutable paymentEdited event per affected payment. ADR 0010 permits this narrow category-only maintenance on written-off services without reopening; ordinary edits still require reopening. Exact amounts, dates, balances, waivers and owed totals stay unchanged. No migration or deployment is included.

## 0.1.10 — Money owed to you (Phase 1 step 10a)

Add ledger-scoped contacts (list/create/detail/full PATCH/delete/archive/unarchive/history), receivables (list/create/detail/full PATCH/delete/restore/write-off/reopen), and nested payments (list/create/detail/full PATCH/delete/restore). Writes use strict shared schemas, session/owner/editor/Origin guards, required Idempotency-Key and expected versions. Inaccessible/foreign/deleted references return 404; stale versions and lifecycle conflicts return safe 409s.

Unpaid services create no transaction. Exact positive USD payments create one linked cleared unsplit income and atomically advance parent/version/history/receipt. Payments reject pending/status, splits and client linkage. Edit requires expectedVersion plus expectedReceivableVersion and replaces all editable payment fields on the same transaction. Paired delete returns replayable 204; Undo uses both supplied versions plus one and restores the same IDs after validating current parent/remainder/references/balances. A write-off waives only the current remainder without posting; reopen restores collectibility. Written-off services must reopen before service/payment changes. Derived status and computed balances are read-only.

Transaction DTOs add nullable receivablePaymentId and receivableId, defaulting null for historical receipts; public transaction create cannot set them. Ordinary transaction PATCH/delete/restore return 409 for linked rows including tombstones; use the payment endpoint. Archived original references stay correctable/restorable, while deleted references block Undo. Services category defaults/creation remain explicit client choices; the API always requires a valid income category ID.

Lists use UUID cursor/limit contracts and literal search; services support contact/state/inclusive service dates. Person totals cover all live open services independent of visible paging/filtering, including archives; history retains before/after snapshots and actor/version. Old fingerprints/receipts remain compatible. Migration 0008_neat_molten_man.sql adds four tables and deferred reciprocal/link/allocation checks (ADR 0009). Backup manifests verify twelve tables when present. Deploy API/web together; linked data requires forward recovery or the verified backup rather than an unsafe application rollback. No release/deployment is included. Home and payment-aware Category merge follow in steps 12 and 11.

## 0.1.9 — Category splits (Phase 1 step 10)

Transaction create optionally accepts 2–50 ordered splits with categoryId null. Each line has categoryId, signed USD amount and optional note; new lines omit IDs. Lines must match parent kind/ledger and total its amount exactly. Reads add isSplit and ordered splits (IDs, amounts, notes, shared version and audit timestamps), defaulting false/empty for historical receipts.

PATCH splits replaces the full allocation: current IDs retain identity, omitted IDs create lines, removed lines are tombstoned. Omission preserves splits; null converts to an ordinary transaction with categoryId. Delete/restore change parent and current lines atomically. Account balance counts the parent once; category totals count lines once. Category filters return matching split parents once. Pending entries do not post; transfers cannot split.

Existing write guards/locks/receipts/version conflicts apply. Archived current references remain correctable/restorable; new archive assignments fail. Live split references block category deletion; Undo fails atomically after deleting a required reference. Ordinary omitted fields retain previous request fingerprints. Migration 0007_overconfident_siren.sql and ADR 0007 document integrity and coordinated-client deployment/rollback limits. No deployment in this PR.

## 0.1.8 — Account/category deletion

Add `DELETE /api/v1/ledgers/{ledgerId}/accounts/{accountId}` and the corresponding `/categories/{categoryId}` endpoint. Strict `{ expectedVersion }` bodies, session/owner/editor/Origin guards, required Idempotency-Key, atomic replayable 204 and safe RFC 9457 errors reuse the existing write foundation. Both active and archived targets are eligible.

Any non-deleted cleared/pending transaction or transfer leg blocks deletion with 409; delete those entries first. Parent categories also require deleting or moving all non-deleted children, including archives. Stale versions conflict; foreign/missing/deleted targets return 404. Assignment locks serialize deletion with new entries and restoration. Deleted transactions retain reference IDs, but Undo fails atomically if a required reference was deleted. No account/category restoration is added. Deleting an account removes its opening balance from ledger totals. No migration is needed (ADR 0006).

## 0.1.7 — Transfers (Phase 1 step 9)

- Add ledger-scoped `POST /transfers`, `GET/PATCH/DELETE /transfers/{transferId}`, and `POST /transfers/{transferId}/restore`. Writes reuse session/role/Origin guards, required Idempotency-Key receipts and RFC 9457 errors.
- Transfer amount is positive exact USD cents; source/destination accounts must differ and belong to the ledger. Responses include both stable leg IDs and one shared version. Both opposite cleared legs have `fxRate = 1`, signed `baseAmount = amount`, no category/payee, and matching date/optional local HH:mm time/note.
- PATCH supplies all editable fields plus expectedVersion. Delete advances both tombstone versions and returns replayable 204; restore uses the deleted version, retains identities/history and advances both versions. Stale/active restores, deleted references and unsafe posted balances fail atomically with no receipt.
- New archived-account assignments fail; unchanged archived references permit historical reads/corrections and Undo. Independent transaction-leg edit/delete/restore fail with 409.
- Transaction read DTOs now permit `kind = transfer` and nullable categoryId. `kind=transfer` lists both legs; ordinary income/expense and category filters exclude them. Every account balance includes cleared transfer legs. Transfer IDs are discovered through transaction history.
- Existing ordinary write contracts and saved receipt fingerprints are unchanged. This read-contract extension requires updated clients before creating transfers; v0.0.5 serializers cannot read transfer rows after an application rollback (ADR 0005). No deployment is performed by this PR.

## 0.1.6 — Transaction deletion Undo

Add `POST /api/v1/ledgers/{ledgerId}/transactions/{transactionId}/restore` with `{ expectedVersion }` and a transaction DTO response. Restore the same tombstoned row and historical fields; increment its version, clear deletedAt and recompute the posted balance. DELETE increments the version once, so a client with its successful deletion request uses that expectedVersion + 1 for Undo. Same-key retries replay the committed restore response. Already-active or stale targets conflict; missing/cross-ledger targets or tombstoned references return 404. Archived references may be retained. Independent transfer legs cannot be restored here.

Uses the existing owner/editor, Origin, ledger and atomic idempotency guards; category mutation and sorted account locks serialize changes. Balance overflow rolls back restoration and its receipt. Pending restoration does not post. No migration is required. Transaction list ordering and filter contracts remain unchanged.

## 0.1.5 — Optional transaction time

Add nullable `time` to transaction responses and optional `time` to create/PATCH bodies. It is the local clock time on the selected date, canonical `HH:mm` (00:00–23:59), with no timezone/UTC conversion. Omission on create leaves it null; omission on PATCH preserves it; explicit null clears it. Invalid times, seconds, offsets and timestamps are rejected. Existing rows remain null; no time is inferred from audit timestamps. See ADR 0004.

Migration `0005_remarkable_shatterstar.sql` adds a nullable text column with a matching clock-time check. Balances, date filters, cursor ordering and write guards are unchanged. Omitted fields retain the pre-upgrade request fingerprint, and old saved responses replay with `time: null`.

## 0.1.4 — 2026-10-07

Add ledger-scoped Transactions endpoints: `GET/POST /api/v1/ledgers/{ledgerId}/transactions` and `GET/PATCH/DELETE /api/v1/ledgers/{ledgerId}/transactions/{transactionId}`. The additive transaction migration stores UUIDv7 IDs, ledger/account/category references, kind, calendar date, signed bigint cents, USD currency, payee/note, status, frozen FX/base amount, nullable transfer ID, bounded version and audit/tombstone timestamps. Composite foreign keys enforce account ledger and category ledger/kind; constraints back signs, exact cents, USD/FX/base equality, date range, text lengths, status and versions.

Create accepts `{ accountId, categoryId, kind, date, amount: { amount, currency: "USD" }, status?, payee?, note? }`. Expenses are negative; income is positive; zero is rejected. Status defaults to `cleared`; optional nullable payee/note default to null and are trimmed/bounded to 200/2000 characters. Dates are real calendar dates from 0001–9999. Saved `fxRate` is 1 and `baseAmount` is the same signed USD money object as `amount`; clients cannot set either field or a transfer ID.

PATCH accepts a partial change plus `expectedVersion` and validates the complete resulting entry. DELETE accepts `{ expectedVersion }`, soft-deletes and returns an empty 204. A same-key delete retry replays 204; a fresh action on a deleted target returns 404. Transfer legs cannot be independently edited/deleted here. All writes require a trusted Origin, owner/editor permission and actor/ledger-scoped transactional idempotency. Stale versions and invalid assignments return safe field-level RFC 9457 errors. Cross-ledger/missing/tombstoned references return 404; wrong-kind categories or new assignments to archived accounts/categories conflict. Existing archived references can be retained for historical corrections and remain readable.

Lists exclude tombstones and sort by date descending, then UUID descending. `limit` is 1–100 (default 50); `nextCursor` is a nullable `YYYY-MM-DD_UUIDv7` boundary that does not require the source row to remain present. Keep the same filters between pages. Optional exact `accountId`/`categoryId`, inclusive `from`/`to` dates, `kind`, `status` and `text` apply before pagination. Text is a case-insensitive literal substring of payee or note, so `%` and `_` are ordinary characters. Stable datasets page without duplicates or omissions; edits to sort fields during traversal can move rows between pages.

Account list/detail/edit/archive responses now compute opening balance plus cleared, non-deleted transaction totals, including archived accounts. Pending entries never affect posted balances. Totals use PostgreSQL exact sums and BigInt before converting to safe integer JSON cents; account reads use a repeatable-read snapshot. Writes lock referenced accounts in sorted order and share the category mutation lock to prevent archive races. Transaction creates/edits/deletes and opening-balance corrections that would exceed the supported safe integer balance range conflict and roll back both mutation and receipt. No cached balance is stored.

Production remains `v0.0.4`. Quick-add follows in step 7; the next deployment checkpoint follows step 8.

## 0.1.3 — 2026-10-07

Add `POST /api/v1/ledgers/{ledgerId}/categories/{categoryId}/unarchive` with `{ expectedVersion }` and the existing category response. Requires a trusted Origin, owner/editor permission and an `Idempotency-Key`; inaccessible or tombstoned rows return 404, stale versions and already-active targets return safe field-level 409 conflicts. Successful retries replay the original result without advancing the version again.

Unarchive restores the same category ID, name, kind, parent, icon/color and historical identity. It clears `archivedAt`, appends the category to its sibling group, and advances its version/audit timestamp atomically under the category ledger lock. Restore an archived parent before its children; children are never restored automatically. A deleted/inaccessible parent cannot be restored through its child. Reserved sibling names continue to apply. No migration is needed; production remains `v0.0.3` pending the step 5 release checkpoint.

## 0.1.2 — 2026-10-07

Add ledger-scoped Categories endpoints: `GET/POST /api/v1/ledgers/{ledgerId}/categories`, `GET/PATCH /api/v1/ledgers/{ledgerId}/categories/{categoryId}`, and `POST` actions at `/{categoryId}/archive`, `/reorder` and `/starter-set`.

Categories have immutable `kind` (`income|expense`), nullable `parentId`, trimmed names (1–100 characters), nullable Lucide icon names (lowercase letters/digits/hyphens, up to 50 characters), nullable six-digit hex colors, `sortOrder`, versions and UTC audit/archive timestamps. Roots may have children of the same kind and ledger, with at most two levels. Parent changes reject cycles, third levels and archived/tombstoned parents; a root with children cannot become a child. Sibling names are unique ignoring case and surrounding spaces, including archived siblings. Database composite parent references and unique indexes back the ledger/kind and name checks.

List pagination uses ascending UUIDv7 IDs (`cursor`, `limit` 1–100/default 50); optional `kind` and `status=all|active|archived` filters apply before pagination. Load all relevant pages, then display sibling groups by `sortOrder` with ID as the tie-breaker. New and reparented categories append to their group. Archives remain readable with labels, IDs and hierarchy; archive active children before their parent. Metadata corrections preserve archive state. No hard-delete or merge endpoint is exposed.

`POST /reorder` takes `{ kind, parentId, items: [{ id, expectedVersion }] }`, with `parentId` defaulting to null and 1–1000 unique items in the desired order. Supply every active sibling in that group. Incomplete, mixed-group, archived or stale groups fail without changes; inaccessible/tombstoned targets return 404. All positions and versions advance together in one transaction. Archived positions are retained.

`POST /starter-set` requires `{ starterSet: "basic" }` and an empty non-deleted category list, including archives. It atomically creates seven roots: Salary, Other income, Food, Housing, Transport, Health and Other expenses. Clients can preview the shared `basicCategoryStarterSet`. No bootstrap, read or migration silently seeds categories.

All five mutations reuse the trusted-Origin and owner/editor guards, actor/ledger-scoped transactional idempotency, and RFC 9457 errors. Edits, archives and every reorder item require `expectedVersion`. Category writes serialize under one ledger-scoped transaction lock, preventing concurrent tree changes or name checks from racing. Successful retries replay the committed response; conflicts return safe field-level 409 details. Production remains `v0.0.3`; category screens and the first Phase 1 deployment checkpoint follow in step 5.

## 0.1.1 — 2026-10-06

Add ledger-scoped Accounts endpoints: `GET/POST /api/v1/ledgers/{ledgerId}/accounts`, `GET/PATCH /api/v1/ledgers/{ledgerId}/accounts/{accountId}`, and `POST /api/v1/ledgers/{ledgerId}/accounts/{accountId}/archive`. Support bank, cash, card, wallet, loan and savings accounts. Opening balances are signed USD integer cents; liability debt is negative. Account DTOs include money objects, UUIDv7 IDs, UTC audit/archive timestamps and a version.

Lists default to all non-deleted accounts, including archived ones; `status=active|archived|all`, `limit` (1–100, default 50) and UUIDv7 `cursor` control pagination in ascending ID order. Responses contain `items` and nullable `nextCursor`. Archived accounts stay readable with their balance and are excluded from active lists. Editing their metadata preserves the archive state. No hard-delete endpoint is exposed.

All three mutations require a trusted browser Origin, owner/editor permission and `Idempotency-Key`; edits/archives also require `expectedVersion`. Conflicts return 409, invalid input returns safe field-level 400 details, and inaccessible resources return 404. Currency is fixed to USD throughout Phase 1. Balance currently equals opening balance because transaction resources arrive in step 6; that step extends the computation with cleared, non-deleted entries. No balance cache column is stored.

## 0.1.0 — 2026-10-06

Add reusable USD integer-cent money, calendar-date and expected-version schemas, plus the required financial-write `Idempotency-Key` header contract. Keys are scoped to the signed-in actor and ledger; retries return the committed response, while changed requests conflict with 409. Owner/editor permission checks apply before writes and replay. Stale edits return field-level 409 problem details; invalid requests return safe field-level 400 details.

This step adds the shared write machinery and client retry helper. Accounts and other financial resource endpoints arrive in subsequent Phase 1 steps. Existing authentication and ledger-read endpoints retain their behavior; native authentication remains deferred.

## 0.0.1 — 2026-10-06

Initial OpenAPI 3.1 contract: database readiness, ledger list, and ledger detail. Ledger routes require an owner session and exclude other users' and soft-deleted ledgers. Authentication uses Better Auth browser endpoints under `/api/v1/auth` (sign-in/email, get-session, sign-out); public registration is disabled. Native bearer-token login is deferred to the Android phase.
