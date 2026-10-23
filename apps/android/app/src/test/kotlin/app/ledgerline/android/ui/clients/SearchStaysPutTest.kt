package app.ledgerline.android.ui.clients

import android.app.Application
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.unit.dp
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.Paged
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
            ClientsListContent(text, "all", Online.Ready(Paged<Contact>(clients, hasMore = false)), ClientsListActions({}, { text = it }, {}, {}, {}, {}), short(640))
        }
        compose.onNode(hasScrollAction()).performScrollToIndex(1)
        compose.waitForIdle()
        val before = searchTop("Search clients")

        text = "zzz"
        clients = emptyList()
        compose.waitForIdle()
        assertEquals(before, searchTop("Search clients"))
    }

    @Test
    fun theLoansSearchFieldStaysWhereItIsWhenTheListGetsShorter() {
        compose.setContent {
            LoansListContent(Online.Loading, text, "active", Online.Ready(Paged<LoanPerson>(people, hasMore = false)), LoansListActions({}, { text = it }, {}, {}, {}, {}), short(560))
        }
        compose.onNode(hasScrollAction()).performScrollToIndex(1)
        compose.waitForIdle()
        val before = searchTop("Search people")

        text = "person 1"
        people = people.take(1)
        compose.waitForIdle()
        assertEquals(before, searchTop("Search people"))
    }
}
