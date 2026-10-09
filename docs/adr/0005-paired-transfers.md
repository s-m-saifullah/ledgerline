# ADR 0005: Paired transfer representation and correction

Date: 2026-10-07
Status: implemented under the approved Phase 1 step 9; pending PR review.

## Decision

Keep transfers entirely in the transactions domain: exactly two rows share a UUIDv7 `transferId`. Both use `kind = transfer`, no category or payee, cleared status, equal/opposite USD cents and signed base amounts, and `fxRate = 1`. This explicit kind prevents income/expense filters and category totals from treating either leg as an ordinary entry. Account balances continue to sum all cleared, non-deleted rows. No aggregate transfer table or balance cache is added.

The negative leg is the source and the positive leg is the destination. Their IDs and direction remain stable through corrections, including an account swap. Date, nullable local HH:mm time, note, audit timestamps, tombstone and version stay identical. Row constraints and a unique direction index protect each leg; a deferred PostgreSQL constraint trigger checks the complete pair at commit. Complete removal of both rows is allowed for scoped test cleanup or a future deliberate purge; public APIs only soft-delete.

Transfer endpoints expose one positive amount, source/destination accounts, both leg IDs and one shared version. PATCH replaces all editable fields and requires `expectedVersion`; delete/restore require only the shared version. All writes and receipts commit together, lock existing legs by sorted ID and lock all affected accounts by normalized sorted ID. Balance overflow rolls back both legs and the receipt. A replay returns the original response even after later corrections. Reads discover transfer IDs through ordinary transaction history; a separate transfer list is unnecessary in this step.

New assignments require active same-ledger accounts. Historical corrections, deletion and restoration can retain an unchanged archived account on its original leg. Swapping an archived account to the other leg is a new assignment and is rejected. Deleted/missing references fail. Same-account and cross-ledger transfers fail. Ordinary transaction edit/delete/restore always reject transfer legs.

The Add sheet has income/expense and transfer modes. History displays both account effects; opening either leg loads the same paired editor. Create Undo deletes both legs; deletion Undo restores both original identities. The existing shell memory and immutable prepared requests preserve interrupted actions across close/resume and navigation, freeze conflicting financial writes and clear on actor/ledger changes or sign-out. A browser reload is outside this existing in-memory retry guarantee.

## Consequences

The additive migration leaves ordinary transactions and historical receipt bodies valid, makes category references nullable for transfers and extends the read DTO kind to `transfer`. Older API/client serializers that only accept ordinary kinds/non-null categories must be updated before transfer data is created. Applying the migration alone leaves previous ordinary workflows valid; after transfers exist, an application rollback to v0.0.5 cannot display those rows. Do not remove transfer data to accommodate a rollback.

Future Home/report/category totals must select ordinary kinds (or explicitly exclude transfer IDs), while balances include both legs. Splits remain the next step; this change does not introduce pending transfers, fees, exchange rates or automatic categories.
