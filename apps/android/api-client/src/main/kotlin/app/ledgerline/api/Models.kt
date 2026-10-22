package app.ledgerline.api

import kotlinx.serialization.Serializable

/** Money as the API sends it: an integer in minor units plus an ISO 4217 code. Never a floating point number. */
@Serializable
data class Money(val amount: Long, val currency: String)

/** An RFC 9457 problem+json error body. */
@Serializable
data class Problem(
    val type: String,
    val title: String,
    // The contract allows integers up to 2^53 here, so it is a Long like every unbounded integer.
    val status: Long,
    val detail: String,
    val errors: List<FieldError>,
)

@Serializable
data class FieldError(val field: String, val message: String)

@Serializable
data class Health(val status: String)

@Serializable
data class LedgerList(val items: List<LedgerSummary>)

@Serializable
data class LedgerSummary(
    val id: String,
    val name: String,
    val baseCurrency: String,
    val timeZone: String?,
    val version: Int,
    val role: String,
)
