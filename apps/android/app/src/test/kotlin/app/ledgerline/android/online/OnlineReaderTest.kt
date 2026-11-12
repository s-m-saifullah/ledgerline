package app.ledgerline.android.online

import app.ledgerline.android.session.SessionManager
import app.ledgerline.android.session.SessionState
import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.FakeTokenProtector
import app.ledgerline.android.testing.OnlineHarness
import app.ledgerline.api.SessionToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A read online uses the open session. While the app is locked or signed out there is no token, so nothing is sent:
 * a 401 to a request that carried no token is not the server refusing the sign-in, and must never end it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OnlineReaderTest {
    private val harness = OnlineHarness()

    @Before
    fun open() = harness.open()

    @After
    fun close() = harness.close()

    private fun read() = runBlocking { harness.reader().read { home("ledger-a", "2026-10") } }

    @Test
    fun aLockedAppSendsNothingAndKeepsTheStoredSignIn() {
        val protector = FakeTokenProtector(stored = SessionToken("tok"))
        harness.session = SessionManager(protector, FakeClock())
        assertEquals(SessionState.Locked, harness.session.state.value)
        harness.route(".*") { harness.json(401) }

        assertEquals(Online.Failed, read())

        assertTrue("sent: ${harness.targets}", harness.targets.isEmpty())
        assertEquals(SessionState.Locked, harness.session.state.value)
        assertEquals(0, protector.discardCount)
        assertEquals("tok", protector.stored?.value)
    }

    @Test
    fun aSignedOutAppSendsNothing() {
        harness.session = SessionManager(FakeTokenProtector(), FakeClock())
        assertEquals(SessionState.SignedOut, harness.session.state.value)
        harness.route(".*") { harness.json(401) }

        assertEquals(Online.Failed, read())

        assertTrue("sent: ${harness.targets}", harness.targets.isEmpty())
    }

    @Test
    fun aRefusedTokenStillEndsTheSession() {
        harness.route(".*") { harness.json(401) }

        assertEquals(Online.Failed, read())

        assertEquals(listOf<String?>("Bearer tok"), harness.tokens.toList())
        assertEquals(SessionState.SignedOut, harness.session.state.value)
    }

    @Test
    fun aRefusalThatArrivesAfterTheAppLockedDoesNotEndTheSignIn() {
        val protector = FakeTokenProtector()
        harness.session = SessionManager(protector, FakeClock())
        harness.session.signedIn(SessionToken("tok"))
        runBlocking { harness.session.protect() }
        assertEquals(SessionState.Unlocked, harness.session.state.value)
        harness.delayMillis = 400
        harness.route(".*") { harness.json(401) }

        val answer = runBlocking {
            val pending = async(Dispatchers.IO) { harness.reader().read { home("ledger-a", "2026-10") } }
            harness.requests(1)
            // The request went out with the token; the owner locks the app before the answer arrives.
            harness.session.lock()
            pending.await()
        }

        assertEquals(Online.Failed, answer)
        assertEquals(SessionState.Locked, harness.session.state.value)
        assertEquals(0, protector.discardCount)
    }

    @Test
    fun aSignedInReadSendsTheTokenAndReturnsTheAnswer() {
        harness.route(".*") { harness.json(500) }

        assertEquals(Online.Failed, read())

        assertEquals(listOf<String?>("Bearer tok"), harness.tokens.toList())
        assertEquals(SessionState.Unlocked, harness.session.state.value)
    }
}
