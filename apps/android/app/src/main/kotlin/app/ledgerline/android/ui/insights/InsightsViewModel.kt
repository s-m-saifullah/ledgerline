package app.ledgerline.android.ui.insights

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.ledgerline.android.mirror.MirrorReads
import app.ledgerline.android.online.MonthlyRead
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.OnlineReader
import app.ledgerline.api.CashFlowReport
import app.ledgerline.api.NetWorthReport
import app.ledgerline.api.SpendingReport
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.StateFlow
import java.time.YearMonth
import javax.inject.Inject

/** How many months the two charts show, as on the web. */
const val ChartMonths = 12

/** What Insights shows for a month: its spending by category, and cash flow and net worth for the months to it. */
data class Insights(val spending: SpendingReport, val cashFlow: CashFlowReport, val netWorth: NetWorthReport)

/** The three answers as one: shown when all arrived, otherwise no connection if any had none, else failed. */
fun <A, B, C, R> allOf(a: Online<A>, b: Online<B>, c: Online<C>, join: (A, B, C) -> R): Online<R> = when {
    a is Online.Ready && b is Online.Ready && c is Online.Ready -> Online.Ready(join(a.value, b.value, c.value))
    listOf(a, b, c).any { it == Online.Offline } -> Online.Offline
    else -> Online.Failed
}

/**
 * Insights, read online from `/reports/spending`, `/reports/cash-flow` and `/reports/net-worth` together (ADR 0043,
 * slice 5) while the screen shows it; see [MonthlyRead] for when it reads.
 */
@HiltViewModel
class InsightsViewModel @Inject constructor(reader: OnlineReader, reads: MirrorReads) : ViewModel() {
    private val read = MonthlyRead<Insights>(viewModelScope, reads, { it.spending.month }) { ledger, month ->
        coroutineScope {
            val spending = async { reader.read { spending(ledger, month) } }
            val cashFlow = async { reader.read { cashFlow(ledger, month, ChartMonths) } }
            val netWorth = async { reader.read { netWorth(ledger, month, ChartMonths) } }
            allOf(spending.await(), cashFlow.await(), netWorth.await(), ::Insights)
        }
    }
    val month: StateFlow<YearMonth> = read.month
    val insights: StateFlow<Online<Insights>> = read.state

    fun previous() = read.previous()

    fun next() = read.next()

    fun retry() = read.retry()
}
