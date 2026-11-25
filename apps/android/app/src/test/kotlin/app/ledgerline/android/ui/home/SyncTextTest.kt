package app.ledgerline.android.ui.home

import android.app.Application
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import app.ledgerline.android.ui.format.DayClock
import app.ledgerline.android.ui.format.LocalDayClock
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.util.TimeZone

/** The sync line says when the ledger was updated by the phone's 24-hour setting, and with the year only when it is not this year. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SyncTextTest {
    @get:Rule
    val compose = createComposeRule()

    private val zone = TimeZone.getDefault()

    @Before
    fun inUtc() = TimeZone.setDefault(TimeZone.getTimeZone("UTC"))

    @After
    fun back() = TimeZone.setDefault(zone)

    private fun show(updatedAt: String, is24Hour: Boolean, today: LocalDate = LocalDate.of(2026, 10, 22)) {
        compose.setContent {
            CompositionLocalProvider(LocalDayClock provides DayClock(today, is24Hour)) {
                Text(syncText(SyncLine(updatedAt, running = false, problem = null)) ?: "")
            }
        }
    }

    @Test
    fun todaysUpdateShowsATimeByThe12HourSetting() {
        show("2026-10-22T15:05:00Z", is24Hour = false)
        compose.onNodeWithText("Updated 3:05 PM").assertExists()
    }

    @Test
    fun todaysUpdateFollowsThePhones24HourSetting() {
        show("2026-10-22T15:05:00Z", is24Hour = true)
        compose.onNodeWithText("Updated 15:05").assertExists()
    }

    @Test
    fun anEarlierDayIsWrittenWithItsDay() {
        show("2026-10-21T15:05:00Z", is24Hour = true)
        compose.onNodeWithText("Updated Oct 21, 15:05").assertExists()
    }

    @Test
    fun anotherYearHasItsYear() {
        show("2025-10-21T15:05:00Z", is24Hour = true)
        compose.onNodeWithText("Updated Oct 21, 2025, 15:05").assertExists()
    }
}
