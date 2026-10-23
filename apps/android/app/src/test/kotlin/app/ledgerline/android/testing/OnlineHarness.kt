package app.ledgerline.android.testing

import app.ledgerline.android.mirror.MirrorDatabase
import app.ledgerline.android.mirror.SyncCursorRow
import app.ledgerline.android.online.OnlineReader
import app.ledgerline.android.outbox.memoryDatabase
import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.android.session.SessionManager
import app.ledgerline.api.ApiJson
import app.ledgerline.api.SessionToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.KSerializer
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

/**
 * What the online screens' view-model tests share: a mock server that answers by route (the first matching route
 * wins, an unknown one is a 404), the real clients and the real Room mirror, and a signed-in session. Every request
 * is kept in [targets] (path and query) and the bearer token of each in [tokens].
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OnlineHarness {
    private val routes = mutableListOf<Pair<Regex, (String) -> MockResponse>>()
    val targets = CopyOnWriteArrayList<String>()
    val tokens = CopyOnWriteArrayList<String?>()
    var delayMillis = 0L
    val server = MockWebServer()
    lateinit var database: MirrorDatabase
    lateinit var session: SessionManager

    fun open() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                targets += request.target
                tokens += request.headers["Authorization"]
                val match = routes.firstOrNull { it.first.matches(request.target) }
                val answer = match?.second?.invoke(request.target) ?: MockResponse.Builder().code(404).body("{}").build()
                return answer.newBuilder().headersDelay(delayMillis, TimeUnit.MILLISECONDS).build()
            }
        }
        server.start()
        database = memoryDatabase()
        session = SessionManager(FakeTokenProtector(), FakeClock())
        session.signedIn(SessionToken("tok"))
        session.skipProtect()
    }

    fun close() {
        server.close()
        database.close()
        Dispatchers.resetMain()
    }

    fun reader(origin: String = server.url("/").toString().trimEnd('/')) =
        OnlineReader(FakeServerAddressStore(origin), ClientsProvider(session), session)

    /** An address nothing answers at, for "no connection": a server that was started and closed. */
    fun closedOrigin(): String {
        val closed = MockWebServer().apply { start() }
        val origin = closed.url("/").toString().trimEnd('/')
        closed.close()
        return origin
    }

    /** Answers requests whose path and query match [pattern] (a regex over `/api/v1/...?query`) with [respond]. */
    fun route(pattern: String, respond: (String) -> MockResponse) {
        routes.removeAll { it.first.pattern == pattern }
        routes += Regex(pattern) to respond
    }

    fun json(code: Int = 200, body: String = "{}") = MockResponse.Builder().code(code).body(body).build()

    fun <T> ok(serializer: KSerializer<T>, value: T) = json(200, ApiJson.encodeToString(serializer, value))

    /** The mirror has pulled [serverTime]'s ledger "ledger-a": screens read online from here on. */
    fun pulled(serverTime: String) = runBlocking { database.dao().putCursor(SyncCursorRow("ledger-a", "c", serverTime)) }

    /** Waits until at least [count] requests have arrived (a screen may send several together). */
    fun requests(count: Int): List<String> = runBlocking {
        withTimeout(5_000) { while (targets.size < count) delay(10) }
        targets.toList()
    }

    /** Waits until [condition] holds, polling: for what a state flow cannot tell (a request that returns the same rows). */
    fun until(condition: () -> Boolean) = runBlocking {
        withTimeout(5_000) { while (!condition()) delay(10) }
    }

    /** True when nothing arrives in half a second: for "nothing is read until..." checks. */
    fun quiet(): Boolean = server.takeRequest(500, TimeUnit.MILLISECONDS) == null
}
