package app.ledgerline.android.ui

import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.android.session.SessionManager
import app.ledgerline.android.session.SessionState
import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.FakeTokenProtector
import app.ledgerline.android.testing.FakeServerAddressStore
import app.ledgerline.android.ui.signin.SignInProblem
import app.ledgerline.android.ui.signin.SignInStep
import app.ledgerline.android.ui.signin.SignInViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.SocketEffect.CloseSocket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/** The sign-in screen's logic against a mock server, with the real clients. */
@OptIn(ExperimentalCoroutinesApi::class)
class SignInViewModelTest {
    private lateinit var server: MockWebServer
    private lateinit var session: SessionManager
    private lateinit var model: SignInViewModel

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.start()
        session = SessionManager(FakeTokenProtector(), FakeClock())
        val origin = server.url("/").toString().trimEnd('/')
        model = SignInViewModel(FakeServerAddressStore(origin), ClientsProvider(session), session)
    }

    @After
    fun tearDown() {
        server.close()
        Dispatchers.resetMain()
    }

    private fun reply(code: Int, body: String = "{}", vararg headers: Pair<String, String>) {
        val builder = MockResponse.Builder().code(code).body(body)
        headers.forEach { (name, value) -> builder.addHeader(name, value) }
        server.enqueue(builder.build())
    }

    /** The request runs on a network thread, so wait for the screen to finish its work. */
    private fun submit() {
        model.submit()
        runBlocking { withTimeout(10_000) { model.state.first { !it.submitting } } }
    }

    private fun fill() {
        model.onEmail("you@example.com")
        model.onPassword("correct horse")
    }

    /** `GET /me` as the server answers it: the one thing the phone reads from it is `mustChangePassword`. */
    private fun me(mustChangePassword: Boolean) =
        """{"id":"01900000-0000-7000-8000-000000000001","name":"Sam","email":"you@example.com","isAdmin":false,""" +
            """"mustChangePassword":$mustChangePassword,"twoFactorEnabled":false}"""

    /** A finished sign-in is followed by the phone's one question about the account (ADR 0050). */
    private fun accepted(token: String, mustChangePassword: Boolean = false) {
        reply(200, "{}", "set-auth-token" to token)
        reply(200, me(mustChangePassword))
    }

    private fun next() = server.takeRequest(5, TimeUnit.SECONDS)!!

    /**
     * Every state the session passes through, kept as it happens (a StateFlow alone would drop the short-lived ones). The
     * session changes on the network thread while the view model is still running there, so this watcher runs after the
     * screen has finished its work and the test thread may read first: use [awaitSeen] before comparing, and a list that is
     * safe to read from another thread.
     */
    private fun watchSession(): MutableList<SessionState> {
        val seen = CopyOnWriteArrayList<SessionState>()
        CoroutineScope(Dispatchers.Unconfined).launch { session.state.collect { seen += it } }
        return seen
    }

    /** Waits until the watcher has recorded [count] states, then returns what it saw. */
    private fun awaitSeen(seen: List<SessionState>, count: Int): List<SessionState> {
        runBlocking { withTimeout(5_000) { while (seen.size < count) delay(10) } }
        return seen.toList()
    }

    @Test
    fun emptyFieldsAreRefusedWithoutAnyRequest() {
        submit()
        assertEquals(SignInProblem.MissingFields, model.state.value.problem)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun aPlainSignInStoresTheTokenAndClearsThePassword() {
        accepted("tok-1")
        fill()
        submit()
        assertEquals("tok-1", session.token.value?.value)
        assertEquals("", model.state.value.password)
        assertNull(model.state.value.problem)
    }

    @Test
    fun theAccountIsAskedAboutWithTheNewTokenBeforeTheSessionHasIt() {
        accepted("tok-1")
        fill()
        val seen = watchSession()
        submit()
        assertEquals("/api/v1/auth/sign-in/email", next().url.encodedPath)
        val question = next()
        assertEquals("GET", question.method)
        assertEquals("/api/v1/me", question.url.encodedPath)
        assertEquals("Bearer tok-1", question.headers["Authorization"])
        assertEquals(2, server.requestCount)
        assertEquals(listOf(SessionState.SignedOut, SessionState.Offer), awaitSeen(seen, 2))
    }

    @Test
    fun aPersonOnATemporaryPasswordIsToldWhyAndGetsNoSession() {
        accepted("tok-t", mustChangePassword = true)
        reply(200)
        fill()
        val seen = watchSession()
        submit()
        assertNull(session.token.value)
        assertEquals(SessionState.SignedOut, session.state.value)
        // Nothing can be waited for here, so give a late state time to be recorded before saying there was none.
        awaitSeen(seen, 1)
        Thread.sleep(300)
        assertEquals(listOf<SessionState>(SessionState.SignedOut), seen.toList())
        assertEquals(SignInProblem.PasswordChangeRequired, model.state.value.problem)
        assertEquals("you@example.com", model.state.value.email)
        assertEquals("", model.state.value.password)
        assertEquals(false, model.state.value.submitting)
        assertEquals(SignInStep.Password, model.state.value.step)
        assertNull(session.ended.value)
    }

    @Test
    fun theSignInThatWasNotUsedIsEndedOnTheServerWithTheSameToken() {
        accepted("tok-t", mustChangePassword = true)
        reply(200)
        fill()
        submit()
        next()
        next()
        val signOut = next()
        assertEquals("POST", signOut.method)
        assertEquals("/api/v1/auth/sign-out", signOut.url.encodedPath)
        assertEquals("Bearer tok-t", signOut.headers["Authorization"])
        assertEquals(3, server.requestCount)
    }

    @Test
    fun theMessageStandsEvenWhenTheServerCannotBeToldToSignOut() {
        accepted("tok-t", mustChangePassword = true)
        reply(500)
        fill()
        submit()
        assertNull(session.token.value)
        assertEquals(SignInProblem.PasswordChangeRequired, model.state.value.problem)
    }

    @Test
    fun aFailedQuestionStillSignsInAsBefore() {
        reply(200, "{}", "set-auth-token" to "tok-1")
        reply(500)
        fill()
        submit()
        assertEquals("tok-1", session.token.value?.value)
        assertNull(model.state.value.problem)
    }

    @Test
    fun aDroppedConnectionDuringTheQuestionStillSignsInAsBefore() {
        reply(200, "{}", "set-auth-token" to "tok-1")
        server.enqueue(MockResponse.Builder().onRequestStart(CloseSocket()).build())
        fill()
        submit()
        assertEquals("tok-1", session.token.value?.value)
        assertNull(model.state.value.problem)
    }

    @Test
    fun anAnswerTheAppDoesNotUnderstandStillSignsInAsBefore() {
        reply(200, "{}", "set-auth-token" to "tok-1")
        reply(200, "not json")
        fill()
        submit()
        assertEquals("tok-1", session.token.value?.value)
        assertNull(model.state.value.problem)
    }

    @Test
    fun aWrongPasswordAsksNothingAboutTheAccount() {
        reply(401)
        fill()
        submit()
        assertEquals(1, server.requestCount)
    }

    @Test
    fun aTwoFactorAccountStoresNothingUntilTheCodeIsAccepted() {
        reply(200, """{"twoFactorRedirect":true}""", "Set-Cookie" to "two_factor=abc; Path=/")
        fill()
        submit()
        assertNull(session.token.value)
        assertEquals(SignInStep.Code, model.state.value.step)
        assertEquals("", model.state.value.password)

        reply(401)
        model.onCode("000000")
        submit()
        assertNull(session.token.value)
        assertEquals(SignInProblem.WrongCode, model.state.value.problem)
        assertEquals(SignInStep.Code, model.state.value.step)

        accepted("tok-2")
        model.onCode("123456")
        submit()
        assertEquals("tok-2", session.token.value?.value)
    }

    @Test
    fun aTemporaryPasswordIsNoticedOnlyOnceTheCodeIsAcceptedAndThenStartsOverAtThePassword() {
        reply(200, """{"twoFactorRedirect":true}""", "Set-Cookie" to "two_factor=abc; Path=/")
        fill()
        submit()
        assertEquals(1, server.requestCount)
        assertEquals(SignInStep.Code, model.state.value.step)

        accepted("tok-t", mustChangePassword = true)
        reply(200)
        model.onCode("123456")
        submit()
        assertNull(session.token.value)
        assertEquals(SignInProblem.PasswordChangeRequired, model.state.value.problem)
        assertEquals(SignInStep.Password, model.state.value.step)
        assertEquals("", model.state.value.code)
        assertEquals(4, server.requestCount)
    }

    @Test
    fun goingBackForgetsTheChallenge() {
        reply(200, """{"twoFactorRedirect":true}""", "Set-Cookie" to "two_factor=abc; Path=/")
        fill()
        submit()
        model.backToPassword()
        assertEquals(SignInStep.Password, model.state.value.step)
        assertNull(session.token.value)
    }

    @Test
    fun aWrongPasswordShowsTheProblemAndAllowsAnotherTry() {
        reply(401)
        fill()
        submit()
        assertEquals(SignInProblem.BadCredentials, model.state.value.problem)
        assertEquals(false, model.state.value.submitting)
        assertEquals("correct horse", model.state.value.password)
        assertNull(session.token.value)
    }

    @Test
    fun theEndedNoticeIsShownOnceAndCanBeDismissed() {
        session.endSession(app.ledgerline.android.session.SessionEnd.Expired)
        assertNotNull(model.ended.value)
        model.dismissNotice()
        assertNull(model.ended.value)
    }
}
