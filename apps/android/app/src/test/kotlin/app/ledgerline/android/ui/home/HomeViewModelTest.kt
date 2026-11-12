package app.ledgerline.android.ui.home

import app.ledgerline.android.mirror.MirrorDatabase
import app.ledgerline.android.mirror.SyncCursorRow
import app.ledgerline.android.online.Online
import app.ledgerline.android.online.OnlineReader
import app.ledgerline.android.outbox.memoryDatabase
import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.android.session.SessionManager
import app.ledgerline.android.session.SessionState
import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.FakeServerAddressStore
import app.ledgerline.android.testing.FakeTokenProtector
import app.ledgerline.android.ui.format.monthLabel
import app.ledgerline.api.ApiJson
import app.ledgerline.api.HomeGroup
import app.ledgerline.api.HomeLoans
import app.ledgerline.api.HomeOwed
import app.ledgerline.api.HomeSetup
import app.ledgerline.api.HomeSummary
import app.ledgerline.api.Money
import app.ledgerline.api.SessionToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
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
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

/** A Home where every amount is [amount] US cents and the owner has an account. */
internal fun homeSummary(amount: Long = 123456, month: String = "2026-10"): HomeSummary {
    val usd = Money(amount, "USD")
    return HomeSummary(
        month = month,
        monthStart = "$month-01",
        monthEnd = "$month-31",
        inHand = usd,
        netWorth = usd,
        liabilitiesOwed = usd,
        loans = HomeLoans(lent = usd, borrowed = usd),
        accounts = emptyList(),
        otherActive = HomeGroup(0, Money(0, "USD")),
        archived = HomeGroup(0, Money(0, "USD")),
        moneyIn = usd,
        moneyOut = usd,
        owed = HomeOwed(usd, 2, emptyList(), emptyList()),
        pendingCount = 1,
        latest = emptyList(),
        setup = HomeSetup(hasActiveAccount = true, hasCategory = true),
        unconvertedCurrencies = emptyList(),
    )
}

