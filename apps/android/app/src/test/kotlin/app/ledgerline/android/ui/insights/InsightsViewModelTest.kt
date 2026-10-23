package app.ledgerline.android.ui.insights

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
import app.ledgerline.android.ui.format.sharePercent
import app.ledgerline.android.ui.format.shortMonth
import app.ledgerline.api.ApiJson
import app.ledgerline.api.CashFlowMonth
import app.ledgerline.api.CashFlowReport
import app.ledgerline.api.Money
import app.ledgerline.api.NetWorthMonth
import app.ledgerline.api.NetWorthReport
import app.ledgerline.api.SessionToken
import app.ledgerline.api.SpendingCategory
import app.ledgerline.api.SpendingReport
import app.ledgerline.api.SpendingSubcategory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
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
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.YearMonth
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

private fun usd(amount: Long) = Money(amount, "USD")

/** [count] months ending at [to], oldest first. */
internal fun monthsTo(to: String, count: Int = ChartMonths): List<String> =
    (count - 1 downTo 0).map { YearMonth.parse(to).minusMonths(it.toLong()).toString() }

/**
 * Made-up Insights for [month]: [spent] spent in a main category with a subcategory (and some directly in it) and
 * in one without; twelve months of cash flow and net worth, the chosen month's money in [income].
 */
internal fun insights(month: String = "2026-10", spent: Long = 76147, income: Long = 250000, worthMonths: Int = ChartMonths): Insights {
    val food = spent * 6 / 10
    val spending = SpendingReport(
        month = month,
        monthStart = "$month-01",
        monthEnd = "$month-28",
        total = usd(spent),
        categories = listOf(
            SpendingCategory("c-food", "Food", null, false, usd(food), 6000, listOf(SpendingSubcategory("c-groceries", "Groceries", null, false, usd(food - 1000), 5900))),
            SpendingCategory("c-fun", "Fun", null, false, usd(spent - food), 4000, emptyList()),
        ),
    )
    val flow = CashFlowReport(
        monthsTo(month).first(),
        month,
        monthsTo(month).mapIndexed { i, m ->
            val inc = if (m == month) income else 200000L + i * 5000
            val out = if (m == month) spent else 60000L + (i % 3) * 9000
            CashFlowMonth(m, usd(inc), usd(out), usd(inc - out))
        },
    )
    val worth = NetWorthReport(
        monthsTo(month, worthMonths).firstOrNull() ?: month,
        month,
        historyStart = if (worthMonths < ChartMonths) monthsTo(month, worthMonths).firstOrNull() else null,
        months = monthsTo(month, worthMonths).mapIndexed { i, m -> NetWorthMonth(m, "$m-28", usd(500000L + i * 40000), emptyList()) },
    )
    return Insights(spending, flow, worth)
}

