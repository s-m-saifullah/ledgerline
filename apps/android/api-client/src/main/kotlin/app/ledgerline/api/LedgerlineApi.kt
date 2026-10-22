package app.ledgerline.api

import kotlinx.serialization.json.Json
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * The routes the app calls. A route is added here in the slice that uses it, with its types in Models.kt
 * and a case in ContractTest.
 */
interface LedgerlineApi {
    @GET("api/health")
    suspend fun health(): Health

    @GET("api/v1/ledgers")
    suspend fun ledgers(): LedgerList

    /** The pull (ADR 0042). No cursor is a full refresh; `limit` is rows per table, at most 1000. */
    @GET("api/v1/ledgers/{ledgerId}/sync")
    suspend fun sync(
        @Path("ledgerId") ledgerId: String,
        @Query("cursor") cursor: String?,
        @Query("limit") limit: Int,
    ): SyncResponse
}

/** A newer server may add fields; the app ignores what it does not know. The contract test is strict. */
val ApiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = true
}
