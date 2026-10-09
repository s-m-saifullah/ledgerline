# ADR 0006: Delete accounts and categories after deleting connected entries

- Status: accepted — requested by the owner on 2026-10-07
- Scope: Phase 1 addition after Transfers, before Splits

## Decision

Allow owner/editor users to soft-delete active or archived accounts and categories once no non-deleted transaction references them. Pending and cleared entries both block; transfer legs block their accounts. A zero balance does not establish that an account is unused. Delete connected entries first, or archive the reference to retain its availability for historical corrections and Undo.

Deleted entries retain their original account/category IDs and all historical fields. They do not block reference deletion. Transaction and paired transfer restoration continue to validate references under the same locks, and fail atomically with 404 if any required reference is deleted. Account/category deletion has no restore endpoint or Undo in this addition. Confirmations explain this and offer archive as the alternative. Deleting an account removes its opening balance from ledger totals because balances include only non-deleted accounts. No live entries can lose their labels or accounts.

A parent category cannot be deleted while it has any non-deleted children, including archived children. Delete or reparent those first. Deleted names can be reused for new category identities; existing tombstones retain their original IDs. No cascade, reassignment or hard delete is performed.

## API and concurrency

Add DELETE to the existing ledger-scoped account and category detail paths. The strict body is `{ expectedVersion }`; successful deletion advances the version, sets deletedAt and returns replayable 204. Reuse session/role/Origin guards, transactional actor/ledger idempotency receipts, expected-version conflicts and safe RFC 9457 problems. Target discovery stays ledger-scoped, so absent, foreign and deleted references are indistinguishable.

Account deletion takes the existing account assignment row lock. Category deletion takes the existing per-ledger category mutation lock. Transaction create/edit/restore already hold these locks before validating assignments. The usage check and tombstone therefore cannot race a new assignment or Undo into a dangling live reference. The transactions module exposes a scoped usage-guard service; other features never query its tables directly. Existing deletedAt/version columns suffice, so no migration is needed.

Step 10 Splits must extend this usage guard to non-deleted split-line category references under the same category lock. Step 11 merge must preserve these deletion rules. The next deployment checkpoint remains after step 12; this addition does not complete Phase 1 or its final two-week trial.
