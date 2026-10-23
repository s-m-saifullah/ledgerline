package app.ledgerline.android.ui.design

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.online.Online
import app.ledgerline.android.overlay.ShownLine
import app.ledgerline.android.ui.budgets.BudgetsContent
import app.ledgerline.android.ui.budgets.budgetLine
import app.ledgerline.android.ui.budgets.budgetMonth
import app.ledgerline.android.ui.home.HomeContent
import app.ledgerline.android.ui.insights.CashFlowChart
import app.ledgerline.android.ui.insights.InsightsContent
import app.ledgerline.android.ui.insights.NetWorthChart
import app.ledgerline.android.ui.insights.insights
import app.ledgerline.android.ui.home.ListBottomSpace
import app.ledgerline.android.ui.home.Mirrored
import app.ledgerline.android.ui.home.SignedInFrame
import app.ledgerline.android.ui.home.SyncHeader
import app.ledgerline.android.ui.home.SyncLine
import app.ledgerline.android.ui.home.SyncStatus
import app.ledgerline.android.ui.home.Tab
import app.ledgerline.android.ui.home.TransactionsContent
import app.ledgerline.android.ui.home.homeSummary
import app.ledgerline.android.ui.more.MoreActions
import app.ledgerline.android.ui.more.MoreContent
import app.ledgerline.android.ui.more.MoreState
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.android.ui.theme.LedgerlineTheme
import app.ledgerline.api.HomeOwed
import app.ledgerline.api.Money
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshots for design review (ADR 0045), not a comparison: every screen in its real frame at 320 and 390 dp,
 * light and dark, and with the largest font scale. Runs only with -Pledgerline.screenshots and writes PNGs to
 * app/build/outputs/roborazzi; the data is made up.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class)
