package app.ledgerline.api

import kotlinx.serialization.json.Json
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.Header
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
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

    /** Insights (slice 5): spending by category for [month], then [months] months of cash flow and net worth to [to]. */
    @GET("api/v1/ledgers/{ledgerId}/reports/spending")
    suspend fun spending(@Path("ledgerId") ledgerId: String, @Query("month") month: String): SpendingReport

    @GET("api/v1/ledgers/{ledgerId}/reports/cash-flow")
    suspend fun cashFlow(@Path("ledgerId") ledgerId: String, @Query("to") to: String, @Query("months") months: Int): CashFlowReport

    @GET("api/v1/ledgers/{ledgerId}/reports/net-worth")
    suspend fun netWorth(@Path("ledgerId") ledgerId: String, @Query("to") to: String, @Query("months") months: Int): NetWorthReport

    /** Clients (slice 5): [kind] is `clients`, [status] `all`, `active` or `archived`; read online, never stored. */
    @GET("api/v1/ledgers/{ledgerId}/contacts")
    suspend fun contacts(
        @Path("ledgerId") ledgerId: String,
        @Query("kind") kind: String,
        @Query("status") status: String,
        @Query("text") text: String?,
        @Query("cursor") cursor: String?,
        @Query("limit") limit: Int,
    ): ContactList

    @GET("api/v1/ledgers/{ledgerId}/contacts/{contactId}")
    suspend fun contact(@Path("ledgerId") ledgerId: String, @Path("contactId") contactId: String): Contact

    @GET("api/v1/ledgers/{ledgerId}/receivables")
    suspend fun services(
        @Path("ledgerId") ledgerId: String,
        @Query("contactId") contactId: String,
        @Query("cursor") cursor: String?,
        @Query("limit") limit: Int,
    ): ServiceList

    @GET("api/v1/ledgers/{ledgerId}/receivables/{receivableId}/payments")
    suspend fun payments(
        @Path("ledgerId") ledgerId: String,
        @Path("receivableId") receivableId: String,
        @Query("cursor") cursor: String?,
        @Query("limit") limit: Int,
    ): PaymentList

    @GET("api/v1/ledgers/{ledgerId}/contacts/{contactId}/history")
    suspend fun history(
        @Path("ledgerId") ledgerId: String,
        @Path("contactId") contactId: String,
        @Query("cursor") cursor: String?,
        @Query("limit") limit: Int,
    ): HistoryList

    /** Loans (slice 5): the people you lend to or borrow from, and one person's loans. */
    @GET("api/v1/ledgers/{ledgerId}/loans")
    suspend fun loanPeople(
        @Path("ledgerId") ledgerId: String,
        @Query("status") status: String,
        @Query("text") text: String?,
        @Query("cursor") cursor: String?,
        @Query("limit") limit: Int,
    ): LoanPersonList

    @GET("api/v1/ledgers/{ledgerId}/contacts/{contactId}/loans")
    suspend fun loans(@Path("ledgerId") ledgerId: String, @Path("contactId") contactId: String): LoanList

    /** Categories (PRs after slice 5): each write is one idempotent REST call; [key] is the `Idempotency-Key` (8 to 128 safe characters). */
    @POST("api/v1/ledgers/{ledgerId}/categories")
    suspend fun createCategory(
        @Path("ledgerId") ledgerId: String,
        @Header("Idempotency-Key") key: String,
        @Body body: CreateCategory,
    ): Category

    @PATCH("api/v1/ledgers/{ledgerId}/categories/{categoryId}")
    suspend fun updateCategory(
        @Path("ledgerId") ledgerId: String,
        @Path("categoryId") categoryId: String,
        @Header("Idempotency-Key") key: String,
        @Body body: UpdateCategory,
    ): Category

    @POST("api/v1/ledgers/{ledgerId}/categories/{categoryId}/archive")
    suspend fun archiveCategory(
        @Path("ledgerId") ledgerId: String,
        @Path("categoryId") categoryId: String,
        @Header("Idempotency-Key") key: String,
        @Body body: ExpectedVersion,
    ): Category

    @POST("api/v1/ledgers/{ledgerId}/categories/{categoryId}/unarchive")
    suspend fun unarchiveCategory(
        @Path("ledgerId") ledgerId: String,
        @Path("categoryId") categoryId: String,
        @Header("Idempotency-Key") key: String,
        @Body body: ExpectedVersion,
    ): Category

    /** Deletes a category (a soft delete); the server answers 204, and refuses while it has subcategories, entries or rules. */
    @HTTP(method = "DELETE", path = "api/v1/ledgers/{ledgerId}/categories/{categoryId}", hasBody = true)
    suspend fun deleteCategory(
        @Path("ledgerId") ledgerId: String,
        @Path("categoryId") categoryId: String,
        @Header("Idempotency-Key") key: String,
        @Body body: ExpectedVersion,
    )

    /** Budgets: a limit is set (created or edited) or removed with one idempotent call; the server answers 201, 200 or, for a removal, 204. */
    @PUT("api/v1/ledgers/{ledgerId}/budgets")
    suspend fun setBudget(
        @Path("ledgerId") ledgerId: String,
        @Header("Idempotency-Key") key: String,
        @Body body: SetBudget,
    ): Budget

    @HTTP(method = "DELETE", path = "api/v1/ledgers/{ledgerId}/budgets/{budgetId}", hasBody = true)
    suspend fun deleteBudget(
        @Path("ledgerId") ledgerId: String,
        @Path("budgetId") budgetId: String,
        @Header("Idempotency-Key") key: String,
        @Body body: ExpectedVersion,
    )

    /** The push (ADR 0042): each mutation is its own idempotent write, so a batch may be sent again safely. */
    @POST("api/v1/ledgers/{ledgerId}/sync")
    suspend fun push(@Path("ledgerId") ledgerId: String, @Body body: SyncPush): SyncPushResponse
}

/** A newer server may add fields; the app ignores what it does not know. The contract test is strict. */
val ApiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = true
}
