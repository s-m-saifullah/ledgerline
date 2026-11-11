package app.ledgerline.api

import kotlinx.serialization.Serializable

/*
 * Receiving a payment for a service (ADR 0050, slice 4): one idempotent write. Optional fields left out of the body are
 * read by the server as "not given", so a field with no value here has a default and is not sent.
 */

/**
 * `POST /ledgers/{ledgerId}/receivables/{receivableId}/payments`. [amount] is what the payment settles, in the service's
 * currency and never more than what is outstanding: money over that goes in [tip], as the web sends it. [receivedAmount]
 * is for an account in another currency. [fxRate] is a rate set by hand, for that account's currency, and only when neither
 * the service nor the account is in the base currency (the server refuses it otherwise). [expectedReceivableVersion] is the
 * version of the service the phone holds, so a service that changed meanwhile is refused with `409`.
 */
@Serializable
data class CreatePayment(
    val amount: Money,
    val receivedAmount: Money? = null,
    val fxRate: String? = null,
    val accountId: String,
    val categoryId: String,
    val date: String,
    val time: String? = null,
    val note: String? = null,
    val tip: TipInput? = null,
    val expectedReceivableVersion: Int,
)

/** The extra money received on top of what a payment settles: its own income entry, in the account's currency. */
@Serializable
data class TipInput(val amount: Money, val categoryId: String)

/*
 * A payment from a client (ADR 0050, slice 4c): one amount applied to the client's oldest unpaid services first. The phone
 * asks for a preview of which services it would pay, and sends one write that names exactly that preview.
 */

/** `GET /ledgers/{ledgerId}/contacts/{contactId}/receipt-preview`: what [amount] would pay, oldest service first. */
@Serializable
data class ReceiptPreview(
    val contactId: String,
    val amount: Money,
    /** Everything the client owes in the amount's currency. */
    val openTotal: Money,
    val exceedsBalance: Boolean,
    /** More services than one receipt may touch; the payer records a smaller payment first. */
    val tooManyServices: Boolean,
    val allocations: List<ReceiptAllocation>,
)

/** One service a preview would pay: how much it takes and what would be left of it. */
@Serializable
data class ReceiptAllocation(
    val receivableId: String,
    val description: String,
    val serviceDate: String,
    val version: Int,
    val outstanding: Money,
    val applied: Money,
    val remainingAfter: Money,
)

/**
 * `POST /ledgers/{ledgerId}/contacts/{contactId}/receipts`. [amount] is what the receipt settles, never more than the open
 * total: money over that goes in [tip], once for the whole receipt. [expectedAllocations] are copied from the preview, so a
 * service that changed meanwhile is refused with `409`. [receivedAmount] and [fxRate] are as for a payment for one service.
 */
@Serializable
data class CreateReceipt(
    val amount: Money,
    val receivedAmount: Money? = null,
    val fxRate: String? = null,
    val accountId: String,
    val categoryId: String,
    val date: String,
    val time: String? = null,
    val note: String? = null,
    val tip: TipInput? = null,
    val expectedAllocations: List<ExpectedAllocation>,
)

/** A service the receipt is expected to pay, as the preview showed it. */
@Serializable
data class ExpectedAllocation(val receivableId: String, val expectedVersion: Int, val applied: Long)

/** A recorded receipt: its payments, one for each service it paid. */
@Serializable
data class Receipt(val id: String, val contactId: String, val amount: Money, val payments: List<ServicePayment>)
