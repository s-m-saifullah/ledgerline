package app.ledgerline.android.session

import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.FakeTokenProtector
import app.ledgerline.api.SessionToken
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** One HTTP client's connections serve every kind of client the app makes for its server (WP-19b), not one pool each. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ClientsProviderTest {
    private val server = MockWebServer()
    private lateinit var origin: String
    private lateinit var session: SessionManager

    @Before
    fun open() {
        server.start()
        origin = server.url("/").toString().trimEnd('/')
        session = SessionManager(FakeTokenProtector(), FakeClock())
        session.signedIn(SessionToken("tok"))
        session.skipProtect()
    }

    @After
    fun close() = server.close()

    private fun answers(count: Int) = repeat(count) { server.enqueue(MockResponse.Builder().code(200).body("{}").build()) }

    @Test
    fun theScreensTheBackgroundSyncAndTheSignInStepAllShareOneConnection() = runBlocking {
        val base = OkHttpClient()
        val provider = ClientsProvider(session, base)
        answers(3)
        provider.forOrigin(origin).auth.signOut()
        provider.forSync(origin).auth.signOut()
        provider.forToken(origin, SessionToken("one-question")).auth.signOut()
        val connections = (1..3).map { server.takeRequest().connectionIndex }
        assertEquals("one connection, kept open between the three", listOf(0, 0, 0), connections)
        assertEquals(1, base.connectionPool.connectionCount())
    }

    @Test
    fun aClientKeepsItsOwnHeadersWhileSharingTheConnection() = runBlocking {
        val provider = ClientsProvider(session, OkHttpClient())
        answers(2)
        provider.forOrigin(origin).auth.signOut()
        provider.forToken(origin, SessionToken("other-token")).auth.signOut()
        assertEquals("Bearer tok", server.takeRequest().headers["Authorization"])
        assertEquals("Bearer other-token", server.takeRequest().headers["Authorization"])
    }
}
