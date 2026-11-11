package app.ledgerline.android.ui.clients

import app.ledgerline.android.online.Online
import app.ledgerline.android.online.RateReads
import app.ledgerline.api.RateLookup
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** What a look-up found, as the form holds it: a rate, none stored for the date, or no answer (no connection, an error). */
internal fun Online<RateLookup>.toStoredRate(): StoredRate = when (this) {
    is Online.Ready -> value.rate?.let { StoredRate.Found(it, value.rateDate) } ?: StoredRate.Missing
    Online.Loading -> StoredRate.Looking
    Online.Offline, Online.Failed -> StoredRate.Unavailable
}

/**
 * Looks up the stored rate for the [RateKey] a payment sheet needs (ADR 0050, slice 4b-2): one look-up at a time, so
 * asking for a new key drops the one on its way, and a sheet that no longer needs a rate asks for none. The answer goes
 * back with the key it was asked for, so the form never uses one that belongs to another account or date.
 */
internal class RateFollower(private val scope: CoroutineScope, private val reads: RateReads) {
    private var job: Job? = null

    fun follow(ledgerId: String?, key: RateKey?, onAnswer: (RateAnswer) -> Unit) {
        job?.cancel()
        job = null
        if (key == null || ledgerId == null) return
        job = scope.launch { onAnswer(RateAnswer(key, reads.lookup(ledgerId, key.code, key.date).toStoredRate())) }
    }

    fun stop() {
        job?.cancel()
        job = null
    }
}
