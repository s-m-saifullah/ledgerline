package app.ledgerline.api

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

class LedgerlineClients(val auth: AuthClient, val api: LedgerlineApi)

/**
 * The app's HTTP clients for one server. There is no logging interceptor and no cookie jar: nothing about a
 * request or reply is written to the log, and the only cookie the app ever sends is the two-factor challenge,
 * by hand. Redirects are not followed, so a bearer token can never be sent to another address.
 */
fun createClients(
    origin: String,
    userAgent: String,
    token: () -> String?,
    base: OkHttpClient = OkHttpClient(),
): LedgerlineClients {
    val client = base.newBuilder()
        .followRedirects(false)
        .followSslRedirects(false)
        .callTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(HeadersInterceptor(origin, userAgent, token))
        .build()
    val retrofit = Retrofit.Builder()
        .baseUrl("$origin/")
        .client(client)
        .addConverterFactory(ApiJson.asConverterFactory("application/json; charset=UTF-8".toMediaType()))
        .build()
    return LedgerlineClients(AuthClient(retrofit.create(AuthApi::class.java)), retrofit.create(LedgerlineApi::class.java))
}
