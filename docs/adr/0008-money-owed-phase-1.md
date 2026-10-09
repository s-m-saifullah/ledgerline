# ADR 0008: Move Money owed to you before Category merge

Date: 2026-10-07. Status: accepted — explicitly requested by the owner.

## Decision

Move the existing Money owed to you feature from Phase 2 into Phase 1 as step 10a, after reviewed/merged Splits and before step 11 Category merge. Preserve existing step numbers, the next deployment checkpoint after step 12 Home, and the final two-week expense-logging trial.

Bring forward contacts, unpaid services/receivables with optional due dates, full/partial payments linked to income transactions, write-offs and the People screen with per-person balances and history. Entry remains USD-only under ADR 0003. Logging an unpaid service creates no income or account posting; payments create income in the receiving account and reduce the outstanding balance atomically. Home’s Owed to you total is part of step 12. Budgets, recurring entries and currency tools remain Phase 2.

## Implementation boundary

This decision approves scope and order, not a completed API/schema or payment lifecycle design. Prepare the detailed step 10a implementation plan for review before large changes. Resolve linked payment/transaction corrections, deletion/Undo, write-off/reopen behavior, pending payments, overpayment prevention and Services category defaults explicitly; prevent linked records from diverging or money from being counted twice. Preserve exact cents, scoped references, history, roles, idempotency, version conflicts and privacy. Include new tables in backup/restore verification.

No application code, migration or deployment is part of this planning change. New feature PR merges and deployment still require authorization.
