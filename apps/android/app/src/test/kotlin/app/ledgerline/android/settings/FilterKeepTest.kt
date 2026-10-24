package app.ledgerline.android.settings

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import app.ledgerline.android.mirror.EntryFilters
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

/** How long the Transactions filters stay: the rules, the typed number, and what is kept on the phone. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class FilterKeepTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val start = Instant.parse("2026-10-24T10:00:00Z")

    @Test
    fun byDefaultTheFiltersStayUntilTheAppCloses() {
        assertEquals(KeepMode.UntilAppCloses, FilterKeep().mode)
        assertEquals(KeepMode.UntilAppCloses, PrefsPhoneSettings(context).filterKeep.value.mode)
    }

    @Test
    fun aTimeIsMinutesHoursOrDays() {
        assertEquals(90 * 60_000L, FilterKeep(KeepMode.ForAWhile, 90, KeepUnit.Minutes).durationMillis)
        assertEquals(2 * 3_600_000L, FilterKeep(KeepMode.ForAWhile, 2, KeepUnit.Hours).durationMillis)
        assertEquals(3 * 86_400_000L, FilterKeep(KeepMode.ForAWhile, 3, KeepUnit.Days).durationMillis)
    }

    @Test
    fun onlyAChosenTimeRunsOutAndNotBeforeItsLastMinute() {
        val hour = FilterKeep(KeepMode.ForAWhile, 1, KeepUnit.Hours)
        assertFalse(hour.expired(start, start.plusSeconds(3599)))
        assertTrue(hour.expired(start, start.plusSeconds(3600)))
        assertTrue(hour.expired(start, start.plusSeconds(86_400 * 30)))
        // The other two never run out by the clock.
        assertFalse(FilterKeep(KeepMode.UntilLeave).expired(start, start.plusSeconds(86_400 * 30)))
        assertFalse(FilterKeep(KeepMode.UntilAppCloses).expired(start, start.plusSeconds(86_400 * 30)))
    }

    @Test
    fun aTypedNumberIsAWholeNumberFromOneTo999() {
        assertEquals(1, FilterKeep.amountOf("1"))
        assertEquals(999, FilterKeep.amountOf("999"))
        assertEquals(12, FilterKeep.amountOf("  12 "))
        listOf("", "0", "1000", "-3", "abc", "1.5", "1 2").forEach { assertNull(it, FilterKeep.amountOf(it)) }
        // Digits of other scripts count too, for people who type in them.
        assertEquals(3, FilterKeep.amountOf("٣"))
    }

    @Test
    fun theChoiceIsKeptForTheNextStartWithTheLastTimeRemembered() {
        val settings = PrefsPhoneSettings(context)
        settings.setFilterKeep(FilterKeep(KeepMode.ForAWhile, 45, KeepUnit.Minutes))
        assertEquals(FilterKeep(KeepMode.ForAWhile, 45, KeepUnit.Minutes), PrefsPhoneSettings(context).filterKeep.value)
        // Another mode keeps the number and unit for when a time is chosen again.
        settings.setFilterKeep(FilterKeep(KeepMode.UntilLeave, 45, KeepUnit.Minutes))
        assertEquals(FilterKeep(KeepMode.UntilLeave, 45, KeepUnit.Minutes), PrefsPhoneSettings(context).filterKeep.value)
    }

    @Test
    fun anUnreadableStoredChoiceFallsBackToTheDefault() {
        context.getSharedPreferences("phone-settings", Context.MODE_PRIVATE).edit()
            .putString("filterKeepMode", "Sometimes").putInt("filterKeepAmount", 0).putString("filterKeepUnit", "Fortnights").commit()
        assertEquals(FilterKeep(), PrefsPhoneSettings(context).filterKeep.value)
    }

    @Test
    fun savedFiltersRoundTripEveryFieldAndClearingForgetsThem() {
        val store = PrefsFilterStore(context)
        assertNull(store.load())
        val filters = EntryFilters("cafe", "a", "c", includeSubcategories = false, tagId = "t", from = "2026-10-01", to = "2026-10-31", kind = "expense", status = "pending")
        store.save(SavedFilters(filters, 1234L))
        assertEquals(SavedFilters(filters, 1234L), PrefsFilterStore(context).load())
        store.save(SavedFilters(EntryFilters(status = "cleared"), 99L))
        assertEquals(SavedFilters(EntryFilters(status = "cleared"), 99L), store.load())
        store.clear()
        assertNull(PrefsFilterStore(context).load())
    }
}
