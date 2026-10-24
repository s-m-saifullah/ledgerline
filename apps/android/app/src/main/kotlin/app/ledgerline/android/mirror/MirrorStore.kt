package app.ledgerline.android.mirror

import androidx.room.withTransaction
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Writes pulled pages into the mirror (ADR 0042, 0043). The rules that keep rows from being lost or brought back:
 *
 * - A page and the cursor that follows it are committed in one transaction, so a crash re-reads a page and never
 *   skips one.
 * - An incoming row replaces the stored one only when its `version` is newer (a tag link: its `updatedAt`), so a
 *   repeat or an older copy never undoes a newer row or a tombstone.
 * - A full refresh is the server's whole truth: it replaces the ledger's rows in one transaction, whatever their
 *   versions (a restored server can have lower ones), and a refresh that fails leaves the old mirror untouched.
 */
@Singleton
class MirrorStore @Inject constructor(private val database: MirrorDatabase) {
    private val dao = database.dao()

    /** Test hook: runs inside the page transaction after the rows are written and before the cursor is. */
    @Volatile
    internal var beforeCursorWrite: (() -> Unit)? = null

    suspend fun cursor(ledgerId: String): SyncCursorRow? = dao.cursor(ledgerId)

    /** Applies one incremental page and moves the cursor, or does neither. */
    suspend fun applyPage(ledgerId: String, rows: MirrorRows, cursor: String, serverTime: String) {
        database.withTransaction {
            dao.putAccounts(newer(rows.accounts, { it.id }, { it.version }) { dao.accountVersions(ledgerId, it) })
            dao.putCategories(newer(rows.categories, { it.id }, { it.version }) { dao.categoryVersions(ledgerId, it) })
            dao.putTags(newer(rows.tags, { it.id }, { it.version }) { dao.tagVersions(ledgerId, it) })
            dao.putCurrencies(newer(rows.currencies, { it.id }, { it.version }) { dao.currencyVersions(ledgerId, it) })
            dao.putRates(newer(rows.rates, { it.id }, { it.version }) { dao.rateVersions(ledgerId, it) })
            dao.putTransactions(newer(rows.transactions, { it.id }, { it.version }) { dao.transactionVersions(ledgerId, it) })
            dao.putSplits(newer(rows.splits, { it.id }, { it.version }) { dao.splitVersions(ledgerId, it) })
            dao.putTransactionTags(newerTags(ledgerId, rows.transactionTags))
            beforeCursorWrite?.invoke()
            dao.putCursor(SyncCursorRow(ledgerId, cursor, serverTime))
        }
    }

    /**
     * Puts one category the API just returned from a write into the mirror, under the same rule as a pulled row: only when
     * its `version` is newer than the stored one, so a pull that already brought it (or a newer edit) is never undone.
     */
    suspend fun putCategory(row: CategoryRow) {
        database.withTransaction {
            dao.putCategories(newer(listOf(row), { it.id }, { it.version }) { dao.categoryVersions(row.ledgerId, it) })
        }
    }

    /** Replaces everything held for [ledgerId] (and drops any other ledger's rows) with a full pull, or changes nothing. */
    suspend fun replaceAll(ledgerId: String, rows: MirrorRows, cursor: String, serverTime: String) {
        database.withTransaction {
            dao.clearAccountsOfOtherLedgers(ledgerId)
            dao.clearCategoriesOfOtherLedgers(ledgerId)
            dao.clearTagsOfOtherLedgers(ledgerId)
            dao.clearCurrenciesOfOtherLedgers(ledgerId)
            dao.clearRatesOfOtherLedgers(ledgerId)
            dao.clearTransactionsOfOtherLedgers(ledgerId)
            dao.clearSplitsOfOtherLedgers(ledgerId)
            dao.clearTransactionTagsOfOtherLedgers(ledgerId)
            dao.clearCursorsOfOtherLedgers(ledgerId)
            dao.clearAccounts(ledgerId)
            dao.clearCategories(ledgerId)
            dao.clearTags(ledgerId)
            dao.clearCurrencies(ledgerId)
            dao.clearRates(ledgerId)
            dao.clearTransactions(ledgerId)
            dao.clearSplits(ledgerId)
            dao.clearTransactionTags(ledgerId)
            dao.putAccounts(rows.accounts)
            dao.putCategories(rows.categories)
            dao.putTags(rows.tags)
            dao.putCurrencies(rows.currencies)
            dao.putRates(rows.rates)
            dao.putTransactions(rows.transactions)
            dao.putSplits(rows.splits)
            dao.putTransactionTags(rows.transactionTags)
            beforeCursorWrite?.invoke()
            dao.putCursor(SyncCursorRow(ledgerId, cursor, serverTime))
        }
    }

    /** Deletes every mirrored row and cursor (sign out). The outbox is not touched: unsent changes are only ever
     * deleted when the owner says so. */
    suspend fun wipe() {
        database.withTransaction {
            dao.wipeAccounts()
            dao.wipeCategories()
            dao.wipeTags()
            dao.wipeCurrencies()
            dao.wipeExchangeRates()
            dao.wipeTransactions()
            dao.wipeTransactionSplits()
            dao.wipeTransactionTags()
            dao.wipeSyncCursors()
        }
    }

    /** Entries the push returned, applied by version like a page but without moving the cursor. Call inside a transaction. */
    internal suspend fun applyTransactionRows(ledgerId: String, rows: List<TransactionRow>) {
        dao.putTransactions(newer(rows, { it.id }, { it.version }) { dao.transactionVersions(ledgerId, it) })
    }

    private suspend fun <T> newer(
        rows: List<T>,
        id: (T) -> String,
        version: (T) -> Int,
        stored: suspend (List<String>) -> List<IdVersion>,
    ): List<T> {
        if (rows.isEmpty()) return rows
        val latest = rows.groupBy(id).values.map { copies -> copies.maxBy(version) }
        val have = latest.map(id).chunked(IdChunk).flatMap { stored(it) }.associate { it.id to it.version }
        return latest.filter { row -> have[id(row)]?.let { version(row) > it } ?: true }
    }

    private suspend fun newerTags(ledgerId: String, rows: List<TransactionTagRow>): List<TransactionTagRow> {
        if (rows.isEmpty()) return rows
        val latest = rows.groupBy { it.id }.values.map { copies -> copies.maxBy { Instant.parse(it.updatedAt) } }
        val have = latest.map { it.id }.chunked(IdChunk)
            .flatMap { dao.transactionTagStamps(ledgerId, it) }
            .associate { it.id to Instant.parse(it.updatedAt) }
        return latest.filter { row -> have[row.id]?.let { Instant.parse(row.updatedAt).isAfter(it) } ?: true }
    }

    companion object {
        /** SQLite allows 999 variables per statement on the oldest supported phones; stay well under it. */
        const val IdChunk = 500
    }
}
