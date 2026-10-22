package app.ledgerline.api

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The sign-in sequence against recorded server behaviour (the shapes pinned by the API's bearer tests). */
class AuthClientTest {
    private lateinit var server: MockWebServer
    private lateinit var origin: String
    private var token: String? = null
    private lateinit var clients: LedgerlineClients

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        origin = server.url("/").toString().trimEnd('/')
        clients = createClients(origin, "Ledgerline-Android/0.1.0 (Test Phone)", { token })
    }

    @After
    fun tearDown() = server.close()

    private fun reply(code: Int, body: String = "{}", vararg headers: Pair<String, String>) {
        val builder = MockResponse.Builder().code(code).body(body)
        headers.forEach { (name, value) -> builder.addHeader(name, value) }
        server.enqueue(builder.build())
    }

    private fun signIn() = runBlocking { clients.auth.signIn("you@example.com", "correct horse") }

    private fun failure(result: SignInResult) = (result as SignInResult.Failed).failure

    @Test
    fun aPasswordSignInWithoutTwoFactorGivesTheToken() {
        reply(200, """{"redirect":false,"token":"x"}""", "set-auth-token" to "tok-123")
        val result = signIn() as SignInResult.SignedIn
        assertEquals("tok-123", result.token.value)
        val request = server.takeRequest()
        assertEquals("/api/v1/auth/sign-in/email", request.url.encodedPath)
        assertEquals(origin, request.headers["Origin"])
        assertEquals("Ledgerline-Android/0.1.0 (Test Phone)", request.headers["User-Agent"])
        assertEquals("android", request.headers[ClientHeader])
        assertNull(request.headers["Authorization"])
        assertNull(request.headers["Cookie"])
        assertEquals("""{"email":"you@example.com","password":"correct horse"}""", request.body?.utf8())
    }

    @Test
    fun aTwoFactorAccountGetsNoTokenFromThePasswordAloneEvenIfTheHeaderIsThere() {
        reply(
            200, """{"twoFactorRedirect":true}""",
            "set-auth-token" to "must-be-ignored",
            "Set-Cookie" to "two_factor=abc123; Max-Age=600; Path=/; HttpOnly",
        )
        assertTrue(signIn() is SignInResult.NeedsCode)
    }

    @Test
    fun theCodeStepSendsTheChallengeCookieAndGivesTheToken() = runBlocking {
        reply(
            200, """{"twoFactorRedirect":true}""",
            "Set-Cookie" to "two_factor=abc123; Max-Age=600; Path=/; HttpOnly",
            "Set-Cookie" to "other=gone; Max-Age=0; Path=/",
        )
        reply(200, "{}", "set-auth-token" to "tok-2fa")
        val needsCode = clients.auth.signIn("you@example.com", "pw") as SignInResult.NeedsCode
        server.takeRequest()
        val done = clients.auth.verifyCode(needsCode.challenge, " 123456 ", backupCode = false) as SignInResult.SignedIn
        assertEquals("tok-2fa", done.token.value)
        val request = server.takeRequest()
        assertEquals("/api/v1/auth/two-factor/verify-totp", request.url.encodedPath)
        assertEquals("two_factor=abc123", request.headers["Cookie"])
        assertEquals("android", request.headers[ClientHeader])
        assertNull(request.headers["Authorization"])
        assertEquals("""{"code":"123456"}""", request.body?.utf8())
    }

    @Test
    fun aBackupCodeUsesItsOwnRoute() = runBlocking {
        reply(200, """{"twoFactorRedirect":true}""", "Set-Cookie" to "two_factor=abc; Path=/")
        reply(200, "{}", "set-auth-token" to "tok-backup")
        val needsCode = clients.auth.signIn("you@example.com", "pw") as SignInResult.NeedsCode
        server.takeRequest()
        val done = clients.auth.verifyCode(needsCode.challenge, "abcd-efgh", backupCode = true)
        assertTrue(done is SignInResult.SignedIn)
        assertEquals("/api/v1/auth/two-factor/verify-backup-code", server.takeRequest().url.encodedPath)
    }

    @Test
    fun aWrongCodeIsNotSignedIn() = runBlocking {
        reply(200, """{"twoFactorRedirect":true}""", "Set-Cookie" to "two_factor=abc; Path=/")
        reply(401, """{"title":"Authentication failed"}""")
        val needsCode = clients.auth.signIn("you@example.com", "pw") as SignInResult.NeedsCode
        assertEquals(SignInFailure.WrongCode, failure(clients.auth.verifyCode(needsCode.challenge, "000000", false)))
    }

    @Test
    fun aTwoFactorStepWithoutAChallengeCookieIsUnexpected() {
        reply(200, """{"twoFactorRedirect":true}""")
        assertEquals(SignInFailure.Unexpected, failure(signIn()))
    }

    @Test
    fun aSignInReplyWithoutATokenIsNeverASession() {
        reply(200, """{"redirect":false}""")
        assertEquals(SignInFailure.Unexpected, failure(signIn()))
    }

    @Test
    fun aGarbledReplyWithoutATokenIsUnexpected() {
        reply(200, "<html>proxy page</html>")
        assertEquals(SignInFailure.Unexpected, failure(signIn()))
    }

    @Test
    fun aWrongPasswordIsBadCredentials() {
        reply(401, """{"title":"Authentication failed"}""")
        assertEquals(SignInFailure.BadCredentials, failure(signIn()))
    }

    @Test
    fun theRateLimitCarriesTheWaitWhenTheServerSaysIt() {
        reply(429, "{}", "X-Retry-After" to "7")
        assertEquals(SignInFailure.RateLimited(7), failure(signIn()))
        reply(429)
        assertEquals(SignInFailure.RateLimited(null), failure(signIn()))
    }

    @Test
    fun aRefusedOriginIsAnAddressProblem() {
        reply(403)
        assertEquals(SignInFailure.AddressRejected, failure(signIn()))
    }

    @Test
    fun serverErrorsAndUnreachableServersAreTold() {
        reply(500)
        assertEquals(SignInFailure.Server, failure(signIn()))
        reply(502)
        assertEquals(SignInFailure.Server, failure(signIn()))
        server.close()
        assertEquals(SignInFailure.Network, failure(signIn()))
    }

    @Test
    fun redirectsAreNotFollowedSoTheTokenCannotLeave() {
        reply(302, "", "Location" to "https://other.example.com/")
        assertEquals(SignInFailure.Unexpected, failure(signIn()))
        assertEquals(1, server.requestCount)
    }

    @Test
    fun otherCallsCarryTheBearerTokenAndNeverTheClientHeader() = runBlocking {
        token = "tok-abc"
        reply(200, """{"items":[]}""")
        clients.api.ledgers()
        val request = server.takeRequest()
        assertEquals("Bearer tok-abc", request.headers["Authorization"])
        assertEquals(origin, request.headers["Origin"])
        assertEquals("Ledgerline-Android/0.1.0 (Test Phone)", request.headers["User-Agent"])
        assertNull(request.headers[ClientHeader])
    }

    @Test
    fun aSignInNeverSendsAnOldBearerToken() {
        token = "old-token"
        reply(200, "{}", "set-auth-token" to "new-token")
        signIn()
        assertNull(server.takeRequest().headers["Authorization"])
    }

    @Test
    fun signOutSendsTheTokenAndReportsWhetherTheServerEndedTheSession() = runBlocking {
        token = "tok-abc"
        reply(200, """{"success":true}""")
        assertTrue(clients.auth.signOut())
        val request = server.takeRequest()
        assertEquals("/api/v1/auth/sign-out", request.url.encodedPath)
        assertEquals("Bearer tok-abc", request.headers["Authorization"])
        assertEquals("{}", request.body?.utf8())
        reply(401)
        assertFalse(clients.auth.signOut())
        server.close()
        assertFalse(clients.auth.signOut())
    }

    @Test
    fun theTokenIsNeverInAUrlOrAString() {
        token = "tok-secret"
        reply(200, "{}", "set-auth-token" to "tok-secret")
        val result = signIn() as SignInResult.SignedIn
        assertFalse(result.toString().contains("tok-secret"))
        assertFalse(server.takeRequest().url.toString().contains("tok-secret"))
    }

    @Test
    fun theClientHasNoLoggingAndNoCookieJar() {
        val client = OkHttpClient()
        val built = client.newBuilder().build()
        assertTrue(built.interceptors.none { it.javaClass.name.contains("Logging") })
        assertEquals(okhttp3.CookieJar.NO_COOKIES, built.cookieJar)
    }

    @Test
    fun theUserAgentNamesTheAppAndSanitisesTheModel() {
        assertEquals("Ledgerline-Android/0.1.0 (Pixel 9 Pro)", appUserAgent("0.1.0", "Pixel 9 Pro"))
        assertEquals("Ledgerline-Android/0.1.0 (Phone X)", appUserAgent("0.1.0", "Phone\r\n (X)"))
        assertEquals("Ledgerline-Android/0.1.0 (Android)", appUserAgent("0.1.0", ""))
        assertEquals("Ledgerline-Android/0.1.0 (Android)", appUserAgent("0.1.0", "é☃"))
    }
}
