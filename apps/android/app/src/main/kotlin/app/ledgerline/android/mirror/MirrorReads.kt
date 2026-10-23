package app.ledgerline.android.mirror

import androidx.room.Dao
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/** An account with its balance computed on the phone: the opening balance plus its cleared, live entries. */
data class AccountBalance(
    val id: String,
    val name: String,
    val type: String,
    val currency: String,
    val archivedAt: String?,
    val contactId: String?,
    /** Minor units, never stored: computed the way the server computes it. */
    val balance: Long,
    /** Live entries still pending, which the balance leaves out. */
    val pending: Int,
)

/** An entry for the list, with names joined from the mirror. */
data class EntryLine(
    val id: String,
    val date: String,
    val time: String?,
    val kind: String,
    val isSplit: Boolean,
    val status: String,
    val amount: Long,
    val currency: String,
    val payee: String?,
    val accountName: String?,
    val categoryName: String?,
    /** Live tags on the entry, by name, separated by ", ". */
    val tagNames: String?,
    val transferId: String?,
    val createdAt: String,
)

data class TagLink(val transactionId: String, val tagId: String)

private const val AccountBalancesSql = """
    SELECT a.id, a.name, a.type, a.currency, a.archivedAt, a.contactId,
        a.openingAmount + COALESCE((
            SELECT SUM(t.amount) FROM transactions t
            WHERE t.ledgerId = a.ledgerId AND t.accountId = a.id AND t.deletedAt IS NULL AND t.status = 'cleared'
        ), 0) AS balance,
        (
            SELECT COUNT(*) FROM transactions t
            WHERE t.ledgerId = a.ledgerId AND t.accountId = a.id AND t.deletedAt IS NULL AND t.status = 'pending'
        ) AS pending
    FROM accounts a
    WHERE a.ledgerId = :ledgerId AND a.deletedAt IS NULL AND (:includeHidden OR a.contactId IS NULL)
    ORDER BY a.archivedAt IS NOT NULL, a.name COLLATE NOCASE, a.id
"""

private const val SelectEntryLines = """
    SELECT t.id, t.date, t.time, t.kind, t.isSplit, t.status, t.amount, t.currency, t.payee,
        a.name AS accountName, c.name AS categoryName,
        (
            SELECT group_concat(name, ', ') FROM (
                SELECT g.name AS name FROM transaction_tags l
                JOIN tags g ON g.ledgerId = l.ledgerId AND g.id = l.tagId AND g.deletedAt IS NULL
                WHERE l.ledgerId = t.ledgerId AND l.transactionId = t.id AND l.deletedAt IS NULL
                ORDER BY g.name COLLATE NOCASE
            )
        ) AS tagNames,
        t.transferId, t.createdAt
    FROM transactions t
    LEFT JOIN accounts a ON a.ledgerId = t.ledgerId AND a.id = t.accountId
    LEFT JOIN categories c ON c.ledgerId = t.ledgerId AND c.id = t.categoryId
    WHERE t.ledgerId = :ledgerId AND t.deletedAt IS NULL
"""

private const val NewestFirstLimited = """
    ORDER BY t.date DESC, t.time IS NULL, t.time DESC, t.createdAt DESC, t.id DESC
    LIMIT :limit
"""

private const val EntryLinesSql = SelectEntryLines + NewestFirstLimited

/**
 * The same list narrowed by the Transactions filters, with the meanings of the server's list: an account, a category
 * (the entry or one of its split lines is in it, or in a subcategory when asked), a tag, an inclusive date range, a
 * kind, a status, and a literal part of the payee or note. A null parameter means "any".
 */
private const val FilteredEntryLinesSql = SelectEntryLines + """
    AND (:accountId IS NULL OR t.accountId = :accountId)
    AND (:categoryId IS NULL
        OR t.categoryId IN (SELECT f.id FROM categories f WHERE f.ledgerId = t.ledgerId AND (f.id = :categoryId OR (:subcategories AND f.parentId = :categoryId)))
        OR EXISTS (
            SELECT 1 FROM transaction_splits s
            WHERE s.ledgerId = t.ledgerId AND s.transactionId = t.id AND s.deletedAt IS NULL
                AND s.categoryId IN (SELECT f.id FROM categories f WHERE f.ledgerId = t.ledgerId AND (f.id = :categoryId OR (:subcategories AND f.parentId = :categoryId)))
        ))
    AND (:tagId IS NULL OR EXISTS (
        SELECT 1 FROM transaction_tags l
        WHERE l.ledgerId = t.ledgerId AND l.transactionId = t.id AND l.tagId = :tagId AND l.deletedAt IS NULL
    ))
    AND (:from IS NULL OR t.date >= :from)
    AND (:to IS NULL OR t.date <= :to)
    AND (:kind IS NULL OR t.kind = :kind)
    AND (:status IS NULL OR t.status = :status)
    AND (:text IS NULL OR instr(lower(coalesce(t.payee, '')), lower(:text)) > 0 OR instr(lower(coalesce(t.note, '')), lower(:text)) > 0)
""" + NewestFirstLimited

