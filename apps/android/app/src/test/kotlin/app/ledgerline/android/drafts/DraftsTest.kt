package app.ledgerline.android.drafts

import androidx.lifecycle.SavedStateHandle
import kotlinx.serialization.Serializable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

@Serializable
private data class Sample(val amount: String, val note: String = "", val ids: List<String> = emptyList())

/** A draft is what a sheet holds, kept so that Android ending the app does not lose it (WP-18b). */
class DraftsTest {
    private val handle = SavedStateHandle()
    private val draft = Draft(handle, "sample", Sample.serializer())

    /** What Android brings back after the process died: the same values in a new handle. */
    private fun restarted() = SavedStateHandle(handle.keys().associateWith { handle.get<Any>(it) })

    @Test
    fun nothingIsKeptUntilSomethingIsSaved() {
        assertNull(draft.load())
    }

    @Test
    fun aSavedDraftComesBackAfterARestart() {
        draft.save(Sample("12.50", "lunch", listOf("a", "b")))
        assertEquals(Sample("12.50", "lunch", listOf("a", "b")), Draft(restarted(), "sample", Sample.serializer()).load())
    }

    @Test
    fun savingNothingForgetsTheDraft() {
        draft.save(Sample("1"))
        draft.save(null)
        assertNull(draft.load())
        assertEquals(emptySet<String>(), handle.keys())
    }

    @Test
    fun aDraftThatCannotBeReadIsDroppedNotCrashedOn() {
        handle["sample"] = "{not json"
        assertNull(draft.load())
        handle["sample"] = """{"unrelated":true}"""
        assertNull(draft.load())
    }

    @Test
    fun aDraftFromAnOlderVersionWithMoreFieldsStillLoads() {
        handle["sample"] = """{"amount":"5","gone":"field"}"""
        assertEquals(Sample("5"), draft.load())
    }
}
