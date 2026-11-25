package app.ledgerline.android.ui.format

import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/**
 * Dates and times as the phone writes them (WP-22b): in the phone's language and order, with the 24-hour setting, and the
 * year only when it is not this year, as the web writes a day. They run under Robolectric because the patterns come from
 * the phone's own date library (`DateFormat.getBestDateTimePattern`).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class DateFormatsTest {
    private val us = Locale.US
    private val uk = Locale.UK
    private val de = Locale.GERMANY
    private val ja = Locale.JAPAN
    private val today = LocalDate.of(2026, 11, 25)
    private val chicago = ZoneId.of("America/Chicago")

    /** ICU writes a no-break space before "PM" in some versions; the words are what matter. */
    private fun String.plain() = replace(' ', ' ').replace(' ', ' ')

    // ---- a day, with the year only when it is not this year (the web's formatDay)

    @Test
    fun aDayThisYearLeavesOutTheYear() {
        assertEquals("Oct 12", formatDay("2026-10-12", today, us))
        assertEquals("12 Oct", formatDay("2026-10-12", today, uk))
        assertEquals("12. Okt.", formatDay("2026-10-12", today, de))
        assertEquals("10月12日", formatDay("2026-10-12", today, ja))
    }

    @Test
    fun aDayInAnotherYearHasTheYear() {
        assertEquals("Dec 31, 2025", formatDay("2025-12-31", today, us))
        assertEquals("31 Dec 2025", formatDay("2025-12-31", today, uk))
        assertEquals("31. Dez. 2025", formatDay("2025-12-31", today, de))
        assertEquals("2025年12月31日", formatDay("2025-12-31", today, ja))
    }

    @Test
    fun aDayNextYearHasTheYearToo() {
        assertEquals("Jan 3, 2027", formatDay("2027-01-03", today, us))
    }

    // ---- a day heading: weekday and year always

    @Test
    fun aDayHeadingHasTheWeekdayAndTheYearInThePhonesOrder() {
        assertEquals("Thu, Oct 22, 2026", formatDayHead("2026-10-22", us))
        assertEquals("Thu, 22 Oct 2026", formatDayHead("2026-10-22", uk))
        assertEquals("Do., 22. Okt. 2026", formatDayHead("2026-10-22", de))
        assertEquals("2026年10月22日(木)", formatDayHead("2026-10-22", ja))
    }

    // ---- months

    @Test
    fun aMonthIsNamedInThePhonesLanguageAndOrder() {
        assertEquals("October 2026", monthLabel("2026-10", us))
        assertEquals("octubre de 2026", monthLabel("2026-10", Locale.forLanguageTag("es")))
        assertEquals("Oktober 2026", monthLabel("2026-10", de))
        assertEquals("2026年10月", monthLabel("2026-10", ja))
        assertEquals("Oct", shortMonth("2026-10", us))
        assertEquals("Okt", shortMonth("2026-10", de))
    }

    // ---- a time of day, by the phone's 24-hour setting

    @Test
    fun aTimeFollowsThe24HourSetting() {
        assertEquals("15:05", formatClock("15:05", true, us))
        assertEquals("3:05 PM", formatClock("15:05", false, us).plain())
        assertEquals("09:05", formatClock("09:05", true, us))
        assertEquals("9:05 AM", formatClock("09:05", false, us).plain())
        assertEquals("15:05", formatClock("15:05", true, de))
        assertEquals("3:05 PM", formatClock("15:05", false, de).plain())
        assertEquals("15:05", formatClock("15:05:00", true, us))
    }

    @Test
    fun aTimeIsTheSameEverywhereForTheSameSetting() {
        // The editor, a service's hint and a payment's hint all go through formatClock: one answer for one setting.
        listOf(true, false).forEach { is24 -> assertEquals(formatClock("15:05", is24, us), formatClock("15:05:00", is24, us)) }
    }

    // ---- a moment from the server, in the phone's time zone

    @Test
    fun aMomentIsTheLocalDayAndTime() {
        assertEquals("Oct 21, 5:42 AM", formatServerMoment("2026-10-21T10:42:00Z", today, false, chicago, us).plain())
        assertEquals("Oct 21, 05:42", formatServerMoment("2026-10-21T10:42:00Z", today, true, chicago, us))
        assertEquals("21 Oct, 05:42", formatServerMoment("2026-10-21T10:42:00Z", today, true, chicago, uk))
    }

    @Test
    fun aMomentInAnotherYearHasTheYear() {
        assertEquals("Oct 21, 2025, 5:42 AM", formatServerMoment("2025-10-21T10:42:00Z", today, false, chicago, us).plain())
        assertEquals("Oct 21, 2025, 05:42", formatServerMoment("2025-10-21T10:42:00Z", today, true, chicago, us))
    }

    @Test
    fun aMomentFollowsTheZoneAcrossMidnight() {
        assertEquals("Oct 20, 11:30 PM", formatServerMoment("2026-10-21T04:30:00Z", today, false, chicago, us).plain())
        assertEquals("Oct 20, 23:30", formatServerMoment("2026-10-21T04:30:00Z", today, true, chicago, us))
    }

    @Test
    fun theLastUpdateShowsATimeTodayAndADayOtherwise() {
        val sameDay = LocalDate.of(2026, 10, 22)
        assertEquals("5:42 AM", formatUpdated("2026-10-22T10:42:00.000Z", chicago, sameDay, false, us).plain())
        assertEquals("05:42", formatUpdated("2026-10-22T10:42:00.000Z", chicago, sameDay, true, us))
        assertEquals("Oct 21, 5:42 AM", formatUpdated("2026-10-21T10:42:00Z", chicago, sameDay, false, us).plain())
        assertEquals("Oct 21, 2025, 5:42 AM", formatUpdated("2025-10-21T10:42:00Z", chicago, sameDay, false, us).plain())
    }

    // ---- the medium date a picker shows keeps its year

    @Test
    fun aChosenDateKeepsItsYear() {
        assertEquals("Oct 20, 2026", formatEntryDate("2026-10-20", us))
    }

    @Test
    fun aPatternIsBuiltOncePerLocaleAndSkeleton() {
        assertSame(formatterFor(us, "MMMd"), formatterFor(us, "MMMd"))
    }
}
