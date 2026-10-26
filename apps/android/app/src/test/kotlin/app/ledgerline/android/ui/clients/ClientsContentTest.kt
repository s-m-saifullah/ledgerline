package app.ledgerline.android.ui.clients

import android.app.Application
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.Paged
import app.ledgerline.android.ui.privacy.LocalPrivacy
import app.ledgerline.api.Contact
import app.ledgerline.api.HistoryEvent
import app.ledgerline.api.Money
import app.ledgerline.api.Service
import app.ledgerline.api.ServicePayment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate

/** Clients (ADR 0046): the list with its chips and total, and one client with unpaid services, Paid and History. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class ClientsContentTest {
    @get:Rule
    val compose = createComposeRule()

    private val today = LocalDate.of(2026, 10, 23)

    private fun count(text: String, n: Int) = compose.onAllNodesWithText(text).assertCountEquals(n)

    private class Taps {
        val opened = mutableListOf<String>()
        val filters = mutableListOf<ClientFilter>()
        var back = 0
        var more = 0
    }

    private val ada = contact("Ada Archer", owed = 5000, oldest = "2026-10-11")
    private val bo = contact("Bo Baker", owed = 25000, oldest = "2026-10-23")
    private val dee = contact("Dee Dunn")
    private val eve = contact("Eve Early", owed = 700, archived = true, oldest = "2026-09-01")

    private fun list(
        rows: List<Contact> = listOf(ada, bo, dee, eve),
        filter: ClientFilter = ClientFilter.Open,
        text: String = "",
        taps: Taps = Taps(),
        hasMore: Boolean = false,
        private: Boolean = false,
        state: Online<Paged<Contact>> = Online.Ready(Paged(rows, hasMore = hasMore)),
    ) = compose.setContent {
        CompositionLocalProvider(LocalPrivacy provides private) {
            ClientsListContent(
                text, filter, state,
                ClientsListActions({ taps.back++ }, {}, { taps.filters += it }, { taps.opened += it }, { taps.more++ }, {}),
                Modifier.requiredHeight(3000.dp),
                today,
            )
        }
    }

    @Test
    fun theTopBarHasTheTitleAndABackArrow() {
        val taps = Taps()
        list(taps = taps)
        compose.onNodeWithText("Clients").assertExists()
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(1, taps.back)
    }

    @Test
    fun theOldHeaderIsGone() {
        list()
        compose.onNodeWithText("Money owed to you").assertDoesNotExist()
        compose.onNodeWithText("Unpaid services stay separate from income until you receive payment.").assertDoesNotExist()
    }

    @Test
    fun theChipsShowHowManyAreOpenAndSelectTheirFilter() {
        val taps = Taps()
        list(taps = taps)
        compose.onNodeWithText("Open (2)").assertExists()
        compose.onNodeWithText("Settled").performClick()
        compose.onNodeWithText("All").performClick()
        compose.onNodeWithText("Open (2)").performClick()
        assertEquals(listOf(ClientFilter.Settled, ClientFilter.All, ClientFilter.Open), taps.filters)
    }

    @Test
    fun openShowsTheClientsWhoOweAndLeavesOutTheRest() {
        list()
        compose.onNodeWithText("Ada Archer").assertExists()
        compose.onNodeWithText("Bo Baker").assertExists()
        compose.onNodeWithText("Dee Dunn").assertDoesNotExist()
        compose.onNodeWithText("Eve Early (archived)").assertDoesNotExist()
    }

    @Test
    fun settledShowsOnlyThoseWhoOweNothing() {
        list(filter = ClientFilter.Settled)
        compose.onNodeWithText("Dee Dunn").assertExists()
        compose.onNodeWithText("Ada Archer").assertDoesNotExist()
    }

    @Test
    fun allShowsEveryoneWithTheArchivedOneMarked() {
        list(filter = ClientFilter.All)
        compose.onNodeWithText("Eve Early (archived)").assertExists()
        compose.onNodeWithText("Dee Dunn").assertExists()
    }

    @Test
    fun theClientWhoOwesMostIsFirst() {
        list()
        val boTop = compose.onNodeWithText("Bo Baker").getBoundsInRoot().top
        val adaTop = compose.onNodeWithText("Ada Archer").getBoundsInRoot().top
        assertTrue("$boTop $adaTop", boTop < adaTop)
    }

    @Test
    fun aRowSaysHowLongAgoTheOldestUnpaidServiceWasAndWhen() {
        list()
        compose.onNodeWithText("Oldest unpaid 12d ago · Oct 11").assertExists()
        compose.onNodeWithText("Oldest unpaid today · Oct 23").assertExists()
    }

    @Test
    fun aRowShowsWhatTheyOwe() {
        list()
        compose.onNodeWithText("$50.00").assertExists()
        compose.onNodeWithText("$250.00").assertExists()
    }

    @Test
    fun aSettledRowShowsNoAmount() {
        list(filter = ClientFilter.Settled)
        compose.onNodeWithText("$0.00").assertDoesNotExist()
        compose.onNodeWithText("No open services").assertExists()
    }

    @Test
    fun theTotalCardSaysWhatOpenClientsOweTogether() {
        list()
        compose.onNodeWithText("Owed to you").assertExists()
        compose.onNodeWithText("$300.00").assertExists()
        compose.onNodeWithText("2 clients owe you").assertExists()
    }

    @Test
    fun theTotalDoesNotDependOnTheChosenChip() {
        list(filter = ClientFilter.Settled)
        compose.onNodeWithText("$300.00").assertExists()
    }

    @Test
    fun theTotalWaitsForASearchToBeCleared() {
        list(text = "ada")
        compose.onNodeWithText("Owed to you").assertDoesNotExist()
    }

    @Test
    fun theTotalNamesACurrencyWithoutARate() {
        list(rows = listOf(contact("Overseas", owed = 9000, oldest = "2026-10-01", balances = listOf(Money(9000, "USD"), Money(1000, "EUR")), unconverted = listOf("EUR"))))
        compose.onNodeWithText("Not counting EUR (no rate yet)").assertExists()
    }

    @Test
    fun noTotalWhenNobodyOwes() {
        list(rows = listOf(dee), filter = ClientFilter.All)
        compose.onNodeWithText("Owed to you").assertDoesNotExist()
    }

    @Test
    fun noClientsAtAllSaysSo() {
        list(rows = emptyList())
        compose.onNodeWithText("No clients yet. Add them in the web app.").assertExists()
    }

    @Test
    fun nobodyOwingIsSaidOnOpen() {
        list(rows = listOf(dee))
        compose.onNodeWithText("Nobody owes you right now.").assertExists()
    }

    @Test
    fun nobodySettledIsSaidOnSettled() {
        list(rows = listOf(ada), filter = ClientFilter.Settled)
        compose.onNodeWithText("No settled clients yet.").assertExists()
    }

    @Test
    fun aSearchWithNoResultSaysSo() {
        list(rows = emptyList(), text = "zzz")
        compose.onNodeWithText("No matching clients").assertExists()
    }

    @Test
    fun tappingARowOpensThatClient() {
        val taps = Taps()
        list(taps = taps)
        compose.onNodeWithText("Ada Archer").performClick()
        assertEquals(listOf("ada-archer"), taps.opened)
    }

    @Test
    fun loadMoreShowsOnlyWhileThereIsMore() {
        val taps = Taps()
        list(taps = taps, hasMore = true)
        compose.onNodeWithText("Load more clients").performClick()
        assertEquals(1, taps.more)
    }

    @Test
    fun noLoadMoreWhenThereIsNone() {
        list()
        compose.onNodeWithText("Load more clients").assertDoesNotExist()
    }

    @Test
    fun theListHidesEveryAmountInPrivacyMode() {
        list(private = true, filter = ClientFilter.All)
        for (text in listOf("$50.00", "$250.00", "$300.00")) compose.onNodeWithText(text, substring = true).assertDoesNotExist()
    }

    // One client.

    private val client = contact("Vapor Vault", owed = 7200, oldest = "2026-10-23", phone = "555-0101")
    private val overdue = service("Sales Service", 7200, date = "2026-10-23", time = "15:00", due = "2026-10-22", id = "overdue")
    private val notDue = service("Photo set", 3000, received = 1000, date = "2026-10-20", due = "2026-11-30", id = "notdue")
    private val paidA = service("Sales Service A", 14400, received = 14400, date = "2026-10-18", time = "09:00", id = "paid-a")
    private val paidB = service("Sales Service B", 7200, received = 7200, date = "2026-10-16", id = "paid-b")
    private val waived = service("Menu photos", 8000, received = 5000, writtenOff = 3000, date = "2026-08-14", id = "waived")

    private class ClientTaps {
        val tabs = mutableListOf<ClientTab>()
        val payments = mutableListOf<String>()
        var back = 0
    }

    private fun page(vararg services: Service) = Online.Ready(Paged(services.toList(), hasMore = false))

    private fun client(
        services: Online<Paged<Service>> = page(overdue, notDue, paidA, paidB),
        history: Online<Paged<HistoryEvent>> = Online.Ready(Paged(emptyList(), hasMore = false)),
        tab: ClientTab = ClientTab.Paid,
        taps: ClientTaps = ClientTaps(),
        private: Boolean = false,
        payments: Map<String, Online<List<ServicePayment>>> = emptyMap(),
    ) = compose.setContent {
        CompositionLocalProvider(LocalPrivacy provides private) {
            ClientContent(
                Online.Ready(client), services, history, payments, "2026-10-23", tab,
                ClientActions({ taps.back++ }, { taps.tabs += it }, {}, {}, { taps.payments += it }, {}, {}, {}, {}),
                Modifier.requiredHeight(4000.dp),
            )
        }
    }

    @Test
    fun theClientsTopBarHasTheirNameAndABackArrow() {
        val taps = ClientTaps()
        client(taps = taps)
        compose.onNodeWithText("Vapor Vault").assertExists()
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(1, taps.back)
    }

    @Test
    fun theBalanceCardShowsWhatTheyOweAndHowToReachThem() {
        client()
        compose.onNodeWithText("Open balance").assertExists()
        compose.onNodeWithText("555-0101").assertExists()
    }

    @Test
    fun theBalanceCardSaysHowManyServicesAreOverdueAndSince() {
        client()
        compose.onNodeWithText("1 service overdue · due Oct 22").assertExists()
    }

    @Test
    fun nothingIsSaidOverdueWhenNoServiceIsPastItsDueDate() {
        client(services = page(notDue, paidA))
        compose.onNodeWithText("overdue", substring = true).assertDoesNotExist()
        compose.onNodeWithText("Overdue").assertDoesNotExist()
    }

    @Test
    fun unpaidServicesArePinnedAboveThePaidAndHistoryTabs() {
        client()
        compose.onNodeWithText("Unpaid (2)", ignoreCase = true).assertExists()
        val unpaidTop = compose.onNodeWithText("Photo set").getBoundsInRoot().top
        val tabsTop = compose.onNodeWithText("Paid (2)").getBoundsInRoot().top
        assertTrue("$unpaidTop $tabsTop", unpaidTop < tabsTop)
    }

    @Test
    fun onlyAServicePastItsDueDateIsMarkedOverdue() {
        client()
        count("Overdue", 1)
    }

    @Test
    fun anUnpaidServiceShowsWhenAndWhatWasReceived() {
        client()
        compose.onNodeWithText("Oct 23, 2026 · 3:00 PM · Received $0.00").assertExists()
        compose.onNodeWithText("Oct 20, 2026 · Received $10.00").assertExists()
    }

    @Test
    fun anUnpaidServiceShowsWhatIsLeftOnIt() {
        client()
        compose.onNode(hasText("Sales Service") and hasText("$72.00")).assertExists()
        compose.onNode(hasText("Photo set") and hasText("$20.00")).assertExists()
    }

    @Test
    fun theTabsCountPaidServicesAndHistoryEvents() {
        client(history = Online.Ready(Paged(listOf(event("created", paidA), event("created", paidB, id = "e2", createdAt = "2026-10-01T10:00:00.000Z")), hasMore = false)))
        compose.onNodeWithText("Paid (2)").assertExists()
        compose.onNodeWithText("History (2)").assertExists()
    }

    @Test
    fun aCountHasAPlusWhileMoreIsToLoad() {
        client(services = Online.Ready(Paged(listOf(paidA), hasMore = true)))
        compose.onNodeWithText("Paid (1+)").assertExists()
    }

    @Test
    fun tappingATabSelectsIt() {
        val taps = ClientTaps()
        client(taps = taps)
        compose.onNodeWithText("History", substring = true).performClick()
        compose.onNodeWithText("Paid (2)").performClick()
        assertEquals(listOf(ClientTab.History, ClientTab.Paid), taps.tabs)
    }

    @Test
    fun thePaidTabListsPaidServicesWithPaidInFullAndNotTheUnpaidOnes() {
        client()
        compose.onNodeWithText("Sales Service A").assertExists()
        compose.onNodeWithText("Sales Service B").assertExists()
        compose.onNodeWithText("$144.00").assertExists()
        count("Paid in full", 2)
        // The unpaid service is above, once; the Paid list does not repeat it.
        count("Photo set", 1)
    }

    @Test
    fun aWrittenOffServiceIsNotPaidInFull() {
        client(services = page(waived))
        compose.onNodeWithText("Written off").assertExists()
        compose.onNodeWithText("Paid in full").assertDoesNotExist()
    }

    @Test
    fun theHistoryTabHidesThePaidServices() {
        client(tab = ClientTab.History)
        compose.onNodeWithText("Sales Service A").assertDoesNotExist()
        compose.onNodeWithText("Photo set").assertExists()
    }

    private fun batchEvents(): List<HistoryEvent> {
        val a = service("Sales", 14400, id = "ha")
        val b = service("Sales", 7200, id = "hb")
        val c = service("Sales", 7200, id = "hc")
        val minute = "2026-10-21T23:19:30.000Z"
        return listOf(
            event("paymentCreated", a, payment(a, 14400), createdAt = minute, id = "p1"),
            event("paymentCreated", b, payment(b, 7200), createdAt = minute, id = "p2"),
            event("paymentCreated", c, payment(c, 7200), createdAt = minute, id = "p3"),
        )
    }

    @Test
    fun paymentsWrittenTogetherAreOneLineWithEachAmountAndTheTotalTakenOff() {
        client(history = Online.Ready(Paged(batchEvents(), hasMore = false)), tab = ClientTab.History)
        compose.onNodeWithText("3 payments received").assertExists()
        compose.onNodeWithText("-$288.00").assertExists()
        compose.onNodeWithText("$144.00 + $72.00 + $72.00", substring = true).assertExists()
    }

    @Test
    fun servicesLoggedTogetherAreOneLineWithTheirDatesAndTheTotalAdded() {
        val a = service("Sales", 14400, date = "2026-10-14", id = "ha")
        val b = service("Sales", 7200, date = "2026-10-18", id = "hb")
        val minute = "2026-10-21T23:19:30.000Z"
        client(history = Online.Ready(Paged(listOf(event("created", a, createdAt = minute, id = "s1"), event("created", b, createdAt = minute, id = "s2")), hasMore = false)), tab = ClientTab.History)
        compose.onNodeWithText("2 services logged").assertExists()
        compose.onNodeWithText("+$216.00").assertExists()
        compose.onNodeWithText("Oct 14–Oct 18", substring = true).assertExists()
    }

    @Test
    fun aLoneServiceLoggedKeepsItsOwnWordsAndIsAdded() {
        val a = service("Sales", 7200, id = "ha")
        client(history = Online.Ready(Paged(listOf(event("created", a)), hasMore = false)), tab = ClientTab.History)
        compose.onNodeWithText("Service logged (Sales)").assertExists()
        compose.onNodeWithText("+$72.00").assertExists()
    }

    @Test
    fun aLonePaymentShowsItsTipInTheNameAndIsTakenOff() {
        val a = service("Sales", 14400, received = 14400, id = "ha")
        client(history = Online.Ready(Paged(listOf(event("paymentCreated", a, payment(a, 14400, tip = 100))), hasMore = false)), tab = ClientTab.History)
        compose.onNodeWithText("Payment received (+\u00a0$1.00\u00a0tip)").assertExists()
        compose.onNodeWithText("-$144.00").assertExists()
    }

    @Test
    fun aCorrectionHasNoSign() {
        val a = service("Sales", 14400, received = 14400, id = "ha")
        client(history = Online.Ready(Paged(listOf(event("paymentEdited", a, payment(a, 14400), before = payment(a, 10000))), hasMore = false)), tab = ClientTab.History)
        compose.onNodeWithText("Payment corrected").assertExists()
        compose.onNodeWithText("$144.00").assertExists()
    }

    @Test
    fun theHistoryNoLongerMentionsServiceVersions() {
        val a = service("Sales", 7200, id = "ha")
        client(history = Online.Ready(Paged(listOf(event("created", a)), hasMore = false)), tab = ClientTab.History)
        compose.onNodeWithText("service version", substring = true).assertDoesNotExist()
    }

    @Test
    fun tappingAServiceAsksForItsPayments() {
        val taps = ClientTaps()
        client(taps = taps)
        compose.onNodeWithText("Photo set").performClick()
        assertEquals(listOf("notdue"), taps.payments)
    }

    @Test
    fun theClientScreenHidesEveryAmountInPrivacyMode() {
        client(private = true, history = Online.Ready(Paged(batchEvents(), hasMore = false)), tab = ClientTab.History)
        for (text in listOf("$72.00", "$20.00", "$144.00", "$288.00", "$10.00")) compose.onNodeWithText(text, substring = true).assertDoesNotExist()
    }
}
