package app.ledgerline.android.online

import app.ledgerline.api.RateLookup
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The rate a payment into an account where neither side is the base currency would be valued at (ADR 0050, slice 4b-2): a
 * read of what the ledger stores for a currency on a date (the newest rate on or before it), nothing is changed. Read
 * online and never kept on the phone.
 */
@Singleton
class RateReads @Inject constructor(private val reader: OnlineReader) {
    suspend fun lookup(ledgerId: String, code: String, date: String): Online<RateLookup> =
        reader.read { rateLookup(ledgerId, code, date) }
}
