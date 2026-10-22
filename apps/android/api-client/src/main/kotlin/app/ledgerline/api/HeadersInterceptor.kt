package app.ledgerline.api

import okhttp3.Interceptor
import okhttp3.Response

const val ClientHeader = "X-Ledgerline-Client"

/** The calls that may hand the app a new token. Only these carry [ClientHeader] (ADR 0042). */
private val CredentialPaths = setOf(
    "/api/v1/auth/sign-in/email",
    "/api/v1/auth/two-factor/verify-totp",
    "/api/v1/auth/two-factor/verify-backup-code",
)

/**
 * Names the app on every request: `Origin` is the server's own address (the server checks it), `User-Agent`
 * names the app and the phone model (the signed-in devices list shows it). A sign-in or code check also
 * carries [ClientHeader] and never a bearer token; every other request carries the bearer token when there
 * is one and never [ClientHeader].
 */
class HeadersInterceptor(
    private val origin: String,
    private val userAgent: String,
    private val token: () -> String?,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val credential = request.method == "POST" && request.url.encodedPath in CredentialPaths
        val builder = request.newBuilder().header("Origin", origin).header("User-Agent", userAgent)
        if (credential) {
            builder.header(ClientHeader, "android")
        } else {
            token()?.let { builder.header("Authorization", "Bearer $it") }
        }
        return chain.proceed(builder.build())
    }
}

/** `Ledgerline-Android/<version> (<model>)`, with anything a header cannot carry removed from the model. */
fun appUserAgent(version: String, model: String): String {
    val safeModel = model.filter { it in ' '..'~' && it != '(' && it != ')' }.trim().take(60).ifEmpty { "Android" }
    return "Ledgerline-Android/$version ($safeModel)"
}
