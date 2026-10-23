package app.ledgerline.api

import kotlinx.serialization.Serializable

/** Money as the API sends it: an integer in minor units plus an ISO 4217 code. Never a floating point number. */
@Serializable
data class Money(val amount: Long, val currency: String)

/** An RFC 9457 problem+json error body. */
@Serializable
data class Problem(
    val type: String,
    val title: String,
    // The contract allows integers up to 2^53 here, so it is a Long like every unbounded integer.
    val status: Long,
    val detail: String,
    val errors: List<FieldError>,
)

@Serializable
data class FieldError(val field: String, val message: String)

@Serializable
data class Health(val status: String)

@Serializable
data class LedgerList(val items: List<LedgerSummary>)

@Serializable
data class LedgerSummary(
    val id: String,
    val name: String,
    val baseCurrency: String,
    val timeZone: String?,
    val version: Int,
    val role: String,
)

/** `GET /ledgers/{ledgerId}/home?month=YYYY-MM`: the web's Home, read online by the phone's Home (slice 5). */
@Serializable
data class HomeSummary(
    val month: String,
    val monthStart: String,
    val monthEnd: String,
    val inHand: Money,
    val netWorth: Money,
    val liabilitiesOwed: Money,
    val loans: HomeLoans,
    val accounts: List<HomeAccount>,
    val otherActive: HomeGroup,
    val archived: HomeGroup,
    val moneyIn: Money,
    val moneyOut: Money,
    val owed: HomeOwed,
    val pendingCount: Long,
    val latest: List<HomeLatest>,
    val setup: HomeSetup,
    val unconvertedCurrencies: List<String>,
)

@Serializable
data class HomeLoans(val lent: Money, val borrowed: Money)

@Serializable
data class HomeAccount(val id: String, val name: String, val type: String, val balance: Money, val baseBalance: Money?)

@Serializable
data class HomeGroup(val count: Long, val balance: Money)

@Serializable
data class HomeOwed(
    val total: Money,
    val personCount: Long,
    val otherCurrencies: List<String>,
    val unconvertedCurrencies: List<String>,
)

@Serializable
data class HomeLatest(
    val transaction: TransactionResponse,
    val accountName: String,
    val categoryLabel: String?,
    val counterpartAccountName: String?,
)

@Serializable
data class HomeSetup(val hasActiveAccount: Boolean, val hasCategory: Boolean)

/** A transaction as the REST API returns it (not the sync's stored row). */
@Serializable
data class TransactionResponse(
    val accountId: String,
    val categoryId: String?,
    val kind: String,
    val date: String,
    val time: String?,
    val amount: Money,
    val status: String,
    val payee: String?,
    val note: String?,
    val id: String,
    val ledgerId: String,
    val fxRate: String,
    val baseAmount: Money,
    val transferId: String?,
    val relatedTransferId: String?,
    val feeTransferId: String?,
    val tipPaymentId: String?,
    val receivablePaymentId: String?,
    val receivableId: String?,
    val isSplit: Boolean,
    val splits: List<TransactionSplitResponse>,
    val tags: List<TagRef>,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class TransactionSplitResponse(
    val id: String,
    val categoryId: String,
    val amount: Money,
    val note: String?,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class TagRef(val id: String, val name: String, val archived: Boolean)

/** A month of budgets (slice 5): one line per expense category, read online and never stored on the phone. */
@Serializable
data class BudgetMonth(val month: String, val items: List<BudgetLine>, val totals: BudgetTotals)

/** A category's month: its budget (null when it has none), what rolled in, what was spent and what is left. */
@Serializable
data class BudgetLine(
    val categoryId: String,
    val name: String,
    val icon: String?,
    val color: String?,
    val archived: Boolean,
    val budget: Budget?,
    val carriedIn: Money,
    val spent: Money,
    val left: Money?,
)

@Serializable
data class Budget(
    val id: String,
    val ledgerId: String,
    val categoryId: String,
    val month: String,
    val amount: Money,
    val rollover: Boolean,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class BudgetTotals(
    val budgeted: Money,
    val carriedIn: Money,
    val spent: Money,
    val left: Money,
    val unbudgetedSpent: Money,
)
