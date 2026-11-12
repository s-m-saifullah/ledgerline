package app.ledgerline.android.online

import app.ledgerline.android.mirror.MirrorDatabase
import app.ledgerline.android.mirror.SyncCursorRow
import app.ledgerline.android.outbox.memoryDatabase
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

internal data class Answer(val ledger: String, val month: String)

/**
 * On a shared phone one person signs out and the next signs in without the app being closed, so the screens' read
 * helpers outlive both. When the ledger goes away they show Loading and forget what they had; the next ledger's
 * numbers are never preceded by the earlier ledger's (ADR 0048: nobody sees another person's money).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ReadersForgetTheLedgerTest {
    private lateinit var database: MirrorDatabase
    private lateinit var scope: CoroutineScope

    @Before
    fun open() {
        database = memoryDatabase()
        scope = CoroutineScope(Dispatchers.Unconfined + Job())
    }

    @After
    fun close() {
        scope.cancel()
        database.close()
    }

    /** Keeps [flow] subscribed, as a visible screen does, and records everything it shows. */
    private fun <T> watch(flow: StateFlow<T>): CopyOnWriteArrayList<T> {
        val seen = CopyOnWriteArrayList<T>()
        scope.launch { flow.collect { seen += it } }
        return seen
    }

    private fun until(condition: () -> Boolean) = runBlocking {
        withTimeout(5_000) { while (!condition()) delay(10) }
    }

    private fun cursor(ledger: String) = runBlocking { database.dao().putCursor(SyncCursorRow(ledger, "c", "2026-11-12T10:00:00.000Z")) }

    private fun wipe() = runBlocking { database.dao().wipeSyncCursors() }

    @Test
    fun readOnTriggerForgetsTheAnswerWhenTheLedgerGoesAndNeverShowsItUnderTheNext() {
        val ledger = MutableStateFlow<String?>("a")
        val gate = CompletableDeferred<Unit>()
        val state = readOnTrigger(scope, ledger, { it }) { key ->
            if (key == "b") gate.await()
            Online.Ready("answer-$key")
        }
        val seen = watch(state)
        until { state.value == Online.Ready("answer-a") }

        val mark = seen.size
        ledger.value = null
        assertEquals(Online.Loading, state.value)
        ledger.value = "b"
        assertEquals(Online.Loading, state.value)
        gate.complete(Unit)
        until { state.value == Online.Ready("answer-b") }

        assertTrue("shown after the ledger left: ${seen.drop(mark)}", seen.drop(mark).none { it == Online.Ready("answer-a") })
    }

    @Test
    fun readOnTriggerKeepsItsAnswerOnScreenWhileTheSameLedgerReloads() {
        val refresh = MutableStateFlow<Pair<String, Int>?>("a" to 0)
        val gate = CompletableDeferred<Unit>()
        val state = readOnTrigger(scope, refresh, { it.first }) { key ->
            if (key.second == 1) gate.await()
            Online.Ready("answer-${key.first}-${key.second}")
        }
        watch(state)
        until { state.value == Online.Ready("answer-a-0") }

        refresh.value = "a" to 1

        assertEquals(Online.Ready("answer-a-0"), state.value)
        gate.complete(Unit)
        until { state.value == Online.Ready("answer-a-1") }
    }

    @Test
    fun pagedReadForgetsTheRowsWhenTheLedgerGoesAndNeverShowsThemUnderTheNext() {
        val ledger = MutableStateFlow<String?>("a")
        val gate = CompletableDeferred<Unit>()
        val read = PagedRead<String, String>(scope, ledger, { it }) { key, _ ->
            if (key == "b") gate.await()
            Online.Ready(Page(listOf("row-$key"), null))
        }
        val seen = watch(read.state)
        until { read.state.value == Online.Ready(Paged(listOf("row-a"), hasMore = false)) }

        val mark = seen.size
        ledger.value = null
        assertEquals(Online.Loading, read.state.value)
        ledger.value = "b"
        assertEquals(Online.Loading, read.state.value)
        gate.complete(Unit)
        until { read.state.value == Online.Ready(Paged(listOf("row-b"), hasMore = false)) }

        assertTrue(seen.drop(mark).none { it == Online.Ready(Paged(listOf("row-a"), hasMore = false)) })
    }

    @Test
    fun monthlyReadForgetsTheAnswerWhenTheLedgerGoes() {
        val startedB = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        val read = MonthlyRead<Answer>(scope, database.reads(), { it.month }) { ledger, month ->
            if (ledger == "ledger-b") {
                startedB.complete(Unit)
                gate.await()
            }
            Online.Ready(Answer(ledger, month))
        }
        val seen = watch(read.state)
        cursor("ledger-a")
        until { (read.state.value as? Online.Ready)?.value?.ledger == "ledger-a" }

        val mark = seen.size
        wipe()
        until { read.state.value == Online.Loading }
        cursor("ledger-b")
        runBlocking { withTimeout(5_000) { startedB.await() } }
        until { read.state.value == Online.Loading }
        gate.complete(Unit)
        until { (read.state.value as? Online.Ready)?.value?.ledger == "ledger-b" }

        assertTrue(seen.drop(mark).none { (it as? Online.Ready)?.value?.ledger == "ledger-a" })
    }

    @Test
    fun monthlyReadShowsLoadingNotTheEarlierLedgersNumbersWhenTheLedgerChangesInOneStep() {
        val started = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        val read = MonthlyRead<Answer>(scope, database.reads(), { it.month }) { ledger, month ->
            if (ledger == "ledger-0") {
                started.complete(Unit)
                gate.await()
            }
            Online.Ready(Answer(ledger, month))
        }
        val seen = watch(read.state)
        cursor("ledger-a")
        until { (read.state.value as? Online.Ready)?.value?.ledger == "ledger-a" }

        // "ledger-0" sorts before "ledger-a", so the mirror's ledger changes without ever being empty.
        val mark = seen.size
        cursor("ledger-0")
        runBlocking { withTimeout(5_000) { started.await() } }

        // The answer crosses Room's threads, so Loading may land a moment after the read started.
        until { read.state.value == Online.Loading }
        gate.complete(Unit)
        until { (read.state.value as? Online.Ready)?.value?.ledger == "ledger-0" }
        assertTrue(seen.drop(mark).none { (it as? Online.Ready)?.value?.ledger == "ledger-a" })
    }

    @Test
    fun monthlyReadKeepsItsNumbersOnScreenWhileTheSameLedgerReads() {
        val gate = CompletableDeferred<Unit>()
        val reads = AtomicInteger()
        val read = MonthlyRead<Answer>(scope, database.reads(), { it.month }) { ledger, month ->
            if (reads.incrementAndGet() == 2) gate.await()
            Online.Ready(Answer(ledger, month))
        }
        watch(read.state)
        cursor("ledger-a")
        until { read.state.value is Online.Ready }

        read.retry()
        until { reads.get() == 2 }

        assertTrue(read.state.value is Online.Ready)
        gate.complete(Unit)
    }
}
