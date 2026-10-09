# ADR 0010: Category merge preserves financial history and preview intent

Date: 2026-10-08. Status: accepted by the owner.

Category merge is one ledger-scoped idempotent write with a server preview. Source
and destination must share kind and hierarchy level; the destination and its
parent must be active. Active or archived sources can be consolidated. Root merges
move all non-deleted children, preserving their IDs/archive state and rejecting
normalized sibling-name collisions. The source is archived; existing unarchive
does not reverse the merge. No reverse-merge or bulk Undo is added.

Only live ordinary/pending entries, current split allocations and live linked
income are recategorized. Deleted records and removed allocations keep their
original references and Undo rules. All current split lines share the resulting
parent version and timestamp. Linked payment/income versions advance together;
each payment correction advances its service and appends immutable before/after
history. Existing receipts/events remain unchanged.

Allow category-only merge maintenance on income from written-off services without
reopening them. Preserve amount, received, waiver and outstanding/status exactly.
This internal operation cannot edit payment money, accounts, dates, notes or
lifecycle; ordinary payment edits still require reopening under ADR 0009.

Require a fingerprint of the actual previewed rows/versions and relevant category
state, not only source/destination expected versions. Recompute after obtaining
the existing category-ledger lock in the outer read-committed transaction. New
assignments, corrections, deletions, restores or child changes invalidate stale
confirmation. Feature services own their repositories and use deterministic
contact/service/payment lock ordering. Every mutation, event and receipt commits
or rolls back together.

Shell-owned request memory retains an immutable body/key/token through uncertain
close/resume/navigation, blocks conflicting writes, and clears on actor/ledger
change or sign-out. A definitive conflict requires fresh preview/reconfirmation.
Full browser-restart draft persistence is not part of this feature.

Amounts, account/ledger/owed totals, financial identities, dates and currency remain
unchanged by merge. No schema migration is required. API/web require coordinated
deployment; deployment and step 12 Home remain separately authorized work.
