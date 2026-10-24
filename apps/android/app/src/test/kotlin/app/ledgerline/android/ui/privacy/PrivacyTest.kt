package app.ledgerline.android.ui.privacy

import android.app.Application
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.overlay.AttentionItem
import app.ledgerline.android.overlay.AttentionReason
import app.ledgerline.android.ui.home.AccountRow
import app.ledgerline.android.ui.home.AttentionRow
import app.ledgerline.android.ui.home.EntryRow
import app.ledgerline.android.ui.home.MonthCard
import app.ledgerline.android.ui.home.homeSummary
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.Paged
import app.ledgerline.android.ui.budgets.BudgetsContent
import app.ledgerline.android.ui.clients.ClientActions
import app.ledgerline.android.ui.clients.ClientCard
import app.ledgerline.android.ui.clients.ClientContent
import app.ledgerline.android.ui.clients.ClientsListActions
import app.ledgerline.android.ui.clients.ClientsListContent
import app.ledgerline.android.ui.clients.contact
import app.ledgerline.android.ui.clients.event
import app.ledgerline.android.ui.clients.homeLoans
import app.ledgerline.android.ui.clients.loan
import app.ledgerline.android.ui.clients.payment
import app.ledgerline.android.ui.clients.person
import app.ledgerline.android.ui.clients.service
import app.ledgerline.android.ui.loans.LoansListActions
import app.ledgerline.android.ui.loans.LoansListContent
import app.ledgerline.android.ui.loans.PersonActions
import app.ledgerline.android.ui.loans.PersonCard
import app.ledgerline.android.ui.loans.PersonContent
import app.ledgerline.android.ui.insights.CashFlowChart
import app.ledgerline.android.ui.insights.InsightsContent
import app.ledgerline.android.ui.insights.NetWorthChart
import app.ledgerline.android.ui.insights.insights
import app.ledgerline.api.Money
import app.ledgerline.android.ui.budgets.LineCard
import app.ledgerline.android.ui.budgets.budgetLine
import app.ledgerline.android.ui.budgets.budgetMonth
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Privacy mode hides every amount, on screen and to a screen reader; FLAG_SECURE follows the switch. A plain
 * Application: these screens need no injection, and the app's own would start syncing when an activity opens.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class PrivacyTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun aMaskHasNoDigitsAndSaysTheAmountIsHidden() {
        val shown = shownMoney(123456, "USD", private = true, hidden = "Amount hidden")
        assertEquals(ShownMoney(AmountMask, "Amount hidden"), shown)
        assertFalse(shown.text.any(Char::isDigit))
        assertEquals("$1,234.56", shownMoney(123456, "USD", private = false, hidden = "Amount hidden").text)
    }

    @Test
    fun theWindowIsSecureUnlessScreenshotsAreAllowed() {
        val window = Robolectric.buildActivity(ComponentActivity::class.java).setup().get().window
        window.applyScreenshotRule(allowScreenshots = false)
        assertTrue(window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        window.applyScreenshotRule(allowScreenshots = true)
        assertFalse(window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
    }

    @Test
    fun anAccountRowHidesItsBalance() = check { AccountRow(AccountBalance("a", "Checking", "bank", "USD", null, null, 123456, 0)) }

    @Test
    fun anEntryRowHidesItsAmount() = check {
        EntryRow(
            EntryLine("e", "2026-10-20", null, "expense", false, "cleared", -123456, "USD", "Grocer", "Checking", "Food", null, null, "2026-10-20T10:00:00Z"),
            unsent = false,
            onOpen = {},
        )
    }

    @Test
    fun aChangeThatNeedsTheOwnerHidesItsAmount() = check {
        AttentionRow(
            AttentionItem("c", "transaction.update", "Grocer", -123456, "USD", AttentionReason.ChangedElsewhere, null, canKeepMine = true),
            onFix = {},
            onDiscard = {},
            onKeepMine = {},
            onKeepTheirs = {},
        )
    }

    @Test
    fun theMonthOnHomeHidesEveryAmount() = check { MonthCard(Online.Ready(homeSummary(123456)), onRetry = {}, onOpenInsights = {}) }

    @Test
    fun budgetsHideTheTotalsAndEveryLine() = check {
        // Every amount on the screen is 1,234.56: the totals, spent, the budget, what is left, and spent without a budget.
        val line = budgetLine("Food", 246912, 123456)
        BudgetsContent("2026-10", Online.Ready(budgetMonth(items = listOf(line, budgetLine("Fun", null, 123456)))), {}, {}, {})
    }

    @Test
    fun aBudgetLineHidesWhatIsOverAndWhatCarriedIn() = check { LineCard(budgetLine("Fun", 0, 246912, carriedIn = 123456)) }

    @Test
    fun insightsHideWhatWasSpentAndEachCategory() = check {
        InsightsContent("2026-10", Online.Ready(insights(spent = 123456)), open = setOf("c-food"), onToggle = {}, onOpenCategory = {}, onPrevious = {}, onNext = {}, onRetry = {})
    }

    @Test
    fun theCashFlowFiguresHideEveryAmount() = check { CashFlowChart(insights(spent = 123456).cashFlow, "2026-10", open = true, onToggle = {}) }

    @Test
    fun theNetWorthFiguresHideEveryAmount() = check {
        val report = insights().netWorth
        NetWorthChart(report.copy(months = report.months.map { it.copy(netWorth = Money(123456, "USD")) }), "2026-10", open = true, onToggle = {})
    }

    /** Every amount is 1,234.56, so one check sees them all; a frame tall enough that a list composes every row. */
    private val tall = Modifier.requiredHeight(6000.dp)

    @Test
    fun aClientCardHidesWhatTheyOweIncludingTheValueAtTodaysRates() = check {
        ClientCard(
            contact("Northwind", owed = 123456, oldest = "2026-09-21", balances = listOf(Money(123456, "USD"), Money(123456, "EUR"))),
            onClick = {},
        )
    }

    @Test
    fun aClientsScreenHidesWhatIsOwedServicesPaymentsTipsAndHistory() = check {
        val audit = service("Website audit", 123456, received = 123456, due = "2026-10-21")
        val corrected = payment(audit, 123456, tip = 123456, note = "Paid by card")
        ClientContent(
            Online.Ready(contact("Northwind", owed = 123456, oldest = "2026-09-21", phone = "555-0101")),
            Online.Ready(Paged(listOf(audit, service("Logo", 123456, writtenOff = 123456, reason = "A thank-you")), hasMore = false)),
            Online.Ready(Paged(listOf(event("paymentEdited", audit, corrected, before = corrected)), hasMore = false)),
            mapOf("website-audit" to Online.Ready(listOf(corrected))),
            today = "2026-10-23",
            actions = ClientActions({}, {}, {}, {}, {}, {}, {}, {}),
            modifier = tall,
        )
    }

    @Test
    fun theClientsListHidesEveryBalance() = check {
        ClientsListContent("", "all", Online.Ready(Paged(listOf(contact("Northwind", owed = 123456), contact("Harbor", owed = 123456)), hasMore = false)), ClientsListActions({}, {}, {}, {}, {}, {}), tall)
    }

    @Test
    fun aPersonCardHidesWhatTheyOweYou() = check { PersonCard(person("Sam", "USD" to 123456L), onClick = {}) }

    @Test
    fun aPersonScreenHidesTheirBalanceAndWhatStoodBefore() = check {
        PersonContent(Online.Ready(contact("Sam", origin = "loan")), Online.Ready(listOf(loan("USD", 123456, opening = 123456))), PersonActions({}, {}, {}), tall)
    }

    @Test
    fun theLoansListHidesWhatIsLentOutAndOwed() = check {
        LoansListContent(Online.Ready(homeLoans(123456, 123456)), "", "active", Online.Ready(Paged(listOf(person("Sam", "USD" to 123456L)), hasMore = false)), LoansListActions({}, {}, {}, {}, {}, {}), tall)
    }

    @Test
    fun aBudgetLineHidesWhatWasOverspentBefore() = check { LineCard(budgetLine("Fun", 246912, 0, carriedIn = -123456)) }

    /** With privacy off the amount is there (so the check can see it); with privacy on it is nowhere. */
    private fun check(row: @Composable () -> Unit) {
        var private by mutableStateOf(false)
        compose.setContent { CompositionLocalProvider(LocalPrivacy provides private) { row() } }
        assertTrue(words().any { "1,234.56" in it })
        private = true
        compose.waitForIdle()
        val hidden = words()
        assertFalse(hidden.toString(), hidden.any { "1,234" in it || "234.56" in it })
        assertTrue(hidden.toString(), hidden.any { "Amount hidden" in it })
    }

    /** Every text and description in the tree, as a screen reader or the screen would show them. */
    private fun words(): List<String> {
        val found = mutableListOf<String>()
        fun walk(node: SemanticsNode) {
            node.config.getOrNull(SemanticsProperties.Text)?.forEach { found += it.text }
            node.config.getOrNull(SemanticsProperties.ContentDescription)?.let { found += it }
            node.children.forEach(::walk)
        }
        walk(compose.onRoot(useUnmergedTree = true).fetchSemanticsNode())
        return found
    }
}
