package app.ledgerline.android.settings

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import app.ledgerline.android.mirror.EntryFilters
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** How the kept filters are written (WP-19a): typing saves in the background, and forgetting them is done before it returns. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class FilterStoreWritesTest {
    private val writes = mutableListOf<String>()

    private class RecordingPrefs(private val real: SharedPreferences, private val log: MutableList<String>) : SharedPreferences by real {
        override fun edit(): SharedPreferences.Editor = RecordingEditor(real.edit(), log)
    }

    private class RecordingEditor(private val real: SharedPreferences.Editor, private val log: MutableList<String>) : SharedPreferences.Editor by real {
        override fun commit(): Boolean {
            log += "commit"
            return real.commit()
        }

        override fun apply() {
            log += "apply"
            real.apply()
        }
    }

    private fun store(): PrefsFilterStore {
        val base = ApplicationProvider.getApplicationContext<Context>()
        val recording = object : ContextWrapper(base) {
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences = RecordingPrefs(super.getSharedPreferences(name, mode), writes)
        }
        return PrefsFilterStore(recording)
    }

    @Test
    fun savingWhileTypingDoesNotWaitForTheDiskOnTheMainThread() {
        store().save(SavedFilters(EntryFilters(text = "caf"), 1L))
        assertEquals(listOf("apply"), writes)
    }

    @Test
    fun forgettingTheFiltersIsDoneBeforeItReturnsSoASignOutLeavesNothingBehind() {
        store().clear()
        assertEquals(listOf("commit"), writes)
    }
}
