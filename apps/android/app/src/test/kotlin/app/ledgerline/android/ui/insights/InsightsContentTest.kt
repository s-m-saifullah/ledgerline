package app.ledgerline.android.ui.insights

import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.api.CashFlowMonth
import app.ledgerline.api.Money
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Insights (ADR 0046): a top bar with the month, one summary card, one category card, a 12-month chart only with activity, net worth. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class InsightsContentTest {
    @get:Rule
    val compose = createComposeRule()

    private var previous = 0
    private var next = 0

    private fun show(data: Insights = insights(), snapshot: WorthSnapshot? = null, private: Boolean = false, open: Set<String> = emptySet()) =
        compose.setContent {
            CompositionLocalProvider(LocalPrivacy provides private) {
                InsightsContent("2026-10", Online.Ready(data), open, {}, {}, { previous++ }, { next++ }, {}, Modifier.requiredHeight(4000.dp), snapshot)
            }
        }

    private fun quiet(data: Insights, vararg activeMonths: Int): Insights {
        val months = data.cashFlow.months.mapIndexed { i, row ->
            if (i in activeMonths) row else CashFlowMonth(row.month, Money(0, "USD"), Money(0, "USD"), Money(0, "USD"))
        }
        return data.copy(cashFlow = data.cashFlow.copy(months = months))
    }

    @Test
    fun theTopBarHasTheTitleAndTheMonthWithPreviousAndNext() {
        show()
        compose.onNodeWithText("Insights").assertExists()
        compose.onNodeWithText("October 2026").assertExists()
        compose.onNodeWithContentDescription("Previous month").performClick()
        compose.onNodeWithContentDescription("Next month").performClick()
        compose.onNodeWithContentDescription("Next month").performClick()
        assertEquals(1, previous)
        assertEquals(2, next)
    }

    @Test
    fun theOldHeaderIsGone() {
        show()
        compose.onNodeWithText("Your personal ledger").assertDoesNotExist()
    }

    @Test
    fun theSummaryShowsWhatWasSpentMoneyInAndNet() {
        show()
        compose.onNodeWithText("$761.47").assertExists()
        compose.onNodeWithText("Money in $2,500.00 · Net $1,738.53").assertExists()
    }

    @Test
    fun theSummaryNamesWhatWasSpentAndKeptWithTheirShares() {
        show()
        compose.onNodeWithText("$761.47 · 30.5%").assertExists()
        compose.onNodeWithText("$1,738.53 · 69.5%").assertExists()
    }

    @Test
    fun whenMoreWentOutThanCameInNothingIsKept() {
        show(insights(spent = 300000, income = 250000))
        compose.onNodeWithText("Kept").assertDoesNotExist()
    }

    @Test
    fun spendingExactlyWhatCameInKeepsNothingButStillSaysSo() {
        show(insights(spent = 250000, income = 250000))
        compose.onNodeWithText("$0.00 · 0.0%").assertExists()
    }

    @Test
    fun aMainCategoryRowSaysWhetherItIsOpen() {
        show()
        compose.onNodeWithTag("row-Food").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Collapsed"))
        compose.onNodeWithTag("row-Fun").assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.StateDescription))
    }

    @Test
    fun anOpenMainCategoryRowSaysItIsExpanded() {
        show(open = setOf("c-food"))
        compose.onNodeWithTag("row-Food").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Expanded"))
    }

    @Test
    fun withNoMoneyInNothingIsKept() {
        show(insights(spent = 30000, income = 0))
        compose.onNodeWithText("Kept").assertDoesNotExist()
    }

    @Test
    fun aCategoryRowHintsItsShareAndAMainCategoryItsSubcategories() {
        show()
        compose.onNodeWithText("40.0%").assertExists()
        compose.onNodeWithText("60.0% · 1 subcategory").assertExists()
    }

    @Test
    fun anOpenMainCategoryListsItsSubcategoriesWithTheirAmounts() {
        show(open = setOf("c-food"))
        compose.onNodeWithText("Groceries").assertExists()
        compose.onNodeWithText("Directly in Food").assertExists()
    }

    @Test
    fun theDirectlyInLineIsLeftOutWhenTheSubcategoriesAccountForEverything() {
        val data = insights()
        val food = data.spending.categories.first { it.categoryId == "c-food" }
        val whole = food.copy(children = food.children.map { it.copy(amount = food.amount) })
        show(data.copy(spending = data.spending.copy(categories = listOf(whole))), open = setOf("c-food"))
        compose.onNodeWithText("Groceries").assertExists()
        compose.onNodeWithText("Directly in Food").assertDoesNotExist()
    }

    @Test
    fun everyRowHasABarIncludingSubcategories() {
        show(open = setOf("c-food"))
        for (name in listOf("Food", "Fun", "Groceries", "Directly in Food")) compose.onNodeWithTag("bar-$name", useUnmergedTree = true).assertExists()
    }

    @Test
    fun aClosedMainCategoryHidesItsSubcategories() {
        show()
        compose.onNodeWithText("Groceries").assertDoesNotExist()
    }

    @Test
    fun theTwelveMonthChartIsLeftOutWithOnlyOneMonthOfActivity() {
        show(quiet(insights(), 11))
        compose.onNodeWithText("Money in and out, 12 months", ignoreCase = true).assertDoesNotExist()
        compose.onNodeWithText("Nothing recorded in these months.").assertDoesNotExist()
    }

    @Test
    fun theTwelveMonthChartShowsWithTwoMonthsOfActivity() {
        show(quiet(insights(), 10, 11))
        compose.onNodeWithText("Money in and out, 12 months", ignoreCase = true).assertExists()
    }

    @Test
    fun theFiguresLeaveOutMonthsWithoutActivity() {
        show(quiet(insights(), 10, 11), open = setOf(CashFlowFigures))
        compose.onNode(hasContentDescription("Oct 2026:", substring = true)).assertExists()
        compose.onNode(hasContentDescription("Sep 2026:", substring = true)).assertExists()
        compose.onNode(hasContentDescription("Aug 2026:", substring = true)).assertDoesNotExist()
    }

    @Test
    fun theSnapshotShowsNetWorthNowWithAssetsAndLiabilities() {
        show(snapshot = WorthSnapshot(Money(155000, "USD"), Money(-142000, "USD"), Money(13000, "USD")))
        compose.onNodeWithText("Net worth now", ignoreCase = true).assertExists()
        compose.onNodeWithText("$130.00").assertExists()
        compose.onNodeWithText("Assets").assertExists()
        compose.onNodeWithText("$1,550.00").assertExists()
        compose.onNodeWithText("Liabilities").assertExists()
        compose.onNodeWithText("-$1,420.00").assertExists()
    }

    @Test
    fun withoutASnapshotThereIsNoNetWorthNowCard() {
        show()
        compose.onNodeWithText("Net worth now", ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun privacyModeHidesTheSummarySnapshotAndRows() {
        show(snapshot = WorthSnapshot(Money(155000, "USD"), Money(-142000, "USD"), Money(13000, "USD")), private = true, open = setOf("c-food"))
        for (text in listOf("$761.47", "$1,738.53", "$130.00", "$1,550.00", "$446.88")) compose.onNodeWithText(text, substring = true).assertDoesNotExist()
    }
}
