package app.ledgerline.android.overlay

import app.ledgerline.android.outbox.OutboxRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** How changes not yet sent are laid over the mirror (pure, no database). */
class OverlayTest {
    private var seq = 0L

    private fun change(type: String, entityId: String, body: String, editedAt: String = "2026-10-22T10:00:00Z"): OutboxRow {
        val (kind, action) = type.split(".")
        return OutboxRow("m${++seq}", "l", seq, kind, action, entityId, null, editedAt, body, false, OutboxRow.Pending, null, null, null)
    }

    private fun mirrored(
        id: String,
        account: String = "checking",
        amount: Long = -1_000,
        status: String = "cleared",
        transferId: String? = null,
        kind: String = "expense",
        tags: List<String> = emptyList(),
    ) = ShownEntry(
        id, account, if (kind == "transfer") null else "food", kind, false, "2026-10-20", null, amount, "USD", "Shop", null,
        status, tags, "2026-10-20T09:00:00.000Z", transferId, unsent = false,
    )

    @Test
    fun aNewEntryAppearsWithItsFieldsAndIsMarkedUnsent() {
        val shown = Overlay.apply(
            emptyList(),
            listOf(
                change(
                    "transaction.create", "e1",
                    """{"accountId":"cash","categoryId":"food","kind":"expense","date":"2026-10-22","amount":{"amount":-450,"currency":"USD"},"payee":"Cafe","tagIds":["t1"]}""",
                ),
            ),
        )
        val entry = shown.getValue("e1")!!
        assertEquals("cash", entry.accountId)
        assertEquals(-450L, entry.amount)
        assertEquals("cleared", entry.status)
        assertEquals(listOf("t1"), entry.tagIds)
        assertTrue(entry.unsent)
    }

    @Test
    fun anEditChangesOnlyWhatItSendsAndANullClearsAField() {
        val shown = Overlay.apply(
            listOf(mirrored("e1", tags = listOf("t1"))),
            listOf(change("transaction.update", "e1", """{"payee":null,"amount":{"amount":-2000,"currency":"USD"},"status":"pending"}""")),
        )
        val entry = shown.getValue("e1")!!
        assertNull(entry.payee)
        assertEquals(-2_000L, entry.amount)
        assertEquals("pending", entry.status)
        assertEquals("food", entry.categoryId)
        assertEquals(listOf("t1"), entry.tagIds)
        assertTrue(entry.unsent)
    }

    @Test
    fun aDeleteHidesTheEntryAndAChangeToAnEntryThePhoneLacksIsIgnored() {
        val shown = Overlay.apply(
            listOf(mirrored("e1")),
            listOf(change("transaction.delete", "e1", "{}"), change("transaction.update", "unknown", """{"payee":"x"}""")),
        )
        assertTrue("e1" in shown)
        assertNull(shown["e1"])
        assertTrue("unknown" !in shown)
    }

    @Test
    fun aNewTransferShowsBothLegs() {
        val shown = Overlay.apply(
            emptyList(),
            listOf(change("transfer.create", "t9", """{"fromAccountId":"checking","toAccountId":"cash","amount":{"amount":5000,"currency":"USD"},"date":"2026-10-22"}""")),
        )
        assertEquals(-5_000L, shown.getValue(unsentLegId("t9", "from"))!!.amount)
        assertEquals("checking", shown.getValue(unsentLegId("t9", "from"))!!.accountId)
        assertEquals(5_000L, shown.getValue(unsentLegId("t9", "to"))!!.amount)
        assertEquals("cash", shown.getValue(unsentLegId("t9", "to"))!!.accountId)
    }

    @Test
    fun aTransferEditMovesBothLegsAndADeleteHidesThem() {
        val legs = listOf(
            mirrored("a", account = "checking", amount = -100, transferId = "t9", kind = "transfer"),
            mirrored("b", account = "cash", amount = 100, transferId = "t9", kind = "transfer"),
        )
        val edited = Overlay.apply(
            legs,
            listOf(change("transfer.update", "t9", """{"fromAccountId":"savings","toAccountId":"cash","amount":{"amount":700,"currency":"USD"},"date":"2026-10-21","time":null,"note":"rent"}""")),
        )
        assertEquals("savings" to -700L, edited.getValue("a")!!.let { it.accountId to it.amount })
        assertEquals("cash" to 700L, edited.getValue("b")!!.let { it.accountId to it.amount })
        assertEquals("rent", edited.getValue("b")!!.note)
        val deleted = Overlay.apply(legs, listOf(change("transfer.delete", "t9", "{}")))
        assertNull(deleted["a"])
        assertNull(deleted["b"])
    }

    @Test
    fun balancesChangeByClearedAmountsOnlyAndFollowAMovedEntry() {
        val mirror = listOf(mirrored("e1", account = "checking", amount = -1_000), mirrored("e2", amount = -300, status = "pending"))
        val shown = Overlay.apply(
            mirror,
            listOf(
                change("transaction.update", "e1", """{"accountId":"cash","amount":{"amount":-1200,"currency":"USD"}}"""),
                change("transaction.update", "e2", """{"amount":{"amount":-400,"currency":"USD"}}"""),
                change(
                    "transaction.create", "e3",
                    """{"accountId":"checking","categoryId":null,"kind":"income","date":"2026-10-22","amount":{"amount":250,"currency":"USD"}}""",
                ),
                change(
                    "transaction.create", "e4",
                    """{"accountId":"checking","categoryId":null,"kind":"expense","date":"2026-10-22","amount":{"amount":-90,"currency":"USD"},"status":"pending"}""",
                ),
            ),
        )
        assertEquals(mapOf("checking" to 1_000L + 250, "cash" to -1_200L), balanceChanges(mirror, shown))
    }

    @Test
    fun deletingAnEntryGivesItsAmountBack() {
        val mirror = listOf(mirrored("e1", account = "checking", amount = -1_000))
        val shown = Overlay.apply(mirror, listOf(change("transaction.delete", "e1", "{}")))
        assertEquals(mapOf("checking" to 1_000L), balanceChanges(mirror, shown))
    }

    @Test
    fun theListOrderIsNewestDateThenTimeWithNoTimeLastThenCreation() {
        val base = mirrored("x")
        val ordered = listOf(
            base.copy(id = "4", date = "2026-10-19"),
            base.copy(id = "2", date = "2026-10-20", time = null, createdAt = "2026-10-21T00:00:00Z"),
            base.copy(id = "1", date = "2026-10-20", time = "18:00"),
            base.copy(id = "3", date = "2026-10-20", time = null, createdAt = "2026-10-20T00:00:00Z"),
            base.copy(id = "0", date = "2026-10-21"),
        ).sortedWith(NewestFirst)
        assertEquals(listOf("0", "1", "2", "3", "4"), ordered.map { it.id })
    }
}
