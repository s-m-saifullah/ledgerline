package app.ledgerline.android.ui.home

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.design.Choice
import app.ledgerline.android.ui.insights.insights
import app.ledgerline.android.ui.theme.LedgerlineTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.YearMonth

/** The filters of Transactions, as plain data: what each control shows and what it asks for. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class EntryFiltersPanelTest {
    @get:Rule
    val compose = createComposeRule()

    private val options = FilterOptions(
        accounts = listOf(Choice("a1", "Checking"), Choice("a2", "Cash")),
        categories = listOf(Choice("c1", "Food"), Choice("c2", "Food › Groceries")),
        tags = listOf(Choice("t1", "work")),
    )

    private var changed = mutableListOf<EntryFilters>()
    private var applied = mutableListOf<EntryFilters>()
    private var opened = 0
    private var closed = 0

    private fun bar(filters: EntryFilters = EntryFilters(), fontScale: Float = 1f) {
        compose.setContent {
            val density = androidx.compose.ui.platform.LocalDensity.current
            androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(density.density, fontScale)) {
                LedgerlineTheme {
                    androidx.compose.foundation.layout.Box(Modifier.requiredHeight(3000.dp)) { EntryFilterBar(filters, { changed += it }, { opened++ }) }
                }
            }
        }
    }

    /** The sheet as its host holds it: each change is kept as the filters, so the sheet shows what it just asked for. */
    private fun sheet(filters: EntryFilters = EntryFilters(), fontScale: Float = 1f) {
        compose.setContent {
            val density = androidx.compose.ui.platform.LocalDensity.current
            androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(density.density, fontScale)) {
                LedgerlineTheme {
                    var current by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(filters) }
                    androidx.compose.foundation.layout.Box(Modifier.requiredHeight(3000.dp)) {
                        EntryFiltersSheetContent(current, options, { applied += it; current = it }, { closed++ })
                    }
                }
            }
        }
    }

    @Test
    fun typingInTheSearchAsksForThatText() {
        bar()
        compose.onNode(hasSetTextAction()).performTextInput("cafe")
        assertEquals("cafe", changed.last().text)
    }

    @Test
    fun theTypeChipsSetTheKindAndAllClearsIt() {
        bar(EntryFilters(kind = "income"))
        compose.onNodeWithText("Income").assertIsSelected()
        compose.onNodeWithText("All").assertIsNotSelected()
        compose.onNodeWithText("Expenses").performClick()
        assertEquals("expense", changed.last().kind)
        compose.onNodeWithText("Transfers").performClick()
        assertEquals("transfer", changed.last().kind)
        compose.onNodeWithText("All").performClick()
        assertNull(changed.last().kind)
    }

    @Test
    fun theFiltersButtonCountsEveryFilterButTheSearchAndTheTypeAndOpensTheSheet() {
        bar(EntryFilters(text = "x", kind = "expense", accountId = "a1", from = "2026-10-01"))
        compose.onNodeWithContentDescription("Filters (2)").performClick()
        assertEquals(1, opened)
    }

    @Test
    fun withNoSheetFilterTheButtonHasNoCount() {
        bar(EntryFilters(text = "only a search", kind = "income"))
        compose.onNodeWithContentDescription("Filters").assertExists()
        compose.onNodeWithContentDescription("Filters (1)").assertDoesNotExist()
    }

    @Test
    fun theSheetOffersEveryFilterButTheTypeWhichHasChips() {
        sheet()
        listOf("Account", "Category", "Tag", "From date", "To date", "Cleared", "Pending").forEach { compose.onNodeWithText(it).assertExists() }
        compose.onNodeWithText("Entry type").assertDoesNotExist()
    }

    @Test
    fun everyChoiceTakesEffectAtOnce() {
        sheet()
        compose.onNodeWithText("Pending").performClick()
        assertEquals("pending", applied.single().status)
    }

    @Test
    fun thereIsNoApplyAndNoCancelButtonJustClose() {
        sheet()
        compose.onNodeWithText("Apply").assertDoesNotExist()
        compose.onNodeWithText("Cancel").assertDoesNotExist()
        compose.onNodeWithText("Close").assertExists()
    }

    @Test
    fun closeClosesTheSheetAndChangesNothing() {
        sheet(EntryFilters(accountId = "a1"))
        compose.onNodeWithText("Close").performClick()
        assertEquals(1, closed)
        assertEquals(emptyList<EntryFilters>(), applied)
    }

    @Test
    fun choosingAFilterDoesNotChangeTheSheetsHeight() {
        sheet()
        fun height() = compose.onNodeWithText("Status").fetchSemanticsNode().boundsInRoot.top - compose.onNodeWithText("Filters").fetchSemanticsNode().boundsInRoot.top
        val before = height()
        compose.onNodeWithText("Pending").performClick()
        compose.onNodeWithText("Reset all").assertExists()
        assertEquals(before, height())
        compose.onNodeWithText("All").performClick()
        compose.onNodeWithText("Reset all").assertDoesNotExist()
        assertEquals(before, height())
    }

    @Test
    fun aChoiceKeepsTheSearchAndTheTypeTheSheetWasOpenedWith() {
        sheet(EntryFilters(text = "cafe", kind = "income"))
        compose.onNodeWithText("Cleared").performClick()
        assertEquals(EntryFilters(text = "cafe", kind = "income", status = "cleared"), applied.single())
    }

    @Test
    fun resetAllShowsOnlyWhileASheetFilterIsSet() {
        sheet()
        compose.onNodeWithText("Reset all").assertDoesNotExist()
    }

    @Test
    fun resetAllClearsTheSheetFiltersAtOnceButNotTheSearchOrTheType() {
        sheet(EntryFilters(accountId = "a1", text = "x", status = "pending", kind = "income", from = "2026-10-01"))
        compose.onNodeWithText("Reset all").performClick()
        assertEquals(EntryFilters(text = "x", kind = "income"), applied.single())
        compose.onNodeWithText("Reset all").assertDoesNotExist()
    }

    @Test
    fun pickingAnAccountTakesEffectAtOnce() {
        sheet()
        compose.onNodeWithText("Account").performClick()
        // The box shows its choice ("All accounts") and the open list offers it again, with the accounts.
        assertEquals(2, compose.onAllNodesWithText("All accounts").fetchSemanticsNodes().size)
        compose.onNodeWithText("Cash").performClick()
        assertEquals("a2", applied.single().accountId)
    }

    @Test
    fun allAccountsClearsTheAccountFilter() {
        sheet(EntryFilters(accountId = "a1"))
        compose.onNodeWithText("Account").performClick()
        compose.onNodeWithText("All accounts").performClick()
        assertNull(applied.single().accountId)
    }

    @Test
    fun theCategoryFilterFindsSubcategoriesToo() {
        sheet(EntryFilters(categoryId = "c1", includeSubcategories = false))
        compose.onNodeWithText("Category").performClick()
        compose.onNodeWithText("Food › Groceries").performClick()
        assertEquals(EntryFilters(categoryId = "c2", includeSubcategories = true), applied.single())
    }

    @Test
    fun anUnsetDateIsAnAnyDatePillAndASetOneShowsTheDay() {
        sheet(EntryFilters(from = "2026-10-05"))
        compose.onNodeWithText("Oct 5, 2026").assertExists()
        // To has no date: one "Any date" pill, and From has the day instead.
        assertEquals(1, compose.onAllNodesWithText("Any date").fetchSemanticsNodes().size)
    }

    @Test
    fun aDatesCrossClearsItAtOnce() {
        sheet(EntryFilters(from = "2026-10-05"))
        compose.onNodeWithContentDescription("Clear From date").performClick()
        assertNull(applied.single().from)
    }

    @Test
    fun theToDatesCrossClearsOnlyTheToDate() {
        sheet(EntryFilters(from = "2026-10-05", to = "2026-10-20"))
        compose.onNodeWithContentDescription("Clear To date").performClick()
        assertEquals(EntryFilters(from = "2026-10-05", to = null), applied.single())
    }

    @Test
    fun theSheetsCloseButtonDismissesTheSheetItself() {
        compose.setContent { LedgerlineTheme { EntryFiltersSheet(EntryFilters(), options, { applied += it }, { closed++ }) } }
        compose.onNodeWithText("Close").performClick()
        assertEquals(1, closed)
        assertEquals(emptyList<EntryFilters>(), applied)
    }

    @Test
    fun aDatePillOpensTheSharedPickerAndCancelChangesNothing() {
        sheet()
        compose.onAllNodesWithText("Any date")[0].performClick()
        compose.onNode(androidx.compose.ui.test.hasText("OK") and androidx.compose.ui.test.hasAnyAncestor(androidx.compose.ui.test.isDialog())).assertExists()
        compose.onNode(androidx.compose.ui.test.hasText("Cancel") and androidx.compose.ui.test.hasAnyAncestor(androidx.compose.ui.test.isDialog())).performClick()
        assertEquals(emptyList<EntryFilters>(), applied)
    }

    @Test
    fun anEndDateBeforeTheStartIsExplainedInTheBar() {
        bar(EntryFilters(from = "2026-10-31", to = "2026-10-01"))
        compose.onNodeWithText("Choose an end date on or after the start date.").assertExists()
    }

    @Test
    fun aBadRangeIsExplainedInTheSheetToo() {
        sheet(EntryFilters(from = "2026-10-31", to = "2026-10-01"))
        compose.onNodeWithText("Choose an end date on or after the start date.").assertExists()
    }

    @Test
    fun twoFieldsShareARowOnlyOnAWideSheetWithNormalText() {
        assertEquals(true, sheetTwoColumns(358.dp, 1f))
        assertEquals(true, sheetTwoColumns(340.dp, 1.15f))
        assertEquals(false, sheetTwoColumns(339.dp, 1f))
        assertEquals(false, sheetTwoColumns(358.dp, 1.16f))
        assertEquals(false, sheetTwoColumns(288.dp, 1f))
    }

    @Test
    fun theSheetCountIgnoresTheSearchAndTheType() {
        assertEquals(0, EntryFilters(text = "x", kind = "income").sheetCount)
        assertEquals(3, EntryFilters(accountId = "a", tagId = "t", status = "pending", kind = "expense", text = "q").sheetCount)
    }

    @Test
    fun anEmptyListSaysWhetherFiltersAreTheReason() {
        compose.setContent {
            androidx.compose.foundation.layout.Column {
                TransactionsContent(
                    status = quietSync,
                    entries = Mirrored.Ready(emptyList()),
                    canShowMore = false,
                    onShowMore = {},
                    filters = EntryFilters(text = "zzz"),
                    options = options,
                    filtersOpen = false,
                    onToggleFilters = {},
                    onFilters = {},
                    onRetrySync = {},
                    onOpenAttention = {},
                    onOpen = {},
                )
            }
        }
        compose.onNodeWithText("No matching entries").assertExists()
        compose.onNodeWithText("Try another search or clear the filters.").assertExists()
    }

    @Test
    fun anEmptyLedgerStillSaysThereAreNoTransactionsYet() {
        compose.setContent {
            TransactionsContent(quietSync, Mirrored.Ready(emptyList()), false, {}, EntryFilters(), options, false, {}, {}, {}, {}, onOpen = {})
        }
        compose.onNodeWithText("No transactions yet.").assertExists()
        compose.onNodeWithText("No matching entries").assertDoesNotExist()
    }

    @Test
    fun aBadDateRangeShowsTheMessageAndNoEmptyCard() {
        compose.setContent {
            TransactionsContent(quietSync, Mirrored.Ready(emptyList()), false, {}, EntryFilters(from = "2026-10-31", to = "2026-10-01"), options, false, {}, {}, {}, {}, onOpen = {})
        }
        compose.onNodeWithText("Choose an end date on or after the start date.").assertExists()
        compose.onNodeWithText("No matching entries").assertDoesNotExist()
        compose.onNodeWithText("No transactions yet.").assertDoesNotExist()
    }

    @Test
    fun homeLinksToThePendingEntriesOnlyWhenThereAreSome() {
        var opened = 0
        compose.setContent {
            HomeContent(
                quietSync, Online.Ready(homeSummary().copy(pendingCount = 2)), Mirrored.Ready(emptyList()), null, false,
                noHomeActions.copy(onOpenPending = { opened++ }), Modifier.requiredHeight(3000.dp),
            )
        }
        compose.onNodeWithText("2 pending entries aren't counted yet.").performClick()
        assertEquals(1, opened)
    }

    @Test
    fun homeHasNoPendingLinkWithNothingPending() {
        compose.setContent {
            HomeContent(quietSync, Online.Ready(homeSummary().copy(pendingCount = 0)), Mirrored.Ready(emptyList()), null, false, noHomeActions, Modifier.requiredHeight(3000.dp))
        }
        compose.onNodeWithText("aren't counted yet", substring = true).assertDoesNotExist()
        compose.onNodeWithText("isn't counted yet", substring = true).assertDoesNotExist()
    }

    @Test
    fun theShortcutsNarrowTransactionsTheWayTheWebsLinksDo() {
        assertEquals(EntryFilters(status = "pending"), PendingEntries)
        assertEquals(
            EntryFilters(categoryId = "c-fun", includeSubcategories = false, from = "2026-10-01", to = "2026-10-31"),
            categoryEntries("c-fun", YearMonth.of(2026, 10)),
        )
        // A leap February ends on the 29th, a short month on its own last day.
        assertEquals("2028-02-29", categoryEntries("c", YearMonth.of(2028, 2)).to)
        assertEquals("2026-11-30", categoryEntries("c", YearMonth.of(2026, 11)).to)
    }

    /** The search box and the Filters button sit side by side as one row, so they are the same height (a Material text field is 56 dp by itself). */
    private fun searchAndButtonHeights(filters: EntryFilters, fontScale: Float = 1f): Pair<Float, Float> {
        bar(filters, fontScale)
        val search = compose.onNodeWithContentDescription("Search payer, payee or note").getBoundsInRoot()
        val button = compose.onNode(androidx.compose.ui.test.hasContentDescription("Filters", substring = true)).getBoundsInRoot()
        return (search.bottom - search.top).value to (button.bottom - button.top).value
    }

    @Test
    fun theSearchBoxAndTheFiltersButtonAreTheSameHeight() {
        val (search, button) = searchAndButtonHeights(EntryFilters())
        assertEquals(search, button, 0.5f)
        // Both are the 48 dp touch target, not the 56 dp of a stock Material text field.
        assertEquals(48f, search, 0.5f)
    }

    @Test
    fun theyStayTheSameHeightWithTextInTheBoxAndFiltersSet() {
        val (search, button) = searchAndButtonHeights(EntryFilters(text = "coffee", accountId = "a1", tagId = "t1"))
        assertEquals(search, button, 0.5f)
    }

    @Test
    fun theyStayTheSameHeightWithTheLargestText() {
        val (search, button) = searchAndButtonHeights(EntryFilters(accountId = "a1", tagId = "t1"), fontScale = 2f)
        assertEquals(search, button, 0.5f)
    }
}
