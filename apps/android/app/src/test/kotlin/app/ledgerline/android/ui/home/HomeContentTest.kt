package app.ledgerline.android.ui.home

import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import app.ledgerline.android.mirror.AccountBalance
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.LimitState
import app.ledgerline.android.ui.design.heroFiguresPerRow
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.android.ui.theme.LedgerlineTheme
import app.ledgerline.api.HomeOwed
import app.ledgerline.api.Money
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

internal val quietSync = SyncStatus(SyncLine("2026-10-22T10:42:00Z", running = false, problem = null), unsent = 0, attention = 0)
internal val noHomeActions = HomeActions({}, {}, {}, {}, {}, {}, {})

private fun account(name: String, type: String, currency: String, balance: Long, pending: Int = 0, archived: Boolean = false) =
    AccountBalance("id-$name", name, type, currency, if (archived) "2026-09-01T00:00:00Z" else null, null, balance, pending)

/** Home (ADR 0046): the pure rules for the month's bar and the account groups, and what the content shows. A plain Application, as the other Compose tests. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class HomeContentTest {
    @get:Rule
    val compose = createComposeRule()

    private fun usd(amount: Long) = Money(amount, "USD")

    @Test
    fun theMonthsBarIsTheShareOfMoneyInThatWentOut() {
        val flow = cashFlow(usd(100000), usd(40000))!!
        assertEquals(usd(60000), flow.net)
        assertEquals(0.4f, flow.share, 0.0001f)
        assertEquals(LimitState.Within, flow.state)
        assertEquals(LimitState.Near, cashFlow(usd(100000), usd(95000))!!.state)
        assertEquals(LimitState.Over, cashFlow(usd(100000), usd(100001))!!.state)
        assertEquals(usd(-1), cashFlow(usd(100000), usd(100001))!!.net)
        assertEquals(1f, cashFlow(usd(100000), usd(250000))!!.share, 0f)
    }

    @Test
    fun aMonthWithNothingInIsAnEmptyBarUnlessSomethingWentOut() {
        assertEquals(0f, cashFlow(usd(0), usd(0))!!.share, 0f)
        assertEquals(LimitState.Within, cashFlow(usd(0), usd(0))!!.state)
        assertEquals(1f, cashFlow(usd(0), usd(500))!!.share, 0f)
        assertEquals(LimitState.Over, cashFlow(usd(0), usd(500))!!.state)
    }

    @Test
    fun noNetIsMadeOfTwoCurrencies() {
        assertNull(cashFlow(usd(100), Money(100, "BDT")))
    }

    @Test
    fun cardsAndLoansAreDebtAndEverythingElseIsToHand() {
        assertEquals(AccountKind.Debt, accountKind("card"))
        assertEquals(AccountKind.Debt, accountKind("loan"))
        listOf("bank", "cash", "wallet", "savings", "other", "anything").forEach { assertEquals(AccountKind.Liquid, accountKind(it)) }
    }

    @Test
    fun accountsGroupToHandFirstAndNarrowToACurrency() {
        val items = listOf(
            account("Cash", "cash", "USD", 100), account("Amex", "card", "USD", -500), account("Brac", "bank", "BDT", 900), account("Affirm", "loan", "USD", -50),
        )
        assertEquals(listOf(AccountKind.Liquid to listOf("Cash", "Brac"), AccountKind.Debt to listOf("Amex", "Affirm")), groupAccounts(items, null).map { it.kind to it.items.map { a -> a.name } })
        assertEquals(listOf(AccountKind.Liquid to listOf("Brac")), groupAccounts(items, "BDT").map { it.kind to it.items.map { a -> a.name } })
        assertEquals(emptyList<AccountGroup>(), groupAccounts(items, "EUR"))
    }

    @Test
    fun currenciesComeMostUsedFirst() {
        val items = listOf(account("a", "bank", "BDT", 1), account("b", "bank", "USD", 1), account("c", "bank", "USD", 1), account("d", "bank", "EUR", 1))
        assertEquals(listOf("USD", "BDT", "EUR"), currenciesOf(items))
        assertEquals(emptyList<String>(), currenciesOf(emptyList()))
    }

    private fun show(
        month: Online<app.ledgerline.api.HomeSummary> = Online.Ready(homeSummary()),
        accounts: List<AccountBalance> = emptyList(),
        currency: String? = null,
        hidden: Boolean = false,
        status: SyncStatus = quietSync,
        actions: HomeActions = noHomeActions,
    ) = compose.setContent {
        LedgerlineTheme {
            CompositionLocalProvider(LocalPrivacy provides hidden) {
                HomeContent(status, month, Mirrored.Ready(accounts), currency, hidden, actions, Modifier.requiredHeight(4000.dp))
            }
        }
    }

    @Test
    fun theCurrencyControlShowsOnlyWithAccountsInTwoCurrenciesAndNarrowsOnATap() {
        var chosen: String? = "none"
        show(accounts = listOf(account("Cash", "cash", "USD", 100), account("Brac", "bank", "BDT", 900)), actions = noHomeActions.copy(onSelectCurrency = { chosen = it }))
        compose.onNodeWithText("BDT").performClick()
        assertEquals("BDT", chosen)
        compose.onNodeWithText("All").performClick()
        assertNull(chosen)
    }

    @Test
    fun withOneCurrencyThereIsNoCurrencyControl() {
        show(accounts = listOf(account("Cash", "cash", "USD", 100), account("Chase", "bank", "USD", 900)))
        compose.onNodeWithText("USD").assertDoesNotExist()
        compose.onNodeWithText("All").assertDoesNotExist()
    }

    @Test
    fun aChosenCurrencyNoAccountHasShowsEverything() {
        show(accounts = listOf(account("Cash", "cash", "USD", 100), account("Brac", "bank", "BDT", 900)), currency = "EUR")
        compose.onNodeWithContentDescription("Cash", substring = true).assertExists()
        compose.onNodeWithContentDescription("Brac", substring = true).assertExists()
    }

    @Test
    fun onlyMoneyToHandSaysOverdrawn() {
        show(accounts = listOf(account("Chase", "bank", "USD", -2500), account("Amex", "card", "USD", -778830)))
        compose.onNodeWithContentDescription("Chase", substring = true).assertExists()
        compose.onNodeWithContentDescription("Chase, -\$25.00, Bank · Overdrawn").assertExists()
        compose.onNodeWithContentDescription("Amex, -\$7,788.30, Card").assertExists()
    }

    @Test
    fun groupsCarryTheirCounts() {
        show(accounts = listOf(account("Cash", "cash", "USD", 100), account("Chase", "bank", "USD", 900), account("Amex", "card", "USD", -5)))
        compose.onNodeWithText("CASH AND BANKING (2)").assertExists()
        compose.onNodeWithText("CARDS AND LOANS (1)").assertExists()
    }

    @Test
    fun theHeroHoldsOwedWithItsClientCountAndLentAndExplainsNothing() {
        show(month = Online.Ready(homeSummary(250000)))
        compose.onNodeWithContentDescription("In hand", substring = true).assertExists()
        compose.onNodeWithContentDescription("Owed to you (2) \$2,500.00", substring = true).assertExists()
        compose.onNodeWithContentDescription("Lent out \$2,500.00", substring = true).assertExists()
        compose.onNodeWithContentDescription("Not counting", substring = true).assertDoesNotExist()
    }

    @Test
    fun owedAndLentLeaveTheHeroWhenTheyAreNothing() {
        val nothing = homeSummary().let { it.copy(owed = HomeOwed(usd(0), 0, emptyList(), emptyList()), loans = it.loans.copy(lent = usd(0), borrowed = usd(0))) }
        show(month = Online.Ready(nothing))
        compose.onNodeWithContentDescription("In hand", substring = true).assertExists()
        compose.onNodeWithContentDescription("Owed to you", substring = true).assertDoesNotExist()
        compose.onNodeWithContentDescription("Lent out", substring = true).assertDoesNotExist()
    }

    @Test
    fun youOweAppearsOnlyWhenSomethingIsBorrowed() {
        val none = homeSummary().let { it.copy(loans = it.loans.copy(borrowed = usd(0))) }
        show(month = Online.Ready(none))
        compose.onNodeWithContentDescription("You owe", substring = true).assertDoesNotExist()
    }

    @Test
    fun theMonthCardOpensInsightsAndReadsMoneyInOutAndNet() {
        var opened = 0
        val month = homeSummary().copy(moneyIn = usd(79400), moneyOut = usd(45942))
        show(month = Online.Ready(month), actions = noHomeActions.copy(onOpenInsights = { opened++ }))
        compose.onNodeWithContentDescription("This month, Money in \$794.00, Money out \$459.42, Net \$334.58, Open Insights").performClick()
        assertEquals(1, opened)
    }

    @Test
    fun theHideAmountsSwitchShowsItsStateAndToggles() {
        var toggled = 0
        show(hidden = true, actions = noHomeActions.copy(onToggleHide = { toggled++ }))
        compose.onNodeWithText("Hide amounts").assertIsSelected().performClick()
        assertEquals(1, toggled)
    }

    @Test
    fun theTopBarNamesTheMonth() {
        show(month = Online.Ready(homeSummary(month = "2026-10")))
        compose.onNodeWithText("October 2026").assertExists()
    }

    @Test
    fun whatNeedsTheOwnerAndWhatIsPendingAreOneLineEachAboveTheHero() {
        var attention = 0
        var pending = 0
        show(
            month = Online.Ready(homeSummary().copy(pendingCount = 3)),
            status = SyncStatus(quietSync.line, unsent = 2, attention = 1),
            actions = noHomeActions.copy(onOpenAttention = { attention++ }, onOpenPending = { pending++ }),
        )
        compose.onNodeWithText("1 change needs your attention").performClick()
        compose.onNodeWithText("3 pending entries aren't counted yet.").performClick()
        assertEquals(1, attention)
        assertEquals(1, pending)
    }

    @Test
    fun withoutAnyAccountsHomeSaysSo() {
        show(accounts = emptyList())
        compose.onNodeWithText("No accounts yet. Add them in the web app.").assertExists()
    }

    @Test
    fun theOwedFigureKeepsItsRateNotes() {
        val owed = HomeOwed(usd(5000), 2, listOf("BDT"), listOf("BDT"))
        show(month = Online.Ready(homeSummary().copy(owed = owed)))
        compose.onNodeWithContentDescription("Not counting BDT until it has a rate.", substring = true).assertExists()
    }

    @Test
    fun heroFiguresShareARowOnlyWhenTheTextAndTheAmountsAreShort() {
        org.junit.Assert.assertEquals(2, heroFiguresPerRow(1f, listOf("\$2,500.00", "\$891.89")))
        org.junit.Assert.assertEquals(2, heroFiguresPerRow(1.3f, listOf("\$12,500.00")))
        org.junit.Assert.assertEquals(1, heroFiguresPerRow(1.31f, listOf("\$2,500.00")))
        org.junit.Assert.assertEquals(1, heroFiguresPerRow(1f, listOf("\$2,500.00", "\$1,234,567,890.12")))
        org.junit.Assert.assertEquals(2, heroFiguresPerRow(1f, listOf("•••••", "•••••")))
    }

    @Test
    fun archivedAccountsFollowTheChosenCurrency() {
        val items = listOf(
            account("Cash", "cash", "USD", 100), account("Brac", "bank", "BDT", 900),
            account("Old dollars", "bank", "USD", 0, archived = true), account("Old taka", "bank", "BDT", 0, archived = true),
        )
        show(accounts = items, currency = "USD")
        compose.onNodeWithContentDescription("Old dollars", substring = true).assertExists()
        compose.onNodeWithContentDescription("Old taka", substring = true).assertDoesNotExist()
    }

    @Test
    fun archivedAccountsAllShowWithoutAChosenCurrency() {
        val items = listOf(
            account("Cash", "cash", "USD", 100), account("Brac", "bank", "BDT", 900),
            account("Old dollars", "bank", "USD", 0, archived = true), account("Old taka", "bank", "BDT", 0, archived = true),
        )
        show(accounts = items, currency = null)
        compose.onNodeWithContentDescription("Old dollars", substring = true).assertExists()
        compose.onNodeWithContentDescription("Old taka", substring = true).assertExists()
    }

    @Test
    fun nothingNeedingTheOwnerMeansNoNoteAboutIt() {
        show(status = SyncStatus(quietSync.line, unsent = 0, attention = 0), month = Online.Ready(homeSummary().copy(pendingCount = 0)))
        compose.onNodeWithText("need your attention", substring = true).assertDoesNotExist()
        compose.onNodeWithText("needs your attention", substring = true).assertDoesNotExist()
    }
}
