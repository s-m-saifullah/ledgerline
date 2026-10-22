package app.ledgerline.android.overlay

import app.ledgerline.android.mirror.entry
import app.ledgerline.android.outbox.OutboxRow
import app.ledgerline.api.ApiJson
import app.ledgerline.api.SyncTransaction
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AttentionTest {
    private fun row(type: String, state: String, body: String, server: List<SyncTransaction> = emptyList(), detail: String? = null): OutboxRow {
        val (kind, action) = type.split(".")
        return OutboxRow(
            "m", "l", 1, kind, action, server.firstOrNull()?.id ?: "e", 2, "t", body, true, state, "Invalid request", detail,
            ApiJson.encodeToString(ListSerializer(SyncTransaction.serializer()), server),
        )
    }

    @Test
    fun anEditThatLostToAnotherEditCanBeKept() {
        val item = attentionItem(row("transaction.update", OutboxRow.Superseded, """{"payee":"Mine"}""", listOf(entry(1, payee = "Theirs"))))
        assertEquals(AttentionReason.ChangedElsewhere, item.reason)
        assertEquals("Mine", item.payee)
        assertEquals(1_000L, item.amount)
        assertTrue(item.canKeepMine)
    }

    @Test
    fun anEditOfAnEntryDeletedElsewhereCanOnlyBeLetGo() {
        val item = attentionItem(
            row("transaction.update", OutboxRow.Superseded, """{"payee":"Mine"}""", listOf(entry(1, deletedAt = "2026-10-22T10:00:00Z"))),
        )
        assertEquals(AttentionReason.DeletedElsewhere, item.reason)
        assertFalse(item.canKeepMine)
    }

    @Test
    fun aRejectedChangeShowsTheServersReason() {
        val item = attentionItem(
            row("transaction.create", OutboxRow.Rejected, """{"amount":{"amount":-450,"currency":"EUR"},"payee":"Cafe"}""", detail = "The account is archived."),
        )
        assertEquals(AttentionReason.Rejected, item.reason)
        assertEquals("The account is archived.", item.detail)
        assertEquals(-450L to "EUR", item.amount to item.currency)
        assertFalse(item.canKeepMine)
    }
}
