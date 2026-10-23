package app.ledgerline.android.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.OnlineReader
import app.ledgerline.api.HomeSummary
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.time.YearMonth
import javax.inject.Inject

/**
 * This month on Home, read online from `GET /home` (ADR 0043, slice 5). It is read when the mirror knows its
 * ledger, again after every pull (so an entry sent from the phone shows up) and on Retry or pull to refresh.
 * The month is the phone's own calendar month, as the web uses the browser's.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val reader: OnlineReader,
    reads: MirrorReads,
) : ViewModel() {
    private val retries = MutableStateFlow(0)
    private val _month = MutableStateFlow<Online<HomeSummary>>(Online.Loading)
    val month: StateFlow<Online<HomeSummary>> = _month.asStateFlow()

    init {
        // Room re-runs a watched query on every write to its table, so repeats of the same ledger and pull are dropped.
        val pulled = reads.mirroredLedger().distinctUntilChanged().flatMapLatest { ledger ->
            if (ledger == null) flowOf(null) else reads.cursorOf(ledger).map { ledger to it?.serverTime }
        }.distinctUntilChanged()
        viewModelScope.launch {
            combine(pulled, retries) { ledger, _ -> ledger?.first }.collectLatest { ledger ->
                if (ledger != null) load(ledger)
            }
        }
    }

    fun retry() {
        retries.value += 1
    }

    private suspend fun load(ledger: String) {
        // A reload keeps the numbers on screen until the answer arrives; only the first read shows Loading.
        if (_month.value !is Online.Ready) _month.value = Online.Loading
        _month.value = reader.read { home(ledger, YearMonth.now().toString()) }
    }
}