/** This month on Home, read online with the real clients against a mock server and the real Room mirror. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class HomeViewModelTest {
    private lateinit var server: MockWebServer
    private lateinit var database: MirrorDatabase
    private lateinit var session: SessionManager
    private lateinit var model: HomeViewModel

    @Before
    fun open() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.start()
        database = memoryDatabase()
        session = SessionManager(FakeTokenProtector(), FakeClock())
        session.signedIn(SessionToken("tok"))
        session.skipProtect()
    }

    @After
    fun close() {
        server.close()
        database.close()
        Dispatchers.resetMain()
    }

    private fun start(origin: String = server.url("/").toString().trimEnd('/')) {
        model = HomeViewModel(OnlineReader(FakeServerAddressStore(origin), ClientsProvider(session), session), database.reads())
    }

    private fun answer(code: Int, body: String = "{}") = server.enqueue(MockResponse.Builder().code(code).body(body).build())

    private fun pulled(serverTime: String) = runBlocking { database.dao().putCursor(SyncCursorRow("ledger-a", "c", serverTime)) }

    private fun <T> settled(test: (Online<HomeSummary>) -> T?): T = runBlocking {
        withTimeout(10_000) { test(model.month.first { test(it) != null })!! }
    }

    @Test
    fun readsTheMonthOnceTheMirrorKnowsItsLedger() {
        answer(200, ApiJson.encodeToString(HomeSummary.serializer(), homeSummary()))
        start()
        assertEquals(Online.Loading, model.month.value)
        assertEquals(0, server.requestCount)

        pulled("2026-10-22T10:00:00.000Z")
        assertEquals(homeSummary(), settled { (it as? Online.Ready)?.value })
        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/api/v1/ledgers/ledger-a/home?month=${YearMonth.now()}", request.target)
        assertEquals("Bearer tok", request.headers["Authorization"])
    }

    @Test
    fun everyPullReadsItAgainAndKeepsTheNumbersOnScreenMeanwhile() {
        answer(200, ApiJson.encodeToString(HomeSummary.serializer(), homeSummary(100)))
        answer(200, ApiJson.encodeToString(HomeSummary.serializer(), homeSummary(200)))
        start()
        pulled("2026-10-22T10:00:00.000Z")
        assertEquals(100L, settled { (it as? Online.Ready)?.value?.inHand?.amount })
        pulled("2026-10-22T10:05:00.000Z")
        assertEquals(200L, settled { (it as? Online.Ready)?.value?.inHand?.amount?.takeIf { amount -> amount == 200L } })
        assertEquals(2, server.requestCount)
    }

    @Test
    fun theSameCursorWrittenAgainIsNotReadAgain() {
        answer(200, ApiJson.encodeToString(HomeSummary.serializer(), homeSummary()))
        start()
        pulled("2026-10-22T10:00:00.000Z")
        settled { (it as? Online.Ready)?.value }
        server.takeRequest(5, TimeUnit.SECONDS)
        // Room re-runs a watched query on every write to its table, even when nothing it returns changed.
        pulled("2026-10-22T10:00:00.000Z")
        assertNull(server.takeRequest(500, TimeUnit.MILLISECONDS))
    }

    @Test
    fun withoutAConnectionItSaysSo() {
        val closed = MockWebServer().apply { start() }
        val origin = closed.url("/").toString().trimEnd('/')
        closed.close()
        start(origin)
        pulled("2026-10-22T10:00:00.000Z")
        assertEquals(Online.Offline, settled { it.takeIf { state -> state == Online.Offline } })
    }

    @Test
    fun aServerErrorIsShownAndRetryRecovers() {
        answer(500)
        answer(200, ApiJson.encodeToString(HomeSummary.serializer(), homeSummary()))
        start()
        pulled("2026-10-22T10:00:00.000Z")
        assertEquals(Online.Failed, settled { it.takeIf { state -> state == Online.Failed } })
        model.retry()
        assertEquals(homeSummary(), settled { (it as? Online.Ready)?.value })
        assertEquals(SessionState.Unlocked, session.state.value)
    }

    @Test
    fun theMonthIsNamedInThePhonesLanguage() {
        assertEquals("October 2026", monthLabel("2026-10", Locale.US))
        assertEquals("octubre 2026", monthLabel("2026-10", Locale.forLanguageTag("es")))
    }

    @Test
    fun aRefusedTokenEndsTheSessionAsTheSyncDoes() {
        answer(401)
        start()
        pulled("2026-10-22T10:00:00.000Z")
        assertEquals(Online.Failed, settled { it.takeIf { state -> state == Online.Failed } })
        runBlocking { withTimeout(5_000) { session.state.first { it == SessionState.SignedOut } } }
        assertNull(session.token.value)
    }

    /** Keeps Home subscribed, as the activity does for the life of the app. */
    private fun shown(seen: MutableList<Online<HomeSummary>> = mutableListOf()) =
        CoroutineScope(Dispatchers.Main).launch { model.month.collect { seen += it } }

    @Test
    fun aLockedAppReadsNothingAndStaysLocked() {
        val protector = FakeTokenProtector(stored = SessionToken("tok"))
        session = SessionManager(protector, FakeClock())
        assertEquals(SessionState.Locked, session.state.value)
        answer(401)
        answer(401)
        start()
        val job = shown()

        // The 15-minute background pull wrote a new cursor while the lock screen was up.
        pulled("2026-10-22T10:00:00.000Z")
        pulled("2026-10-22T10:05:00.000Z")

        assertNull(server.takeRequest(500, TimeUnit.MILLISECONDS))
        assertEquals(SessionState.Locked, session.state.value)
        assertEquals(0, protector.discardCount)
        job.cancel()
    }

    @Test
    fun whenTheLedgerGoesAwayHomeShowsLoading() {
        answer(200, ApiJson.encodeToString(HomeSummary.serializer(), homeSummary(100)))
        start()
        val job = shown()
        pulled("2026-10-22T10:00:00.000Z")
        assertEquals(100L, settled { (it as? Online.Ready)?.value?.inHand?.amount })

        runBlocking { database.dao().wipeSyncCursors() }

        assertEquals(Online.Loading, settled { it.takeIf { state -> state == Online.Loading } })
        job.cancel()
    }

    @Test
    fun aNewLedgerShowsLoadingAndNeverTheEarlierLedgersNumbers() {
        // Answered by ledger, not in order: when the mirror is wiped its two watched queries may report in either
        // order, so Home may read the old ledger once more before it learns there is none. B's answer is slow.
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val forB = "/ledgers/ledger-b/" in request.target
                val body = ApiJson.encodeToString(HomeSummary.serializer(), homeSummary(if (forB) 200 else 100))
                val answer = MockResponse.Builder().code(200).body(body)
                return (if (forB) answer.headersDelay(1, TimeUnit.SECONDS) else answer).build()
            }
        }
        start()
        val seen = CopyOnWriteArrayList<Online<HomeSummary>>()
        val job = shown(seen)
        pulled("2026-10-22T10:00:00.000Z")
        assertEquals(100L, settled { (it as? Online.Ready)?.value?.inHand?.amount })

        // Person A signs out (the mirror is wiped); person B's first pull then names another ledger.
        val mark = seen.size
        runBlocking {
            database.dao().wipeSyncCursors()
            database.dao().putCursor(SyncCursorRow("ledger-b", "c", "2026-10-22T11:00:00.000Z"))
        }

        assertEquals(200L, settled { (it as? Online.Ready)?.value?.inHand?.amount?.takeIf { amount -> amount == 200L } })
        val after = seen.drop(mark)
        assertEquals(Online.Loading, after.first())
        assertTrue("A's numbers shown again: $after", after.none { (it as? Online.Ready)?.value?.inHand?.amount == 100L })
        job.cancel()
    }
}
