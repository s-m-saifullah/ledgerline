package app.ledgerline.android.ui.loans

import app.ledgerline.android.online.Online
import app.ledgerline.android.online.Paged
import app.ledgerline.android.session.SessionState
import app.ledgerline.android.testing.OnlineHarness
import app.ledgerline.android.ui.clients.contact
import app.ledgerline.android.ui.clients.homeLoans
import app.ledgerline.android.ui.clients.loan
import app.ledgerline.android.ui.clients.person
import app.ledgerline.android.ui.home.homeSummary
import app.ledgerline.api.Contact
import app.ledgerline.api.HomeSummary
import app.ledgerline.api.LoanList
import app.ledgerline.api.LoanPerson
import app.ledgerline.api.LoanPersonList
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.YearMonth

/** Loans read online with the real clients against a mock server that answers by route, and the real Room mirror. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LoansViewModelTest {
    private val harness = OnlineHarness()
    private lateinit var model: LoansViewModel

    private val sam = person("Sam Rivera", "USD" to 20000L)
    private val jo = person("Jo Chen", "USD" to -15000L)
    private val casey = person("Casey Morgan")

    @Before
    fun open() {
        harness.open()
        harness.route("/api/v1/ledgers/ledger-a/loans\\?.*") { harness.ok(LoanPersonList.serializer(), LoanPersonList(listOf(sam, jo, casey), null)) }
        harness.route("/api/v1/ledgers/ledger-a/home\\?.*") { harness.ok(HomeSummary.serializer(), homeSummary().copy(loans = homeLoans(20000, 15000))) }
        harness.route("/api/v1/ledgers/ledger-a/contacts/sam-rivera") { harness.ok(Contact.serializer(), contact("Sam Rivera", origin = "loan")) }
        harness.route("/api/v1/ledgers/ledger-a/contacts/sam-rivera/loans") { harness.ok(LoanList.serializer(), LoanList(listOf(loan("USD", 20000, opening = 5000)))) }
        model = LoansViewModel(harness.reader(), harness.database.reads()).also { it.searchDelayMillis = 0 }
    }

    @After
    fun close() = harness.close()

    private fun <T> StateFlow<T>.settled(test: (T) -> Boolean = { true }): T = runBlocking { withTimeout(10_000) { first { test(it) } } }

    private fun StateFlow<Online<Paged<LoanPerson>>>.rows(): List<LoanPerson> = settled { it is Online.Ready }.let { (it as Online.Ready).value.items }

    private fun personRequests() = harness.targets.filter { "/loans?" in it }

    @Test
    fun nothingIsReadUntilTheScreenShowsItThenThePeopleWithActiveByDefault() {
        harness.pulled("2026-10-22T10:00:00.000Z")
        assertTrue(harness.quiet())

        assertEquals(listOf(sam, jo, casey), model.people.rows())
        assertEquals("/api/v1/ledgers/ledger-a/loans?status=active&limit=50", personRequests().single())
        assertEquals("Bearer tok", harness.tokens.first())
    }

    @Test
    fun whatIsLentAndOwedIsReadFromHomeForThisMonth() {
        harness.pulled("2026-10-22T10:00:00.000Z")
        val totals = (model.totals.settled { it is Online.Ready } as Online.Ready).value
        assertEquals(20000L, totals.lent.amount)
        assertEquals(15000L, totals.borrowed.amount)
        assertTrue(harness.targets.contains("/api/v1/ledgers/ledger-a/home?month=${YearMonth.now()}"))
    }

    @Test
    fun aSearchAndAStatusAreSent() {
        harness.pulled("2026-10-22T10:00:00.000Z")
        model.people.rows()
        model.search("sam")
        model.people.settled { personRequests().any { r -> "text=sam" in r } }
        model.filter("all")
        model.people.settled { personRequests().any { r -> "status=all" in r && "text=sam" in r } }
        assertTrue(personRequests().any { "status=active" in it && "text=sam" in it })
    }

    @Test
    fun aPersonReadsTheirDetailsAndLoansAndBackClosesThem() {
        harness.pulled("2026-10-22T10:00:00.000Z")
        model.open("sam-rivera")
        assertEquals("sam-rivera", model.selected.value)
        assertEquals("Sam Rivera", ((model.person.settled { it is Online.Ready }) as Online.Ready).value.name)
        val loans = (model.loans.settled { it is Online.Ready } as Online.Ready).value
        assertEquals(20000L, loans.single().balance.amount)
        assertEquals(5000L, loans.single().openingBalance.amount)

        model.close()
        assertNull(model.selected.value)
    }

    @Test
    fun theSameCursorWrittenAgainIsNotReadAgain() {
        harness.pulled("2026-10-22T10:00:00.000Z")
        model.people.rows()
        harness.pulled("2026-10-22T10:00:00.000Z")
        Thread.sleep(500)
        assertEquals(1, personRequests().size)
    }

    @Test
    fun withoutAConnectionItSaysSo() {
        model = LoansViewModel(harness.reader(harness.closedOrigin()), harness.database.reads())
        harness.pulled("2026-10-22T10:00:00.000Z")
        assertEquals(Online.Offline, model.people.settled { it == Online.Offline })
    }

    @Test
    fun aServerErrorIsShownAndRetryRecovers() {
        harness.route("/api/v1/ledgers/ledger-a/loans\\?.*") { harness.json(500) }
        harness.pulled("2026-10-22T10:00:00.000Z")
        assertEquals(Online.Failed, model.people.settled { it == Online.Failed })

        harness.route("/api/v1/ledgers/ledger-a/loans\\?.*") { harness.ok(LoanPersonList.serializer(), LoanPersonList(listOf(sam), null)) }
        model.retry()
        assertEquals(listOf(sam), model.people.rows())
        assertEquals(SessionState.Unlocked, harness.session.state.value)
    }

    @Test
    fun aRefusedTokenEndsTheSessionAsTheSyncDoes() {
        harness.route("/api/v1/ledgers/ledger-a/loans\\?.*") { harness.json(401) }
        harness.pulled("2026-10-22T10:00:00.000Z")
        assertEquals(Online.Failed, model.people.settled { it == Online.Failed })
        runBlocking { withTimeout(5_000) { harness.session.state.first { it == SessionState.SignedOut } } }
        assertNull(harness.session.token.value)
    }
}
