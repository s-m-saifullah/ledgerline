package app.ledgerline.android.mirror

import app.ledgerline.api.Money
import app.ledgerline.api.SyncAccount
import app.ledgerline.api.SyncCategory
import app.ledgerline.api.SyncChanges
import app.ledgerline.api.SyncResponse
import app.ledgerline.api.SyncTag
import app.ledgerline.api.SyncTransaction
import app.ledgerline.api.SyncTransactionTag
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.HttpException
import retrofit2.Response

const val Stamp = "2026-10-22T10:00:00.000Z"

/** A UUID-shaped id; the mirror does not care which. */
fun id(n: Int) = "01930000-0000-7000-8000-%012d".format(n)

fun account(n: Int, version: Int = 1, name: String = "Account $n", deletedAt: String? = null, updatedAt: String = Stamp, openingAmount: Long = 0) =
    SyncAccount(
        id(n), Stamp, updatedAt, deletedAt, version, name, "bank", "USD", Money(openingAmount, "USD"),
        null, null, null, null, null, null, null,
    )

fun syncCategory(
    n: Int,
    name: String = "Category $n",
    kind: String = "expense",
    parentN: Int? = null,
    version: Int = 1,
    sortOrder: Long = n.toLong(),
    archived: Boolean = false,
    deletedAt: String? = null,
) = SyncCategory(id(n), Stamp, Stamp, deletedAt, version, parentN?.let(::id), name, kind, null, null, sortOrder, if (archived) Stamp else null)

fun tag(n: Int, version: Int = 1, name: String = "Tag $n", deletedAt: String? = null) =
    SyncTag(id(n), Stamp, Stamp, deletedAt, version, name, null)

fun entry(
    n: Int,
    accountN: Int = 1,
    version: Int = 1,
    amount: Long = 1_000,
    deletedAt: String? = null,
    payee: String? = "Shop",
    kind: String = "expense",
) = SyncTransaction(
    id(n), Stamp, Stamp, deletedAt, version, id(accountN), null, kind, false, "2026-10-20", null, Money(amount, "USD"),
    payee, null, null, null, null, null, null, null, null, "cleared", "1", Money(amount, "USD"),
)

fun tagLink(n: Int, entryN: Int, tagN: Int, updatedAt: String = Stamp, deletedAt: String? = null) =
    SyncTransactionTag(id(n), Stamp, updatedAt, deletedAt, id(entryN), id(tagN))

fun changes(
    accounts: List<SyncAccount> = emptyList(),
    tags: List<SyncTag> = emptyList(),
    transactions: List<SyncTransaction> = emptyList(),
    links: List<SyncTransactionTag> = emptyList(),
    categories: List<SyncCategory> = emptyList(),
) = SyncChanges(accounts, categories, tags, emptyList(), emptyList(), transactions, emptyList(), links)

fun page(changes: SyncChanges = changes(), cursor: String = "c1", hasMore: Boolean = false, serverTime: String = Stamp) =
    SyncResponse(changes, cursor, hasMore, serverTime)

fun httpError(code: Int) = HttpException(Response.error<Any>(code, "{}".toResponseBody("application/json".toMediaType())))

/** Answers each pull from a script and records what was asked. */
class ScriptedSource(private vararg val steps: (cursor: String?) -> SyncResponse) : PullSource {
    val asked = mutableListOf<String?>()
    override suspend fun pull(ledgerId: String, cursor: String?, limit: Int): SyncResponse {
        val step = steps[asked.size.coerceAtMost(steps.size - 1)]
        asked += cursor
        return step(cursor)
    }
}

fun reply(response: SyncResponse): (String?) -> SyncResponse = { response }
fun fail(error: Throwable): (String?) -> SyncResponse = { throw error }
