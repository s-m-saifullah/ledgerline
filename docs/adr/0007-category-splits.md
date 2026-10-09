# ADR 0007: Category allocations belong to one transaction

Date: 2026-10-07. Status: accepted within the approved Phase 1 step 10 plan.

## Representation and API

A split expense/income remains one transaction for account balance, date/time/payee/note/status and income/spending totals. Add an explicit isSplit flag; its parent categoryId is null. Ordered transaction_splits rows carry ledgerId, transactionId, kind, categoryId, exact signed USD amount, optional note, position, version and audit/tombstone timestamps. Transfers cannot have splits. Use 2–50 nonzero lines with the parent's direction and exact sum; repeated categories are permitted and aggregate normally. Currency/FX are inherited from the USD parent, with fxRate = 1 and baseAmount = amount.

Extend ordinary transaction create/read/PATCH/delete/restore endpoints rather than exposing independently mutable lines. Create supplies splits and null categoryId; new lines omit IDs. PATCH with splits replaces the complete allocation. Keep existing IDs only for current lines; omitted IDs create new lines, omitted saved lines are soft-deleted. Omitted splits preserve the allocation; explicit null converts to an ordinary entry and requires categoryId. This permits corrections between ordinary and split entries and between expense/income. The UI resets categories/line IDs on direction changes so those choices are explicit new assignments. Every live line shares the parent version. A stale parent changes nothing.

DTOs expose isSplit and ordered splits, defaulting false/empty for historical receipts. Ordinary omitted split/time fields stay out of request fingerprints. Same-key retries replay the whole committed response; failures leave no receipt. List category filters match any live line and return the parent once. Internal category totals sum ordinary category amounts or split allocations; account totals always sum transaction parents. Pending entries contribute to neither posted balance nor category spending. Transfer legs never enter category totals.

## Lifecycle and integrity

Writes reuse the category ledger lock, sorted old/new account row locks, role/Origin/session guards and transactional idempotency. Unchanged archived line categories remain readable/correctable/restorable; newly assigned archived categories fail. Category deletion now checks live split lines under the same lock, including pending entries. Account deletion is already blocked by the live parent.

Delete soft-deletes the parent and current lines atomically at one version. Undo restores exactly those lines, preserving identities and historical fields. Tombstone timestamp plus parent deletion version distinguishes the last allocation from lines removed by earlier corrections, including changes within one clock millisecond. Deleted required references fail restoration atomically. Reference deletion remains without Undo (ADR 0006).

Composite foreign keys scope parent/category references. A deferred database check enforces the final complete parent/allocation at commit, including exact numeric sums, same kind/shared version and tombstones; ordinary/transfer entries cannot acquire live split lines. Removed historical lines retain their original category kind even if their parent is later converted, so the parent FK scopes ledger/id and the deferred check validates current kind. No balance cache or independent split endpoint.

## Compatibility and next steps

The additive migration leaves old ordinary writes and receipts valid. After split data exists, older clients cannot display allocations or safely correct those entries. Older parent-only deletes are rejected by the database check. Deploy API and web together; do not roll application code back to a client without split support while split records exist. Keep the database volume and use the verified snapshot backup if recovery is required.

Backup manifests now include transaction_splits, making eight financial/auth tables verified exactly when present. Step 11 category merge must move both ordinary and split category references atomically without changing money or account totals. The next deployment checkpoint remains after step 12; the final two-week logging trial remains outstanding.
