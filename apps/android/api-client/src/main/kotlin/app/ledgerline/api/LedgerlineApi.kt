package app.ledgerline.api

import kotlinx.serialization.json.Json
import retrofit2.http.GET

/**
 * The routes the app calls. A route is added here in the slice that uses it, with its types in Models.kt
 * and a case in ContractTest.
 */
interface LedgerlineApi {
    @GET("api/health")
    suspend fun health(): Health

    @GET("api/v1/ledgers")
    suspend fun ledgers(): LedgerList
}

/** A newer server may add fields; the app ignores what it does not know. The contract test is strict. */
val ApiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = true
}
