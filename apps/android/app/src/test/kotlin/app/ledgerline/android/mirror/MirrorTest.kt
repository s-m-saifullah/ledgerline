package app.ledgerline.android.mirror

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

/** The mirror and the pull engine against the real Room database, on the JVM. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MirrorTest {
    private lateinit var database: MirrorDatabase
    private lateinit var store: MirrorStore
    private val ledger = "ledger-a"
    private val other = "ledger-b"

    @Before
    fun open() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, MirrorDatabase::class.java).allowMainThreadQueries().build()
        store = MirrorStore(database)
    }

    @After
    fun close() = database.close()

    private fun engine(vararg steps: (String?) -> app.ledgerline.api.SyncResponse) = ScriptedSource(*steps).let { it to SyncEngine(it, store, SyncLock()) }

    private val dao get() = database.dao()

    @Test
    fun theFirstPullIsAFullRefreshAndSavesTheCursor() = runBlocking {
        val (source, sync) = engine(reply(page(changes(accounts = listOf(account(1)), transactions = listOf(entry(10))), cursor = "c1", serverTime = "2026-10-22T11:00:00.000Z")))
        val result = sync.pull(ledger)
        assertEquals(PullResult.Updated(fullRefresh = true, serverTime = "2026-10-22T11:00:00.000Z"), result)
        assertEquals(listOf<String?>(null), source.asked)
        assertEquals(listOf(id(1)), dao.allAccounts(ledger).map { it.id })
        assertEquals(listOf(id(10)), dao.allTransactions(ledger).map { it.id })
        assertEquals("c1", dao.cursor(ledger)?.cursor)
        assertEquals("2026-10-22T11:00:00.000Z", dao.cursor(ledger)?.serverTime)
    }

    @Test
    fun aFullRefreshReadsEveryPageBeforeWritingAndSavesTheLastCursor() = runBlocking {
        val (source, sync) = engine(
            reply(page(changes(accounts = listOf(account(1))), cursor = "p1", hasMore = true)),
            reply(page(changes(accounts = listOf(account(2))), cursor = "p2", hasMore = false)),
        )
        sync.pull(ledger)
        assertEquals(listOf<String?>(null, "p1"), source.asked)
        assertEquals(listOf(id(1), id(2)), dao.allAccounts(ledger).map { it.id })
        assertEquals("p2", dao.cursor(ledger)?.cursor)
    }

    @Test
    fun anIncrementalPullStartsFromTheSavedCursorAndAdvancesPageByPage() = runBlocking {
        store.replaceAll(ledger, MirrorRows.Empty, "start", Stamp)
        val (source, sync) = engine(
            reply(page(changes(accounts = listOf(account(1))), cursor = "p1", hasMore = true)),
            reply(page(changes(accounts = listOf(account(2))), cursor = "p2", hasMore = false)),
        )
        val result = sync.pull(ledger)
        assertEquals(PullResult.Updated(fullRefresh = false, serverTime = Stamp), result)
        assertEquals(listOf<String?>("start", "p1"), source.asked)
        assertEquals(2, dao.allAccounts(ledger).size)
        assertEquals("p2", dao.cursor(ledger)?.cursor)
    }

    @Test
    fun aFailureOnTheSecondPageKeepsTheFirstPageAndItsCursorSoTheNextPullContinues() = runBlocking {
        store.replaceAll(ledger, MirrorRows.Empty, "start", Stamp)
        val (_, sync) = engine(
            reply(page(changes(accounts = listOf(account(1))), cursor = "p1", hasMore = true)),
            fail(IOException("offline")),
        )
        assertEquals(PullResult.Offline, sync.pull(ledger))
        assertEquals(listOf(id(1)), dao.allAccounts(ledger).map { it.id })
        assertEquals("p1", dao.cursor(ledger)?.cursor)
    }

    @Test
    fun aCrashBetweenAPageAndItsCursorStoresNeitherAndTheNextPullReadsThePageAgain() = runBlocking {
        store.replaceAll(ledger, MirrorRows.Empty, "start", Stamp)
        val pageOne = page(changes(accounts = listOf(account(1)), transactions = listOf(entry(10))), cursor = "p1")
        store.beforeCursorWrite = { throw IllegalStateException("process died") }
        val (_, crashing) = engine(reply(pageOne))
        assertEquals(PullResult.Failed, crashing.pull(ledger))
        assertEquals(emptyList<String>(), dao.allAccounts(ledger).map { it.id })
        assertEquals(emptyList<String>(), dao.allTransactions(ledger).map { it.id })
        assertEquals("start", dao.cursor(ledger)?.cursor)

        store.beforeCursorWrite = null
        val (source, retry) = engine(reply(pageOne))
        retry.pull(ledger)
        assertEquals(listOf<String?>("start"), source.asked)
        assertEquals(listOf(id(1)), dao.allAccounts(ledger).map { it.id })
        assertEquals("p1", dao.cursor(ledger)?.cursor)
    }

    @Test
    fun aTombstoneIsKeptAndALaterOlderCopyDoesNotBringTheRowBack() = runBlocking {
        store.replaceAll(ledger, MirrorRows.Empty, "start", Stamp)
        val (_, sync) = engine(
            reply(page(changes(transactions = listOf(entry(10, version = 1))), cursor = "p1")),
            reply(page(changes(transactions = listOf(entry(10, version = 2, deletedAt = "2026-10-22T12:00:00.000Z"))), cursor = "p2")),
            reply(page(changes(transactions = listOf(entry(10, version = 1))), cursor = "p3")),
        )
        sync.pull(ledger)
        sync.pull(ledger)
        sync.pull(ledger)
        val row = dao.allTransactions(ledger).single()
        assertEquals(2, row.version)
        assertNotNull(row.deletedAt)
    }

    @Test
    fun aRepeatOfTheSameVersionAndANewerVersionAreHandledByVersionNotByArrival() = runBlocking {
        store.replaceAll(ledger, MirrorRows.Empty, "start", Stamp)
        val (_, sync) = engine(
            reply(page(changes(accounts = listOf(account(1, version = 3, name = "Third"))), cursor = "p1")),
            reply(page(changes(accounts = listOf(account(1, version = 3, name = "Repeat"))), cursor = "p2")),
            reply(page(changes(accounts = listOf(account(1, version = 2, name = "Second"))), cursor = "p3")),
            reply(page(changes(accounts = listOf(account(1, version = 4, name = "Fourth"))), cursor = "p4")),
        )
        repeat(3) { sync.pull(ledger) }
        assertEquals("Third", dao.allAccounts(ledger).single().name)
        sync.pull(ledger)
        assertEquals("Fourth", dao.allAccounts(ledger).single().name)
    }

    @Test
    fun theSameRowTwiceInOnePageKeepsTheNewerVersionWhateverTheOrder() = runBlocking {
        store.replaceAll(ledger, MirrorRows.Empty, "start", Stamp)
        val (_, sync) = engine(reply(page(changes(accounts = listOf(account(1, version = 5, name = "New"), account(1, version = 4, name = "Old"))))))
        sync.pull(ledger)
        assertEquals("New", dao.allAccounts(ledger).single().name)
    }

    @Test
    fun aTagLinkIsAppliedByUpdatedAtAndFractionsOfASecondAreCompared() = runBlocking {
        store.replaceAll(ledger, MirrorRows.Empty, "start", Stamp)
        val (_, sync) = engine(
            reply(page(changes(links = listOf(tagLink(1, 10, 20, updatedAt = "2026-10-22T10:00:00Z"))), cursor = "p1")),
            reply(page(changes(links = listOf(tagLink(1, 10, 20, updatedAt = "2026-10-22T10:00:00.500Z", deletedAt = "2026-10-22T10:00:00.500Z"))), cursor = "p2")),
            reply(page(changes(links = listOf(tagLink(1, 10, 20, updatedAt = "2026-10-22T10:00:00.250Z"))), cursor = "p3")),
        )
        repeat(3) { sync.pull(ledger) }
        val link = dao.allTransactionTags(ledger).single()
        assertEquals("2026-10-22T10:00:00.500Z", link.updatedAt)
        assertNotNull(link.deletedAt)
    }

    @Test
    fun aFullRefreshDropsRowsTheServerNoLongerHasAndAcceptsLowerVersionsAfterARestore() = runBlocking {
        store.replaceAll(ledger, MirrorRows.merge(listOf(changes(accounts = listOf(account(1, version = 9, name = "Stale"), account(2))).toRows(ledger))), "old", Stamp)
        val (_, sync) = engine(reply(page(changes(accounts = listOf(account(1, version = 2, name = "Restored"))), cursor = "new")))
        assertEquals(PullResult.Updated(true, Stamp), sync.refreshEverything(ledger))
        val rows = dao.allAccounts(ledger)
        assertEquals(listOf("Restored"), rows.map { it.name })
        assertEquals(2, rows.single().version)
        assertEquals("new", dao.cursor(ledger)?.cursor)
    }

    @Test
    fun aFullRefreshThatFailsPartWayLeavesTheOldMirrorAndCursor() = runBlocking {
        store.replaceAll(ledger, changes(accounts = listOf(account(1, name = "Keep"))).toRows(ledger), "old", Stamp)
        val (_, sync) = engine(
            reply(page(changes(accounts = listOf(account(2))), cursor = "p1", hasMore = true)),
            fail(httpError(500)),
        )
        assertEquals(PullResult.Failed, sync.refreshEverything(ledger))
        assertEquals(listOf("Keep"), dao.allAccounts(ledger).map { it.name })
        assertEquals("old", dao.cursor(ledger)?.cursor)
    }

    @Test
    fun aFullRefreshThatFailsWhileWritingRollsBackEverything() = runBlocking {
        store.replaceAll(ledger, changes(accounts = listOf(account(1, name = "Keep")), transactions = listOf(entry(10))).toRows(ledger), "old", Stamp)
        store.beforeCursorWrite = { throw IllegalStateException("disk full") }
        val (_, sync) = engine(reply(page(changes(accounts = listOf(account(2, name = "New"))), cursor = "new")))
        assertEquals(PullResult.Failed, sync.refreshEverything(ledger))
        assertEquals(listOf("Keep"), dao.allAccounts(ledger).map { it.name })
        assertEquals(1, dao.allTransactions(ledger).size)
        assertEquals("old", dao.cursor(ledger)?.cursor)
    }

    @Test
    fun aCursorTheServerRejectsStartsAFullRefreshInstead() = runBlocking {
        store.replaceAll(ledger, changes(accounts = listOf(account(1, name = "Old"))).toRows(ledger), "bad", Stamp)
        val (source, sync) = engine(
            fail(httpError(400)),
            reply(page(changes(accounts = listOf(account(2, name = "Fresh"))), cursor = "good")),
        )
        assertEquals(PullResult.Updated(true, Stamp), sync.pull(ledger))
        assertEquals(listOf<String?>("bad", null), source.asked)
        assertEquals(listOf("Fresh"), dao.allAccounts(ledger).map { it.name })
        assertEquals("good", dao.cursor(ledger)?.cursor)
    }

    @Test
    fun aRefusedTokenStopsThePullAndKeepsTheMirror() = runBlocking {
        store.replaceAll(ledger, changes(accounts = listOf(account(1))).toRows(ledger), "c", Stamp)
        val (_, sync) = engine(fail(httpError(401)))
        assertEquals(PullResult.SignedOut, sync.pull(ledger))
        assertEquals(1, dao.allAccounts(ledger).size)
        assertEquals("c", dao.cursor(ledger)?.cursor)
    }

    @Test
    fun aServerErrorChangesNothing() = runBlocking {
        store.replaceAll(ledger, changes(accounts = listOf(account(1))).toRows(ledger), "c", Stamp)
        val (_, sync) = engine(fail(httpError(503)))
        assertEquals(PullResult.Failed, sync.pull(ledger))
        assertEquals("c", dao.cursor(ledger)?.cursor)
    }

    @Test
    fun aServerThatKeepsSayingThereIsMoreWithTheSameCursorEndsInsteadOfLooping() = runBlocking {
        store.replaceAll(ledger, MirrorRows.Empty, "same", Stamp)
        val (source, sync) = engine(reply(page(cursor = "same", hasMore = true)))
        assertEquals(PullResult.Failed, sync.pull(ledger))
        assertEquals(1, source.asked.size)
    }

    @Test
    fun anotherLedgersRowsAreNotTouchedByAPullAndAreDroppedByAFullRefresh() = runBlocking {
        store.replaceAll(ledger, MirrorRows.Empty, "start", Stamp)
        store.applyPage(other, changes(accounts = listOf(account(5, name = "Other"))).toRows(other), "o", Stamp)
        val (_, incremental) = engine(reply(page(changes(accounts = listOf(account(1))), cursor = "p1")))
        incremental.pull(ledger)
        assertEquals(listOf("Other"), dao.allAccounts(other).map { it.name })
        assertEquals(listOf(id(1)), dao.allAccounts(ledger).map { it.id })

        val (_, full) = engine(reply(page(changes(accounts = listOf(account(1))), cursor = "p2")))
        full.refreshEverything(ledger)
        assertEquals(emptyList<String>(), dao.allAccounts(other).map { it.name })
        assertNull(dao.cursor(other))
    }

    @Test
    fun moneyKeepsEveryDigitOfALargeAmount() = runBlocking {
        val big = 9_007_199_254_740_991L
        val (_, sync) = engine(reply(page(changes(accounts = listOf(account(1, openingAmount = big)), transactions = listOf(entry(10, amount = -big))))))
        sync.pull(ledger)
        assertEquals(big, dao.allAccounts(ledger).single().openingAmount)
        assertEquals(-big, dao.allTransactions(ledger).single().amount)
    }

    @Test
    fun aPageLargerThanTheIdChunkIsAppliedByVersion() = runBlocking {
        val many = (1..1_300).map { account(it, version = 2, name = "New") }
        store.replaceAll(ledger, changes(accounts = (1..1_300).map { account(it, version = if (it % 2 == 0) 3 else 1, name = "Old") }).toRows(ledger), "start", Stamp)
        val (_, sync) = engine(reply(page(changes(accounts = many), cursor = "p1")))
        sync.pull(ledger)
        val byId = dao.allAccounts(ledger).associateBy { it.id }
        assertEquals("Old", byId.getValue(id(2)).name)
        assertEquals("New", byId.getValue(id(1)).name)
        assertEquals(1_300, byId.size)
    }

    @Test
    fun signingOutWipesEveryRowAndCursor() = runBlocking {
        store.replaceAll(ledger, changes(accounts = listOf(account(1)), tags = listOf(tag(2)), transactions = listOf(entry(10)), links = listOf(tagLink(3, 10, 2))).toRows(ledger), "c", Stamp)
        store.applyPage(other, changes(accounts = listOf(account(7))).toRows(other), "d", Stamp)
        store.wipe()
        assertTrue(dao.allAccounts(ledger).isEmpty() && dao.allTags(ledger).isEmpty() && dao.allTransactions(ledger).isEmpty())
        assertTrue(dao.allTransactionTags(ledger).isEmpty() && dao.allAccounts(other).isEmpty())
        assertNull(dao.cursor(ledger))
        assertNull(dao.cursor(other))
    }
}
