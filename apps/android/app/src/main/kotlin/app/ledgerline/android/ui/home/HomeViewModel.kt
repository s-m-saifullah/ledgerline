package app.ledgerline.android.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.OnlineReader
import app.ledgerline.android.online.readOnTrigger
import app.ledgerline.android.online.readings
import app.ledgerline.android.online.view
import app.ledgerline.api.HomeSummary
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import java.time.YearMonth
import javax.inject.Inject

/**
 * This month on Home, read online from `GET /home` (ADR 0043, slice 5). It is read while Home is shown, once the
 * mirror knows its ledger, again after every pull (so an entry sent from the phone shows up) and on Retry or pull to
 * refresh; nothing is read while the lock screen is up. The month is the phone's own calendar month, as the web uses
 * the browser's, taken when each read starts. A reload keeps the numbers on screen; another ledger, or none after a
 * sign-out, shows Loading, so one person's numbers never appear under the next person's sign-in.
 */
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val reader: OnlineReader,
    reads: MirrorReads,
) : ViewModel() {
    private val retries = MutableStateFlow(0)

    val month: StateFlow<Online<HomeSummary>> = readOnTrigger(viewModelScope, reads.readings(flowOf(Unit), retries), { it.view() }) { reading ->
        reader.read { home(reading.ledger, YearMonth.now().toString()) }
    }

    fun retry() {
        retries.value += 1
    }
}
