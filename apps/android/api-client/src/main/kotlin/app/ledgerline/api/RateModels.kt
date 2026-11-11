package app.ledgerline.api

import kotlinx.serialization.Serializable

/**
 * `GET /ledgers/{ledgerId}/exchange-rates/lookup?code&date` (ADR 0050, slice 4b-2): the rate an entry in [code] on [date]
 * would be saved with. [rate] is the number of [baseCurrency] units one unit of [code] is worth, as exact decimal text, or
 * null when no rate is stored yet. [rateDate] is the day of the stored rate used (an earlier day on weekends and holidays);
 * [source] is `api`, `manual` or `base`.
 */
@Serializable
data class RateLookup(
    val code: String,
    val date: String,
    val baseCurrency: String,
    val rate: String?,
    val rateDate: String?,
    val source: String?,
)
