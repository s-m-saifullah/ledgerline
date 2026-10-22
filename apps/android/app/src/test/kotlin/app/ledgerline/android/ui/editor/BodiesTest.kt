package app.ledgerline.android.ui.editor

import app.ledgerline.android.overlay.ShownEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BodiesTest {
    private val values = EntryValues("expense", "a1", "c1", "2026-10-22", -1_250, "USD", "Cafe", null, listOf("t1", "t2"))
    private val before = ShownEntry(
        "e1", "a1", "c1", "expense", false, "2026-10-22", "09:00", -1_250, "USD", "Cafe", null, "cleared",
        listOf("t2", "t1"), "2026-10-22T09:00:00Z", null, unsent = false,
    )

    @Test
    fun aNewEntrySendsEveryFieldWithASignedAmount() {
        assertEquals(
            """{"accountId":"a1","categoryId":"c1","kind":"expense","date":"2026-10-22","amount":{"amount":-1250,"currency":"USD"},"status":"cleared","payee":"Cafe","note":null,"tagIds":["t1","t2"]}""",
            entryCreateBody(values).toString(),
        )
    }

    @Test
    fun anEditSendsOnlyWhatChangedAndTagOrderDoesNotCount() {
        assertTrue(entryChanges(before, values).isEmpty())
        assertEquals("""{"payee":null}""", entryChanges(before, values.copy(payee = null)).toString())
        assertEquals(
            """{"kind":"income","amount":{"amount":1250,"currency":"USD"}}""",
            entryChanges(before, values.copy(kind = "income", amount = 1_250)).toString(),
        )
        assertEquals("""{"tagIds":["t1"]}""", entryChanges(before, values.copy(tagIds = listOf("t1"))).toString())
    }

    @Test
    fun aTransferSendsEveryField() {
        assertEquals(
            """{"fromAccountId":"a1","toAccountId":"a2","amount":{"amount":5000,"currency":"USD"},"date":"2026-10-22","time":null,"note":"rent"}""",
            transferBody(TransferValues("a1", "a2", 5_000, "USD", "2026-10-22", null, "rent")).toString(),
        )
    }
}
