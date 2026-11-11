package app.ledgerline.api

import kotlinx.serialization.Serializable

/*
 * Logging a service for a client (ADR 0050, slice 5): one idempotent write. Optional fields left out of the body are read by
 * the server as "not given" (no time, no due date), so a field with no value here has a default and is not sent.
 */

/**
 * `POST /ledgers/{ledgerId}/receivables`. [description] is trimmed by the sender and is 1 to 2000 characters. [serviceTime]
 * is "HH:mm". [amount] is above zero, in the base currency or one the ledger has added; the server refuses any other.
 */
@Serializable
data class CreateService(
    val contactId: String,
    val description: String,
    val serviceDate: String,
    val serviceTime: String? = null,
    val dueDate: String? = null,
    val amount: Money,
)
