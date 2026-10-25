package app.ledgerline.android.ui.budgets

import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.privacy.LocalPrivacy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate

/** Budgets (ADR 0046): a top bar with the month, a hero, one ranked list and a folded line; read-only. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class BudgetsContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val today = LocalDate.of(2026, 10, 24)

    private class Taps {
        var previous = 0
        var next = 0
        var retry = 0
    }

    private fun show(
        state: Online<app.ledgerline.api.BudgetMonth>,
        taps: Taps = Taps(),
        month: String = "2026-10",
        private: Boolean = false,
    ) = compose.setContent {
        CompositionLocalProvider(LocalPrivacy provides private) {
            BudgetsContent(month, state, { taps.previous++ }, { taps.next++ }, { taps.retry++ }, Modifier.requiredHeight(3000.dp), today)
        }
    }

    private val budgeted = Online.Ready(
        budgetMonth(
            items = listOf(
                budgetLine("Interest", 20000, 19228),
                budgetLine("Transport", 10000, 6956),
                budgetLine("Fun", 1000, 1200),
                budgetLine("Idle", 5000, 0),
                budgetLine("Housing", null, 0),
                budgetLine("Family", null, 0),
            ),
        ),
    )

    @Test
    fun theTopBarHasTheTitleAndTheMonthWithPreviousAndNext() {
        val taps = Taps()
        show(budgeted, taps)
        compose.onNodeWithText("Budgets").assertExists()
        compose.onNodeWithText("October 2026").assertExists()
        compose.onNodeWithContentDescription("Previous month").performClick()
        compose.onNodeWithContentDescription("Next month").performClick()
        compose.onNodeWithContentDescription("Next month").performClick()
        assertEquals(1, taps.previous)
        assertEquals(2, taps.next)
    }

    @Test
    fun theOldHeaderIsGone() {
        show(budgeted)
        compose.onNodeWithText("Your personal ledger").assertDoesNotExist()
        compose.onNodeWithText("YOUR PERSONAL LEDGER").assertDoesNotExist()
    }

    @Test
    fun theHeroShowsWhatIsLeftOfTheAllowanceHowMuchIsUsedAndTheDaysLeft() {
        show(budgeted)
        // Allowance 20,000 + 10,000 + 1,000 + 5,000 = 360.00; spent 273.84 (19,228 + 6,956 + 1,200); left 86.16.
        compose.onNodeWithText("Left this month").assertExists()
        compose.onNodeWithText("$86.16").assertExists()
        compose.onNodeWithText("of $360.00").assertExists()
        compose.onNodeWithText("76% used · 7 days left").assertExists()
    }

    @Test
    fun theHeroGoesRedWordsWhenTheMonthIsOverAndNamesNoDaysOutsideTheCurrentMonth() {
        show(Online.Ready(budgetMonth("2026-09", listOf(budgetLine("Fun", 1000, 5000)))), month = "2026-09")
        compose.onNodeWithText("-$40.00").assertExists()
        compose.onNodeWithText("500% used").assertExists()
    }

    @Test
    fun aRowSaysWhatIsLeftAndHowMuchIsUsedWithSpentOfTheBudgetBesideIt() {
        show(budgeted)
        compose.onNodeWithText("$7.72 left (96%)").assertExists()
        compose.onNodeWithText("$192.28").assertExists()
        compose.onNodeWithText("of $200.00").assertExists()
        compose.onNodeWithText("$30.44 left (70%)").assertExists()
    }

    @Test
    fun anOverspentRowSaysHowMuchOver() {
        show(budgeted)
        compose.onNodeWithText("$2.00 over (120%)").assertExists()
    }

    @Test
    fun aBudgetedCategoryWithNothingSpentIsStillThere() {
        show(budgeted)
        compose.onNodeWithText("Idle").assertExists()
        compose.onNodeWithText("$50.00 left (0%)").assertExists()
    }

    @Test
    fun whatCarriedOverAndWhatWasOverspentBeforeStayOnTheirRows() {
        show(Online.Ready(budgetMonth(items = listOf(budgetLine("Food", 30000, 12883, carriedIn = 30000), budgetLine("Cars", 15000, 21000, carriedIn = -2500)))))
        compose.onNodeWithText("Carried over $300.00").assertExists()
        compose.onNodeWithText("Overspent $25.00").assertExists()
    }

    @Test
    fun spendingWithoutABudgetStaysAsALineAndOnItsRow() {
        show(Online.Ready(budgetMonth(items = listOf(budgetLine("Food", 30000, 12883), budgetLine("Health", null, 1000)))))
        compose.onNodeWithText("Spent without a budget: $10.00").assertExists()
        compose.onNodeWithText("No budget").assertExists()
    }

    @Test
    fun theUnspentUnbudgetedCategoriesFoldIntoOneLineThatOpens() {
        show(budgeted)
        compose.onNodeWithText("2 categories with nothing planned or spent").assertExists()
        compose.onNodeWithText("Housing").assertDoesNotExist()
        compose.onNodeWithText("2 categories with nothing planned or spent").performClick()
        compose.onNodeWithText("Housing").assertExists()
        compose.onNodeWithText("Family").assertExists()
    }

    @Test
    fun noFoldedLineWhenEveryCategoryHasSomething() {
        show(Online.Ready(budgetMonth(items = listOf(budgetLine("Food", 100, 0)))))
        compose.onNodeWithText("category with nothing planned or spent", substring = true).assertDoesNotExist()
    }

    @Test
    fun withNoBudgetsTheHeroSaysWhatWasSpentAndRowsShowTheirShareOfIt() {
        show(Online.Ready(budgetMonth(items = listOf(budgetLine("Interest", null, 19228), budgetLine("Personal", null, 9901), budgetLine("Zero", null, 0)))))
        compose.onNodeWithText("No monthly target yet").assertExists()
        compose.onNodeWithText("Spent $291.29 across 2 categories").assertExists()
        compose.onNodeWithText("66.0% of Oct spend").assertExists()
        compose.onNodeWithText("34.0% of Oct spend").assertExists()
        compose.onNodeWithText("Left this month").assertDoesNotExist()
        compose.onNodeWithText("1 category with nothing planned or spent").assertExists()
    }

    @Test
    fun withNoBudgetsAndNothingSpentTheHeroSaysSo() {
        show(Online.Ready(budgetMonth("2026-11", listOf(budgetLine("Food", null, 0)))), month = "2026-11")
        compose.onNodeWithText("No monthly target yet").assertExists()
        compose.onNodeWithText("Nothing spent yet").assertExists()
    }

    @Test
    fun withNoCategoriesItSaysSo() {
        show(Online.Ready(budgetMonth(items = emptyList())))
        compose.onNodeWithText("No expense categories yet").assertExists()
    }

    @Test
    fun loadingOfflineAndFailedEachHaveTheirOwnNote() {
        val taps = Taps()
        show(Online.Offline, taps)
        compose.onNodeWithText("Budgets need a connection.").assertExists()
        compose.onNodeWithText("Try again").performClick()
        assertEquals(1, taps.retry)
    }

    @Test
    fun failedOffersTryAgain() {
        val taps = Taps()
        show(Online.Failed, taps)
        compose.onNodeWithText("Your budgets could not be loaded.").assertExists()
        compose.onNodeWithText("Try again").performClick()
        assertEquals(1, taps.retry)
    }

    @Test
    fun loadingSaysSo() {
        show(Online.Loading)
        compose.onNodeWithText("Loading your budgets…").assertExists()
    }

    @Test
    fun everyAmountIsMaskedUnderPrivacyMode() {
        show(budgeted, private = true)
        compose.onNodeWithText("$86.16").assertDoesNotExist()
        compose.onNodeWithText("$192.28").assertDoesNotExist()
        compose.onNodeWithText("of $200.00").assertDoesNotExist()
        compose.onNodeWithText("$7.72 left (96%)").assertDoesNotExist()
    }

    @Test
    fun aRowIsAtLeast56DpTall() {
        show(Online.Ready(budgetMonth(items = listOf(budgetLine("Food", 30000, 12883)))))
        val bounds = compose.onNodeWithTag("row-Food").getBoundsInRoot()
        assertTrue("${bounds.bottom - bounds.top}", (bounds.bottom - bounds.top).value >= 56f)
    }

    /** The colour a text is drawn in, read from its laid-out style. */
    private fun colorOf(text: String): androidx.compose.ui.graphics.Color {
        val results = mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        val node = compose.onNodeWithText(text).fetchSemanticsNode()
        node.config[androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult].action?.invoke(results)
        return results.single().layoutInput.style.color
    }

    private val danger = app.ledgerline.android.ui.theme.LightPalette.danger

    @Test
    fun whatIsOverIsRedAndWhatIsLeftIsNot() {
        show(budgeted)
        assertEquals(danger, colorOf("$2.00 over (120%)"))
        assertTrue(colorOf("$7.72 left (96%)") != danger)
    }

    @Test
    fun theHeroFigureIsRedOnlyWhenTheMonthIsOver() {
        show(Online.Ready(budgetMonth("2026-09", listOf(budgetLine("Fun", 1000, 5000)))), month = "2026-09")
        assertEquals(danger, colorOf("-$40.00"))
    }

    @Test
    fun theHeroFigureIsNotRedWhenSomethingIsLeft() {
        show(budgeted)
        assertTrue(colorOf("$86.16") != danger)
    }

    @Test
    fun whatCarriedInCountsTowardsWhatIsLeftAndThePercentButNotTheBudgetShown() {
        show(Online.Ready(budgetMonth(items = listOf(budgetLine("Food", 30000, 12883, carriedIn = 30000)))))
        // Allowance 600.00 (300.00 budget + 300.00 carried), spent 128.83: left 471.17, 21% used; "of" is the budget.
        compose.onNodeWithText("$471.17 left (21%)").assertExists()
        compose.onNodeWithText("of $300.00").assertExists()
    }

    @Test
    fun aLineWithNoBudgetShowsNoCarriedOverLine() {
        show(Online.Ready(budgetMonth(items = listOf(budgetLine("Food", 100, 0), budgetLine("Odd", null, 500, carriedIn = 700)))))
        compose.onNodeWithText("Carried over $7.00").assertDoesNotExist()
    }

    @Test
    fun aRowWithNoBarIsStillAtLeast56DpTall() {
        show(Online.Ready(budgetMonth(items = listOf(budgetLine("Food", 30000, 100), budgetLine("Health", null, 1000)))))
        val bounds = compose.onNodeWithTag("row-Health").getBoundsInRoot()
        assertTrue("${bounds.bottom - bounds.top}", (bounds.bottom - bounds.top).value >= 56f)
    }

    /** The title keeps a line to itself, so a long month or the largest text cannot squeeze it into pieces. */
    @Test
    fun theMonthSitsUnderTheTitleNotBesideIt() {
        show(budgeted)
        val title = compose.onNodeWithText("Budgets").getBoundsInRoot()
        val month = compose.onNodeWithText("October 2026").getBoundsInRoot()
        assertTrue("month ${month.top} under title ${title.bottom}", month.top >= title.bottom)
    }
}