/** What the screens read. Only live rows (no `deletedAt`) are ever shown. */
@Dao
interface MirrorReads {
    /** The ledger the mirror holds: after a full refresh there is exactly one cursor row. */
    @Query("SELECT ledgerId FROM sync_cursors ORDER BY ledgerId LIMIT 1")
    fun mirroredLedger(): Flow<String?>

    @Query("SELECT * FROM sync_cursors WHERE ledgerId = :ledgerId")
    fun cursorOf(ledgerId: String): Flow<SyncCursorRow?>

    /** [includeHidden] adds the balance accounts kept for clients and loans, which the screens leave out. */
    @Query(AccountBalancesSql)
    fun accountBalances(ledgerId: String, includeHidden: Boolean): Flow<List<AccountBalance>>

    @Query(AccountBalancesSql)
    suspend fun accountBalancesNow(ledgerId: String, includeHidden: Boolean): List<AccountBalance>

    @Query("SELECT * FROM categories WHERE ledgerId = :ledgerId AND deletedAt IS NULL")
    fun liveCategories(ledgerId: String): Flow<List<CategoryRow>>

    @Query("SELECT * FROM tags WHERE ledgerId = :ledgerId AND deletedAt IS NULL")
    fun liveTags(ledgerId: String): Flow<List<TagRow>>

    @Query(EntryLinesSql)
    fun entryLines(ledgerId: String, limit: Int): Flow<List<EntryLine>>

    @Query(EntryLinesSql)
    suspend fun entryLinesNow(ledgerId: String, limit: Int): List<EntryLine>

    @Query(FilteredEntryLinesSql)
    fun filteredEntryLines(
        ledgerId: String,
        limit: Int,
        accountId: String?,
        categoryId: String?,
        subcategories: Boolean,
        tagId: String?,
        from: String?,
        to: String?,
        kind: String?,
        status: String?,
        text: String?,
    ): Flow<List<EntryLine>>

    @Query(FilteredEntryLinesSql)
    suspend fun filteredEntryLinesNow(
        ledgerId: String,
        limit: Int,
        accountId: String?,
        categoryId: String?,
        subcategories: Boolean,
        tagId: String?,
        from: String?,
        to: String?,
        kind: String?,
        status: String?,
        text: String?,
    ): List<EntryLine>

    @Query("SELECT * FROM transactions WHERE ledgerId = :ledgerId AND deletedAt IS NULL AND id IN (:ids)")
    suspend fun liveByIds(ledgerId: String, ids: List<String>): List<TransactionRow>

    @Query("SELECT * FROM transactions WHERE ledgerId = :ledgerId AND deletedAt IS NULL AND transferId IN (:transferIds)")
    suspend fun liveByTransfer(ledgerId: String, transferIds: List<String>): List<TransactionRow>

    /** Live bonus and fee entries of a transfer: such a transfer is edited on the web. */
    @Query("SELECT COUNT(*) FROM transactions WHERE ledgerId = :ledgerId AND deletedAt IS NULL AND (relatedTransferId = :transferId OR feeTransferId = :transferId)")
    suspend fun transferExtras(ledgerId: String, transferId: String): Int

    /** Live tag links to live tags. */
    @Query(
        """SELECT l.transactionId, l.tagId FROM transaction_tags l
        JOIN tags g ON g.ledgerId = l.ledgerId AND g.id = l.tagId AND g.deletedAt IS NULL
        WHERE l.ledgerId = :ledgerId AND l.deletedAt IS NULL AND l.transactionId IN (:ids)""",
    )
    suspend fun liveTagLinks(ledgerId: String, ids: List<String>): List<TagLink>
}

/** The list narrowed by [filters] (a flow that re-emits when the mirror changes). */
fun MirrorReads.entryLines(ledgerId: String, limit: Int, filters: EntryFilters): Flow<List<EntryLine>> =
    with(filters) { filteredEntryLines(ledgerId, limit, accountId, categoryId, includeSubcategories, tagId, from, to, kind, status, searchText) }

suspend fun MirrorReads.entryLinesNow(ledgerId: String, limit: Int, filters: EntryFilters): List<EntryLine> =
    with(filters) { filteredEntryLinesNow(ledgerId, limit, accountId, categoryId, includeSubcategories, tagId, from, to, kind, status, searchText) }
