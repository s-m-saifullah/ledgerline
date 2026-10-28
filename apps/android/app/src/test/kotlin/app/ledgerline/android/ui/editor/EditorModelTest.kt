package app.ledgerline.android.ui.editor

import org.junit.Assert.assertEquals
import org.junit.Test

class EditorModelTest {
    private val form = EditorForm(EntryMode.Transfer, "5", "a1", "a2", null, "2026-10-23", "", "", emptyList())

    @Test
    fun swappingExchangesFromAndToAndNothingElse() {
        val swapped = form.swapped()
        assertEquals("a2", swapped.accountId)
        assertEquals("a1", swapped.toAccountId)
        assertEquals(form.copy(accountId = "a2", toAccountId = "a1"), swapped)
    }

    @Test
    fun swappingTwiceIsWhereItStarted() {
        assertEquals(form, form.swapped().swapped())
    }

    @Test
    fun theSearchBoxComesFromEightChoices() {
        assertEquals(8, PickerSearchFrom)
    }
}
