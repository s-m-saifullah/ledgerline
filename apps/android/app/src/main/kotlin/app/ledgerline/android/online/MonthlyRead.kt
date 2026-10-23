package app.ledgerline.android.online

import app.ledgerline.android.mirror.MirrorReads
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.transformLatest
import java.time.YearMonth

/**
 * A screen that reads one month online (Budgets, Insights; ADR 0043, slice 5). [state] is read only while it is
 * collected, that is while the screen shows it (and for five seconds after), when the month changes, after every
 * pull (an entry sent from the phone changes the numbers) and on [retry]. It starts at the phone's own calendar
 * month, as the web does. A reload of the same month keeps its numbers on screen; another month shows Loading, so
 * one month's numbers never appear under another month's name. [monthOf] says which month an answer is for.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MonthlyRead<T>(
    scope: CoroutineScope,
    reads: MirrorReads,
    private val monthOf: (T) -> String,
    private val read: suspend (ledger: String, month: String) -> Online<T>,
) {
    private val retries = MutableStateFlow(0)
    private val _month = MutableStateFlow(YearMonth.now())
    val month: StateFlow<YearMonth> = _month.asStateFlow()

    /** The last answer, so a reload of the same month keeps its numbers on screen until the new ones arrive. */
    private var last: Online<T> = Online.Loading

    val state: StateFlow<Online<T>> = run {
        // Room re-runs a watched query on every write to its table, so repeats of the same ledger and pull are dropped.
        val pulled = reads.mirroredLedger().distinctUntilChanged().flatMapLatest { ledger ->
            if (ledger == null) flowOf(null) else reads.cursorOf(ledger).map { ledger to it?.serverTime }
        }.distinctUntilChanged()
        combine(pulled, _month, retries) { ledger, month, _ -> ledger?.first to month.toString() }
            .transformLatest { (ledger, month) ->
                if (ledger == null) return@transformLatest
                if ((last as? Online.Ready)?.value?.let(monthOf) != month) emit(Online.Loading)
                emit(read(ledger, month))
            }
            .map { it.also { state -> last = state } }
            .stateIn(scope, SharingStarted.WhileSubscribed(5_000), Online.Loading)
    }

    fun previous() {
        _month.value = _month.value.minusMonths(1)
    }

    fun next() {
        _month.value = _month.value.plusMonths(1)
    }

    fun retry() {
        retries.value += 1
    }
}
