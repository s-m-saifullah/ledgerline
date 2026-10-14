# ADR 0027: Tips on payments

Date: 2026-10-13. Status: accepted by the owner when approving the design. Amends [0009](0009-received-payments-and-receivable-history.md) and [0012](0012-person-level-receipts.md), which rejected overpayment.

## Context

A client sometimes pays more than is owed. The extra is a tip: real income, but not payment of a service, so it must not reduce what is owed or break the rule that payments never exceed their service.

## Decisions

- **A payment stays capped.** A payment (or receipt) still settles at most what is owed; the database function `ledgerline_check_receivable` is unchanged.
- **The tip is its own income entry.** A request may carry `tip: { amount, categoryId }`. It is saved in the same atomic write and under the same `Idempotency-Key` as the payment, as an ordinary cleared, unsplit income entry in the payment's account, dated and timed like the payment, with the client's name as payee. The server never works the tip out: the client sends the extra explicitly. A missing or unusable category is refused (an active income category of the ledger is required).
- **Currency.** The tip is in the receiving account's currency (the currency received). With a cross-currency payment the amount received is independent of the amount settled, so the form asks for the tip as a separate field; in the same-currency case the form splits an amount typed above the balance. The tip is priced like any entry; a missing rate blocks the save.
- **Receipts.** A person-level receipt makes one tip for the whole receipt, linked to its first payment.
- **A distinct link.** A new nullable `transactions.tip_payment_id` points from the tip entry to its payment, with a scoped foreign key, a unique index per ledger (one tip per payment) and a check that allows it only on an income entry that is not a transfer leg, a split, a payment's own income, a bonus or a fee. `receivable_payment_id` is not reused, because that column triggers the strict payment-pairing check.
- **Edit.** Editing a payment or receipt never touches its tip. The tip is an ordinary income entry that can be edited or deleted on its own, but it keeps its kind and cannot be split.
- **Delete and Undo.** Deleting a payment or receipt deletes its tip at the same moment, always. Restoring brings back only a tip deleted at that moment, never one deleted on its own. Undoing a just-saved payment removes its tip too.
- **Totals.** A tip is income: it counts in money in and in the account balance. It does not change what is owed, "Owed to you" or any service status.
- **Category default.** As for Services (0009), clients default to the last confirmed tip category, otherwise an active income root named Tips; creating "Tips" is an explicit action, never silent.
- **Backup and drill.** The manifest gains a `tips` check (live count, tombstoned count and live total) and the drill a `tip_links` invariant: every tip is income, its payment exists in the same ledger and is not deleted while the tip is live, and a receipt has at most one tip.

## Consequences

Migration 0021 is additive. API 0.1.31: requests gain an optional `tip`; payments gain `tip`, history snapshots gain `tip` and transactions gain `tipPaymentId`, all defaulting to null so older fixtures still parse. Rollback: older code runs on the new column but would not move a tip with its payment, so after the release the rollback caveat covers migration 0021 as well.
