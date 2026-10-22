package app.ledgerline.android.outbox

import app.ledgerline.android.mirror.MirrorDatabase
import app.ledgerline.android.mirror.PullResult
import app.ledgerline.android.mirror.SyncLock
import app.ledgerline.android.mirror.httpError
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

/** Sending the outbox against a stand-in server that applies each change id once. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PushEngineTest {
    private lateinit var database: MirrorDatabase
    private lateinit var outbox: OutboxStore
    private val server = FakeServer()
    private val ledger = "ledger-a"

    @Before
    fun open() {
        database = memoryDatabase()
        outbox = outboxFor(database)
    }

    @After
    fun close() = database.close()

    private val engine get() = PushEngine(server, outbox, SyncLock())

    @Test
    fun everythingIsSentOldestFirstIn50sAndLeavesTheOutbox() = runBlocking {
        val ids = (1..120).map { outbox.createEntry(ledger, json("n" to it)) }
        assertEquals(PushResult.Sent(120), engine.send(ledger))
        assertEquals(listOf(50, 50, 20), server.requests.map { it.mutations.size })
        assertEquals(ids, server.applied)
        assertEquals(0, outbox.unsentCount())
        assertEquals(PushResult.Sent(0), engine.send(ledger))
        assertEquals(3, server.requests.size)
    }

    @Test
    fun aLostReplyIsSentAgainAndTheServerAppliesEachChangeOnce() = runBlocking {
        val ids = (1..3).map { outbox.createEntry(ledger, json("n" to it)) }
        server.loseReply = true
        assertEquals(PushResult.Stopped(PullResult.Offline), engine.send(ledger))
        assertEquals(3, outbox.unsentCount())
        assertEquals(PushResult.Sent(3), engine.send(ledger))
        assertEquals(ids, server.applied)
        assertEquals(0, outbox.unsentCount())
    }

    @Test
    fun aCrashBeforeTheResultsAreSavedEndsWithEachChangeAppliedOnce() = runBlocking {
        val ids = (1..2).map { outbox.createEntry(ledger, json("n" to it)) }
        outbox.beforeResultsCommit = { throw IllegalStateException("process died") }
        assertEquals(PushResult.Stopped(PullResult.Failed), engine.send(ledger))
        assertEquals(2, outbox.unsentCount())
        outbox.beforeResultsCommit = null
        assertEquals(PushResult.Sent(2), engine.send(ledger))
        assertEquals(ids, server.applied)
        assertEquals(0, outbox.unsentCount())
    }

    @Test
    fun anEditMadeWhileItsCreateWasInFlightIsSentAfterItAndNotLost() = runBlocking {
        val entryId = outbox.createEntry(ledger, json("payee" to "Grocer"))
        server.loseReply = true
        engine.send(ledger)
        outbox.updateEntry(ledger, entryId, json("payee" to "Baker"))
        engine.send(ledger)
        val sent = server.requests.last().mutations
        assertEquals(listOf("transaction.create", "transaction.update"), sent.map { it.type })
        assertEquals(1, sent.last().baseVersion)
        assertEquals(entryId, sent.last().targetId)
        assertEquals(0, outbox.unsentCount())
    }

    @Test
    fun aRefusedTokenOrNoConnectionKeepsEverything() = runBlocking {
        outbox.createEntry(ledger, json("n" to 1))
        server.fail = httpError(401)
        assertEquals(PushResult.Stopped(PullResult.SignedOut), engine.send(ledger))
        server.fail = IOException("offline")
        assertEquals(PushResult.Stopped(PullResult.Offline), engine.send(ledger))
        assertEquals(1, outbox.unsentCount())
        assertTrue(server.applied.isEmpty())
    }

    @Test
    fun supersededAndRejectedChangesWaitForTheOwnerAndTheRestGoOn() = runBlocking {
        val a = outbox.createEntry(ledger, json("n" to 1))
        val b = outbox.createEntry(ledger, json("n" to 2))
        val c = outbox.createEntry(ledger, json("n" to 3))
        server.answer = { id -> if (id == b) rejected(b) else null }
        assertEquals(PushResult.Sent(3), engine.send(ledger))
        assertEquals(listOf(a, c), server.applied)
        assertEquals(listOf(b), outbox.needingAttention().map { it.id })
        assertEquals(PushResult.Sent(0), engine.send(ledger))
    }

    @Test
    fun anotherLedgersChangesAreNotSent() = runBlocking {
        outbox.createEntry("ledger-b", json("n" to 1))
        assertEquals(PushResult.Sent(0), engine.send(ledger))
        assertTrue(server.requests.isEmpty())
        assertEquals(1, outbox.unsentCount())
    }
}
