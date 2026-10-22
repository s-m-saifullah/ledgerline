package app.ledgerline.android.outbox

import app.ledgerline.android.mirror.MirrorDatabase
import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.Stamp
import app.ledgerline.android.mirror.changes
import app.ledgerline.android.mirror.entry
import app.ledgerline.android.mirror.id
import app.ledgerline.android.mirror.toRows
import app.ledgerline.api.ApiJson
import app.ledgerline.api.Money
import app.ledgerline.api.SyncPushResult
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

/** The outbox rules against the real Room database. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class OutboxStoreTest {
    private lateinit var database: MirrorDatabase
    private lateinit var outbox: OutboxStore
    private val clock = FakeWallClock()
    private val ledger = "ledger-a"

    @Before
    fun open() {
        database = memoryDatabase()
        outbox = outboxFor(database, clock)
    }

    @After
    fun close() = database.close()

    private suspend fun rows() = database.outbox().all()

    private fun body(row: OutboxRow) = ApiJson.parseToJsonElement(row.body).jsonObject

    /** The mirror holds entry [n] at [version], and a transfer `t` whose outgoing leg is at [transferVersion]. */
    private suspend fun mirrorHolds(n: Int, version: Int, transferVersion: Int = 1) {
        val legs = listOf(
            entry(50, version = transferVersion, amount = -500, kind = "transfer").copy(transferId = "t"),
            entry(51, version = 9, amount = 500, kind = "transfer").copy(transferId = "t"),
        )
        MirrorStore(database).replaceAll(ledger, changes(transactions = listOf(entry(n, version = version)) + legs).toRows(ledger), "c", Stamp)
    }

    @Test
    fun aNewEntryIsOneCreateWhoseIdIsTheEntryId() = runBlocking {
        val entryId = outbox.createEntry(ledger, json("payee" to "Grocer"))
        val row = rows().single()
        assertEquals(entryId, row.id)
        assertEquals(entryId, row.entityId)
        assertNull(row.baseVersion)
        val mutation = row.toMutation()
        assertEquals("transaction.create", mutation.type)
        assertNull(mutation.targetId)
        assertEquals("2026-10-22T10:00:00Z", mutation.editedAt)
    }

    @Test
    fun editingAnUnsentEntryChangesItsCreate() = runBlocking {
        val entryId = outbox.createEntry(ledger, json("payee" to "Grocer", "note" to "x"))
        clock.now = Instant.parse("2026-10-22T10:05:00.123Z")
        outbox.updateEntry(ledger, entryId, json("payee" to "Baker"))
        val row = rows().single()
        assertEquals("create", row.action)
        assertEquals(json("payee" to "Baker", "note" to "x"), body(row))
        assertEquals("2026-10-22T10:05:00.123Z", row.editedAt)
    }

    @Test
    fun deletingAnUnsentEntryLeavesNothingToSend() = runBlocking {
        val entryId = outbox.createEntry(ledger, json("payee" to "Grocer"))
        outbox.updateEntry(ledger, entryId, json("payee" to "Baker"))
        outbox.deleteEntry(ledger, entryId)
        assertTrue(rows().isEmpty())
    }

    @Test
    fun aCreateThatWasSentIsNeverChangedAndALaterEditExpectsVersionOne() = runBlocking {
        val entryId = outbox.createEntry(ledger, json("payee" to "Grocer"))
        outbox.takeBatch(ledger)
        outbox.updateEntry(ledger, entryId, json("payee" to "Baker"))
        val (create, update) = rows()
        assertEquals(json("payee" to "Grocer"), body(create))
        assertEquals("update", update.action)
        assertEquals(entryId, update.entityId)
        assertEquals(1, update.baseVersion)
        assertEquals(entryId, update.toMutation().targetId)
    }

    @Test
    fun editsOfAMirroredEntryFoldUntilSentThenExpectTheNextVersion() = runBlocking {
        mirrorHolds(10, version = 4)
        outbox.updateEntry(ledger, id(10), json("payee" to "One"))
        outbox.updateEntry(ledger, id(10), json("note" to "Two"))
        assertEquals(4, rows().single().baseVersion)
        assertEquals(json("payee" to "One", "note" to "Two"), body(rows().single()))
        outbox.takeBatch(ledger)
        outbox.updateEntry(ledger, id(10), json("payee" to "Three"))
        assertEquals(listOf(4, 5), rows().map { it.baseVersion })
    }

    @Test
    fun deletingAfterAnUnsentEditDropsTheEditAndSendsOneDelete() = runBlocking {
        mirrorHolds(10, version = 2)
        outbox.updateEntry(ledger, id(10), json("payee" to "One"))
        outbox.deleteEntry(ledger, id(10))
        outbox.deleteEntry(ledger, id(10))
        val row = rows().single()
        assertEquals("delete", row.action)
        assertEquals(2, row.baseVersion)
    }

    @Test(expected = IllegalStateException::class)
    fun editingAnEntryThePhoneDoesNotKnowIsAnError(): Unit = runBlocking {
        outbox.updateEntry(ledger, "unknown", json("payee" to "x"))
    }

    @Test(expected = IllegalStateException::class)
    fun editingAnEntryBeingDeletedIsAnError(): Unit = runBlocking {
        mirrorHolds(10, version = 2)
        outbox.deleteEntry(ledger, id(10))
        outbox.updateEntry(ledger, id(10), json("payee" to "x"))
    }

    @Test
    fun aTransferExpectsItsOutgoingLegsVersionAndAnEditReplacesTheWholeBody() = runBlocking {
        mirrorHolds(10, version = 1, transferVersion = 6)
        outbox.updateTransfer(ledger, "t", json("amount" to 1, "note" to "a"))
        outbox.updateTransfer(ledger, "t", json("amount" to 2))
        val row = rows().single()
        assertEquals("transfer.update", row.type)
        assertEquals(6, row.baseVersion)
        assertEquals(json("amount" to 2), body(row))
    }

    @Test
    fun batchesAreOldestFirstPerLedgerAndAtMost50() = runBlocking {
        repeat(60) { outbox.createEntry(ledger, json("n" to it)) }
        outbox.createEntry("ledger-b", json("n" to "other"))
        val first = outbox.takeBatch(ledger)
        assertEquals(50, first.size)
        assertEquals((0 until 50).map { json("n" to it) }, first.map { body(it) })
        assertTrue(first.all { it.attempted })
        // Until the server answers, the same changes are the next batch again (sent again, never skipped).
        assertEquals(first.map { it.id }, outbox.takeBatch(ledger).map { it.id })
        assertTrue(first.all { it.ledgerId == ledger })
    }

    @Test
    fun resultsSettleEachChangeAndUpdateTheMirror() = runBlocking {
        mirrorHolds(10, version = 1)
        val a = outbox.createEntry(ledger, json("payee" to "A"))
        val b = outbox.createEntry(ledger, json("payee" to "B"))
        outbox.updateEntry(ledger, id(10), json("payee" to "C"))
        val c = rows().last().id
        val batch = outbox.takeBatch(ledger)
        val serverEntry = entry(10, version = 3, payee = "Theirs")
        outbox.settle(
            ledger,
            batch,
            listOf(SyncPushResult(a, "applied", listOf(entry(20, payee = "A").copy(id = a))), rejected(b), superseded(c, listOf(serverEntry))),
        )
        val left = rows().associateBy { it.id }
        assertEquals(setOf(b, c), left.keys)
        assertEquals(OutboxRow.Rejected, left.getValue(b).state)
        assertEquals("The account is archived.", left.getValue(b).problemDetail)
        assertEquals(OutboxRow.Superseded, left.getValue(c).state)
        val mirror = database.dao().allTransactions(ledger).associateBy { it.id }
        assertEquals("A", mirror.getValue(a).payee)
        assertEquals("Theirs", mirror.getValue(id(10)).payee)
        assertEquals(0, outbox.unsentCount())
        assertEquals(listOf(b, c), outbox.needingAttention().map { it.id })
    }

    @Test
    fun resultsThatDoNotAnswerTheBatchChangeNothing() = runBlocking {
        val a = outbox.createEntry(ledger, json("payee" to "A"))
        outbox.createEntry(ledger, json("payee" to "B"))
        val batch = outbox.takeBatch(ledger)
        val failure = runCatching { outbox.settle(ledger, batch, listOf(SyncPushResult(a, "applied", emptyList()))) }
        assertTrue(failure.isFailure)
        assertEquals(2, outbox.unsentCount())
    }

    @Test
    fun aCrashWhileSettlingKeepsEveryChangeQueued() = runBlocking {
        val a = outbox.createEntry(ledger, json("payee" to "A"))
        val batch = outbox.takeBatch(ledger)
        outbox.beforeResultsCommit = { throw IllegalStateException("process died") }
        val failure = runCatching {
            outbox.settle(ledger, batch, listOf(SyncPushResult(a, "applied", listOf(entry(20).copy(id = a)))))
        }
        assertTrue(failure.isFailure)
        assertEquals(listOf(a), rows().map { it.id })
        assertTrue(database.dao().allTransactions(ledger).isEmpty())
    }

    @Test
    fun keepMineSendsMyChangeAgainAgainstTheServersVersion() = runBlocking {
        mirrorHolds(10, version = 1)
        outbox.updateEntry(ledger, id(10), json("payee" to "Mine"))
        val batch = outbox.takeBatch(ledger)
        outbox.settle(ledger, batch, listOf(superseded(batch.single().id, listOf(entry(10, version = 3, payee = "Theirs")))))
        assertTrue(outbox.keepMine(batch.single().id))
        val again = rows().single()
        assertEquals(OutboxRow.Pending, again.state)
        assertEquals(3, again.baseVersion)
        assertEquals(json("payee" to "Mine"), body(again))
        assertFalse(again.id == batch.single().id)
    }

    @Test
    fun keepMineIsNotOfferedWhenTheOtherDeviceDeletedTheEntry() = runBlocking {
        mirrorHolds(10, version = 1)
        outbox.updateEntry(ledger, id(10), json("payee" to "Mine"))
        val batch = outbox.takeBatch(ledger)
        outbox.settle(ledger, batch, listOf(superseded(batch.single().id, listOf(entry(10, version = 2, deletedAt = Stamp)))))
        assertFalse(outbox.keepMine(batch.single().id))
        assertEquals(1, rows().size)
        outbox.keepTheirs(batch.single().id)
        assertTrue(rows().isEmpty())
    }

    @Test
    fun keepTheirsAndDiscardNeverDropAChangeStillToBeSent() = runBlocking {
        val a = outbox.createEntry(ledger, json("payee" to "A"))
        outbox.keepTheirs(a)
        outbox.discard(a)
        assertEquals(1, rows().size)
    }

    @Test
    fun wipingTheMirrorOnSignOutKeepsTheOutbox() = runBlocking {
        mirrorHolds(10, version = 1)
        outbox.createEntry(ledger, json("payee" to "A"))
        MirrorStore(database).wipe()
        assertTrue(database.dao().allTransactions(ledger).isEmpty())
        assertEquals(1, outbox.unsentCount())
        outbox.clearAll()
        assertEquals(0, outbox.unsentCount())
    }

    @Test
    fun aRejectedMoneyAmountIsKeptExactlyAsTyped() = runBlocking {
        val big = 9_007_199_254_740_991L
        outbox.createEntry(ledger, kotlinx.serialization.json.buildJsonObject {
            put("amount", ApiJson.encodeToJsonElement(Money.serializer(), Money(-big, "USD")))
        })
        assertEquals("""{"amount":{"amount":-9007199254740991,"currency":"USD"}}""", rows().single().body)
    }
}
