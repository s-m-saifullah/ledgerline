package app.ledgerline.android.mirror

import androidx.room.Entity
import androidx.room.Index

/*
 * The mirror: the rows of the pull as the server stores them (ADR 0042, 0043). Every row carries the ledger it
 * belongs to and the `deletedAt` the server sent, so a tombstone stays a tombstone; screens read only live rows.
 * Money is `Long` minor units plus a currency code, never floating point. Dates and times stay the server's text.
 */

@Entity(tableName = "accounts", primaryKeys = ["ledgerId", "id"], indices = [Index("ledgerId", "deletedAt")])
data class AccountRow(
    val ledgerId: String,
    val id: String,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val name: String,
    val type: String,
    val currency: String,
    val openingAmount: Long,
    val openingCurrency: String,
    val inboundBonusBps: Long?,
    val bonusCategoryId: String?,
    val feeCategoryId: String?,
    val defaultFeeAmount: Long?,
    val defaultFeeCurrency: String?,
    val defaultFeeBps: Long?,
    val contactId: String?,
    val archivedAt: String?,
)

@Entity(tableName = "categories", primaryKeys = ["ledgerId", "id"], indices = [Index("ledgerId", "deletedAt")])
data class CategoryRow(
    val ledgerId: String,
    val id: String,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val parentId: String?,
    val name: String,
    val kind: String,
    val icon: String?,
    val color: String?,
    val sortOrder: Long,
    val archivedAt: String?,
)

@Entity(tableName = "tags", primaryKeys = ["ledgerId", "id"], indices = [Index("ledgerId", "deletedAt")])
data class TagRow(
    val ledgerId: String,
    val id: String,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val name: String,
    val archivedAt: String?,
)

@Entity(tableName = "currencies", primaryKeys = ["ledgerId", "id"])
data class CurrencyRow(
    val ledgerId: String,
    val id: String,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val code: String,
)

@Entity(tableName = "exchange_rates", primaryKeys = ["ledgerId", "id"])
data class RateRow(
    val ledgerId: String,
    val id: String,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val code: String,
    val date: String,
    val rate: String,
    val source: String,
)

@Entity(
    tableName = "transactions",
    primaryKeys = ["ledgerId", "id"],
    indices = [Index("ledgerId", "accountId", "deletedAt"), Index("ledgerId", "deletedAt", "date")],
)
data class TransactionRow(
    val ledgerId: String,
    val id: String,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val accountId: String,
    val categoryId: String?,
    val kind: String,
    val isSplit: Boolean,
    val date: String,
    val time: String?,
    val amount: Long,
    val currency: String,
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
    val baseAmount: Long,
    val baseCurrency: String,
)

@Entity(tableName = "transaction_splits", primaryKeys = ["ledgerId", "id"], indices = [Index("ledgerId", "transactionId")])
data class SplitRow(
    val ledgerId: String,
    val id: String,
    val version: Int,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val transactionId: String,
    val categoryId: String,
    val kind: String,
    val amount: Long,
    val currency: String,
    val baseAmount: Long,
    val baseCurrency: String,
    val note: String?,
    val position: Long,
)

/** A tag on an entry has no version: it is applied when its `updatedAt` is newer. */
@Entity(tableName = "transaction_tags", primaryKeys = ["ledgerId", "id"], indices = [Index("ledgerId", "transactionId")])
data class TransactionTagRow(
    val ledgerId: String,
    val id: String,
    val createdAt: String,
    val updatedAt: String,
    val deletedAt: String?,
    val transactionId: String,
    val tagId: String,
)

/** Where the next pull starts for a ledger, and when the mirror was last brought up to date. */
@Entity(tableName = "sync_cursors", primaryKeys = ["ledgerId"])
data class SyncCursorRow(
    val ledgerId: String,
    val cursor: String,
    /** The server's clock at the last page applied: the "last updated" line. */
    val serverTime: String,
)
