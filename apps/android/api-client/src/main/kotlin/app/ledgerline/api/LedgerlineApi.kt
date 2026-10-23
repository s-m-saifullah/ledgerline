package app.ledgerline.api

import kotlinx.serialization.json.Json
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
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

    /** The month on Home (slice 5): read online, never stored on the phone. [month] is YYYY-MM. */
    @GET("api/v1/ledgers/{ledgerId}/home")
    suspend fun home(@Path("ledgerId") ledgerId: String, @Query("month") month: String): HomeSummary

    /** A month of budgets (slice 5): read online, never stored on the phone. [month] is YYYY-MM. */
    @GET("api/v1/ledgers/{ledgerId}/budgets")
    suspend fun budgets(@Path("ledgerId") ledgerId: String, @Query("month") month: String): BudgetMonth

    /** The push (ADR 0042): each mutation is its own idempotent write, so a batch may be sent again safely. */
    @POST("api/v1/ledgers/{ledgerId}/sync")
    suspend fun push(@Path("ledgerId") ledgerId: String, @Body body: SyncPush): SyncPushResponse
}

/** A newer server may add fields; the app ignores what it does not know. The contract test is strict. */
val ApiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = true
}
