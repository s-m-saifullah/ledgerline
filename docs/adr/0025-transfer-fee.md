# ADR 0025: Transfer fee on the sending account

Date: 2026-10-11. Status: accepted by the owner when approving the design. Builds on [0005](0005-paired-transfers.md), [0022](0022-currency-valuation-and-rate-rules.md) and [0023](0023-transfer-bonus.md); amends [0024](0024-recurring-rules-details.md) for transfer rules.

## Context

Sending money often costs a fee that the sender pays on top of the amount sent. The app should record it with the transfer, in one step, without changing what the receiver gets.

## Decisions

- **Sending account only.** A fee is charged to the sending account. Sending 100 with a fee of 2 debits 102; the received amount is unaffected.
- **One ordinary expense entry.** The fee is an expense in the sending account, in the sending account's currency, dated and timed like the transfer, in a category the person chose. It is saved in the same atomic write and under the same `Idempotency-Key` as the transfer, so a retry never creates it twice. A transfer has at most one fee and may also have a bonus (0023).
- **A distinct link.** A new nullable `transactions.fee_transfer_id` points from the fee entry to its transfer, with its own unique index per ledger. A check constraint allows it only on an expense that is not a transfer leg, a split, a payment receipt or a bonus. The bonus link (`related_transfer_id`, one income entry) is not generalized or changed.
- **One field, fixed or percentage.** The request carries either a fixed `amount` or `basisPoints`. A percentage is of the amount sent (before the fee), whole basis points (1.5% is 150, at most 100%), rounded half away from zero to the sending currency's smallest unit by one shared integer helper. The server works out the money, so every client agrees. A fee that comes to less than one smallest unit is refused. The form uses one box: a plain number is fixed, a number with `%` is a percentage, with a hint and a live preview.
- **Never posted silently.** The fee amount is never defaulted by the server; the request must ask for it. An account may remember a **default fee** (fixed amount in its currency, or basis points) and a **default fee category**; they only prefill clients. A fee with no category in the request and none on the account is refused (409, field `fee.categoryId`). Categories must be active expense categories of the ledger.
- **Pricing.** The fee is priced like any entry in the sending account's currency (a missing rate blocks the save). Its base value is frozen on the fee alone; the two transfer legs still net to zero in the base currency and the received amount is unchanged.
- **Edit.** Editing a transfer never recomputes or changes its fee. From then on the fee is an ordinary expense that can be edited or deleted on its own; it keeps its kind and cannot be split.
- **Delete and Undo.** Deleting a transfer deletes its fee only when asked (`deleteFee`), like the bonus. Restoring a transfer restores a fee deleted at the same moment, never one deleted on its own. Undoing the creation of a transfer removes its fee and bonus too.
- **Reports.** The fee is real spending: it counts in money out, category totals, budgets and net worth with no other change.
- **Recurring rules (amends 0024).** A transfer rule may carry an explicit fee, either a fixed amount or basis points, plus a category, confirmed when the rule is saved. A percentage is worked out again for each occurrence. The fee entry is written with its transfer under the occurrence's key.

## Consequences

Migrations 0019 and 0020 are additive. 0019: `accounts.fee_category_id`, `default_fee_amount` and `default_fee_bps` (one of the two, or neither), and `transactions.fee_transfer_id`. Responses gain `fee` on transfers, `feeTransferId` on entries and `feeCategoryId` and `defaultFee` on accounts, so web fixtures and browser-test mocks change with them. As with the bonus category, merging or archiving an account's default fee category does not repoint the default; the form asks again. 0020 adds `recurring_rules.fee_amount`, `fee_bps` (one of the two, or neither) and `fee_category_id`, only on transfer rules.
