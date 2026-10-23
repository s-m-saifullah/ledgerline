package app.ledgerline.android.ui.clients

import app.ledgerline.android.online.Online
import app.ledgerline.android.online.Paged
import app.ledgerline.android.session.SessionState
import app.ledgerline.android.testing.OnlineHarness
import app.ledgerline.api.Contact
import app.ledgerline.api.ContactList
import app.ledgerline.api.HistoryList
import app.ledgerline.api.PaymentList
import app.ledgerline.api.ServiceList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Clients read online with the real clients against a mock server that answers by route, and the real Room mirror. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ClientsViewModelTest {
    private val harness = OnlineHarness()
    private lateinit var model: ClientsViewModel

    private val northwind = contact("Northwind Design", owed = 63000, oldest = "2026-09-21")
    private val harbor = contact("Harbor Cafe")
    private val audit = service("Website audit", 30000, received = 12000, due = "2026-10-21")
    private val logo = service("Logo refresh", 45000, due = "2026-10-10", time = "14:30")

    @Before
    fun open() {
        harness.open()
        harness.route("/api/v1/ledgers/ledger-a/contacts\\?.*") { harness.ok(ContactList.serializer(), ContactList(listOf(northwind, harbor), null)) }
        harness.route("/api/v1/ledgers/ledger-a/contacts/northwind-design") { harness.ok(Contact.serializer(), northwind) }
        harness.route("/api/v1/ledgers/ledger-a/receivables\\?.*") { harness.ok(ServiceList.serializer(), ServiceList(listOf(logo, audit), null)) }
        harness.route("/api/v1/ledgers/ledger-a/contacts/northwind-design/history\\?.*") {
            harness.ok(HistoryList.serializer(), HistoryList(listOf(event("paymentCreated", audit, payment(audit, 12000, tip = 1000))), null))
        }
        harness.route("/api/v1/ledgers/ledger-a/receivables/website-audit/payments\\?.*") {
            harness.ok(PaymentList.serializer(), PaymentList(listOf(payment(audit, 12000, tip = 1000)), null))
        }
        model = ClientsViewModel(harness.reader(), harness.database.reads()).also { it.searchDelayMillis = 0 }
    }

    @After
    fun close() = harness.close()

    private fun <T> StateFlow<T>.settled(test: (T) -> Boolean = { true }): T = runBlocking { withTimeout(10_000) { first { test(it) } } }

    private fun StateFlow<Online<Paged<Contact>>>.rows(): List<Contact> = settled { it is Online.Ready }.let { (it as Online.Ready).value.items }

    private fun clientRequests() = harness.targets.filter { "/contacts?" in it }

    @Test
    fun nothingIsReadUntilTheScreenShowsItThenTheFirstPageOfClients() {
        harness.pulled("2026-10-22T10:00:00.000Z")
        assertTrue(harness.quiet())

        assertEquals(listOf(northwind, harbor), model.clients.rows())
        assertEquals("/api/v1/ledgers/ledger-a/contacts?kind=clients&status=all&limit=50", clientRequests().single())
        assertEquals("Bearer tok", harness.tokens.first())
    }

    @Test
    fun theNextPageIsAskedForWithItsCursorAndAppended() {
        val second = contact("Willow Lane Studio")
        harness.route("/api/v1/ledgers/ledger-a/contacts\\?.*") { target ->
            val page = if ("cursor=c2" in target) ContactList(listOf(second), null) else ContactList(listOf(northwind, harbor), "c2")
            harness.ok(ContactList.serializer(), page)
        }
        harness.pulled("2026-10-22T10:00:00.000Z")
        assertEquals(2, model.clients.rows().size)
        assertTrue(((model.clients.value as Online.Ready).value).hasMore)

        model.loadMoreClients()
        assertEquals(listOf(northwind, harbor, second), model.clients.settled { (it as? Online.Ready)?.value?.items?.size == 3 }.let { (it as Online.Ready).value.items })
        assertFalse((model.clients.value as Online.Ready).value.hasMore)
        assertTrue(clientRequests().last().contains("cursor=c2"))
    }

    @Test
    fun aSearchAndAStatusAreSentAndTheRowsStayOnScreenUntilTheNewOnesArrive() {
        harness.pulled("2026-10-22T10:00:00.000Z")
        model.clients.rows()

        // Typing must not swap the list for a Loading card between keystrokes.
        val shown = mutableListOf<Online<Paged<Contact>>>()
        val watcher = CoroutineScope(Dispatchers.Unconfined).launch { model.clients.collect { shown += it } }
        harness.delayMillis = 300
        model.search("north")
        harness.until { clientRequests().any { r -> "text=north" in r } }
        model.filter("archived")
        harness.until { clientRequests().any { r -> "status=archived" in r } }
        Thread.sleep(600)
        watcher.cancel()
        assertTrue(shown.toString(), shown.none { it == Online.Loading })
        assertEquals(2, (model.clients.value as Online.Ready).value.items.size)
        assertTrue(clientRequests().any { "status=all" in it && "text=north" in it })
        assertTrue(clientRequests().any { "status=archived" in it && "text=north" in it })
    }

    @Test
    fun aPullReadsAgainAndKeepsTheRowsOnScreenMeanwhile() {
        harness.pulled("2026-10-22T10:00:00.000Z")
        model.clients.rows()
        harness.delayMillis = 1_000

        harness.pulled("2026-10-22T10:05:00.000Z")
        assertEquals(2, (model.clients.value as Online.Ready).value.items.size)
        harness.requests(2)
        assertEquals(2, clientRequests().size)
    }

    @Test
    fun theSameCursorWrittenAgainIsNotReadAgain() {
        harness.pulled("2026-10-22T10:00:00.000Z")
        model.clients.rows()
        harness.pulled("2026-10-22T10:00:00.000Z")
        Thread.sleep(500)
        assertEquals(1, clientRequests().size)
    }

    @Test
    fun aClientReadsItsDetailsServicesAndHistoryAndBackClosesIt() {
        harness.pulled("2026-10-22T10:00:00.000Z")
        model.clients.rows()
        model.open("northwind-design")
        assertEquals("northwind-design", model.selected.value)

        assertEquals(northwind, (model.client.settled { it is Online.Ready } as Online.Ready).value)
        assertEquals(listOf(logo, audit), (model.services.settled { it is Online.Ready } as Online.Ready).value.items)
        assertEquals(1, (model.history.settled { it is Online.Ready } as Online.Ready).value.items.size)
        val requests = harness.targets.toList()
        assertTrue(requests.toString(), "/api/v1/ledgers/ledger-a/receivables?contactId=northwind-design&limit=50" in requests)
        assertTrue("/api/v1/ledgers/ledger-a/contacts/northwind-design/history?limit=50" in requests)

        model.close()
        assertNull(model.selected.value)
    }

    @Test
    fun aServicesPaymentsAreReadWhenOpenedAndClearedWhenClosed() {
        harness.pulled("2026-10-22T10:00:00.000Z")
        model.open("northwind-design")
        model.services.settled { it is Online.Ready }

        model.togglePayments("website-audit")
        val shown = model.payments.settled { (it["website-audit"] as? Online.Ready) != null }
        assertEquals(12000L, (shown.getValue("website-audit") as Online.Ready).value.single().amount.amount)

        model.togglePayments("website-audit")
        assertTrue(model.payments.value.isEmpty())
        model.open("northwind-design")
        assertTrue(model.payments.value.isEmpty())
    }

    @Test
    fun retryReadsAgainIncludingTheOpenPayments() {
        harness.pulled("2026-10-22T10:00:00.000Z")
        model.open("northwind-design")
        model.services.settled { it is Online.Ready }
        model.togglePayments("website-audit")
        model.payments.settled { (it["website-audit"] as? Online.Ready) != null }
        val before = harness.targets.count { "/payments" in it }

        model.retry()
        harness.requests(harness.targets.size + 1)
        Thread.sleep(300)
        assertEquals(before + 1, harness.targets.count { "/payments" in it })
        assertEquals(2, harness.targets.count { it.endsWith("/receivables?contactId=northwind-design&limit=50") })
    }

    @Test
    fun withoutAConnectionItSaysSo() {
        val closed = harness.closedOrigin()
        model = ClientsViewModel(harness.reader(closed), harness.database.reads())
        harness.pulled("2026-10-22T10:00:00.000Z")
        assertEquals(Online.Offline, model.clients.settled { it == Online.Offline })
    }

    @Test
    fun aServerErrorIsShownAndRetryRecovers() {
        harness.route("/api/v1/ledgers/ledger-a/contacts\\?.*") { harness.json(500) }
        harness.pulled("2026-10-22T10:00:00.000Z")
        assertEquals(Online.Failed, model.clients.settled { it == Online.Failed })

        harness.route("/api/v1/ledgers/ledger-a/contacts\\?.*") { harness.ok(ContactList.serializer(), ContactList(listOf(northwind), null)) }
        model.retry()
        assertEquals(listOf(northwind), model.clients.rows())
        assertEquals(SessionState.Unlocked, harness.session.state.value)
    }

    @Test
    fun aRefusedTokenEndsTheSessionAsTheSyncDoes() {
        harness.route("/api/v1/ledgers/ledger-a/contacts\\?.*") { harness.json(401) }
        harness.pulled("2026-10-22T10:00:00.000Z")
        assertEquals(Online.Failed, model.clients.settled { it == Online.Failed })
        runBlocking { withTimeout(5_000) { harness.session.state.first { it == SessionState.SignedOut } } }
        assertNull(harness.session.token.value)
    }

    @Test
    fun aFailedNextPageKeepsTheRowsAndSaysSo() {
        harness.route("/api/v1/ledgers/ledger-a/contacts\\?.*") { target ->
            if ("cursor=c2" in target) harness.json(500) else harness.ok(ContactList.serializer(), ContactList(listOf(northwind), "c2"))
        }
        harness.pulled("2026-10-22T10:00:00.000Z")
        model.clients.rows()
        model.loadMoreClients()
        val failed = model.clients.settled { (it as? Online.Ready)?.value?.moreFailed == true }
        assertEquals(listOf(northwind), (failed as Online.Ready).value.items)
        assertTrue(failed.value.hasMore)
    }
}
