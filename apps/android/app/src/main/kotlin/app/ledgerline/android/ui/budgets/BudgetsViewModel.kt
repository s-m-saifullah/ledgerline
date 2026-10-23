package app.ledgerline.android.ui.budgets

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.MonthlyRead
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.OnlineReader
import app.ledgerline.api.BudgetMonth
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import java.time.YearMonth
import javax.inject.Inject

/**
 * A month of budgets, read online from `GET /budgets` (ADR 0043, slice 5) while the screen shows it; see
 * [MonthlyRead] for when it reads.
 */
@HiltViewModel
class BudgetsViewModel @Inject constructor(reader: OnlineReader, reads: MirrorReads) : ViewModel() {
    private val read = MonthlyRead<BudgetMonth>(viewModelScope, reads, { it.month }) { ledger, month ->
        reader.read { budgets(ledger, month) }
    }
    val month: StateFlow<YearMonth> = read.month
    val budgets: StateFlow<Online<BudgetMonth>> = read.state

    fun previous() = read.previous()

    fun next() = read.next()

    fun retry() = read.retry()
}
