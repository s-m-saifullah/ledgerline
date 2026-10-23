package app.ledgerline.android.ui.budgets

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.OnlineReader
import app.ledgerline.api.BudgetMonth
import dagger.hilt.android.lifecycle.HiltViewModel
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
import javax.inject.Inject

/**
 * A month of budgets, read online from `GET /budgets` (ADR 0043, slice 5). It is read only while the screen
 * shows it: when it opens, when the month changes, after every pull (an entry sent from the phone changes what
 * was spent) and on Retry or pull to refresh. It starts at the phone's own calendar month, as the web does.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class BudgetsViewModel @Inject constructor(
    private val reader: OnlineReader,
    reads: MirrorReads,
) : ViewModel() {
    private val retries = MutableStateFlow(0)
    private val _month = MutableStateFlow(YearMonth.now())
    val month: StateFlow<YearMonth> = _month.asStateFlow()

    /** The last answer, so a reload of the same month keeps its numbers on screen until the new ones arrive. */
    private var last: Online<BudgetMonth> = Online.Loading

    val budgets: StateFlow<Online<BudgetMonth>> = run {
        // Room re-runs a watched query on every write to its table, so repeats of the same ledger and pull are dropped.
        val pulled = reads.mirroredLedger().distinctUntilChanged().flatMapLatest { ledger ->
            if (ledger == null) flowOf(null) else reads.cursorOf(ledger).map { ledger to it?.serverTime }
        }.distinctUntilChanged()
        combine(pulled, _month, retries) { ledger, month, _ -> ledger?.first to month.toString() }
            .transformLatest { (ledger, month) ->
                if (ledger == null) return@transformLatest
                if ((last as? Online.Ready)?.value?.month != month) emit(Online.Loading)
                emit(reader.read { budgets(ledger, month) })
            }
            .map { it.also { state -> last = state } }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), Online.Loading)
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
