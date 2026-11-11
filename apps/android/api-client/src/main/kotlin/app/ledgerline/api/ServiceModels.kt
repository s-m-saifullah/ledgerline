package app.ledgerline.api

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
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

/**
 * `PATCH /ledgers/{ledgerId}/receivables/{receivableId}` (ADR 0050, slice 5b). Every field is sent, and a cleared time or due
 * date is an explicit `null` (a missing time would keep the saved one). [expectedVersion] is the version the phone holds, so
 * a service that changed meanwhile is refused with `409`. The server also refuses a currency change once a payment exists,
 * an amount below what was received, and a client change once a payment exists.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class UpdateService(
    val contactId: String,
    val description: String,
    val serviceDate: String,
    // Optional in the contract, but always sent: a missing time keeps the saved one, so clearing it needs an explicit null.
    @EncodeDefault val serviceTime: String? = null,
    val dueDate: String?,
    val amount: Money,
    val expectedVersion: Int,
)
