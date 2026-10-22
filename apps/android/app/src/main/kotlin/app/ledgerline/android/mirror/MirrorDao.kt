package app.ledgerline.android.mirror

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

data class IdVersion(val id: String, val version: Int)
data class IdStamp(val id: String, val updatedAt: String)

/**
 * Plain reads and writes of the mirror tables. Nothing here decides which rows win: [MirrorStore] does, inside one
 * transaction. The ids passed to the `...Versions` and `...Stamps` queries are at most [MirrorStore.IdChunk] at a time.
 */
@Dao
interface MirrorDao {
    @Query("SELECT id, version FROM accounts WHERE ledgerId = :ledgerId AND id IN (:ids)")
    suspend fun accountVersions(ledgerId: String, ids: List<String>): List<IdVersion>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putAccounts(rows: List<AccountRow>)

    @Query("SELECT * FROM accounts WHERE ledgerId = :ledgerId ORDER BY id")
    suspend fun allAccounts(ledgerId: String): List<AccountRow>

    @Query("DELETE FROM accounts WHERE ledgerId = :ledgerId")
    suspend fun clearAccounts(ledgerId: String)

    @Query("DELETE FROM accounts WHERE ledgerId != :ledgerId")
    suspend fun clearAccountsOfOtherLedgers(ledgerId: String)

    @Query("SELECT id, version FROM categories WHERE ledgerId = :ledgerId AND id IN (:ids)")
    suspend fun categoryVersions(ledgerId: String, ids: List<String>): List<IdVersion>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putCategories(rows: List<CategoryRow>)

    @Query("SELECT * FROM categories WHERE ledgerId = :ledgerId ORDER BY id")
    suspend fun allCategories(ledgerId: String): List<CategoryRow>

    @Query("DELETE FROM categories WHERE ledgerId = :ledgerId")
    suspend fun clearCategories(ledgerId: String)

    @Query("DELETE FROM categories WHERE ledgerId != :ledgerId")
    suspend fun clearCategoriesOfOtherLedgers(ledgerId: String)

    @Query("SELECT id, version FROM tags WHERE ledgerId = :ledgerId AND id IN (:ids)")
    suspend fun tagVersions(ledgerId: String, ids: List<String>): List<IdVersion>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putTags(rows: List<TagRow>)

    @Query("SELECT * FROM tags WHERE ledgerId = :ledgerId ORDER BY id")
    suspend fun allTags(ledgerId: String): List<TagRow>

    @Query("DELETE FROM tags WHERE ledgerId = :ledgerId")
    suspend fun clearTags(ledgerId: String)

    @Query("DELETE FROM tags WHERE ledgerId != :ledgerId")
    suspend fun clearTagsOfOtherLedgers(ledgerId: String)

    @Query("SELECT id, version FROM currencies WHERE ledgerId = :ledgerId AND id IN (:ids)")
    suspend fun currencyVersions(ledgerId: String, ids: List<String>): List<IdVersion>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putCurrencies(rows: List<CurrencyRow>)

    @Query("SELECT * FROM currencies WHERE ledgerId = :ledgerId ORDER BY id")
    suspend fun allCurrencies(ledgerId: String): List<CurrencyRow>

    @Query("DELETE FROM currencies WHERE ledgerId = :ledgerId")
    suspend fun clearCurrencies(ledgerId: String)

    @Query("DELETE FROM currencies WHERE ledgerId != :ledgerId")
    suspend fun clearCurrenciesOfOtherLedgers(ledgerId: String)

    @Query("SELECT id, version FROM exchange_rates WHERE ledgerId = :ledgerId AND id IN (:ids)")
    suspend fun rateVersions(ledgerId: String, ids: List<String>): List<IdVersion>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putRates(rows: List<RateRow>)

    @Query("SELECT * FROM exchange_rates WHERE ledgerId = :ledgerId ORDER BY id")
    suspend fun allRates(ledgerId: String): List<RateRow>

    @Query("DELETE FROM exchange_rates WHERE ledgerId = :ledgerId")
    suspend fun clearRates(ledgerId: String)

    @Query("DELETE FROM exchange_rates WHERE ledgerId != :ledgerId")
    suspend fun clearRatesOfOtherLedgers(ledgerId: String)

    @Query("SELECT id, version FROM transactions WHERE ledgerId = :ledgerId AND id IN (:ids)")
    suspend fun transactionVersions(ledgerId: String, ids: List<String>): List<IdVersion>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putTransactions(rows: List<TransactionRow>)

    @Query("SELECT * FROM transactions WHERE ledgerId = :ledgerId ORDER BY id")
    suspend fun allTransactions(ledgerId: String): List<TransactionRow>

    @Query("DELETE FROM transactions WHERE ledgerId = :ledgerId")
    suspend fun clearTransactions(ledgerId: String)

    @Query("DELETE FROM transactions WHERE ledgerId != :ledgerId")
    suspend fun clearTransactionsOfOtherLedgers(ledgerId: String)

    @Query("SELECT id, version FROM transaction_splits WHERE ledgerId = :ledgerId AND id IN (:ids)")
    suspend fun splitVersions(ledgerId: String, ids: List<String>): List<IdVersion>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putSplits(rows: List<SplitRow>)

    @Query("SELECT * FROM transaction_splits WHERE ledgerId = :ledgerId ORDER BY id")
    suspend fun allSplits(ledgerId: String): List<SplitRow>

    @Query("DELETE FROM transaction_splits WHERE ledgerId = :ledgerId")
    suspend fun clearSplits(ledgerId: String)

    @Query("DELETE FROM transaction_splits WHERE ledgerId != :ledgerId")
    suspend fun clearSplitsOfOtherLedgers(ledgerId: String)

    @Query("SELECT id, updatedAt FROM transaction_tags WHERE ledgerId = :ledgerId AND id IN (:ids)")
    suspend fun transactionTagStamps(ledgerId: String, ids: List<String>): List<IdStamp>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putTransactionTags(rows: List<TransactionTagRow>)

    @Query("SELECT * FROM transaction_tags WHERE ledgerId = :ledgerId ORDER BY id")
    suspend fun allTransactionTags(ledgerId: String): List<TransactionTagRow>

    @Query("DELETE FROM transaction_tags WHERE ledgerId = :ledgerId")
    suspend fun clearTransactionTags(ledgerId: String)

    @Query("DELETE FROM transaction_tags WHERE ledgerId != :ledgerId")
    suspend fun clearTransactionTagsOfOtherLedgers(ledgerId: String)

    @Query("SELECT * FROM sync_cursors WHERE ledgerId = :ledgerId")
    suspend fun cursor(ledgerId: String): SyncCursorRow?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putCursor(row: SyncCursorRow)

    @Query("DELETE FROM sync_cursors WHERE ledgerId != :ledgerId")
    suspend fun clearCursorsOfOtherLedgers(ledgerId: String)
}
