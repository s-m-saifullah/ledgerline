package app.ledgerline.android.mirror

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.ledgerline.api.SyncCategory
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** What the screens read: balances computed on the phone and entries with names joined from the mirror. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MirrorReadsTest {
    private lateinit var database: MirrorDatabase
    private lateinit var store: MirrorStore
    private val ledger = "ledger-a"

    @Before
    fun open() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, MirrorDatabase::class.java).allowMainThreadQueries().build()
        store = MirrorStore(database)
    }

    @After
    fun close() = database.close()

    private val reads get() = database.reads()

    private fun category(n: Int, name: String, deletedAt: String? = null) =
        SyncCategory(id(n), Stamp, Stamp, deletedAt, 1, null, name, "expense", null, null, 0, null)

    private suspend fun load(vararg changes: app.ledgerline.api.SyncChanges) =
        store.replaceAll(ledger, MirrorRows.merge(changes.map { it.toRows(ledger) }), "c", Stamp)

    @Test
    fun aBalanceIsTheOpeningBalancePlusClearedLiveEntriesOfThatAccountOnly() = runBlocking {
        load(
            changes(
                accounts = listOf(account(1, name = "Checking", openingAmount = 10_000), account(2, name = "Cash", openingAmount = 500)),
                transactions = listOf(
                    entry(10, accountN = 1, amount = -2_550),
                    entry(11, accountN = 1, amount = 120_000, kind = "income"),
                    entry(12, accountN = 1, amount = -9_999, deletedAt = "2026-10-22T11:00:00.000Z"),
                    entry(13, accountN = 1, amount = -700).copy(status = "pending"),
                    entry(14, accountN = 2, amount = -100),
                ),
            ),
        )
        val byName = reads.accountBalancesNow(ledger, includeHidden = false).associateBy { it.name }
        assertEquals(10_000L - 2_550 + 120_000, byName.getValue("Checking").balance)
        assertEquals(1, byName.getValue("Checking").pending)
        assertEquals(400L, byName.getValue("Cash").balance)
        assertEquals(0, byName.getValue("Cash").pending)
    }

    @Test
    fun anAccountWithNoEntriesShowsItsOpeningBalanceAndLargeSumsStayExact() = runBlocking {
        val big = 4_000_000_000_000_000L
        load(
            changes(
                accounts = listOf(account(1, openingAmount = -250), account(2, openingAmount = big)),
                transactions = listOf(entry(10, accountN = 2, amount = big)),
            ),
        )
        val rows = reads.accountBalancesNow(ledger, includeHidden = false).associateBy { it.id }
        assertEquals(-250L, rows.getValue(id(1)).balance)
        assertEquals(2 * big, rows.getValue(id(2)).balance)
    }

    @Test
    fun deletedAndClientBalanceAccountsAreLeftOutArchivedOnesComeLast() = runBlocking {
        load(
            changes(
                accounts = listOf(
                    account(1, name = "Zeta"),
                    account(2, name = "alpha"),
                    account(3, name = "Gone", deletedAt = "2026-10-22T11:00:00.000Z"),
                    account(4, name = "Client").copy(contactId = id(90)),
                    account(5, name = "Old").copy(archivedAt = "2026-10-01T00:00:00.000Z"),
                ),
            ),
        )
        assertEquals(listOf("alpha", "Zeta", "Old"), reads.accountBalancesNow(ledger, includeHidden = false).map { it.name })
        assertEquals(
            listOf("alpha", "Client", "Zeta", "Old"),
            reads.accountBalancesNow(ledger, includeHidden = true).map { it.name },
        )
    }

    @Test
    fun entriesCarryAccountCategoryAndLiveTagNamesNewestFirst() = runBlocking {
        load(
            changes(
                accounts = listOf(account(1, name = "Checking")),
                tags = listOf(tag(20, name = "work"), tag(21, name = "Bills"), tag(22, name = "gone", deletedAt = "2026-10-22T11:00:00.000Z")),
                transactions = listOf(
                    entry(10, payee = "Grocer").copy(categoryId = id(30), date = "2026-10-20", time = "09:00"),
                    entry(11, payee = null).copy(categoryId = id(30), date = "2026-10-21"),
                    entry(12, payee = "Old").copy(date = "2026-10-19"),
                    entry(13, payee = "Deleted", deletedAt = "2026-10-22T11:00:00.000Z").copy(date = "2026-10-22"),
                    entry(14, payee = "Late").copy(date = "2026-10-20", time = "18:30"),
                ),
                links = listOf(
                    tagLink(40, 10, 20),
                    tagLink(41, 10, 21),
                    tagLink(42, 10, 22),
                    tagLink(43, 12, 20, deletedAt = "2026-10-22T11:00:00.000Z"),
                ),
            ).copy(categories = listOf(category(30, "Food"))),
        )
        val lines = reads.entryLinesNow(ledger, limit = 10)
        assertEquals(listOf(id(11), id(14), id(10), id(12)), lines.map { it.id })
        val grocer = lines.single { it.id == id(10) }
        assertEquals("Checking", grocer.accountName)
        assertEquals("Food", grocer.categoryName)
        assertEquals("Bills, work", grocer.tagNames)
        assertNull(lines.single { it.id == id(12) }.tagNames)
        assertEquals(1_000L, grocer.amount)
    }

    @Test
    fun theListStopsAtItsLimit() = runBlocking {
        load(changes(accounts = listOf(account(1)), transactions = (1..5).map { entry(10 + it) }))
        assertEquals(3, reads.entryLinesNow(ledger, limit = 3).size)
    }

    @Test
    fun theMirroredLedgerAndItsLastUpdateComeFromTheCursor() = runBlocking {
        assertNull(reads.mirroredLedger().first())
        store.replaceAll(ledger, MirrorRows.Empty, "c", "2026-10-22T12:34:00.000Z")
        assertEquals(ledger, reads.mirroredLedger().first())
        assertEquals("2026-10-22T12:34:00.000Z", reads.cursorOf(ledger).first()?.serverTime)
        store.wipe()
        assertNull(reads.mirroredLedger().first())
    }

    private fun split(n: Int, entryN: Int, categoryN: Int, deletedAt: String? = null) =
        app.ledgerline.api.SyncSplit(id(n), Stamp, Stamp, deletedAt, 1, id(entryN), id(categoryN), "expense", app.ledgerline.api.Money(-100, "USD"), app.ledgerline.api.Money(-100, "USD"), null, 0)

    private fun outboxRow(n: Int, action: String, categoryN: Int?, ledgerId: String = ledger) = app.ledgerline.android.outbox.OutboxRow(
        id = "mutation-$n", ledgerId = ledgerId, seq = n.toLong(), kind = "transaction", action = action, entityId = id(100 + n), baseVersion = null,
        editedAt = Stamp, body = if (categoryN == null) """{"payee":"x"}""" else """{"categoryId":"${id(categoryN)}","payee":"x"}""",
        attempted = false, state = "pending", problemTitle = null, problemDetail = null, serverRows = null,
    )

    private suspend fun seed(
        transactions: List<app.ledgerline.api.SyncTransaction> = emptyList(),
        splits: List<app.ledgerline.api.SyncSplit> = emptyList(),
    ) = store.replaceAll(
        ledger,
        changes(accounts = listOf(account(1)), transactions = transactions, categories = listOf(syncCategory(20, "Food"), syncCategory(21, "Fun"))).copy(transactionSplits = splits).toRows(ledger),
        "c", Stamp,
    )

    @Test
    fun aLiveEntryInTheCategoryCountsAndOthersDoNot() = runBlocking {
        seed(
            transactions = listOf(
                entry(10).copy(categoryId = id(20)), entry(11).copy(categoryId = id(20)), entry(12).copy(categoryId = id(21)),
                entry(13).copy(categoryId = id(20), deletedAt = Stamp), entry(14),
            ),
        )
        assertEquals(2, reads.entriesUsingCategory(ledger, id(20)))
        assertEquals(1, reads.entriesUsingCategory(ledger, id(21)))
        assertEquals(0, reads.entriesUsingCategory(ledger, id(99)))
    }

    @Test
    fun aLiveSplitLineCountsLikeAnEntry() = runBlocking {
        seed(transactions = listOf(entry(10).copy(isSplit = true)), splits = listOf(split(50, 10, 20), split(51, 10, 21), split(52, 10, 20, deletedAt = Stamp)))
        assertEquals(1, reads.entriesUsingCategory(ledger, id(20)))
        assertEquals(1, reads.entriesUsingCategory(ledger, id(21)))
    }

    @Test
    fun aChangeNotSentYetThatNamesTheCategoryCountsButADeleteDoesNot() = runBlocking {
        seed()
        database.outbox().insert(outboxRow(1, "create", 20))
        database.outbox().insert(outboxRow(2, "update", 20))
        database.outbox().insert(outboxRow(3, "delete", 20))
        database.outbox().insert(outboxRow(4, "create", 21))
        database.outbox().insert(outboxRow(5, "update", null))
        assertEquals(2, reads.entriesUsingCategory(ledger, id(20)))
        assertEquals(1, reads.entriesUsingCategory(ledger, id(21)))
    }

    @Test
    fun anotherLedgersRowsAreNeverCounted() = runBlocking {
        seed(transactions = listOf(entry(10).copy(categoryId = id(20))))
        database.outbox().insert(outboxRow(1, "create", 20, ledgerId = "ledger-b"))
        assertEquals(1, reads.entriesUsingCategory(ledger, id(20)))
        assertEquals(0, reads.entriesUsingCategory("ledger-b", id(99)))
    }
}