/** Insights read online with the real clients against a mock server that answers by route, and the real Room mirror. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class InsightsViewModelTest {
    private lateinit var server: MockWebServer
    private lateinit var database: MirrorDatabase
    private lateinit var session: SessionManager
    private lateinit var model: InsightsViewModel

    /** What each route answers next: a month's insights by default, or the code set for it. */
    private val answers = mutableMapOf<String, (String) -> MockResponse>()
    private val targets = CopyOnWriteArrayList<String>()
    private var delayMillis = 0L

    @Before
    fun open() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val target = request.target
                targets += target
                val month = Regex("(?:month|to)=(\\d{4}-\\d{2})").find(target)!!.groupValues[1]
                val route = target.substringAfter("/reports/").substringBefore("?")
                val answer = answers[route]?.invoke(month) ?: ok(route, insights(month))
                return answer.newBuilder().headersDelay(delayMillis, TimeUnit.MILLISECONDS).build()
            }
        }
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

    private fun ok(route: String, value: Insights): MockResponse {
        val body = when (route) {
            "spending" -> ApiJson.encodeToString(SpendingReport.serializer(), value.spending)
            "cash-flow" -> ApiJson.encodeToString(CashFlowReport.serializer(), value.cashFlow)
            else -> ApiJson.encodeToString(NetWorthReport.serializer(), value.netWorth)
        }
        return MockResponse.Builder().code(200).body(body).build()
    }

    private fun start(origin: String = server.url("/").toString().trimEnd('/')) {
        model = InsightsViewModel(OnlineReader(FakeServerAddressStore(origin), ClientsProvider(session), session), database.reads())
    }

    private fun pulled(serverTime: String) = runBlocking { database.dao().putCursor(SyncCursorRow("ledger-a", "c", serverTime)) }

    private fun <T> settled(test: (Online<Insights>) -> T?): T = runBlocking {
        withTimeout(10_000) { test(model.insights.first { test(it) != null })!! }
    }

    /** Waits until [count] requests have arrived (they are sent together). */
    private fun requests(count: Int): List<String> = runBlocking {
        withTimeout(5_000) { while (targets.size < count) kotlinx.coroutines.delay(10) }
        targets.toList()
    }

    private val now = YearMonth.now().toString()

    @Test
    fun nothingIsReadUntilTheScreenShowsItThenTheThreeReportsForThisMonth() {
        start()
        pulled("2026-10-22T10:00:00.000Z")
        assertNull(server.takeRequest(500, TimeUnit.MILLISECONDS))

        assertEquals(insights(now), settled { (it as? Online.Ready)?.value })
        assertEquals(
            setOf(
                "/api/v1/ledgers/ledger-a/reports/spending?month=$now",
                "/api/v1/ledgers/ledger-a/reports/cash-flow?to=$now&months=12",
                "/api/v1/ledgers/ledger-a/reports/net-worth?to=$now&months=12",
            ),
            requests(3).toSet(),
        )
        repeat(3) { assertEquals("Bearer tok", server.takeRequest(5, TimeUnit.SECONDS)!!.headers["Authorization"]) }
    }

    @Test
    fun anotherMonthShowsLoadingUntilItArrives() {
        val previous = YearMonth.now().minusMonths(1).toString()
        start()
        pulled("2026-10-22T10:00:00.000Z")
        settled { (it as? Online.Ready)?.value }
        delayMillis = 1_000

        model.previous()
        assertEquals(Online.Loading, model.insights.value)
        assertEquals(previous, settled { (it as? Online.Ready)?.value?.spending?.month?.takeIf { month -> month == previous } })
        assertEquals(3, requests(6).drop(3).count { previous in it })
    }

    @Test
    fun aPullReadsAgainAndKeepsTheNumbersOnScreenMeanwhile() {
        answers["spending"] = { month -> ok("spending", insights(month, spent = 100)) }
        start()
        pulled("2026-10-22T10:00:00.000Z")
        assertEquals(100L, settled { (it as? Online.Ready)?.value?.spending?.total?.amount })

        answers["spending"] = { month -> ok("spending", insights(month, spent = 200)) }
        delayMillis = 1_000
        pulled("2026-10-22T10:05:00.000Z")
        assertEquals(100L, (model.insights.value as Online.Ready).value.spending.total.amount)
        assertEquals(200L, settled { (it as? Online.Ready)?.value?.spending?.total?.amount?.takeIf { spent -> spent == 200L } })
        assertEquals(6, requests(6).size)
    }

    @Test
    fun theSameCursorWrittenAgainIsNotReadAgain() {
        start()
        pulled("2026-10-22T10:00:00.000Z")
        settled { (it as? Online.Ready)?.value }
        requests(3)
        pulled("2026-10-22T10:00:00.000Z")
        Thread.sleep(500)
        assertEquals(3, targets.size)
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
    fun oneReportFailingFailsThePageAndRetryRecovers() {
        answers["net-worth"] = { MockResponse.Builder().code(500).body("{}").build() }
        start()
        pulled("2026-10-22T10:00:00.000Z")
        assertEquals(Online.Failed, settled { it.takeIf { state -> state == Online.Failed } })

        answers.remove("net-worth")
        model.retry()
        assertEquals(insights(now), settled { (it as? Online.Ready)?.value })
        assertEquals(SessionState.Unlocked, session.state.value)
    }

    @Test
    fun aRefusedTokenEndsTheSessionAsTheSyncDoes() {
        answers["spending"] = { MockResponse.Builder().code(401).body("{}").build() }
        start()
        pulled("2026-10-22T10:00:00.000Z")
        assertEquals(Online.Failed, settled { it.takeIf { state -> state == Online.Failed } })
        runBlocking { withTimeout(5_000) { session.state.first { it == SessionState.SignedOut } } }
        assertNull(session.token.value)
    }

    @Test
    fun theThreeAnswersAreShownOnlyTogether() {
        assertEquals(Online.Ready(6), allOf(Online.Ready(1), Online.Ready(2), Online.Ready(3)) { a, b, c -> a + b + c })
        assertEquals(Online.Offline, allOf(Online.Ready(1), Online.Failed, Online.Offline) { a: Int, _: Int, _: Int -> a })
        assertEquals(Online.Failed, allOf(Online.Ready(1), Online.Ready(2), Online.Failed) { a: Int, _: Int, _: Int -> a })
    }

    @Test
    fun cashFlowBarsAreSharesOfTheTallestAndAnyMoneyShows() {
        assertEquals(1f, flowHeight(250000, 250000))
        assertEquals(0.5f, flowHeight(125000, 250000))
        assertEquals(0.02f, flowHeight(1, 250000))
        assertEquals(0f, flowHeight(0, 250000))
        assertEquals(0f, flowHeight(100, 0))
    }

    @Test
    fun netWorthBarsStandOnZeroAndHangBelowItWhenNegative() {
        val positive = WorthScale(listOf(100, 200))
        assertNull(positive.zero)
        assertEquals(WorthBar(0f, 0.5f), positive.bar(100))
        assertEquals(WorthBar(0f, 1f), positive.bar(200))

        val mixed = WorthScale(listOf(-100, 300))
        assertEquals(0.25f, mixed.zero)
        assertEquals(WorthBar(0.25f, 0.75f), mixed.bar(300))
        assertEquals(WorthBar(0f, 0.25f), mixed.bar(-100))
        assertEquals(WorthBar(0.25f, 0f), mixed.bar(0))
        assertEquals(WorthBar(0f, 0f), WorthScale(listOf(0, 0)).bar(0))
        assertEquals(0.01f, WorthScale(listOf(1_000_000)).bar(1).height)
    }

    @Test
    fun monthNamesThinOutOnlyWhenTheyWouldNotFit() {
        // Column 18 px with 4 px gaps: a name may use its gap, as on the web.
        assertEquals(1, labelStep(widest = 22f, column = 18f, gap = 4f))
        assertEquals(2, labelStep(widest = 30f, column = 18f, gap = 4f))
        assertEquals(3, labelStep(widest = 60f, column = 18f, gap = 4f))
        assertEquals(6, labelStep(widest = 120f, column = 18f, gap = 4f))
        assertEquals(ChartMonths, labelStep(widest = 500f, column = 18f, gap = 4f))
    }

    @Test
    fun sharesHaveOneDecimalRoundedHalfUpAsOnTheWeb() {
        assertEquals("23.7%", sharePercent(18080, 76147, Locale.US))
        assertEquals("6.3%", sharePercent(625, 10000, Locale.US))
        assertEquals("100.0%", sharePercent(5, 5, Locale.US))
        assertEquals("0.0%", sharePercent(5, 0, Locale.US))
        assertEquals("Oct", shortMonth("2026-10", Locale.US))
    }
}
