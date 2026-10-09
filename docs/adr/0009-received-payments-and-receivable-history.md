# ADR 0009: Received payments and receivable corrections stay linked

Date: 2026-10-07. Status: accepted by the owner.

## Accounting and lifecycle

Step 10a records USD-only contacts, services, optional due dates, payments and write-offs before Category merge. Logging a service creates no transaction, account movement or income. For a live service, received is the exact sum of live payments, remaining is amount minus received, and open outstanding is remaining unless written off. Derive unpaid/partlyPaid/paid/writtenOff status; never accept it as an editable field. PostgreSQL numeric sums and BigInt guard individual, person, ledger and posted-account safe-cent limits.

A payment records money actually received. It creates one positive cleared unsplit income transaction with USD, FX 1 and equal base amount. Pending payments, overpayments, prepayments, multi-service allocations, refunds, splits and attaching existing transactions are excluded. Service/payment calendar dates and optional local time remain independently correctable for history.

Payment edits replace amount, account, income category, date/time and note together on the same linked transaction. Payment identity/service association is immutable. Payee begins as a contact-name snapshot and survives later renames. Payment and transaction versions advance together; every service or payment mutation advances the parent service version once. Require both payment and parent expected versions for payment corrections/delete/restore.

Delete tombstones the payment and its income at the same timestamp/version; validate reversed posted balances too. Replayable DELETE returns 204. Undo uses expected versions plus one and restores the same IDs/fields, subject to current parent, remainder, reference and balance checks. Archives can remain unchanged; deleted references, intervening versions, overpayment or a write-off block Undo atomically. Ordinary transaction PATCH/DELETE/restore reject linked rows, including tombstones. Transaction reads add default-null receivablePaymentId/receivableId; old receipts remain replayable without fingerprint changes.

Write off the entire current remainder, with an optional reason, and no expense or income entry. Keep original amount and payments, plus current waiver amount/timestamp/reason and immutable history. Reopen clears the waiver and makes the same remainder collectible. Written-off services must reopen before editing their service or payments; paid services cannot be written off.

Contacts allow duplicate names. Archive retains their balances and accessible history; deletion requires no live services, including paid/written-off ones. Service edits cannot reduce amount below received. Contact reassignment is allowed only before any payment history, including deleted payments. Service deletion requires no live payments and never cascades into income removal; service Undo restores only that service, retains its waiver, and validates its person and aggregate limits.

## Defaults, integrity and retries

Services is a visible category default: use the last confirmed active income category by ID, otherwise an existing active normalized income root named Services. Require an explicit normal-category API action to create it when absent. Archived name collisions remain correctable by selecting another category or visiting Categories; no bootstrap/migration/read silently seeds or unarchives it. Category creation and payment use separate immutable intents/receipts. Refresh choices before selecting defaults on every fresh payment dialog.

Migration 0008 adds contacts, receivables, receivable_payments and receivable_events, scoped composite references, versions/audit/tombstones and nullable transaction linkage. Deferred checks enforce reciprocal one-to-one income links, equal exact amounts/currency/versions/tombstones, cleared unsplit income, no live payments under deleted services, received <= amount and exact waiver remainder. Events append bounded before/after snapshots and actor/resulting service version; there is no event mutation API. Their 64 KiB bound admits all valid Unicode field limits.

One outer financial transaction includes posting, payment, parent version, event and receipt. Reuse membership/role/Origin guards before receipt replay. Lock order is receipt/access → category ledger lock → sorted contacts → parent service → existing payment/transaction → sorted old/new accounts. Contact deletion/assignment share contact locks; payment/amount/write-off changes share service locks. Features cross through service hooks. Read balances/details/history in repeatable-read snapshots.

More → People shows all contacts by default, including archived balances, oldest unpaid service and correction history. Both People and linked transaction history open the same payment editor. Shell request memory preserves exact bodies/keys/IDs/versions across interruption, close/resume and navigation; unknown outcomes freeze conflicting writes and retry the original intent. Definitive conflicts require a deliberate reload. Actor/ledger change or sign-out clears private drafts/queries. Viewer/privacy behavior applies to rows, forms, history and Undo; notifications contain no amounts.

## Compatibility and follow-up

OpenAPI/API notes advance to 0.1.10. The additive migration keeps ordinary rows/writes and saved receipts valid. Once payment links exist, older applications cannot safely correct their income; database checks reject broken pairs. Deploy API/web together. Recover forward or from the verified backup while preserving financial history; a full application rollback is not generally safe. Existing split/transfer restrictions remain.

Backup/restore captures and checks all twelve known tables when present using one exported snapshot, exact fingerprints and checksum. Restore explicitly validates deferred receivable invariants and recomputed owed/account bounds, rejects missing/duplicate manifests, and retains genuine older-dump support.

Step 11 Category merge must move linked category references through transaction/receivable services and advance paired versions/history atomically. Step 12 Home computes open owed independently of account net worth/income. Neither is implemented here. The next deployment checkpoint follows step 12; feature merge/deploy needs separate authorization and Phase 1 still requires the two-week expense-logging trial.
