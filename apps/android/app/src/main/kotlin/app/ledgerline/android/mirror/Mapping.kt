package app.ledgerline.android.mirror

import app.ledgerline.api.SyncAccount
import app.ledgerline.api.Category
import app.ledgerline.api.SyncCategory
import app.ledgerline.api.SyncChanges
import app.ledgerline.api.SyncCurrency
import app.ledgerline.api.SyncRate
import app.ledgerline.api.SyncSplit
import app.ledgerline.api.SyncTag
import app.ledgerline.api.SyncTransaction
import app.ledgerline.api.SyncTransactionTag

fun SyncAccount.toRow(ledgerId: String) = AccountRow(
    ledgerId, id, version, createdAt, updatedAt, deletedAt, name, type, currency,
    openingBalance.amount, openingBalance.currency, inboundBonusBps, bonusCategoryId, feeCategoryId,
    defaultFeeAmount?.amount, defaultFeeAmount?.currency, defaultFeeBps, contactId, archivedAt,
)

fun SyncCategory.toRow(ledgerId: String) = CategoryRow(
    ledgerId, id, version, createdAt, updatedAt, deletedAt, parentId, name, kind, icon, color, sortOrder, archivedAt,
)

/** A category the API returned from a write, as the mirror stores it (live: a write never returns a tombstone). */
fun Category.toRow() = CategoryRow(ledgerId, id, version, createdAt, updatedAt, null, parentId, name, kind, icon, color, sortOrder, archivedAt)

fun SyncTag.toRow(ledgerId: String) = TagRow(ledgerId, id, version, createdAt, updatedAt, deletedAt, name, archivedAt)

fun SyncCurrency.toRow(ledgerId: String) = CurrencyRow(ledgerId, id, version, createdAt, updatedAt, deletedAt, code)

fun SyncRate.toRow(ledgerId: String) = RateRow(ledgerId, id, version, createdAt, updatedAt, deletedAt, code, date, rate, source)

fun SyncTransaction.toRow(ledgerId: String) = TransactionRow(
    ledgerId, id, version, createdAt, updatedAt, deletedAt, accountId, categoryId, kind, isSplit, date, time,
    amount.amount, amount.currency, payee, note, transferId, relatedTransferId, feeTransferId, tipPaymentId,
    importBatchId, receivablePaymentId, receivableId, status, fxRate, baseAmount.amount, baseAmount.currency,
)

fun SyncSplit.toRow(ledgerId: String) = SplitRow(
    ledgerId, id, version, createdAt, updatedAt, deletedAt, transactionId, categoryId, kind,
    amount.amount, amount.currency, baseAmount.amount, baseAmount.currency, note, position,
)

fun SyncTransactionTag.toRow(ledgerId: String) =
    TransactionTagRow(ledgerId, id, createdAt, updatedAt, deletedAt, transactionId, tagId)

/** The page as mirror rows for one ledger. */
data class MirrorRows(
    val accounts: List<AccountRow>,
    val categories: List<CategoryRow>,
    val tags: List<TagRow>,
    val currencies: List<CurrencyRow>,
    val rates: List<RateRow>,
    val transactions: List<TransactionRow>,
    val splits: List<SplitRow>,
    val transactionTags: List<TransactionTagRow>,
) {
    companion object {
        val Empty = MirrorRows(emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList())

        /** The rows of several pages in one set, in page order. */
        fun merge(pages: List<MirrorRows>) = MirrorRows(
            pages.flatMap { it.accounts }, pages.flatMap { it.categories }, pages.flatMap { it.tags },
            pages.flatMap { it.currencies }, pages.flatMap { it.rates }, pages.flatMap { it.transactions },
            pages.flatMap { it.splits }, pages.flatMap { it.transactionTags },
        )
    }
}

fun SyncChanges.toRows(ledgerId: String) = MirrorRows(
    accounts.map { it.toRow(ledgerId) },
    categories.map { it.toRow(ledgerId) },
    tags.map { it.toRow(ledgerId) },
    currencies.map { it.toRow(ledgerId) },
    exchangeRates.map { it.toRow(ledgerId) },
    transactions.map { it.toRow(ledgerId) },
    transactionSplits.map { it.toRow(ledgerId) },
    transactionTags.map { it.toRow(ledgerId) },
)
