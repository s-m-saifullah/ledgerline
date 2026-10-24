package app.ledgerline.android.ui.home

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
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
import app.ledgerline.android.ui.editor.Choice
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
    private var opened = 0
    private var done = 0

    private fun bar(filters: EntryFilters = EntryFilters()) {
        compose.setContent {
            LedgerlineTheme {
                androidx.compose.foundation.layout.Box(Modifier.requiredHeight(3000.dp)) { EntryFilterBar(filters, { changed += it }, { opened++ }) }
            }
        }
    }

    private fun sheet(filters: EntryFilters = EntryFilters()) {
        compose.setContent {
            LedgerlineTheme {
                androidx.compose.foundation.layout.Box(Modifier.requiredHeight(3000.dp)) { EntryFiltersSheetContent(filters, options, { changed += it }, { done++ }) }
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
    fun theFiltersChipCountsEveryFilterButTheSearchAndTheType() {
        bar(EntryFilters(text = "x", kind = "expense", accountId = "a1", from = "2026-10-01"))
        compose.onNodeWithText("Filters (2)").assertIsSelected().performClick()
        assertEquals(1, opened)
    }

    @Test
    fun withNoSheetFilterTheChipHasNoCount() {
        bar(EntryFilters(text = "only a search", kind = "income"))
        compose.onNodeWithText("Filters").assertIsNotSelected()
    }

    @Test
    fun theSheetOffersEveryFilterButTheTypeWhichHasChips() {
        sheet()
        listOf("Account", "Category", "Tag", "From date", "To date", "Status").forEach { compose.onNodeWithText(it).assertExists() }
        compose.onNodeWithText("Entry type").assertDoesNotExist()
    }

    @Test
    fun clearFiltersShowsOnlyWhileAFilterIsSetAndClearsAll() {
        sheet()
        compose.onNodeWithText("Clear filters").assertDoesNotExist()
    }

    @Test
    fun clearFiltersClearsEverythingIncludingTheSearchAndTheType() {
        sheet(EntryFilters(accountId = "a1", text = "x", status = "pending", kind = "income"))
        compose.onNodeWithText("Clear filters").performClick()
        assertEquals(EntryFilters(), changed.single())
    }

    @Test
    fun aSearchAloneOrATypeAloneCanBeClearedFromTheSheet() {
        sheet(EntryFilters(text = "only a search"))
        compose.onNodeWithText("Clear filters").assertExists()
    }

    @Test
    fun doneClosesTheSheet() {
        sheet()
        compose.onNodeWithText("Done").performClick()
        assertEquals(1, done)
    }

    @Test
    fun pickingAnAccountAsksForIt() {
        sheet()
        compose.onNodeWithText("Account").performClick()
        // The box shows its choice ("All accounts") and the open list offers it again, with the accounts.
        assertEquals(2, compose.onAllNodesWithText("All accounts").fetchSemanticsNodes().size)
        compose.onNodeWithText("Cash").performClick()
        assertEquals("a2", changed.single().accountId)
    }

    @Test
    fun allAccountsClearsTheAccountFilter() {
        sheet(EntryFilters(accountId = "a1"))
        compose.onNodeWithText("Account").performClick()
        compose.onNodeWithText("All accounts").performClick()
        assertNull(changed.single().accountId)
    }

    @Test
    fun theCategoryFilterFindsSubcategoriesToo() {
        sheet(EntryFilters(categoryId = "c1", includeSubcategories = false))
        compose.onNodeWithText("Category").performClick()
        compose.onNodeWithText("Food › Groceries").performClick()
        assertEquals(EntryFilters(categoryId = "c2", includeSubcategories = true), changed.single())
    }

    @Test
    fun statusIsChosenFromItsOwnList() {
        sheet()
        compose.onNodeWithText("Status").performClick()
        compose.onNodeWithText("Pending").performClick()
        assertEquals("pending", changed.last().status)
    }

    @Test
    fun aDateShowsAndItsCrossClearsIt() {
        sheet(EntryFilters(from = "2026-10-05"))
        compose.onNodeWithContentDescription("Clear From date").performClick()
        assertNull(changed.single().from)
    }

    @Test
    fun anEndDateBeforeTheStartIsExplainedInTheBarAndTheSheet() {
        bar(EntryFilters(from = "2026-10-31", to = "2026-10-01"))
        compose.onNodeWithText("Choose an end date on or after the start date.").assertExists()
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
}
