package app.ledgerline.android.ui.clients

import android.app.Application
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.unit.dp
import app.ledgerline.android.mirror.EntryFilters
import app.ledgerline.android.mirror.EntryLine
import app.ledgerline.android.online.Online
import app.ledgerline.android.overlay.ShownLine
import app.ledgerline.android.ui.home.FilterOptions
import app.ledgerline.android.ui.home.Mirrored
import app.ledgerline.android.ui.home.SyncLine
import app.ledgerline.android.ui.home.SyncStatus
import app.ledgerline.android.ui.home.TransactionsContent
import app.ledgerline.android.ui.theme.LedgerlineTheme
import app.ledgerline.android.online.Paged
import app.ledgerline.android.ui.loans.LoanFilter
import app.ledgerline.android.ui.loans.LoansListActions
import app.ledgerline.android.ui.loans.LoansListContent
import app.ledgerline.api.Contact
import app.ledgerline.api.LoanPerson
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Typing in a search shortens the list below it. With the keyboard open the screen is short, the list is scrolled
 * so the search field is at the top, and a shorter list used to pull the scroll position back and slide the field
 * down under the owner's fingers. The field must stay where it is.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SearchStaysPutTest {
    @get:Rule
    val compose = createComposeRule()

    private var clients by mutableStateOf(List(8) { contact("Client $it", owed = 1000L + it) })
    private var people by mutableStateOf(List(8) { person("Person $it", "USD" to 1000L + it) })
    private var text by mutableStateOf("")

    /** A screen with the keyboard open on a tall phone: the list is scrolled to the search field, and one or two results do not fill it. */
    private fun short(height: Int) = Modifier.height(height.dp)

    private fun searchTop(label: String) = compose.onNodeWithText(label).getUnclippedBoundsInRoot().top

    @Test
    fun theClientsSearchFieldStaysWhereItIsWhenTheListGetsShorter() {
        compose.setContent {
            LedgerlineTheme {
                ClientsListContent(text, ClientFilter.All, Online.Ready(Paged<Contact>(clients, hasMore = false)), ClientsListActions({}, { text = it }, {}, {}, {}, {}), short(640))
            }
        }
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(1)
        compose.waitForIdle()
        val before = compose.onNodeWithContentDescription("Search clients").getUnclippedBoundsInRoot().top

        text = "zzz"
        clients = emptyList()
        compose.waitForIdle()
        assertEquals(before, compose.onNodeWithContentDescription("Search clients").getUnclippedBoundsInRoot().top)
    }

    @Test
    fun theLoansSearchFieldStaysWhereItIsWhenTheListGetsShorter() {
        compose.setContent {
            LedgerlineTheme {
                LoansListContent(Online.Ready(app.ledgerline.android.ui.clients.homeLoans(1000, 0)), text, LoanFilter.Active, Online.Ready(Paged<LoanPerson>(people, hasMore = false)), LoansListActions({}, { text = it }, {}, {}, {}, {}), short(560))
            }
        }
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(1)
        compose.waitForIdle()
        val before = compose.onNodeWithContentDescription("Search people").getUnclippedBoundsInRoot().top

        text = "person 1"
        compose.waitForIdle()
        // The search stays because it is counted over everyone, not over what the search leaves.
        assertEquals(before, compose.onNodeWithContentDescription("Search people").getUnclippedBoundsInRoot().top)
    }

    private var lines by mutableStateOf(
        List(8) { ShownLine(EntryLine("e$it", "2026-10-${10 + it}", null, "expense", false, "cleared", -1000L - it, "USD", "Payee $it", "Checking", "Food", null, null, "2026-10-${10 + it}T10:00:00Z"), false) },
    )
    private var filters by mutableStateOf(EntryFilters())

    @Test
    fun theTransactionsSearchFieldStaysWhereItIsWhenTheListGetsShorter() {
        compose.setContent {
            LedgerlineTheme {
                TransactionsContent(
                    SyncStatus(SyncLine(null, false, null), 0, 0), Mirrored.Ready(lines), false, {}, filters, FilterOptions(), false, {}, { filters = it }, {}, {},
                    onOpen = {}, modifier = short(640),
                )
            }
        }
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(1)
        compose.waitForIdle()
        val before = compose.onNodeWithContentDescription("Search payer, payee or note").getUnclippedBoundsInRoot().top

        filters = EntryFilters(text = "payee 1")
        lines = lines.take(1)
        compose.waitForIdle()
        assertEquals(before, compose.onNodeWithContentDescription("Search payer, payee or note").getUnclippedBoundsInRoot().top)
    }
}