class ScreenshotTest(private val width: Int, private val dark: Boolean, private val fontScale: Float) {
    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}dp dark={1} font={2}")
        fun cases() = listOf(
            arrayOf<Any>(320, false, 1f),
            arrayOf<Any>(390, false, 1f),
            arrayOf<Any>(320, true, 1f),
            arrayOf<Any>(390, true, 1f),
            arrayOf<Any>(390, false, 2f),
        )
    }

    @Before
    fun screen() {
        assumeTrue("screenshots run with -Pledgerline.screenshots", System.getProperty("ledgerline.screenshots") == "true")
        RuntimeEnvironment.setQualifiers("w${width}dp-h1400dp-xxhdpi")
        RuntimeEnvironment.setFontScale(fontScale)
    }

    private fun shot(name: String, tab: Tab, private: Boolean = false, content: @Composable () -> Unit) {
        val theme = if (dark) "dark" else "light"
        captureRoboImage("build/outputs/roborazzi/$name-${width}dp-$theme-font$fontScale.png") {
            LedgerlineTheme(darkTheme = dark) {
                CompositionLocalProvider(LocalPrivacy provides private) {
                    SignedInFrame(tab, onSelect = {}, onAdd = {}) { inside ->
                        androidx.compose.foundation.layout.Box(inside) { content() }
                    }
                }
            }
        }
    }

    private val header: @Composable () -> Unit = {
        SyncHeader(SyncStatus(SyncLine("2026-10-22T10:42:00Z", running = false, problem = null), unsent = 1, attention = 0), {}, {})
    }

    @Test
    fun home() = shot("home", Tab.Home) {
        val month = homeSummary(590005).copy(
            moneyIn = Money(250000, "USD"),
            moneyOut = Money(71295, "USD"),
            owed = HomeOwed(Money(0, "USD"), 0, emptyList(), emptyList()),
            loans = homeSummary().loans.copy(lent = Money(0, "USD"), borrowed = Money(1250000, "USD")),
        )
        HomeContent(header, Online.Ready(month), {}, Mirrored.Ready(accounts))
    }

    @Test
    fun homeOffline() = shot("home-offline", Tab.Home) { HomeContent(header, Online.Offline, {}, Mirrored.Ready(accounts.take(2))) }

    @Test
    fun transactions() = shot("transactions", Tab.Transactions) {
        TransactionsContent(header, Mirrored.Ready(entries), canShowMore = true, onShowMore = {}, onOpen = {})
    }

    @Test
    fun budgets() = shot("budgets", Tab.Budgets) {
        val month = budgetMonth(
            items = listOf(
                budgetLine("Food", 30000, 12883, carriedIn = 30000),
                budgetLine("Fun", 1000, 16252),
                budgetLine("Home and garden with a long category name", 25000, 6299),
                budgetLine("Transport", 15000, 21000, carriedIn = -2500),
                budgetLine("Health", null, 1000),
                budgetLine("Gifts", null, 0),
            ),
        )
        BudgetsContent("2026-10", Online.Ready(month), {}, {}, {})
    }

    @Test
    fun budgetsOver() = shot("budgets-over", Tab.Budgets) {
        BudgetsContent("2026-10", Online.Ready(budgetMonth(items = listOf(budgetLine("Fun", 1000, 123456789)))), {}, {}, {})
    }

    @Test
    fun budgetsNone() = shot("budgets-none", Tab.Budgets) {
        BudgetsContent("2026-11", Online.Ready(budgetMonth("2026-11", listOf(budgetLine("Food", null, 0), budgetLine("Fun", null, 4200)))), {}, {}, {})
    }

    @Test
    fun budgetsOffline() = shot("budgets-offline", Tab.Budgets) { BudgetsContent("2026-10", Online.Offline, {}, {}, {}) }

    @Test
    fun insightsPage() = shot("insights", Tab.Insights) {
        InsightsContent("2026-10", Online.Ready(insights(worthMonths = 8)), open = setOf("c-food"), onToggle = {}, onPrevious = {}, onNext = {}, onRetry = {})
    }

    /** The charts with their figures open, net worth with a month below zero and one missing a rate. */
    @Test
    fun insightsCharts() = shot("insights-charts", Tab.Insights) {
        val month = insights(spent = 123456789)
        val worth = month.netWorth.copy(
            months = month.netWorth.months.mapIndexed { i, row ->
                row.copy(netWorth = Money(-200000L + i * 90000, "USD"), unconvertedCurrencies = if (i == 9) listOf("EUR") else emptyList())
            },
        )
        androidx.compose.foundation.layout.Column(
            modifier = androidx.compose.ui.Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState()),
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp),
        ) {
            CashFlowChart(month.cashFlow, "2026-10", open = true, onToggle = {})
            NetWorthChart(worth, "2026-10", open = true, onToggle = {})
        }
    }

    /** Net worth alone, so its chart and figures are in view: below zero at first, and one month missing a rate. */
    @Test
    fun insightsWorth() = shot("insights-worth", Tab.Insights) {
        val month = insights(worthMonths = 10)
        val worth = month.netWorth.copy(
            months = month.netWorth.months.mapIndexed { i, row ->
                row.copy(netWorth = Money(-200000L + i * 90000, "USD"), unconvertedCurrencies = if (i == 7) listOf("EUR") else emptyList())
            },
        )
        NetWorthChart(worth, "2026-10", open = true, onToggle = {})
    }

    @Test
    fun insightsHidden() = shot("insights-hidden", Tab.Insights, private = true) {
        androidx.compose.foundation.layout.Column(verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
            CashFlowChart(insights().cashFlow, "2026-10", open = false, onToggle = {})
            NetWorthChart(insights().netWorth, "2026-10", open = false, onToggle = {})
        }
    }

    @Test
    fun insightsOffline() = shot("insights-offline", Tab.Insights) {
        InsightsContent("2026-10", Online.Offline, open = emptySet(), onToggle = {}, onPrevious = {}, onNext = {}, onRetry = {})
    }

    @Test
    fun more() = shot("more", Tab.More) {
        MoreContent(
            MoreState(hideAmounts = false, allowScreenshots = false, unsent = 0, attention = 2, canLock = true, signingOut = false),
            MoreActions({}, {}, {}, {}, {}, {}),
            ListBottomSpace,
        )
    }

    private val accounts = listOf(
        AccountBalance("a1", "Everyday checking", "bank", "USD", null, null, 365937, 0),
        AccountBalance("a2", "Wallet", "cash", "USD", null, null, -3800, 1),
        AccountBalance("a3", "Rainy day savings account with a long name", "savings", "USD", null, null, 1250000000, 0),
        AccountBalance("a4", "Travel card", "card", "EUR", null, null, -45210, 0),
        AccountBalance("a5", "Old account", "bank", "USD", "2026-01-01T00:00:00Z", null, 0, 0),
    )

    private fun entry(id: String, date: String, kind: String, amount: Long, payee: String?, category: String?, account: String, status: String = "cleared", tags: String? = null, split: Boolean = false) =
        EntryLine(id, date, null, kind, split, status, amount, "USD", payee, account, category, tags, if (kind == "transfer") "t$id" else null, "${date}T10:00:00Z")

    private val entries = listOf(
        ShownLine(entry("e1", "2026-10-22", "expense", -5100, "Corner cafe", "Eating out", "Everyday checking", tags = "work, trip"), unsent = true),
        ShownLine(entry("e2", "2026-10-22", "expense", -1234, "Pharmacy", "Health", "Everyday checking", status = "pending"), unsent = false),
        ShownLine(entry("e3", "2026-10-22", "transfer", -4800, null, null, "Everyday checking"), unsent = false),
        ShownLine(entry("e4", "2026-10-21", "income", 250000, "Payroll", "Salary", "Everyday checking"), unsent = false),
        ShownLine(entry("e5", "2026-10-21", "expense", -3000, "Market", null, "Wallet", split = true), unsent = false),
        ShownLine(entry("e6", "2026-10-20", "expense", -123456789, "A very long payee name that keeps going and going", "Home and garden", "Rainy day savings account with a long name"), unsent = false),
    )
}
