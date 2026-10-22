package app.ledgerline.api

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * The pull of `GET /ledgers/{id}/sync` (ADR 0042): each table as its own stored rows. A row with `deletedAt` set is a
 * tombstone. Text enums (type, kind, status, source) stay strings so a value a newer server adds cannot break a pull;
 * money is `Long` minor units, never floating point.
 */
@Serializable
data class SyncResponse(
    val changes: SyncChanges,
    /** Opaque: sent back as `cursor` for the next page or the next pull. */
    val cursor: String,
    val hasMore: Boolean,
    val serverTime: String,
)

@Serializable
data class SyncChanges(
    val accounts: List<SyncAccount>,
    val categories: List<SyncCategory>,
    val tags: List<SyncTag>,
    val currencies: List<SyncCurrency>,
    val exchangeRates: List<SyncRate>,
    val transactions: List<SyncTransaction>,
    val transactionSplits: List<SyncSplit>,
    val transactionTags: List<SyncTransactionTag>,
)

@Serializable
data class SyncAccount(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val version: Int,
    val name: String,
    val type: String,
    val currency: String,
    val openingBalance: Money,
    val inboundBonusBps: Long?,
    val bonusCategoryId: String?,
    val feeCategoryId: String?,
    val defaultFeeAmount: Money?,
    val defaultFeeBps: Long?,
    val contactId: String?,
    val archivedAt: String?,
)

@Serializable
data class SyncCategory(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val version: Int,
    val parentId: String?,
    val name: String,
    val kind: String,
    val icon: String?,
    val color: String?,
    val sortOrder: Long,
    val archivedAt: String?,
)

@Serializable
data class SyncTag(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val version: Int,
    val name: String,
    val archivedAt: String?,
)

@Serializable
data class SyncCurrency(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val version: Int,
    val code: String,
)

@Serializable
data class SyncRate(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val version: Int,
    val code: String,
    val date: String,
    val rate: String,
    val source: String,
)

@Serializable
data class SyncTransaction(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val version: Int,
    val accountId: String,
    val categoryId: String?,
    val kind: String,
    val isSplit: Boolean,
    val date: String,
    val time: String?,
    val amount: Money,
    val payee: String?,
    val note: String?,
    val transferId: String?,
    val relatedTransferId: String?,
    val feeTransferId: String?,
    val tipPaymentId: String?,
    val importBatchId: String?,
    val receivablePaymentId: String?,
    val receivableId: String?,
    val status: String,
    val fxRate: String,
    val baseAmount: Money,
)

@Serializable
data class SyncSplit(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val version: Int,
    val transactionId: String,
    val categoryId: String,
    val kind: String,
    val amount: Money,
    val baseAmount: Money,
    val note: String?,
    val position: Long,
)

/** A tag on an entry has no version of its own: it is applied by `updatedAt`. */
@Serializable
data class SyncTransactionTag(
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val transactionId: String,
    val tagId: String,
)

/**
 * The push of `POST /ledgers/{id}/sync` (ADR 0042): changes made on the phone, at most 50 per request. Optional
 * fields are left out when null (they are never sent as null), because the contract does not allow null there.
 */
@Serializable
data class SyncPush(val mutations: List<SyncMutation>)

@Serializable
data class SyncMutation(
    /** A UUIDv7 made on the phone: the idempotency key, and for a create the new entry's id (a transfer's id). */
    val id: String,
    val type: String,
    val editedAt: String,
    val targetId: String? = null,
    val baseVersion: Int? = null,
    val body: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class SyncPushResponse(val results: List<SyncPushResult>)

@Serializable
data class SyncPushResult(
    val id: String,
    /** applied, replayed, superseded or rejected. */
    val status: String,
    /** The entry (or a transfer's legs, bonus and fee) as the server now has them. */
    val rows: List<SyncTransaction>,
    val problem: SyncPushProblem? = null,
)

@Serializable
data class SyncPushProblem(
    val status: Long,
    val title: String,
    val detail: String,
    val errors: List<FieldError>? = null,
)
