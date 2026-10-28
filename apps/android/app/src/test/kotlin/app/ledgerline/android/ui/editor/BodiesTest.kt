package app.ledgerline.android.ui.editor

import app.ledgerline.android.overlay.ShownEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BodiesTest {
    private val values = EntryValues("expense", "a1", "c1", "2026-10-22", -1_250, "USD", "Cafe", null, listOf("t1", "t2"), time = "09:00")
    private val before = ShownEntry(
        "e1", "a1", "c1", "expense", false, "2026-10-22", "09:00", -1_250, "USD", "Cafe", null, "cleared",
        listOf("t2", "t1"), "2026-10-22T09:00:00Z", null, unsent = false,
    )

    @Test
    fun aNewEntrySendsEveryFieldWithASignedAmount() {
        assertEquals(
            """{"accountId":"a1","categoryId":"c1","kind":"expense","date":"2026-10-22","time":null,"amount":{"amount":-1250,"currency":"USD"},"status":"cleared","payee":"Cafe","note":null,"tagIds":["t1","t2"]}""",
            entryCreateBody(values.copy(time = null)).toString(),
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
    fun aNewEntryIsClearedUnlessTheOwnerMarkedItPending() {
        assertTrue(entryCreateBody(values).toString().contains(""""status":"cleared""""))
        assertTrue(entryCreateBody(values.copy(status = "pending")).toString().contains(""""status":"pending""""))
    }

    @Test
    fun anEditSendsTheStatusOnlyWhenItChanged() {
        assertTrue(entryChanges(before, values.copy(status = "cleared")).isEmpty())
        assertEquals("""{"status":"pending"}""", entryChanges(before, values.copy(status = "pending")).toString())
        assertEquals("""{"status":"cleared"}""", entryChanges(before.copy(status = "pending"), values.copy(status = "cleared")).toString())
    }

    @Test
    fun aTimeIsSentWhenTheOwnerGaveOneAndOnlyWhenItChanged() {
        assertTrue(entryCreateBody(values.copy(time = "07:45")).toString().contains(""""date":"2026-10-22","time":"07:45","""))
        assertEquals("""{"time":"10:15"}""", entryChanges(before, values.copy(time = "10:15")).toString())
        assertEquals("""{"time":null}""", entryChanges(before, values.copy(time = null)).toString())
    }

    @Test
    fun theTimeShowsAsThePhoneShowsTimes() {
        assertEquals("15:05", formatTime("15:05", is24Hour = true, java.util.Locale.US))
        assertEquals("3:05 PM", formatTime("15:05", is24Hour = false, java.util.Locale.US))
    }

    @Test
    fun aTransferSendsEveryField() {
        assertEquals(
            """{"fromAccountId":"a1","toAccountId":"a2","amount":{"amount":5000,"currency":"USD"},"date":"2026-10-22","time":null,"note":"rent"}""",
            transferBody(TransferValues("a1", "a2", 5_000, "USD", "2026-10-22", null, "rent")).toString(),
        )
    }
}
