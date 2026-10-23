package app.ledgerline.android.online

import app.ledgerline.android.mirror.MirrorReads
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * The mirror's ledger with the time of its last pull, or null before it has one. Screens read online when this
 * changes: once the mirror knows its ledger, and again after every pull (an entry sent from the phone changes the
 * numbers). Room re-runs a watched query on every write to its table, even when the answer is unchanged, so
 * repeats of the same ledger and pull are dropped.
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun MirrorReads.pulls(): Flow<Pair<String, String?>?> =
    mirroredLedger().distinctUntilChanged().flatMapLatest { ledger ->
        if (ledger == null) flowOf(null) else cursorOf(ledger).map { ledger to it?.serverTime }
    }.distinctUntilChanged()

/** What a read online was asked for: the [ledger], [params] saying what to show, and [refresh], which changes to read it again. */
data class Reading<P>(val ledger: String, val params: P, val refresh: Any)

/**
 * A [Reading] whenever the ledger is known and [params], a pull or [retries] change; nothing before the mirror has a
 * ledger. A reload of the same ledger and params has the same view ([Reading.ledger] and [Reading.params]).
 */
fun <P> MirrorReads.readings(params: Flow<P>, retries: Flow<Int>): Flow<Reading<P>> =
    kotlinx.coroutines.flow.combine(pulls(), params, retries) { pull, p, n -> pull?.let { Reading(it.first, p, it.second to n) } }
        .filterNotNull()

/** What a [Reading] shows, for the readers that keep rows on screen while they reload. */
fun <P> Reading<P>.view(): Any = ledger to params
