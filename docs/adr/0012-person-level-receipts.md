# ADR 0012: Person-level receipts

Date: 2026-10-08. Status: accepted by the owner. It amends ADR 0009's exclusion of multi-service allocations.

## Decision

One payment from a person is recorded once and applied serially to that person's open services, **oldest service date first, ties by creation order (ID)**. It creates one ordinary linked payment and one cleared income entry per service it touches, so ADR 0009's one-payment-to-one-income link, per-service totals and database invariants are unchanged. Payments created together share a nullable `receipt_id` (additive migration 0009).

Skipped: deleted, written-off and fully paid services. Overpayment (more than the person's open balance) and prepayments stay rejected. A receipt may touch at most 100 services.

## Preview and stale protection

`GET /contacts/{id}/receipt-preview?amount=` returns the exact allocation and each service version. Saving sends that allocation back; if open services, versions or amounts differ the server returns 409 and nothing is written. All payments, income entries, events, version bumps and the idempotency receipt commit in one transaction, under the contact lock.

## Lifecycle

Receipts can be deleted and restored (Undo) as a whole, using each payment's and service's expected versions. Receipt details (account, income category, date, local time, note) can be corrected for every member at once; amounts and allocations cannot change, so correction of an amount is delete and re-enter. The ordinary per-payment edit, delete and restore return 409 for receipt members. Written-off services block receipt changes until reopened, as for single payments.

## Consequences

The Transactions list shows one "Service payment" income row per service touched. Home totals, account balances and owed totals are unchanged in definition. The restore drill checks that no receipt is partly deleted. API notes advance to 0.1.13. Deploy API and web together; older clients cannot change member payments.
