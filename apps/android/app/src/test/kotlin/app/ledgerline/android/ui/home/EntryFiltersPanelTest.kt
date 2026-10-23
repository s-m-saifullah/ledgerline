package app.ledgerline.android.ui.home

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.ui.Modifier
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.YearMonth

/** The filters above Transactions, as plain data: what each control shows and what it asks for. */
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
    private var toggles = 0

    private fun show(filters: EntryFilters = EntryFilters(), expanded: Boolean = false) {
        compose.setContent {
            androidx.compose.foundation.layout.Box(Modifier.requiredHeight(3000.dp)) {
                EntryFiltersPanel(filters, options, expanded, { toggles++ }, { changed += it })
            }
        }
    }

    @Test
    fun typingInTheSearchAsksForThatText() {
        show()
        compose.onNode(hasSetTextAction()).performTextInput("cafe")
        assertEquals("cafe", changed.last().text)
    }

    @Test
    fun clearFiltersShowsOnlyWhileAFilterIsSetAndClearsAll() {
        show()
        compose.onNodeWithText("Clear filters").assertDoesNotExist()
    }

    @Test
    fun clearFiltersClearsEverything() {
        show(EntryFilters(accountId = "a1", text = "x", status = "pending"))
        compose.onNodeWithText("Clear filters").performClick()
        assertEquals(EntryFilters(), changed.single())
    }

    @Test
    fun theHeadingCountsTheFiltersOfThePanelAndOpensIt() {
        show(EntryFilters(text = "x", accountId = "a1", from = "2026-10-01"))
        compose.onNodeWithText("Filter entries (2)").performClick()
        assertEquals(1, toggles)
    }

    @Test
    fun withNoPanelFilterTheHeadingHasNoCount() {
        show(EntryFilters(text = "only a search"))
        compose.onNodeWithText("Filter entries").assertExists()
    }

    @Test
    fun theOpenPanelOffersEveryFilterOfTheWeb() {
        show(expanded = true)
        listOf("Account", "Category", "Tag", "From date", "To date", "Entry type", "Status").forEach { compose.onNodeWithText(it).assertExists() }
    }

    @Test
    fun pickingAnAccountAsksForIt() {
        show(expanded = true)
        compose.onNodeWithText("Account").performClick()
        // The box shows its choice ("All accounts") and the open list offers it again, with the accounts.
        assertEquals(2, compose.onAllNodesWithText("All accounts").fetchSemanticsNodes().size)
        compose.onNodeWithText("Cash").performClick()
        assertEquals("a2", changed.single().accountId)
    }

    @Test
    fun allAccountsClearsTheAccountFilter() {
        show(EntryFilters(accountId = "a1"), expanded = true)
        compose.onNodeWithText("Account").performClick()
        compose.onNodeWithText("All accounts").performClick()
        assertNull(changed.single().accountId)
    }

    @Test
    fun theCategoryFilterFindsSubcategoriesToo() {
        show(EntryFilters(categoryId = "c1", includeSubcategories = false), expanded = true)
        compose.onNodeWithText("Category").performClick()
        compose.onNodeWithText("Food › Groceries").performClick()
        assertEquals(EntryFilters(categoryId = "c2", includeSubcategories = true), changed.single())
    }

    @Test
    fun statusAndEntryTypeAreChosenFromTheirOwnLists() {
        show(expanded = true)
        compose.onNodeWithText("Status").performClick()
        compose.onNodeWithText("Pending").performClick()
        assertEquals("pending", changed.last().status)
        compose.onNodeWithText("Entry type").performClick()
        compose.onNodeWithText("Transfers").performClick()
        assertEquals("transfer", changed.last().kind)
    }

    @Test
    fun aDateShowsAndItsCrossClearsIt() {
        show(EntryFilters(from = "2026-10-05"), expanded = true)
        compose.onNodeWithContentDescription("Clear From date").performClick()
        assertNull(changed.single().from)
    }

    @Test
    fun anEndDateBeforeTheStartIsExplained() {
        show(EntryFilters(from = "2026-10-31", to = "2026-10-01"))
        compose.onNodeWithText("Choose an end date on or after the start date.").assertExists()
    }

    @Test
    fun anEmptyListSaysWhetherFiltersAreTheReason() {
        compose.setContent {
            androidx.compose.foundation.layout.Column {
                TransactionsContent(
                    header = {},
                    entries = Mirrored.Ready(emptyList()),
                    canShowMore = false,
                    onShowMore = {},
                    filters = EntryFilters(text = "zzz"),
                    options = options,
                    filtersOpen = false,
                    onToggleFilters = {},
                    onFilters = {},
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
            TransactionsContent({}, Mirrored.Ready(emptyList()), false, {}, EntryFilters(), options, false, {}, {}, {})
        }
        compose.onNodeWithText("No transactions yet.").assertExists()
        compose.onNodeWithText("No matching entries").assertDoesNotExist()
    }

    @Test
    fun aBadDateRangeShowsTheMessageAndNoEmptyCard() {
        compose.setContent {
            TransactionsContent({}, Mirrored.Ready(emptyList()), false, {}, EntryFilters(from = "2026-10-31", to = "2026-10-01"), options, false, {}, {}, {})
        }
        compose.onNodeWithText("Choose an end date on or after the start date.").assertExists()
        compose.onNodeWithText("No matching entries").assertDoesNotExist()
        compose.onNodeWithText("No transactions yet.").assertDoesNotExist()
    }

    @Test
    fun homeLinksToThePendingEntriesOnlyWhenThereAreSome() {
        var opened = 0
        compose.setContent {
            androidx.compose.foundation.layout.Column(Modifier.requiredHeight(3000.dp)) {
                MonthCard(Online.Ready(homeSummary().copy(pendingCount = 2)), onRetry = {}, onOpenPending = { opened++ })
            }
        }
        compose.onNodeWithText("Show the pending entries").performClick()
        assertEquals(1, opened)
    }

    @Test
    fun homeHasNoPendingLinkWithNothingPending() {
        compose.setContent {
            androidx.compose.foundation.layout.Column(Modifier.requiredHeight(3000.dp)) {
                MonthCard(Online.Ready(homeSummary().copy(pendingCount = 0)), onRetry = {}, onOpenPending = {})
            }
        }
        compose.onNodeWithText("Show the pending entries").assertDoesNotExist()
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
