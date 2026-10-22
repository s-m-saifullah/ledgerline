package app.ledgerline.android.overlay

import app.ledgerline.android.mirror.MirrorDatabase
import app.ledgerline.android.mirror.MirrorStore
import app.ledgerline.android.mirror.Stamp
import app.ledgerline.android.mirror.account
import app.ledgerline.android.mirror.changes
import app.ledgerline.android.mirror.entry
import app.ledgerline.android.mirror.id
import app.ledgerline.android.mirror.tag
import app.ledgerline.android.mirror.tagLink
import app.ledgerline.android.mirror.toRows
import app.ledgerline.android.outbox.OutboxStore
import app.ledgerline.android.outbox.json
import app.ledgerline.android.outbox.memoryDatabase
import app.ledgerline.android.outbox.outboxFor
import app.ledgerline.api.SyncPushResult
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The lists and balances the screens show, with changes not yet sent laid over the real Room mirror. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LedgerViewTest {
    private lateinit var database: MirrorDatabase
    private lateinit var outbox: OutboxStore
    private lateinit var view: LedgerView
    private val ledger = "ledger-a"

    @Before
    fun open() = runBlocking {
        database = memoryDatabase()
        outbox = outboxFor(database)
        view = LedgerView(database.reads(), database.dao(), database.outbox())
        MirrorStore(database).replaceAll(
            ledger,
            changes(
                accounts = listOf(account(1, name = "Checking", openingAmount = 10_000), account(2, name = "Cash")),
                tags = listOf(tag(30, name = "work")),
                transactions = listOf(
                    entry(10, accountN = 1, amount = -1_000, payee = "Grocer").copy(date = "2026-10-20"),
                    entry(11, accountN = 1, amount = -500, payee = "Cinema").copy(date = "2026-10-19"),
                ),
                links = listOf(tagLink(40, 10, 30)),
            ).toRows(ledger),
            "c",
            Stamp,
        )
    }

    @After
    fun close() = database.close()

    private suspend fun balances() = view.accounts(ledger).first().associate { it.name to it.balance }

    private fun newEntry(account: Int, amount: Long, payee: String, date: String = "2026-10-21", status: String = "cleared") = buildJsonObject {
        put("accountId", id(account)); put("categoryId", null as String?); put("kind", if (amount < 0) "expense" else "income")
        put("date", date); put("amount", buildJsonObject { put("amount", amount); put("currency", "USD") }); put("payee", payee)
        put("status", status); put("tagIds", JsonArray(listOf(JsonPrimitive(id(30)))))
    }

    @Test
    fun withNothingUnsentTheMirrorIsShownAsItIs() = runBlocking {
        assertEquals(mapOf("Checking" to 8_500L, "Cash" to 0L), balances())
        val lines = view.entries(ledger, 10).first()
        assertEquals(listOf(id(10), id(11)), lines.map { it.line.id })
        assertTrue(lines.none { it.unsent })
    }

    @Test
    fun anUnsentEntryIsListedMarkedWithItsNamesAndCountsInTheBalance() = runBlocking {
        val created = outbox.createEntry(ledger, newEntry(2, -250, "Cafe"))
        outbox.createEntry(ledger, newEntry(2, -999, "Not yet cleared", date = "2026-10-18", status = "pending"))
        assertEquals(mapOf("Checking" to 8_500L, "Cash" to -250L), balances())
        val lines = view.entries(ledger, 10).first()
        val cafe = lines.single { it.line.id == created }
        assertTrue(cafe.unsent)
        assertEquals("Cash", cafe.line.accountName)
        assertEquals("work", cafe.line.tagNames)
        assertEquals(created, lines.first().line.id)
    }

    @Test
    fun anUnsentEditOrDeleteReplacesTheMirroredLineAndItsBalance() = runBlocking {
        outbox.updateEntry(ledger, id(10), json("payee" to "Baker", "accountId" to id(2)))
        outbox.deleteEntry(ledger, id(11))
        assertEquals(mapOf("Checking" to 10_000L, "Cash" to -1_000L), balances())
        val lines = view.entries(ledger, 10).first()
        assertEquals(listOf(id(10)), lines.map { it.line.id })
        assertEquals("Baker", lines.single().line.payee)
        assertEquals("Cash", lines.single().line.accountName)
        assertEquals("work", lines.single().line.tagNames)
        assertTrue(lines.single().unsent)
    }

    @Test
    fun theListKeepsItsLimitWithUnsentEntriesMixedIn() = runBlocking {
        outbox.createEntry(ledger, newEntry(1, -1, "Newest", date = "2026-10-25"))
        outbox.deleteEntry(ledger, id(10))
        assertEquals(listOf("Newest", "Cinema"), view.entries(ledger, 2).first().map { it.line.payee })
        assertEquals(listOf("Newest"), view.entries(ledger, 1).first().map { it.line.payee })
    }

    @Test
    fun onceTheServerHasTheChangeTheMirrorAloneShowsIt() = runBlocking {
        val created = outbox.createEntry(ledger, newEntry(2, -250, "Cafe"))
        val batch = outbox.takeBatch(ledger)
        outbox.settle(ledger, batch, listOf(SyncPushResult(created, "applied", listOf(entry(50, accountN = 2, amount = -250, payee = "Cafe").copy(id = created)))))
        val cafe = view.entries(ledger, 10).first().single { it.line.id == created }
        assertFalse(cafe.unsent)
        assertEquals(mapOf("Checking" to 8_500L, "Cash" to -250L), balances())
    }

    @Test
    fun aChangeThatNeedsTheOwnerIsNotShownAsIfItHadHappened() = runBlocking {
        outbox.updateEntry(ledger, id(10), json("payee" to "Mine"))
        val batch = outbox.takeBatch(ledger)
        outbox.settle(ledger, batch, listOf(app.ledgerline.android.outbox.superseded(batch.single().id, listOf(entry(10, accountN = 1, amount = -1_000, payee = "Theirs", version = 2)))))
        val grocer = view.entries(ledger, 10).first().single { it.line.id == id(10) }
        assertEquals("Theirs", grocer.line.payee)
        assertFalse(grocer.unsent)
    }
}
