package app.ledgerline.api

import kotlinx.serialization.Serializable

/*
 * Receiving a payment for a service (ADR 0050, slice 4): one idempotent write. Optional fields left out of the body are
 * read by the server as "not given", so a field with no value here has a default and is not sent.
 */

/**
 * `POST /ledgers/{ledgerId}/receivables/{receivableId}/payments`. [amount] is what the payment settles, in the service's
 * currency and never more than what is outstanding: money over that goes in [tip], as the web sends it. [receivedAmount]
 * and [fxRate] are for an account in another currency and come with the next slice. [expectedReceivableVersion] is the
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
