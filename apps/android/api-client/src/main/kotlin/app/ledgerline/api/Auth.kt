package app.ledgerline.api

import kotlinx.serialization.Serializable
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

@Serializable
data class SignInRequest(val email: String, val password: String)

@Serializable
data class CodeRequest(val code: String)

/** What the app reads from a sign-in reply. Better Auth adds more fields; the app needs only this one. */
@Serializable
data class SignInReply(val twoFactorRedirect: Boolean? = null)

/** An empty JSON object, for POST routes that take no fields. */
@Serializable
object EmptyBody

/**
 * The authentication routes of ADR 0042. The replies are returned raw because the interesting parts are
 * headers (the `set-auth-token` header and the two-factor challenge cookie), which [AuthClient] reads.
 * These routes are not part of docs/openapi.json (they belong to the auth library), so the API's
 * bearer and two-factor tests are what pin their behaviour.
 */
interface AuthApi {
    @POST("api/v1/auth/sign-in/email")
    suspend fun signIn(@Body body: SignInRequest): Response<ResponseBody>

    @POST("api/v1/auth/two-factor/verify-totp")
    suspend fun verifyCode(@Header("Cookie") challenge: String, @Body body: CodeRequest): Response<ResponseBody>

    @POST("api/v1/auth/two-factor/verify-backup-code")
    suspend fun verifyBackupCode(@Header("Cookie") challenge: String, @Body body: CodeRequest): Response<ResponseBody>

    @POST("api/v1/auth/sign-out")
    suspend fun signOut(@Body body: EmptyBody): Response<ResponseBody>
}
