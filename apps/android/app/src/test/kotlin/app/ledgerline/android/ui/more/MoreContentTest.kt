package app.ledgerline.android.ui.more

import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.ledgerline.android.ui.home.SignedInFrame
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import app.ledgerline.android.mirror.CategoryRow
import app.ledgerline.android.online.Online
import app.ledgerline.android.ui.home.Tab
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.api.HomeSummary
import app.ledgerline.api.Money
import app.ledgerline.android.ui.home.homeSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** More (ADR 0046): two grouped cards of rows, each with a live figure where it is known online. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class MoreContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val known = MoreSummary(
        owed = Money(35_400, "USD"),
        owedClients = 4,
        lent = Money(89_189, "USD"),
        categoryGroups = 9,
        categorySubs = 18,
        version = "0.1.4",
    )

    private class Taps {
        val opened = mutableListOf<String>()
        fun actions() = MoreActions({ opened += "clients" }, { opened += "loans" }, { opened += "categories" }, { opened += "settings" })
    }

    private fun show(summary: MoreSummary, taps: Taps = Taps(), private: Boolean = false) = compose.setContent {
        CompositionLocalProvider(LocalPrivacy provides private) {
            MoreContent(taps.actions(), summary, 0.dp, Modifier.requiredHeight(3000.dp))
        }
    }

    private fun category(id: String, parent: String? = null, archived: Boolean = false, deleted: Boolean = false) = CategoryRow(
        "l", id, 1, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z", if (deleted) "2026-10-02T00:00:00Z" else null,
        parent, id, "expense", null, null, 0, if (archived) "2026-10-02T00:00:00Z" else null,
    )

    private fun home(owed: Long, people: Long, lent: Long): Online<HomeSummary> {
        val base = homeSummary()
        return Online.Ready(base.copy(owed = base.owed.copy(total = Money(owed, "USD"), personCount = people), loans = base.loans.copy(lent = Money(lent, "USD"))))
    }

    @Test
    fun theTwoGroupsAreLabelledAndHoldAllFourDestinations() {
        show(known)
        compose.onNodeWithText("RECEIVABLES AND LENDING").assertExists()
        compose.onNodeWithText("STRUCTURE AND PREFERENCES").assertExists()
        listOf("Clients", "Loans", "Categories", "Settings").forEach { compose.onNodeWithText(it).assertExists() }
    }

    @Test
    fun theOldHeaderIsGone() {
        show(known)
        compose.onNodeWithText("Make it yours").assertDoesNotExist()
        compose.onNodeWithText("Clients, loans and settings.").assertDoesNotExist()
    }

    @Test
    fun aKnownSummaryShowsTheFiguresAndCounts() {
        show(known)
        compose.onNodeWithText("$354.00").assertExists()
        compose.onNodeWithText("$891.89").assertExists()
        compose.onNodeWithText("4 clients owe you").assertExists()
        compose.onNodeWithText("9 groups · 18 subcategories").assertExists()
        compose.onNodeWithText("v0.1.4").assertExists()
    }

    @Test
    fun oneClientReadsInTheSingular() {
        show(known.copy(owedClients = 1))
        compose.onNodeWithText("1 client owes you").assertExists()
    }

    @Test
    fun offlineThereAreNoFiguresAndTheRowsKeepTheirPlainSentence() {
        show(MoreSummary(version = "0.1.4"))
        compose.onNodeWithText("$354.00").assertDoesNotExist()
        compose.onNodeWithText("Who owes you").assertExists()
        compose.onNodeWithText("Money you lend and borrow").assertExists()
        compose.onNodeWithText("Income and expense groups").assertExists()
    }

    @Test
    fun aFigureOfNothingIsLeftOut() {
        show(known.copy(owed = Money(0, "USD"), owedClients = 0, lent = Money(0, "USD")))
        compose.onNodeWithText("$0.00").assertDoesNotExist()
        compose.onNodeWithText("Who owes you").assertExists()
    }

    @Test
    fun privacyModeMasksEveryAmount() {
        show(known, private = true)
        compose.onNodeWithText("$354.00").assertDoesNotExist()
        compose.onNodeWithText("$891.89").assertDoesNotExist()
        compose.onAllNodesWithText("•••••", useUnmergedTree = true).assertCountEquals(2)
    }

    @Test
    fun eachRowOpensItsScreen() {
        val taps = Taps()
        show(known, taps)
        listOf("Clients", "Loans", "Categories", "Settings").forEach { compose.onNodeWithText(it).performClick() }
        assertEquals(listOf("clients", "loans", "categories", "settings"), taps.opened)
    }

    @Test
    fun theSummaryComesFromHomeAndTheMirror() {
        val s = moreSummary(home(35_400, 4, 89_189), listOf(category("a"), category("b"), category("a1", "a"), category("a2", "a")), "0.1.4")
        assertEquals(Money(35_400, "USD"), s.owed)
        assertEquals(4, s.owedClients)
        assertEquals(Money(89_189, "USD"), s.lent)
        assertEquals(2, s.categoryGroups)
        assertEquals(2, s.categorySubs)
    }

    @Test
    fun archivedAndDeletedCategoriesAreNotCounted() {
        val s = moreSummary(Online.Loading, listOf(category("a"), category("b", archived = true), category("c", deleted = true), category("a1", "a", archived = true)), "x")
        assertEquals(1, s.categoryGroups)
        assertEquals(0, s.categorySubs)
    }

    @Test
    fun withoutAnOnlineAnswerThereAreNoMoneyFigures() {
        listOf(Online.Loading, Online.Offline).forEach { answer ->
            val s = moreSummary(answer, emptyList(), "x")
            assertNull(s.owed)
            assertNull(s.lent)
        }
        assertNull(moreSummary(Online.Loading, null, "x").categoryGroups)
    }

    @Test
    fun addIsHiddenOnMoreAndShownOnTheOtherTabs() {
        assertFalse(addVisible(Tab.More))
        Tab.entries.filter { it != Tab.More }.forEach { assertTrue("$it", addVisible(it)) }
    }

    @Test
    fun theFrameDrawsNoAddButtonOnMoreAndOneOnHome() {
        var tab by mutableStateOf(Tab.More)
        compose.setContent { SignedInFrame(tab, onSelect = {}, onAdd = {}) { inside -> Box(inside) } }
        compose.onNodeWithContentDescription("Add").assertDoesNotExist()
        tab = Tab.Home
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Add").assertExists()
    }
}
