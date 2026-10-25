package app.ledgerline.android.ui.insights

import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.api.CashFlowMonth
import app.ledgerline.api.CashFlowReport
import app.ledgerline.api.Money
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun account(type: String, balance: Long, currency: String = "USD", archived: Boolean = false) =
    AccountBalance("a-$type-$balance", type, type, currency, if (archived) "2026-01-01T00:00:00Z" else null, null, balance, 0)

private fun month(m: String, income: Long, spending: Long) =
    CashFlowMonth(m, Money(income, "USD"), Money(spending, "USD"), Money(income - spending, "USD"))

class InsightsModelTest {
    @Test
    fun theSnapshotSplitsMoneyToHandFromWhatIsOwedAndAddsThem() {
        val snapshot = worthSnapshot(listOf(account("bank", 150000), account("cash", 5000), account("card", -42000), account("loan", -100000)))!!
        assertEquals(Money(155000, "USD"), snapshot.assets)
        assertEquals(Money(-142000, "USD"), snapshot.liabilities)
        assertEquals(Money(13000, "USD"), snapshot.net)
    }

    @Test
    fun aCardWithACreditBalanceReducesWhatIsOwed() {
        val snapshot = worthSnapshot(listOf(account("card", -10000), account("card", 2500)))!!
        assertEquals(Money(-7500, "USD"), snapshot.liabilities)
        assertEquals(Money(0, "USD"), snapshot.assets)
    }

    @Test
    fun archivedAccountsCountAsTheServersNetWorthCountsThem() {
        val snapshot = worthSnapshot(listOf(account("bank", 1000), account("bank", 500, archived = true)))!!
        assertEquals(Money(1500, "USD"), snapshot.assets)
    }

    @Test
    fun noAccountsOrSeveralCurrenciesGiveNoSnapshot() {
        assertNull(worthSnapshot(emptyList()))
        assertNull(worthSnapshot(listOf(account("bank", 1000), account("bank", 1000, "EUR"))))
    }

    @Test
    fun aMonthHasActivityWhenMoneyCameInOrWentOut() {
        assertTrue(hasActivity(month("2026-10", 100, 0)))
        assertTrue(hasActivity(month("2026-10", 0, 100)))
        assertFalse(hasActivity(month("2026-10", 0, 0)))
    }

    @Test
    fun theTwelveMonthChartNeedsTwoMonthsWithActivity() {
        fun report(vararg active: Boolean) = CashFlowReport("a", "b", active.mapIndexed { i, on -> month("2026-%02d".format(i + 1), if (on) 100 else 0, 0) })
        assertFalse(showCashFlow(report(false, false, false)))
        assertFalse(showCashFlow(report(false, true, false)))
        assertTrue(showCashFlow(report(true, false, true)))
    }

    @Test
    fun aNegativeNetWorthIsNeutralAndAnythingElseTheAccent() {
        assertEquals(WorthTone.Negative, worthTone(-1))
        assertEquals(WorthTone.Positive, worthTone(0))
        assertEquals(WorthTone.Positive, worthTone(1))
    }

    @Test
    fun theSummaryBarSplitsSpentFromKept() {
        assertEquals(SummaryBar.Split(0.25f), summaryBar(income = 400, spent = 100))
        assertEquals(SummaryBar.Split(1f), summaryBar(income = 400, spent = 400))
        assertEquals(SummaryBar.Split(0f), summaryBar(income = 400, spent = 0))
    }

    @Test
    fun theSummaryBarIsRedWhenMoreWentOutThanCameIn() {
        assertEquals(SummaryBar.Over, summaryBar(income = 400, spent = 401))
    }

    @Test
    fun theSummaryBarIsLeftOutWithoutMoneyIn() {
        assertEquals(SummaryBar.None, summaryBar(income = 0, spent = 100))
        assertEquals(SummaryBar.None, summaryBar(income = -5, spent = 0))
    }
}
