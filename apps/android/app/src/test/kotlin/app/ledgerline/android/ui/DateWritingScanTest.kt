package app.ledgerline.android.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Where a date or a time is written (WP-22b): in `ui/format` and nowhere else, so a screen cannot drift into its own order,
 * its own year rule or a time that ignores the phone's 24-hour setting.
 */
class DateWritingScanTest {
    private val main = File("src/main/kotlin/app/ledgerline/android")
    private val sources = main.walkTopDown().filter { it.extension == "kt" }.toList()
    private fun relative(file: File) = file.relativeTo(main).path.replace('\\', '/')

    private fun outsideFormat(pattern: String) = sources
        .filter { !relative(it).startsWith("ui/format/") && Regex(pattern).containsMatchIn(it.readText()) }
        .map { relative(it) }

    @Test
    fun theSourcesAreFound() {
        assertTrue(sources.size > 100)
    }

    @Test
    fun noScreenBuildsItsOwnDatePattern() {
        assertEquals(emptyList<String>(), outsideFormat("""DateTimeFormatter\.ofPattern|SimpleDateFormat|getBestDateTimePattern|\.toString\(\)\.take\(10\)"""))
    }

    @Test
    fun onlyTheDayClockReadsThe24HourSetting() {
        assertEquals(emptyList<String>(), outsideFormat("""is24HourFormat"""))
    }

    @Test
    fun noScreenKeepsAFunctionOfItsOwnForTimes() {
        assertEquals(emptyList<String>(), outsideFormat("""fun format(Time|ServiceTime|ShortDate|MomentShort)\b"""))
    }

    @Test
    fun theOldHardCodedUsPatternsAreGone() {
        // ("HH:mm" is the time the server takes, not a way of showing one, so it is not on the list.)
        assertEquals(emptyList<String>(), sources.filter { Regex(""""(EEE, MMM d, yyyy|MMM d|MMM d, |LLLL yyyy|h:mm a)"""").containsMatchIn(it.readText()) }.map { relative(it) })
    }
}
