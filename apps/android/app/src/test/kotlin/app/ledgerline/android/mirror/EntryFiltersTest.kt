package app.ledgerline.android.mirror

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.ledgerline.android.overlay.LedgerView
import app.ledgerline.api.Money
import app.ledgerline.api.SyncCategory
import app.ledgerline.api.SyncSplit
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The Transactions filters with the web's meanings: the mirror's SQL and the search in code (read through [LedgerView]),
 * the same rules in code for the entries a pending change rebuilds, and the two checked against each other on the same data.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class EntryFiltersTest {
    private lateinit var database: MirrorDatabase
    private val ledger = "ledger-a"
    private val reads get() = database.reads()
    private val view get() = LedgerView(reads, database.dao(), database.outbox())

    private fun category(n: Int, name: String, parent: Int? = null, kind: String = "expense") =
        SyncCategory(id(n), Stamp, Stamp, null, 1, parent?.let { id(it) }, name, kind, null, null, 0, null)

    private fun split(n: Int, entryN: Int, categoryN: Int, deletedAt: String? = null) =
        SyncSplit(id(n), Stamp, Stamp, deletedAt, 1, id(entryN), id(categoryN), "expense", Money(-100, "USD"), Money(-100, "USD"), null, 0)

    // 10 Corner Cafe (Groceries, work, Oct 5), 11 Bakery (Food, pending, note "birthday cake", Oct 10), 12 Cinema (Fun,
    // trip, Cash, Oct 15), 13 Payroll (income, Oct 20), 14/15 a transfer (Oct 12), 16 Market (a split with a Groceries
    // line, Oct 18), 17 deleted, 18 "100% pure" (Oct 25), 19 Cafe at the end of September.
    @Before
    fun open() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, MirrorDatabase::class.java).allowMainThreadQueries().build()
        MirrorStore(database).replaceAll(
            ledger,
            changes(
                accounts = listOf(account(1, name = "Checking"), account(2, name = "Cash")),
                tags = listOf(tag(20, name = "work"), tag(21, name = "trip")),
                transactions = listOf(
                    entry(10, accountN = 1, payee = "Corner Cafe").copy(categoryId = id(31), date = "2026-10-05"),
                    entry(11, accountN = 1, payee = "Bakery").copy(categoryId = id(30), date = "2026-10-10", status = "pending", note = "birthday cake"),
                    entry(12, accountN = 2, payee = "Cinema").copy(categoryId = id(32), date = "2026-10-15"),
                    entry(13, accountN = 1, payee = "Payroll", kind = "income").copy(categoryId = id(33), date = "2026-10-20"),
                    entry(14, accountN = 1, payee = null, kind = "transfer", amount = -500).copy(date = "2026-10-12", transferId = "t1"),
                    entry(15, accountN = 2, payee = null, kind = "transfer", amount = 500).copy(date = "2026-10-12", transferId = "t1"),
                    entry(16, accountN = 2, payee = "Market").copy(isSplit = true, date = "2026-10-18"),
                    entry(17, accountN = 1, payee = "Gone", deletedAt = "2026-10-22T11:00:00.000Z").copy(categoryId = id(31), date = "2026-10-06"),
                    entry(18, accountN = 1, payee = "100% pure").copy(categoryId = id(32), date = "2026-10-25"),
                    entry(19, accountN = 1, payee = "cafe").copy(categoryId = id(32), date = "2026-09-30"),
                ),
                links = listOf(tagLink(40, 10, 20), tagLink(41, 12, 21), tagLink(42, 17, 20), tagLink(43, 13, 20, deletedAt = "2026-10-22T11:00:00.000Z")),
            ).copy(
                categories = listOf(category(30, "Food"), category(31, "Groceries", parent = 30), category(32, "Fun"), category(33, "Salary", kind = "income")),
                transactionSplits = listOf(split(50, 16, 31), split(51, 12, 31, deletedAt = "2026-10-22T11:00:00.000Z")),
            ).toRows(ledger),
            "c",
            Stamp,
        )
    }

    @After
    fun close() = database.close()

    private suspend fun ids(filters: EntryFilters, limit: Int = 100): List<Int> =
        view.entries(ledger, limit, filters).first().map { shown -> (1..19).first { id(it) == shown.line.id } }

    @Test
    fun noFilterListsEveryLiveEntryNewestFirst() = runBlocking {
        assertEquals(listOf(18, 13, 16, 12, 15, 14, 11, 10, 19), ids(EntryFilters()))
    }

    @Test
    fun anAccountKeepsItsOwnEntriesAndItsLegOfATransfer() = runBlocking {
        // Newest first: the Market split (Oct 18), the Cinema (Oct 15) and the Cash leg of the transfer (Oct 12).
        assertEquals(listOf(16, 12, 15), ids(EntryFilters(accountId = id(2))))
        assertEquals(listOf(18, 13, 14, 11, 10, 19), ids(EntryFilters(accountId = id(1))))
    }

    @Test
    fun aMainCategoryFindsItsSubcategoriesAndSplitLinesAndOnlyItselfWhenAskedTo() = runBlocking {
        // Food (30): the Bakery in Food itself, the Corner Cafe in Groceries, the Market split with a Groceries line.
        assertEquals(setOf(10, 11, 16), ids(EntryFilters(categoryId = id(30))).toSet())
        assertEquals(setOf(11), ids(EntryFilters(categoryId = id(30), includeSubcategories = false)).toSet())
        // A subcategory: its own entry and the split line, not its main category's.
        assertEquals(setOf(10, 16), ids(EntryFilters(categoryId = id(31))).toSet())
        // A deleted split line does not count.
        assertFalse(12 in ids(EntryFilters(categoryId = id(31))))
    }

    @Test
    fun aTagFindsEntriesWithALiveLinkOnly() = runBlocking {
        assertEquals(listOf(10), ids(EntryFilters(tagId = id(20))))
        assertEquals(listOf(12), ids(EntryFilters(tagId = id(21))))
    }

    @Test
    fun theDateRangeIsInclusiveOnBothEnds() = runBlocking {
        assertEquals(listOf(11), ids(EntryFilters(from = "2026-10-10", to = "2026-10-10")))
        assertEquals(setOf(10, 11, 12, 14, 15), ids(EntryFilters(from = "2026-10-05", to = "2026-10-15")).toSet())
        assertEquals(listOf(19), ids(EntryFilters(to = "2026-09-30")))
        assertEquals(listOf(18), ids(EntryFilters(from = "2026-10-25")))
    }

    @Test
    fun kindAndStatusNarrowTheList() = runBlocking {
        assertEquals(listOf(13), ids(EntryFilters(kind = "income")))
        assertEquals(setOf(15, 14), ids(EntryFilters(kind = "transfer")).toSet())
        assertEquals(listOf(11), ids(EntryFilters(status = "pending")))
        assertEquals(listOf(18, 13, 16, 12, 15, 14, 10, 19), ids(EntryFilters(status = "cleared")))
    }

    @Test
    fun theSearchIsALiteralPartOfThePayeeOrNoteIgnoringCase() = runBlocking {
        assertEquals(setOf(10, 19), ids(EntryFilters(text = "CAFE")).toSet())
        assertEquals(listOf(11), ids(EntryFilters(text = "Cake")))
        // % and _ are ordinary characters, not wildcards.
        assertEquals(listOf(18), ids(EntryFilters(text = "%")))
        assertEquals(emptyList<Int>(), ids(EntryFilters(text = "_")))
        // Spaces around the search are not part of it; a blank search is no search.
        assertEquals(listOf(11), ids(EntryFilters(text = "  bakery ")))
        assertEquals(9, ids(EntryFilters(text = "   ")).size)
    }

    @Test
    fun filtersCombineAndTheLimitAppliesAfterThem() = runBlocking {
        assertEquals(listOf(10), ids(EntryFilters(accountId = id(1), categoryId = id(30), status = "cleared")))
        val cafes = EntryFilters(text = "cafe")
        assertEquals(listOf(10), ids(cafes, limit = 1))
        assertEquals(listOf(10, 19), ids(cafes, limit = 5))
    }

    @Test
    fun theFlowFollowsTheMirror() = runBlocking {
        assertEquals(listOf(id(11)), reads.entryLines(ledger, 10, EntryFilters(status = "pending")).first().map { it.id })
    }

    @Test
    fun theCodeAndTheQueryAgreeOnEveryCombination() = runBlocking {
        val dao = database.dao()
        val rows = dao.allTransactions(ledger).filter { it.deletedAt == null && !it.isSplit }
        val links = dao.allTransactionTags(ledger).filter { it.deletedAt == null }.groupBy({ it.transactionId }, { it.tagId })
        val categories = dao.allCategories(ledger)
        val fields = rows.associate {
            it.id to ShownFilterFields(it.accountId, it.categoryId, links[it.id].orEmpty(), it.date, it.kind, it.status, it.payee, it.note)
        }
        val tries = listOf(
            EntryFilters(),
            EntryFilters(accountId = id(1)),
            EntryFilters(accountId = id(2)),
            EntryFilters(categoryId = id(30)),
            EntryFilters(categoryId = id(30), includeSubcategories = false),
            EntryFilters(categoryId = id(31)),
            EntryFilters(categoryId = id(32)),
            EntryFilters(tagId = id(20)),
            EntryFilters(tagId = id(21)),
            EntryFilters(from = "2026-10-06"),
            EntryFilters(to = "2026-10-12"),
            EntryFilters(from = "2026-10-10", to = "2026-10-20"),
            EntryFilters(kind = "expense"),
            EntryFilters(kind = "transfer"),
            EntryFilters(status = "pending"),
            EntryFilters(status = "cleared"),
            EntryFilters(text = "CAFE"),
            EntryFilters(text = "cake"),
            EntryFilters(text = "%"),
            EntryFilters(accountId = id(1), categoryId = id(30), status = "cleared", text = "corner"),
            EntryFilters(accountId = id(2), kind = "expense", from = "2026-10-01", to = "2026-10-31"),
        )
        for (filters in tries) {
            val family = filters.categoryId?.let { id ->
                categories.filter { it.id == id || (filters.includeSubcategories && it.parentId == id) }.map { it.id }.toSet() + id
            }
            val byQuery = view.entries(ledger, 100, filters).first().map { it.line.id }.filter { it in fields }.toSet()
            val byCode = fields.filter { (_, f) -> filters.matches(f, family) }.keys
            assertEquals("$filters", byCode, byQuery)
        }
    }

    @Test
    fun theFiltersDescribeThemselves() {
        assertFalse(EntryFilters().applied)
        assertEquals(0, EntryFilters(text = "   ").count)
        val set = EntryFilters(text = "x", accountId = "a", status = "pending", from = "2026-10-01")
        assertEquals(4, set.count)
        assertEquals(3, set.panelCount)
        assertEquals("x", EntryFilters(text = "  x ").searchText)
        assertEquals(null, EntryFilters(text = " ").searchText)
        assertTrue(EntryFilters(from = "2026-10-31", to = "2026-10-01").rangeInvalid)
        assertFalse(EntryFilters(from = "2026-10-01", to = "2026-10-01").rangeInvalid)
        assertFalse(EntryFilters(from = "2026-10-01").rangeInvalid)
    }
}
