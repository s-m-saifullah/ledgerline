package app.ledgerline.android.ui.budgets

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
import app.ledgerline.api.Budget
import app.ledgerline.api.BudgetLine
import app.ledgerline.api.BudgetMonth
import app.ledgerline.api.BudgetTotals
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
import java.util.concurrent.TimeUnit

private fun usd(amount: Long) = Money(amount, "USD")

/** A category's line; [budget] null means it has none. */
internal fun budgetLine(
    name: String,
    budget: Long?,
    spent: Long,
    carriedIn: Long = 0,
    month: String = "2026-10",
    id: String = name,
) = BudgetLine(
    categoryId = id,
    name = name,
    icon = null,
    color = null,
    archived = false,
    budget = budget?.let {
        Budget("b-$id", "ledger-a", id, month, usd(it), rollover = carriedIn != 0L, version = 1, createdAt = "2026-10-01T00:00:00.000Z", updatedAt = "2026-10-01T00:00:00.000Z")
    },
    carriedIn = usd(carriedIn),
    spent = usd(spent),
    left = budget?.let { usd(it + carriedIn - spent) },
)

/** A month whose lines and totals add up as the server's do. */
internal fun budgetMonth(month: String = "2026-10", items: List<BudgetLine> = listOf(budgetLine("Food", 30000, 12883, month = month))): BudgetMonth {
    val budgeted = items.filter { it.budget != null }
    return BudgetMonth(
        month = month,
        items = items,
        totals = BudgetTotals(
            budgeted = usd(budgeted.sumOf { it.budget!!.amount.amount }),
            carriedIn = usd(budgeted.sumOf { it.carriedIn.amount }),
            spent = usd(budgeted.sumOf { it.spent.amount }),
            left = usd(budgeted.sumOf { it.left!!.amount }),
            unbudgetedSpent = usd(items.filter { it.budget == null }.sumOf { it.spent.amount }),
        ),
    )
}

/** Budgets read online with the real clients against a mock server and the real Room mirror. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class BudgetsViewModelTest {
    private lateinit var server: MockWebServer
    private lateinit var database: MirrorDatabase
    private lateinit var session: SessionManager
    private lateinit var model: BudgetsViewModel

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
        model = BudgetsViewModel(OnlineReader(FakeServerAddressStore(origin), ClientsProvider(session), session), database.reads())
    }

    private fun answer(code: Int, body: String = "{}", delaySeconds: Long = 0) =
        server.enqueue(MockResponse.Builder().code(code).body(body).headersDelay(delaySeconds, TimeUnit.SECONDS).build())

    private fun answer(month: BudgetMonth, delaySeconds: Long = 0) = answer(200, ApiJson.encodeToString(BudgetMonth.serializer(), month), delaySeconds)

    private fun pulled(serverTime: String) = runBlocking { database.dao().putCursor(SyncCursorRow("ledger-a", "c", serverTime)) }

    private fun <T> settled(test: (Online<BudgetMonth>) -> T?): T = runBlocking {
        withTimeout(10_000) { test(model.budgets.first { test(it) != null })!! }
    }

    private val now = YearMonth.now().toString()

    @Test
    fun nothingIsReadUntilTheScreenShowsThemThenThisMonthIsRead() {
        answer(budgetMonth(now))
        start()
        pulled("2026-10-22T10:00:00.000Z")
        assertNull(server.takeRequest(500, TimeUnit.MILLISECONDS))

        assertEquals(budgetMonth(now), settled { (it as? Online.Ready)?.value })
        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/api/v1/ledgers/ledger-a/budgets?month=$now", request.target)
        assertEquals("Bearer tok", request.headers["Authorization"])
    }

    @Test
    fun anotherMonthShowsLoadingUntilItArrivesAndIsReadForThatMonth() {
        val previous = YearMonth.now().minusMonths(1).toString()
        answer(budgetMonth(now))
        answer(budgetMonth(previous), delaySeconds = 1)
        start()
        pulled("2026-10-22T10:00:00.000Z")
        settled { (it as? Online.Ready)?.value }

        model.previous()
        assertEquals(YearMonth.now().minusMonths(1), model.month.value)
        // This month's numbers are not shown under last month's name while it loads.
        assertEquals(Online.Loading, model.budgets.value)
        assertEquals(previous, settled { (it as? Online.Ready)?.value?.month?.takeIf { month -> month == previous } })
        server.takeRequest(5, TimeUnit.SECONDS)
        assertEquals("/api/v1/ledgers/ledger-a/budgets?month=$previous", server.takeRequest(5, TimeUnit.SECONDS)!!.target)

        model.next()
        assertEquals(YearMonth.now(), model.month.value)
    }

    @Test
    fun aPullReadsAgainAndKeepsTheNumbersOnScreenMeanwhile() {
        answer(budgetMonth(now, listOf(budgetLine("Food", 30000, 100, month = now))))
        answer(budgetMonth(now, listOf(budgetLine("Food", 30000, 200, month = now))), delaySeconds = 1)
        start()
        pulled("2026-10-22T10:00:00.000Z")
        assertEquals(100L, settled { (it as? Online.Ready)?.value?.totals?.spent?.amount })

        pulled("2026-10-22T10:05:00.000Z")
        assertEquals(100L, (model.budgets.value as Online.Ready).value.totals.spent.amount)
        assertEquals(200L, settled { (it as? Online.Ready)?.value?.totals?.spent?.amount?.takeIf { spent -> spent == 200L } })
        assertEquals(2, server.requestCount)
    }

    @Test
    fun theSameCursorWrittenAgainIsNotReadAgain() {
        answer(budgetMonth(now))
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
        answer(budgetMonth(now))
        start()
        pulled("2026-10-22T10:00:00.000Z")
        assertEquals(Online.Failed, settled { it.takeIf { state -> state == Online.Failed } })
        model.retry()
        assertEquals(budgetMonth(now), settled { (it as? Online.Ready)?.value })
        assertEquals(SessionState.Unlocked, session.state.value)
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

    @Test
    fun theBarShowsWhatIsUsedOfTheBudgetAndWhatCarriedIn() {
        assertEquals(0f, usedShare(budgetLine("No budget", null, 5000)))
        assertEquals(0.5f, usedShare(budgetLine("Half", 10000, 5000)))
        assertEquals(0.25f, usedShare(budgetLine("Carried", 10000, 5000, carriedIn = 10000)))
        assertEquals(1f, usedShare(budgetLine("Over", 1000, 16252)))
        assertEquals(1f, usedShare(budgetLine("Nothing left", 0, 100)))
        assertEquals(0f, usedShare(budgetLine("Nothing yet", 0, 0)))
    }
}
