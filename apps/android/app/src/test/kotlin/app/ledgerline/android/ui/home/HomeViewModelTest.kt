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
import app.ledgerline.api.ApiJson
import app.ledgerline.api.HomeGroup
import app.ledgerline.api.HomeLoans
import app.ledgerline.api.HomeOwed
import app.ledgerline.api.HomeSetup
import app.ledgerline.api.HomeSummary
import app.ledgerline.api.Money
import app.ledgerline.api.SessionToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.YearMonth
import java.util.Locale
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
}
