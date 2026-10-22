package app.ledgerline.api

import okhttp3.Headers
import okhttp3.ResponseBody
import retrofit2.Response
import java.io.IOException

/** The token of a signed-in session. It never appears in a log line, a string or a URL. */
class SessionToken(val value: String) {
    override fun toString() = "SessionToken(hidden)"
}

/** The short-lived cookie that ties a code check to the password step. Held in memory for that one step. */
class Challenge internal constructor(internal val cookie: String) {
    override fun toString() = "Challenge(hidden)"
}

sealed interface SignInFailure {
    data object BadCredentials : SignInFailure
    data object WrongCode : SignInFailure
    data class RateLimited(val retryAfterSeconds: Long?) : SignInFailure

    /** The server refused the app's `Origin`: the address typed does not match the server's own address. */
    data object AddressRejected : SignInFailure
    data object Server : SignInFailure
    data object Network : SignInFailure
    data object Unexpected : SignInFailure
}

sealed interface SignInResult {
    data class SignedIn(val token: SessionToken) : SignInResult
    data class NeedsCode(val challenge: Challenge) : SignInResult
    data class Failed(val failure: SignInFailure) : SignInResult
}

/**
 * Signs in with the routes of ADR 0042. A token counts only when the whole sequence is done: a password for
 * an account with two-factor on gets [SignInResult.NeedsCode] and no token, and a reply that should carry a
 * token but does not is [SignInFailure.Unexpected], never a half signed-in state.
 */
class AuthClient(private val api: AuthApi) {
    private val tokenHeader = "set-auth-token"

    suspend fun signIn(email: String, password: String): SignInResult = call(duringCode = false) {
        api.signIn(SignInRequest(email.trim(), password))
    }

    suspend fun verifyCode(challenge: Challenge, code: String, backupCode: Boolean): SignInResult =
        call(duringCode = true) {
            val body = CodeRequest(code.trim())
            if (backupCode) api.verifyBackupCode(challenge.cookie, body) else api.verifyCode(challenge.cookie, body)
        }

    /** True when the server ended the session; false when it could not be reached or refused. */
    suspend fun signOut(): Boolean = try {
        api.signOut(EmptyBody).also { it.release() }.isSuccessful
    } catch (_: IOException) {
        false
    }

    private suspend fun call(duringCode: Boolean, request: suspend () -> Response<ResponseBody>): SignInResult {
        val response = try {
            request()
        } catch (_: IOException) {
            return SignInResult.Failed(SignInFailure.Network)
        }
        try {
            val reply = response
            if (!reply.isSuccessful) return SignInResult.Failed(failureFor(reply, duringCode))
            val headers = reply.headers()
            if (!duringCode && twoFactorRequired(reply)) {
                val cookie = challengeCookie(headers) ?: return SignInResult.Failed(SignInFailure.Unexpected)
                return SignInResult.NeedsCode(Challenge(cookie))
            }
            val token = headers[tokenHeader]?.takeIf { it.isNotBlank() }
                ?: return SignInResult.Failed(SignInFailure.Unexpected)
            return SignInResult.SignedIn(SessionToken(token))
        } finally {
            response.release()
        }
    }

    private fun twoFactorRequired(reply: Response<ResponseBody>): Boolean = try {
        val text = reply.body()?.string().orEmpty()
        ApiJson.decodeFromString(SignInReply.serializer(), text).twoFactorRedirect == true
    } catch (_: IllegalArgumentException) {
        false
    }

    private fun failureFor(reply: Response<ResponseBody>, duringCode: Boolean): SignInFailure = when (reply.code()) {
        400, 401 -> if (duringCode) SignInFailure.WrongCode else SignInFailure.BadCredentials
        403 -> SignInFailure.AddressRejected
        429 -> SignInFailure.RateLimited(
            (reply.headers()["retry-after"] ?: reply.headers()["x-retry-after"])?.trim()?.toLongOrNull(),
        )
        in 500..599 -> SignInFailure.Server
        else -> SignInFailure.Unexpected
    }

    /** `name=value` pairs of the cookies the reply sets, ready to send back as a `Cookie` header. */
    private fun challengeCookie(headers: Headers): String? {
        val pairs = headers.values("Set-Cookie").mapNotNull { line ->
            val parts = line.split(';').map { it.trim() }
            val pair = parts.first()
            val value = pair.substringAfter('=', "")
            val expired = parts.drop(1).any { it.equals("Max-Age=0", ignoreCase = true) }
            pair.takeIf { value.isNotEmpty() && !expired }
        }
        return pairs.takeIf { it.isNotEmpty() }?.joinToString("; ")
    }
}

private fun Response<ResponseBody>.release() {
    body()?.close()
    errorBody()?.close()
}
