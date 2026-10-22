package app.ledgerline.android.ui

import app.ledgerline.android.session.ClientsProvider
import app.ledgerline.android.session.SessionManager
import app.ledgerline.android.testing.FakeClock
import app.ledgerline.android.testing.FakeTokenProtector
import app.ledgerline.android.testing.FakeServerAddressStore
import app.ledgerline.android.ui.signin.SignInProblem
import app.ledgerline.android.ui.signin.SignInStep
import app.ledgerline.android.ui.signin.SignInViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
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

    @Test
    fun emptyFieldsAreRefusedWithoutAnyRequest() {
        submit()
        assertEquals(SignInProblem.MissingFields, model.state.value.problem)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun aPlainSignInStoresTheTokenAndClearsThePassword() {
        reply(200, "{}", "set-auth-token" to "tok-1")
        fill()
        submit()
        assertEquals("tok-1", session.token.value?.value)
        assertEquals("", model.state.value.password)
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

        reply(200, "{}", "set-auth-token" to "tok-2")
        model.onCode("123456")
        submit()
        assertEquals("tok-2", session.token.value?.value)
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
